// MessagesController — the web port of flutter/lib/messages.dart (Svelte 5
// runes). Local-first boot (sqlite mirror) → incremental sync (tip anchor) →
// one long-lived watchSession stream per active session with exponential
// backoff reconnect, eid dedup and run boundaries.
import type { AgentApi } from './api'
import type { LocalStore } from './db'
import type { StreamEvent } from './events'
import {
  compareMessages,
  dropSupersededLocalAssistants,
  orderMessages,
  reanchorInFlightLocals,
} from './message-order'
import type { ChatMessage, ChatPart, Message, ToolState, UploadedFile } from './models'

type SessionListener = (event: string, params: Record<string, unknown>) => void

export function mapMessagesToChat(msgs: Message[]): ChatMessage[] {
  return msgs.map((m, i) => ({
    id: m.id,
    role: m.role,
    status: 'complete' as const,
    createdAt: m.createdAt ?? '',
    seq: i,
    isLocal: false,
    prevId: m.prevId,
    parts: m.parts.map(p => ({
      id: p.id || `p${Date.now()}${i}`,
      type: p.type,
      text: p.text ?? '',
      tool: p.tool ?? '',
      state: p.state ?? null,
      code: p.code ?? null,
      name: p.name ?? null,
      mime: p.mime ?? null,
      size: p.size ?? null,
      width: p.width ?? null,
      height: p.height ?? null,
      durationMs: p.durationMs ?? null,
      thumbCode: p.thumbCode ?? null,
      thumbhash: p.thumbhash ?? null,
    })),
  }))
}

// Re-export the pure ordering helpers for callers that only import this module.
export {
  compareMessages,
  dropSupersededLocalAssistants,
  orderMessages,
  reanchorInFlightLocals,
}

export class MessagesController {
  private api: AgentApi
  private getSessionId: () => string
  private local: LocalStore | null

  messages = $state<ChatMessage[]>([])
  sending = $state(false)
  loading = $state(false)
  hasMore = $state(false)

  /** PENDING (unconsumed) mailbox entries for the open session — drives the
   *  red badge on the top-bar mailbox button. Refreshed on boot, after a
   *  delivery, and whenever the chain advances (a drained entry is consumed). */
  pendingMailbox = $state(0)

  /** Bumped after every mutation so the UI can react via $effect. */
  revision = $state(0)

  private syncedTipId = ''
  private syncedOldestId = ''

  private streamAbort: AbortController | null = null
  private streamingId: string | null = null
  /** Local ERROR bubbles are not server chain members; keep them across
   *  authoritative refreshes (mergeServer/fetchMessages) instead of dropping
   *  them. Cleared per session in init. */
  private localErrors: ChatMessage[] = []
  private nextSeq = 1_000_000
  private sessionListeners: SessionListener[] = []

  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private reconnectAttempt = 0
  private subSid: string | null = null

  private seenEids = new Set<string>()
  private activeRunId: string | null = null
  private awaitingRun = false
  /** Message ids observed on the wire via `message-added` while a local send
   *  was still awaiting its `accepted` id. Closes the race where the backend
   *  persists + announces the prompt BEFORE the RPC response is processed:
   *  `send()` consults this set when it learns the server id. */
  private addedIds = new Set<string>()

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

  constructor(api: AgentApi, getSessionId: () => string, local: LocalStore | null, opts?: { sendFailed?: (e: unknown) => string }) {
    this.api = api
    this.getSessionId = getSessionId
    this.local = local
    if (opts?.sendFailed) this.sendFailedMsg = opts.sendFailed
  }

  get sorted(): ChatMessage[] {
    return [...this.messages].sort(compareMessages)
  }

  onSessionEvent(cb: SessionListener): () => void {
    this.sessionListeners.push(cb)
    return () => {
      this.sessionListeners = this.sessionListeners.filter(x => x !== cb)
    }
  }

  private allocSeq(): number {
    return this.nextSeq++
  }

  private notify() {
    this.revision++
  }

  /** Only the LOCAL bubbles still in flight. */
  private inFlightLocal(): ChatMessage[] {
    return this.messages.filter(m => m.isLocal && (m.status === 'streaming' || m.status === 'sending'))
  }

  private bumpSeqAfter(history: ChatMessage[]) {
    let maxSeq = -1
    for (const m of history) {
      if (m.seq != null && m.seq < this.nextSeq && m.seq > maxSeq) maxSeq = m.seq
    }
    if (maxSeq >= 0) this.nextSeq = maxSeq + 1
  }

  init() {
    this.localErrors = []
    const sid = this.getSessionId()
    if (!sid) return
    void this.boot(sid)
  }

  private async boot(sid: string) {
    await this.hydrateFromLocal(sid)
    await this.sync(sid)
    await this.recover()
    this.connect(sid)
    void this.refreshMailbox()
  }

  /** Count the session's PENDING (unconsumed) mailbox entries for the badge.
   *  Best-effort: a transient error keeps the last known count. */
  async refreshMailbox(): Promise<void> {
    const sid = this.getSessionId()
    if (!sid) {
      this.pendingMailbox = 0
      return
    }
    try {
      const entries = await this.api.mailbox(sid)
      this.pendingMailbox = entries.filter(e => e.status !== 'consumed').length
    } catch {
      /* keep the previous count */
    }
  }

  /** Enqueue the composer's text/attachments into the session mailbox WITHOUT
   *  triggering a turn. Used while the session is RUNNING: the running turn
   *  drains the mailbox at its next step boundary, so the message is delivered
   *  in-order and the red badge reflects the pending count. */
  async deliver(text: string, attachments: UploadedFile[] = []): Promise<void> {
    const trimmed = text.trim()
    if (!trimmed && !attachments.length) return
    const codes = attachments.map(a => a.code)
    await this.api.prompt(this.getSessionId(), trimmed, codes)
    // The mailbox row is written by the agent's durable consumer, not by the
    // RPC — poll briefly so the badge reflects the delivery without a manual
    // refresh (and the running turn's drain will later decrement it).
    await this.refreshMailbox()
    for (let i = 0; i < 6; i++) {
      await new Promise(r => setTimeout(r, 250))
      await this.refreshMailbox()
      if (this.pendingMailbox > 0) break
    }
  }

  private async hydrateFromLocal(sid: string) {
    const l = this.local
    if (!l) return
    try {
      const cached = await l.loadMessages(sid)
      // Only trust a stored anchor when we actually hold cached messages.
      this.syncedTipId = cached.length ? await l.serverTipId(sid) : ''
      this.syncedOldestId = cached.length ? await l.oldestCachedId(sid) : ''
      if (cached.length) {
        this.messages = [...cached, ...this.inFlightLocal()]
        this.renumber()
        this.notify()
      }
    } catch {
      /* cache unreadable — fall through network-only */
    }
  }

  /** Incremental when we hold an anchor, else a baseline fetch. */
  private async sync(sid: string) {
    const l = this.local
    this.loading = this.messages.length === 0
    this.notify()
    try {
      const cacheConsistent =
        this.messages.length === 0 ||
        (this.syncedTipId !== '' &&
          this.syncedOldestId !== '' &&
          (await l?.oldestCachedId(sid)) === this.syncedOldestId)
      if (l && this.syncedTipId && cacheConsistent) {
        const r = await this.api.messagesAfter(sid, this.syncedTipId)
        if (r.resync) {
          await this.baseline(sid)
        } else if (r.messages.length === 0 && this.messages.length === 0) {
          await this.baseline(sid)
        } else {
          this.mergeServer(r.messages, r.tipId)
          await l.persistMessages(sid, this.messages, r.tipId)
        }
      } else {
        await this.baseline(sid)
      }
    } catch {
      /* offline: keep whatever the local cache showed */
    }
    this.loading = false
    this.notify()
  }

  /** Full baseline: the newest page, replacing any cached copy. */
  private async baseline(sid: string) {
    try {
      const [msgs, more] = await this.api.messages(sid, undefined, 50)
      const chat = mapMessagesToChat(msgs)
      this.messages = [...this.inFlightLocal(), ...this.localErrors, ...chat]
      this.renumber()
      this.hasMore = more
      const l = this.local
      if (l) {
        this.syncedTipId = chat.length ? chat[chat.length - 1]!.id : ''
        await l.applyServerMessages(sid, msgs, { replace: true, tipId: this.syncedTipId })
        this.syncedOldestId = await l.oldestCachedId(sid)
      }
    } catch {
      /* keep the existing cache */
    }
  }

  /** Merge a server delta into memory, keeping in-flight local bubbles. A
   *  server message SUPERSEDES an optimistic bubble with the same id (the
   *  real, persisted copy is authoritative), so the send spinner clears as
   *  soon as the chain carries the message. */
  private mergeServer(msgs: Message[], tipId: string) {
    const hasServer = msgs.length > 0
    const chat = mapMessagesToChat(msgs)
    const serverIds = new Set(chat.map(m => m.id))
    // Local-bubble id → the server id that superseded it. A local assistant
    // placeholder chains onto its local user bubble; when that user bubble's
    // server copy arrives, the placeholder's `prevId` must be re-pointed at
    // the server id, otherwise its anchor dangles and it falls to a root.
    const remap = new Map<string, string>()
    const byId = new Map<string, ChatMessage>()
    for (const m of this.messages) {
      if (!m.isLocal) {
        byId.set(m.id, m)
        continue
      }
      const serverId =
        serverIds.has(m.id) ? m.id : (m.serverId != null && serverIds.has(m.serverId) ? m.serverId : null)
      if (serverId !== null) {
        remap.set(m.id, serverId)
        continue // the persisted copy replaces this local bubble
      }
      const inFlight = m.status === 'streaming' || m.status === 'sending'
      if (!hasServer || inFlight) byId.set(`local:${m.id}`, m)
    }
    for (const m of chat) byId.set(m.id, m)
    for (const m of this.localErrors) byId.set(`local:${m.id}`, m)
    const out = [...byId.values()]
    // 1) Re-anchor a surviving local bubble whose parent was just superseded.
    for (let i = 0; i < out.length; i++) {
      const m = out[i]!
      if (!m.isLocal) continue
      const next = remap.get(m.prevId)
      if (next !== undefined) out[i] = { ...m, prevId: next }
    }
    // 2) Drop local assistant placeholders the server has now persisted. A
    //    placeholder has no server id, so the id match above cannot remove it;
    //    without this, the persisted copy and its placeholder coexist as
    //    siblings and the list shuffles/duplicates on every reconcile.
    const surviving = dropSupersededLocalAssistants(out, chat)
    // 3) Serve in-flight local replies that SHOULD follow a newly-arrived
    //    server user message (see [reanchorInFlightLocals]).
    this.messages = reanchorInFlightLocals(surviving, chat)
    this.renumber()
    this.syncedTipId = tipId
  }

  /** Re-seat `seq` from the authoritative ordering (see [orderMessages]). */
  private renumber() {
    this.messages = orderMessages(this.messages)
    this.bumpSeqAfter(this.messages)
  }

  /**
   * The id a NEW message should chain onto: the tail of the authoritative
   * order (the last message after `orderMessages`), or '' when empty. Local
   * optimistic bubbles use this as their `prevId` so they slot into the chain
   * at the point they were created (right after the message they follow),
   * instead of being pinned to the tail by server/local partitioning.
   */
  private chainTipId(): string {
    if (this.messages.length === 0) return ''
    const ordered = orderMessages(this.messages)
    return ordered[ordered.length - 1]!.id
  }

  private async fetchMessages(before?: string) {
    this.loading = true
    this.notify()
    try {
      const sid = this.getSessionId()
      const [msgs, more] = await this.api.messages(sid, before, 50)
      const chat = mapMessagesToChat(msgs)
      if (before != null) {
        const existing = new Set(this.messages.map(m => m.id))
        this.messages = [...chat.filter(m => !existing.has(m.id)), ...this.messages]
      } else {
        this.messages = [...this.inFlightLocal(), ...this.localErrors, ...chat]
      }
      this.renumber()
      this.hasMore = more
    } catch {
      /* keep current view */
    }
    this.loading = false
    this.notify()
    const l = this.local
    if (l) {
      try {
        await l.persistMessages(this.getSessionId(), this.messages, this.syncedTipId)
        this.syncedOldestId = await l.oldestCachedId(this.getSessionId())
      } catch {
        /* ignore */
      }
    }
  }

  private async recover() {
    try {
      const [status] = await this.api.state(this.getSessionId())
      if (status === 'busy' || status === 'running') {
        this.sending = true
        if (!this.messages.some(m => m.status === 'streaming')) {
          this.streamingId = `recover-${Date.now()}`
          this.messages = [
            ...this.messages,
            {
              id: this.streamingId,
              role: 'assistant',
              status: 'streaming',
              parts: [],
              createdAt: new Date().toISOString(),
              isLocal: true,
              prevId: this.chainTipId(),
              seq: this.allocSeq(),
            },
          ]
        }
        this.notify()
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
        for await (const ev of this.api.streamEvents(sid, this.syncedTipId, ac.signal)) {
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
      if (!this.sending) return
      if (Date.now() - this.lastStreamEventAt < MessagesController.STREAM_STALE_MS) return
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
          .then(([st]) => (st === 'busy' || st === 'running' ? ('busy' as const) : ('idle' as const)))
          .catch(() => 'dead' as const),
        new Promise<'timeout'>(r =>
          setTimeout(() => r('timeout'), MessagesController.PROBE_TIMEOUT_MS),
        ),
      ])
      // A fresh event may have landed while probing: stand down.
      if (Date.now() - this.lastStreamEventAt < MessagesController.STREAM_STALE_MS) return
      if (sid !== this.getSessionId()) return
      if (probe === 'idle') {
        this.syncIdle()
        void this.reconcile()
        return
      }
      const now = Date.now()
      if (probe === 'busy' && now - this.lastRecoveryAt < MessagesController.HEALTHY_RECONNECT_COOLDOWN_MS) {
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

  private clearStreaming() {
    this.streamingId = null
    this.activeRunId = null
    if (this.messages.some(m => m.status === 'streaming')) {
      this.messages = this.messages.filter(m => m.status !== 'streaming')
    }
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
      if (Date.now() - this.lastActivity < MessagesController.IDLE_PROBE_EVERY) return
      this.api
        .state(this.getSessionId())
        .then(([st]) => {
          if (st === 'busy' || st === 'running') {
            if (!this.sending) {
              this.sending = true
              this.notify()
            }
          } else {
            // Idle on the server: converge and PULL anything the stream missed
            // (a half-open window can swallow the final turn-complete).
            this.syncIdle()
            void this.reconcile()
          }
        })
        .catch(() => {})
    }, MessagesController.IDLE_PROBE_EVERY)
  }

  /** Converge to idle if the stream ended without a terminal event. */
  private syncIdle() {
    if (!this.sending) return
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
    const { event, params } = ev
    switch (event) {
      case 'start-step':
      case 'text-start':
      case 'reasoning-start':
      case 'tool-input-start': {
        const current = this.streamingId
          ? this.messages.find(m => m.id === this.streamingId)
          : null
        const hasToolPart = current?.parts.some(p => p.type === 'tool') ?? false
        const sid = this.ensureStreamingMsg(
          event === 'start-step' || (event === 'text-start' && hasToolPart),
        )
        if (event === 'text-start' && params['id'] != null) {
          this.ensurePart(sid, params['id'] as string, 'text')
        } else if (event === 'reasoning-start' && params['id'] != null) {
          this.ensurePart(sid, `r${params['id']}`, 'reasoning')
        } else if (event === 'tool-input-start' && params['id'] != null) {
          this.startToolPart(
            sid,
            params['id'] as string,
            (params['toolName'] ?? params['name'] ?? 'tool') as string,
          )
        }
        break
      }
      case 'tool-input-delta': {
        if (params['id'] != null && params['delta'] != null) {
          this.appendToolInput(params['id'] as string, String(params['delta'] ?? ''))
        }
        break
      }
      case 'text-delta':
        if (params['id'] != null && params['text'] != null) {
          const sid = this.ensureStreamingMsg(false)
          this.appendDelta(sid, params['id'] as string, String(params['text'] ?? ''), false)
        }
        break
      case 'reasoning-delta':
        if (params['id'] != null && params['text'] != null) {
          const sid = this.ensureStreamingMsg(false)
          this.appendDelta(sid, `r${params['id']}`, String(params['text'] ?? ''), true)
        }
        break
      case 'tool-call': {
        const sid = this.ensureStreamingMsg(false)
        const tcId = (params['toolCallId'] ?? params['id']) as string | undefined
        if (tcId != null) {
          this.addToolPart(
            sid,
            tcId,
            (params['toolName'] ?? params['name'] ?? 'tool') as string,
            params['input'],
          )
        }
        break
      }
      case 'tool-result': {
        const tcId = (params['toolCallId'] ?? params['id']) as string | undefined
        if (tcId == null) break
        this.updateToolResult(tcId, params['formatted'] ?? params['output'] ?? params['result'], {
          errorMsg: undefined,
          changeId: params['change_id'] as string | undefined,
          diff: params['diff'] as string | undefined,
          additions: params['additions'] as number | undefined,
          deletions: params['deletions'] as number | undefined,
          data: (params['data'] as Record<string, unknown>) ?? undefined,
        })
        break
      }
      case 'tool-error': {
        const tcId = (params['toolCallId'] ?? params['id']) as string | undefined
        const errObj = params['error']
        const errMsg = (
          typeof errObj === 'string'
            ? errObj
            : errObj && typeof errObj === 'object'
              ? ((errObj as Record<string, unknown>)['message'] ?? params['message'] ?? 'tool error')
              : (params['message'] ?? 'tool error')
        ) as string
        if (tcId != null) this.updateToolResult(tcId, null, { errorMsg: errMsg })
        break
      }
      case 'tool-output-denied': {
        const tcId = (params['toolCallId'] ?? params['id']) as string | undefined
        if (tcId != null) this.updateToolResult(tcId, null, { errorMsg: 'denied' })
        break
      }
      case 'file':
      case 'reasoning-file': {
        // A streamed media part the agent has already offloaded to the blob
        // store; `code` is the file:<code> segment. Render it as a file part
        // (same path as persisted file parts). Both `file` and
        // `reasoning-file` are shown.
        const code = params['code'] as string | undefined
        if (code == null || code === '') break
        const sid = this.ensureStreamingMsg(false)
        const partId = `f${code}`
        const existing = this.messages
          .find(m => m.id === sid)
          ?.parts.some(p => p.id === partId)
        if (!existing) {
          this.setMsg(sid, m => ({
            ...m,
            parts: [
              ...m.parts,
              {
                id: partId,
                type: 'file',
                text: '',
                tool: '',
                code,
                name: (params['name'] as string | undefined) ?? null,
                mime: (params['mediaType'] as string | undefined) ?? null,
                size:
                  params['size'] != null ? Number(params['size']) : null,
                width:
                  params['width'] != null ? Number(params['width']) : null,
                height:
                  params['height'] != null ? Number(params['height']) : null,
                durationMs:
                  params['durationMs'] != null
                    ? Number(params['durationMs'])
                    : params['duration_ms'] != null
                      ? Number(params['duration_ms'])
                      : null,
                thumbCode:
                  (params['thumbCode'] as string | undefined) ??
                  (params['thumb_code'] as string | undefined) ??
                  null,
                thumbhash: (params['thumbhash'] as string | undefined) ?? null,
              },
            ],
          }))
        }
        break
      }
      case 'turn-complete':
        this.finishStreaming()
        void this.refreshMailbox()
        break
      case 'message-added': {
        // A new message landed in the chain (mailbox-only write path). The
        // event carries the persisted message id: if it matches an optimistic
        // bubble of ours that is still 'sending', clear its spinner (success).
        // Always pull the delta so the message appears without waiting for
        // turn-complete; do NOT clearStreaming (orthogonal to any in-flight
        // assistant turn).
        const addedId = params['message_id']
        if (typeof addedId === 'string' && addedId !== '') {
          this.addedIds.add(addedId)
          if (this.addedIds.size > 20000) this.addedIds.clear()
          // Clear the spinner on our optimistic bubble: match by local id
          // (already adopted) or by the recorded `serverId`. Stay `isLocal`
          // and stamp `serverId` so the `reconcile` below drops this bubble in
          // favour of the authoritative server copy (rather than rendering
          // both), while the actions reappear immediately.
          let matched = false
          this.messages = this.messages.map(m => {
            if (m.status === 'sending' && (m.id === addedId || m.serverId === addedId)) {
              matched = true
              return { ...m, status: 'complete' as const, serverId: addedId }
            }
            return m
          })
          // Fallback: the Prompt `accepted` response can be lost (stream drop)
          // while the write still lands. If exactly one unmatched optimistic
          // bubble is waiting, it must be this message — adopt it so the
          // spinner cannot hang forever.
          if (!matched) {
            const waiting = this.messages.filter(
              m => m.isLocal && m.role === 'user' && m.status === 'sending' && m.serverId == null,
            )
            if (waiting.length === 1) {
              const localId = waiting[0]!.id
              this.messages = this.messages.map(m =>
                m.id === localId
                  ? { ...m, status: 'complete' as const, serverId: addedId }
                  : m,
              )
            }
          }
          this.notify()
        }
        void this.reconcile()
        // A drained user_prompt is now CONSUMED, so the pending badge shrinks.
        void this.refreshMailbox()
        break
      }
      case 'chain-changed':
        this.clearStreaming()
        this.sending = false
        this.notify()
        void this.fetchMessages()
        break
      case 'status': {
        const stype = params['type']
        if (stype === 'busy' || stype === 'running') {
          this.sending = true
          this.notify()
        } else {
          this.finishStreaming()
        }
        break
      }
      case 'error':
      case 'provider-error': {
        const errObj = params['error']
        const content = (
          typeof errObj === 'string'
            ? errObj
            : errObj && typeof errObj === 'object'
              ? ((errObj as Record<string, unknown>)['message'] ?? params['message'] ?? 'Unknown error')
              : (params['message'] ?? 'Unknown error')
        ) as string
        this.addError(content)
        this.sending = false
        this.notify()
        break
      }
      default:
        break
    }
  }

  private ensureStreamingMsg(forceNew: boolean): string {
    if (this.streamingId) {
      const existing = this.messages.find(m => m.id === this.streamingId)
      if (existing && (!forceNew || existing.parts.length === 0)) return this.streamingId
      // A new step begins while the previous placeholder still has content:
      // the previous step is DONE (the server persists one message per step),
      // so finalize it instead of leaving a second `streaming` bubble behind.
      // Without this, a multi-step turn accumulated zombie `streaming` bubbles
      // (`assistant B streaming` stacked above `assistant A streaming`).
      if (existing) {
        const prevId = existing.id
        this.messages = this.messages.map(m =>
          m.id === prevId ? { ...m, status: 'complete' as const } : m,
        )
      }
    }
    const id = `m${Date.now()}`
    this.streamingId = id
    this.messages = [
      ...this.messages,
      {
        id,
        role: 'assistant',
        status: 'streaming',
        parts: [],
        createdAt: new Date().toISOString(),
        isLocal: true,
        // Anchor to the current chain tail so the new step renders right after
        // the step that just finished (not pinned to the list tail).
        prevId: this.chainTipId(),
        seq: this.allocSeq(),
      },
    ]
    return id
  }

  private setMsg(id: string, fn: (m: ChatMessage) => ChatMessage) {
    const idx = this.messages.findIndex(m => m.id === id)
    if (idx < 0) return
    this.messages[idx] = fn(this.messages[idx]!)
    this.notify()
  }

  private ensurePart(msgId: string, partId: string, type: string) {
    this.setMsg(msgId, m =>
      m.parts.some(p => p.id === partId)
        ? m
        : { ...m, parts: [...m.parts, { id: partId, type, text: '', tool: '' }] },
    )
  }

  private appendDelta(msgId: string, partId: string, delta: string, reasoning: boolean) {
    this.setMsg(msgId, m => {
      const pidx = m.parts.findIndex(p => p.id === partId)
      const parts = [...m.parts]
      if (pidx >= 0) {
        parts[pidx] = { ...parts[pidx]!, text: parts[pidx]!.text + delta }
      } else {
        parts.push({ id: partId, type: reasoning ? 'reasoning' : 'text', text: delta, tool: '' })
      }
      return { ...m, parts }
    })
  }

  /** Create the tool part as soon as argument streaming begins. */
  private startToolPart(msgId: string, partId: string, name: string) {
    this.setMsg(msgId, m => {
      if (m.parts.some(p => p.id === partId)) return m
      const state: ToolState = { status: 'running', title: name, inputText: '' }
      const part: ChatPart = { id: partId, type: 'tool', text: '', tool: name, state }
      return { ...m, parts: [...m.parts, part] }
    })
  }

  /** Accumulate streamed tool-argument JSON for the live preview. */
  private appendToolInput(partId: string, delta: string) {
    const sid = this.streamingId
    if (!sid) return
    this.setMsg(sid, m => {
      const parts = m.parts.map(p => {
        if (p.id !== partId) return p
        const old: ToolState = p.state ?? { status: '', title: '' }
        return { ...p, state: { ...old, inputText: (old.inputText ?? '') + delta } }
      })
      return { ...m, parts }
    })
  }

  private addToolPart(msgId: string, partId: string, name: string, input: unknown) {
    const asMap =
      input && typeof input === 'object' && !Array.isArray(input)
        ? (input as Record<string, unknown>)
        : null
    const state: ToolState = { status: 'running', title: name, input: asMap }
    this.setMsg(msgId, m => {
      const pidx = m.parts.findIndex(p => p.id === partId)
      const parts = [...m.parts]
      const part: ChatPart = { id: partId, type: 'tool', text: '', tool: name, state }
      if (pidx >= 0) parts[pidx] = part
      else parts.push(part)
      return { ...m, parts }
    })
  }

  private updateToolResult(
    partId: string,
    result: unknown,
    extra: {
      errorMsg?: string
      changeId?: string
      diff?: string
      additions?: number
      deletions?: number
      data?: Record<string, unknown>
    } = {},
  ) {
    const sid = this.streamingId
    if (!sid) return
    this.setMsg(sid, m => {
      const parts = m.parts.map(p => {
        if (p.id !== partId) return p
        const old = p.state ?? { status: '', title: '' }
        const output =
          typeof result === 'string' ? result : result == null ? null : pretty(result)
        return {
          ...p,
          state: {
            status: extra.errorMsg != null ? 'error' : 'complete',
            title: old.title,
            error: extra.errorMsg ?? old.error ?? null,
            input: old.input ?? null,
            output: output ?? old.output ?? null,
            data: extra.data ?? old.data ?? null,
            changeId: extra.changeId ?? old.changeId ?? null,
            diff: extra.diff ?? old.diff ?? null,
            additions: extra.additions ?? old.additions ?? null,
            deletions: extra.deletions ?? old.deletions ?? null,
          } satisfies ToolState,
        }
      })
      return { ...m, parts }
    })
  }

  private finishStreaming() {
    this.messages = this.messages.map(m =>
      m.status === 'streaming' ? { ...m, status: 'complete' as const } : m,
    )
    this.streamingId = null
    this.activeRunId = null
    this.sending = false
    this.notify()
    void this.reconcile()
  }

  /** After a turn completes (or a message-added nudge), pull the server delta
   *  and adopt real ids. Works without a local store: the merge is in-memory
   *  and persistence is simply skipped. */
  private async reconcile() {
    const l = this.local
    const sid = this.getSessionId()
    try {
      if (!this.syncedTipId) {
        await this.baseline(sid)
        return
      }
      const r = await this.api.messagesAfter(sid, this.syncedTipId)
      if (r.resync) {
        await this.baseline(sid)
        return
      }
      this.mergeServer(r.messages, r.tipId)
      this.notify()
      if (l) {
        await l.persistMessages(sid, this.messages, this.syncedTipId)
        this.syncedOldestId = await l.oldestCachedId(sid)
      }
    } catch {
      /* offline reconcile retry on next turn */
    }
  }

  private addError(text: string) {
    const now = Date.now()
    const err = {
      id: `err${now}`,
      role: 'error',
      status: 'error' as const,
      isLocal: true,
      parts: [{ id: `p${now}`, type: 'text' as const, text, tool: '' }],
      createdAt: new Date().toISOString(),
      prevId: this.chainTipId(),
      seq: this.allocSeq(),
    }
    this.localErrors.push(err)
    this.messages = [
      ...this.messages.filter(m => m.status !== 'streaming'),
      err,
    ]
    this.streamingId = null
  }

  async send(text: string, attachments: UploadedFile[] = []) {
    const trimmed = text.trim()
    if ((!trimmed && !attachments.length) || this.sending) return
    this.sending = true
    const codes = attachments.map(a => a.code)
    const now = Date.now()
    const userParts: ChatPart[] = [
      ...attachments.map(a => ({
        id: `f${a.code}`,
        type: 'file',
        text: '',
        tool: '',
        code: a.code,
        name: a.name ?? null,
        mime: a.mime ?? null,
        size: a.size ?? null,
      })),
      ...(trimmed
        ? [{ id: `p${now}`, type: 'text', text: trimmed, tool: '' }]
        : []),
    ]
    const localId = `u${now}`
    // Anchor the optimistic user bubble to the current chain tail, then the
    // assistant placeholder anchors to the user bubble — so the pair renders
    // in chain position rather than being pinned to the list tail.
    const anchor = this.chainTipId()
    this.messages = [
      ...this.messages.filter(m => m.status !== 'streaming'),
      {
        id: localId,
        role: 'user',
        status: 'sending',
        isLocal: true,
        parts: userParts,
        createdAt: new Date().toISOString(),
        prevId: anchor,
        seq: this.allocSeq(),
      },
    ]
    this.ensureStreamingMsg(true)
    this.notify()
    try {
      const messageId = await this.api.prompt(this.getSessionId(), trimmed, codes)
      if (messageId) {
        if (this.addedIds.has(messageId)) {
          // The `message-added` event beat this RPC response and reconcile has
          // already inserted the persisted copy — drop the optimistic bubble.
          this.messages = this.messages.filter(m => m.id !== localId)
        } else {
          // Record the server id; the spinner KEEPS SPINNING until the backend
          // `message-added` event confirms the write.
          this.messages = this.messages.map(m =>
            m.id === localId ? { ...m, serverId: messageId } : m,
          )
        }
        this.notify()
      }
    } catch (e) {
      // Drop the optimistic bubble: the send never landed.
      this.messages = this.messages.filter(m => m.id !== localId)
      this.addError(this.sendFailedMsg(e))
      this.sending = false
      this.notify()
    }
  }

  stop() {
    void this.api.interrupt(this.getSessionId()).then(() => this.finishStreaming())
  }

  async revert(messageId: string) {
    if (this.sending) {
      await this.api.interrupt(this.getSessionId())
    }
    await this.api.revert(this.getSessionId(), messageId)
    this.clearStreaming()
    this.sending = false
    await this.fetchMessages()
  }

  /** Retry/Edit: withdraw a user message and everything after, then resend. */
  async resendFrom(msg: ChatMessage, text: string) {
    const trimmed = text.trim()
    if (!trimmed) return
    if (this.sending) {
      await this.api.interrupt(this.getSessionId())
    }
    const codes = msg.parts
      .filter(p => p.type === 'file')
      .map(p => p.code ?? '')
      .filter(c => !!c)
    await this.api.revert(this.getSessionId(), msg.id)
    this.clearStreaming()
    this.sending = false
    await this.fetchMessages()
    await this.send(trimmed, codes.map(code => ({ code, name: null, mime: null } as UploadedFile)))
  }

  async loadMore() {
    if (!this.hasMore || this.loading) return
    const first = this.sorted[0]
    if (!first) return
    await this.fetchMessages(first.id)
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

function pretty(o: unknown): string {
  if (typeof o === 'object' && o != null) return JSON.stringify(o, null, 2)
  return String(o)
}
