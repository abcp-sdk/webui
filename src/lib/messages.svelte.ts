// MessagesController — the web port of flutter/lib/messages.dart (Svelte 5
// runes). Local-first boot (sqlite mirror) → incremental sync (tip anchor) →
// one long-lived watchSession stream per active session with exponential
// backoff reconnect, eid dedup and run boundaries.
//
// Responsibilities are split:
//   - MessageStore  (message-store.svelte.ts)  reactive list + mutations
//   - MessageSync   (message-sync.ts)          local mirror + server delta
//   - applyStreamEvent (message-events.ts)     pure event → store router
//   - this class    TRANSPORT (stream, reconnect, watchdog, idle probe),
//                   the mailbox, and the public actions (deliver/revert/…).
// `messages`/`sorted`/`sending`/… are re-exposed as getters so call sites are
// unchanged.
import type { AgentApi } from './api'
import type { LocalStore } from './db'
import type { StreamEvent } from './events'
import { applyStreamEvent } from './message-events'
import { compareMessages, orderMessages } from './message-order'
import { MessageStore } from './message-store.svelte'
import { MessageSync } from './message-sync'
import type { ChatMessage, UploadedFile } from './models'

export { mapMessagesToChat } from './message-mapping'
export { compareMessages, orderMessages }

type SessionListener = (event: string, params: Record<string, unknown>) => void

export class MessagesController {
  private api: AgentApi
  private getSessionId: () => string

  /** Reactive message list + all content/part mutations. */
  readonly store = new MessageStore()
  /** Local-first mirror + server sync (owns the tip/oldest anchors). */
  private sync: MessageSync

  private streamAbort: AbortController | null = null
  private sessionListeners: SessionListener[] = []

  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private reconnectAttempt = 0
  private subSid: string | null = null

  private seenEids = new Set<string>()
  private activeRunId: string | null = null
  private awaitingRun = false

  private static MAX_RECONNECT = 10
  private static INITIAL_RECONNECT = 1000
  private static MAX_RECONNECT_MS = 30_000
  private static IDLE_PROBE_EVERY = 20_000
  /**
   * A long-lived server stream can go HALF-OPEN: the socket dies (mobile
   * network handoff, NAT timeout, HTTP/2 GOAWAY lost) but `read()` neither
   * resolves nor rejects, so `onStreamClosed` never fires and the client waits
   * forever. The sidebar keeps updating (it uses a SEPARATE `watchSessions`
   * stream) while the open chat freezes — the classic "must refresh to see the
   * reply" bug. These bound the silence: once a believed-active turn has
   * produced no stream event for STREAM_STALE_MS, force a reconnect.
   */
  private static STREAM_STALE_MS = 15_000
  private static WATCHDOG_EVERY = 5_000
  /** Bounded liveness probe: a healthy transport must answer State fast. */
  private static PROBE_TIMEOUT_MS = 4_000
  /** While the transport stays healthy, reconnect at most this often. */
  private static HEALTHY_RECONNECT_COOLDOWN_MS = 60_000
  private idleProbeTimer: ReturnType<typeof setInterval> | null = null
  private watchdogTimer: ReturnType<typeof setInterval> | null = null
  private lastActivity = Date.now()
  /** Wall-clock of the last event RECEIVED on the per-session stream. */
  private lastStreamEventAt = Date.now()
  private lastRecoveryAt = 0
  private probing = false

  private sendFailedMsg = (e: unknown): string => `send failed: ${e}`

  constructor(
    api: AgentApi,
    getSessionId: () => string,
    local: LocalStore | null,
    opts?: { sendFailed?: (e: unknown) => string },
  ) {
    this.api = api
    this.getSessionId = getSessionId
    this.sync = new MessageSync(api, getSessionId, local, this.store)
    if (opts?.sendFailed) this.sendFailedMsg = opts.sendFailed
  }

  // ---- reactive surface (delegated to the store) ----

  get messages(): ChatMessage[] {
    return this.store.messages
  }
  get sorted(): ChatMessage[] {
    return this.store.sorted
  }
  get sending(): boolean {
    return this.store.sending
  }
  get loading(): boolean {
    return this.store.loading
  }
  get hasMore(): boolean {
    return this.store.hasMore
  }
  get pendingMailbox(): number {
    return this.store.pendingMailbox
  }
  get revision(): number {
    return this.store.revision
  }
  get awaitingSend(): boolean {
    return this.store.awaitingSend
  }

  onSessionEvent(cb: SessionListener): () => void {
    this.sessionListeners.push(cb)
    return () => {
      this.sessionListeners = this.sessionListeners.filter(x => x !== cb)
    }
  }

  init() {
    this.store.reset()
    const sid = this.getSessionId()
    if (!sid) return
    void this.boot(sid)
  }

  private async boot(sid: string) {
    await this.sync.hydrate(sid)
    await this.sync.sync(sid)
    await this.recover()
    this.connect(sid)
    void this.refreshMailbox()
  }

  /** Count the session's PENDING (unconsumed) mailbox entries for the badge.
   *  Best-effort: a transient error keeps the last known count. */
  async refreshMailbox(): Promise<void> {
    const sid = this.getSessionId()
    if (!sid) {
      this.store.pendingMailbox = 0
      return
    }
    try {
      // Newest page only: pending entries are the most recent, so the badge
      // reads correctly without paging the whole queue.
      const { entries } = await this.api.mailbox(sid)
      this.store.pendingMailbox = entries.filter(
        e => e.status !== 'consumed',
      ).length
    } catch {
      /* keep the previous count */
    }
  }

  /** Send a prompt (mailbox-only, whether the session is idle or busy).
   *
   *  The composer spins only while the send RPC is in flight; it stops as soon
   *  as the server ACCEPTS the prompt, i.e. the message is durably enqueued in
   *  the mailbox. It must NOT wait for `message-added{role:user}`: the agent
   *  only persists the row when the running turn next drains the mailbox (a
   *  step boundary), which can be minutes into a long model call or tool — the
   *  send is already complete at `accepted`. The user bubble still appears from
   *  `message-added` (server-driven id/position); never a client-optimistic
   *  row. */
  async deliver(text: string, attachments: UploadedFile[] = []): Promise<void> {
    const trimmed = text.trim()
    if (!trimmed && !attachments.length) return
    const codes = attachments.map(a => a.code)
    this.store.awaitingSend = true
    this.store.notify()
    try {
      // Resolves on the server's `accepted` event = durably in the mailbox.
      await this.api.prompt(this.getSessionId(), trimmed, codes)
      this.store.awaitingSend = false
      this.store.notify()
    } catch (e) {
      this.store.addError(this.sendFailedMsg(e))
      this.store.awaitingSend = false
      this.store.notify()
      throw e
    }
  }

  private async recover() {
    // A busy session is reconstructed from the stream itself: replay delivers
    // the live step's `message-added{streaming:true}` (with its server id) plus
    // its deltas, so no client-invented placeholder is needed here.
    try {
      const [status] = await this.api.state(this.getSessionId())
      if (status === 'busy' || status === 'running') {
        this.store.sending = true
        this.store.notify()
      }
    } catch {
      /* offline */
    }
  }

  private connect(sid: string) {
    this.reconnectTimer && clearTimeout(this.reconnectTimer)
    this.reconnectTimer = null
    this.streamAbort?.abort()
    const ac = new AbortController()
    this.streamAbort = ac
    this.subSid = sid
    this.reconnectAttempt = 0
    this.lastActivity = Date.now()
    this.idleProbeTimer && clearInterval(this.idleProbeTimer)
    // Run boundary: the FIRST event of the new connection resets stale
    // streaming state; replay rebuilds it cleanly.
    this.seenEids.clear()
    this.activeRunId = null
    this.awaitingRun = true
    this.lastStreamEventAt = Date.now()
    void (async () => {
      try {
        for await (const ev of this.api.streamEvents(
          sid,
          this.sync.syncedTipId,
          ac.signal,
        )) {
          if (ac.signal.aborted) return
          this.lastStreamEventAt = Date.now()
          this.handleEvent(ev)
        }
        this.onStreamClosed(sid)
      } catch {
        if (!ac.signal.aborted) this.onStreamClosed(sid)
      }
    })()
    this.startIdleProbe()
    this.startWatchdog()
  }

  /**
   * Detect a HALF-OPEN per-session stream and force a reconnect. When the
   * session is believed busy but no stream event has arrived for
   * STREAM_STALE_MS, the stream may be dead WITHOUT an error (a dropped socket
   * or a server-side ordered consumer that stopped yielding) — so
   * `onStreamClosed` never fires and the client waits forever. Tear it down and
   * reconnect; the new subscription replays from the tip anchor (eid dedup
   * makes the overlap harmless). This is what lets a mailbox-drained
   * continuation surface without a manual page refresh.
   *
   * `lastStreamEventAt` is reset on every reconnect, so a genuinely long quiet
   * tool reconnects at most once per STREAM_STALE_MS — bounded and safe.
   */
  private startWatchdog() {
    this.watchdogTimer && clearInterval(this.watchdogTimer)
    this.watchdogTimer = setInterval(() => {
      if (!this.store.sending) return
      if (
        Date.now() - this.lastStreamEventAt <
        MessagesController.STREAM_STALE_MS
      )
        return
      const sid = this.subSid ?? this.getSessionId()
      if (!sid || sid !== this.getSessionId()) return
      void this.recoverStaleStream(sid)
    }, MessagesController.WATCHDOG_EVERY)
  }

  /**
   * Decide whether a silent stream is dead and reconnect if so.
   *
   * A unary `State` over the SAME connection is the discriminator:
   *  - it hangs/errors  → the transport is half-open (dead socket): reconnect
   *    immediately, resetting the backoff budget (liveness, not a crash loop).
   *  - it answers idle  → the turn finished but its terminal event was lost:
   *    converge and pull the delta.
   *  - it answers busy  → the transport is healthy but the ordered consumer
   *    stopped yielding (or a genuinely quiet long tool). Reconnect anyway —
   *    replay-from-anchor + eid dedup make it harmless — but rate-limit to one
   *    attempt per HEALTHY_RECONNECT_COOLDOWN_MS so a quiet tool cannot cause
   *    a reconnect storm.
   */
  private async recoverStaleStream(sid: string): Promise<void> {
    if (this.probing) return
    this.probing = true
    try {
      const probe = await Promise.race([
        this.api
          .state(sid)
          .then(([st]) =>
            st === 'busy' || st === 'running'
              ? ('busy' as const)
              : ('idle' as const),
          )
          .catch(() => 'dead' as const),
        new Promise<'timeout'>(r =>
          setTimeout(() => r('timeout'), MessagesController.PROBE_TIMEOUT_MS),
        ),
      ])
      // A fresh event may have landed while probing: stand down.
      if (
        Date.now() - this.lastStreamEventAt <
        MessagesController.STREAM_STALE_MS
      )
        return
      if (sid !== this.getSessionId()) return
      if (probe === 'idle') {
        this.syncIdle()
        void this.sync.reconcile()
        return
      }
      const now = Date.now()
      if (
        probe === 'busy' &&
        now - this.lastRecoveryAt <
          MessagesController.HEALTHY_RECONNECT_COOLDOWN_MS
      ) {
        return
      }
      this.lastRecoveryAt = now
      this.reconnectAttempt = 0
      this.lastStreamEventAt = now
      this.streamAbort?.abort()
      this.connect(sid)
    } finally {
      this.probing = false
    }
  }

  /** Drop any still-streaming local bubble and leave the active run. */
  private clearStreaming() {
    this.store.clearStreaming()
    this.activeRunId = null
  }

  private onStreamClosed(sid: string) {
    if (this.subSid != null && this.subSid !== sid) return
    this.syncIdle()
    if (sid !== this.getSessionId()) return
    if (this.reconnectAttempt >= MessagesController.MAX_RECONNECT) return
    const delay = Math.min(
      MessagesController.MAX_RECONNECT_MS,
      MessagesController.INITIAL_RECONNECT * 2 ** this.reconnectAttempt,
    )
    this.reconnectAttempt++
    this.reconnectTimer = setTimeout(() => this.connect(sid), delay)
  }

  private startIdleProbe() {
    this.idleProbeTimer && clearInterval(this.idleProbeTimer)
    this.idleProbeTimer = setInterval(() => {
      if (Date.now() - this.lastActivity < MessagesController.IDLE_PROBE_EVERY)
        return
      this.api
        .state(this.getSessionId())
        .then(([st]) => {
          if (st === 'busy' || st === 'running') {
            if (!this.store.sending) {
              this.store.sending = true
              this.store.notify()
            }
          } else {
            // Idle on the server: converge and PULL anything the stream missed
            // (a half-open window can swallow the final turn-complete).
            this.syncIdle()
            void this.sync.reconcile()
          }
        })
        .catch(() => {})
    }, MessagesController.IDLE_PROBE_EVERY)
  }

  /** Converge to idle if the stream ended without a terminal event. */
  private syncIdle() {
    if (!this.store.sending) return
    this.finishStreaming()
  }

  private handleEvent(ev: StreamEvent) {
    this.lastActivity = Date.now()
    // Dedup across the subscribe/replay overlap.
    if (ev.eid) {
      if (this.seenEids.has(ev.eid)) return
      this.seenEids.add(ev.eid)
      if (this.seenEids.size > 20000) this.seenEids.clear()
    }
    // Run boundary handling.
    if (this.awaitingRun) {
      this.awaitingRun = false
      this.clearStreaming()
    }
    const run = ev.runId
    if (run && run !== this.activeRunId) {
      if (this.activeRunId != null) this.clearStreaming()
      this.activeRunId = run
    }
    for (const cb of this.sessionListeners) {
      try {
        cb(ev.event, ev.params)
      } catch {
        /* listener errors are not fatal */
      }
    }
    // Translate the event into store mutations (pure router, see message-events).
    applyStreamEvent(this.store, ev.event, ev.params, {
      finishStreaming: () => this.finishStreaming(),
      refreshMailbox: () => void this.refreshMailbox(),
      reconcile: () => void this.sync.reconcile(),
      clearStreaming: () => this.clearStreaming(),
      fetchMessages: () => void this.sync.fetch(),
    })
  }

  /** Mark every streaming bubble complete, leave the busy state, and pull the
   *  authoritative delta. */
  private finishStreaming() {
    this.store.finishStreaming()
    this.activeRunId = null
    void this.sync.reconcile()
  }

  stop() {
    void this.api
      .interrupt(this.getSessionId())
      .then(() => this.finishStreaming())
  }

  async revert(messageId: string) {
    if (this.store.sending) {
      await this.api.interrupt(this.getSessionId())
    }
    await this.api.revert(this.getSessionId(), messageId)
    this.clearStreaming()
    this.store.sending = false
    await this.sync.fetch()
  }

  /** Retry/Edit: withdraw a user message and everything after, then resend. */
  async resendFrom(msg: ChatMessage, text: string) {
    const trimmed = text.trim()
    if (!trimmed) return
    if (this.store.sending) {
      await this.api.interrupt(this.getSessionId())
    }
    const codes = msg.parts
      .filter(p => p.type === 'file')
      .map(p => p.code ?? '')
      .filter(c => !!c)
    await this.api.revert(this.getSessionId(), msg.id)
    this.clearStreaming()
    this.store.sending = false
    await this.sync.fetch()
    await this.deliver(
      trimmed,
      codes.map(code => ({ code, name: null, mime: null }) as UploadedFile),
    )
  }

  async loadMore() {
    if (!this.store.hasMore || this.store.loading) return
    const first = this.store.sorted[0]
    if (!first) return
    await this.sync.fetch(first.id)
  }

  dispose() {
    this.reconnectTimer && clearTimeout(this.reconnectTimer)
    this.reconnectTimer = null
    this.idleProbeTimer && clearInterval(this.idleProbeTimer)
    this.idleProbeTimer = null
    this.watchdogTimer && clearInterval(this.watchdogTimer)
    this.watchdogTimer = null
    this.streamAbort?.abort()
    this.streamAbort = null
  }
}
