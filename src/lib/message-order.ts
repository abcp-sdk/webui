// Message-list ordering — deliberately PURE (no runes, no Svelte) so it can be
// unit-tested directly and reasoned about in isolation.
//
// Model: the list is a CHAIN. Every message carries `prevId` — the id of the
// message it directly follows ('' at the head). Server messages come with a
// real `prevId`; optimistic LOCAL bubbles are anchored to the message they
// follow, so they slot into the chain at the right place instead of being
// pinned to the tail.
//
// WHY NOT sort by time: server rows carry the SERVER clock and optimistic
// bubbles carry the CLIENT clock; any skew between a device and the server
// (mobile clocks drift) would sort a reply above the user message it answers.
// WHY NOT partition server-first/local-last: a mailbox prompt that lands while
// another turn streams is a SERVER message while the streaming reply is LOCAL,
// so partitioning pushed the new user message ABOVE the in-flight reply —
// `user A -> user B -> assistant A` instead of `user A -> assistant A ->
// user B`. Chain anchoring fixes both: order is structural, never temporal.
import type { ChatMessage } from './models'

/** Order by `seq` ONLY (never `createdAt`). `seq` is re-seated by [orderMessages]. */
export function compareMessages(a: ChatMessage, b: ChatMessage): number {
  return (a.seq ?? 1 << 30) - (b.seq ?? 1 << 30)
}

/**
 * Re-point in-flight LOCAL bubbles at the newly-arrived server messages they
 * should follow.
 *
 * Scenario (mailbox prompt delivered while another turn streams): user B is
 * persisted by the agent and arrives as a SERVER message, while its reply is a
 * LOCAL streaming placeholder created BEFORE user B arrived. The placeholder's
 * `prevId` still names user B's parent, so the two are siblings and the reply
 * renders ABOVE its user message. For every new server USER message S, any
 * in-flight local bubble sharing S's parent is moved to follow S.
 *
 * Pure: returns the same array reference when nothing changes.
 */
export function reanchorInFlightLocals(
  msgs: ChatMessage[],
  newServer: ChatMessage[],
): ChatMessage[] {
  const userServers = newServer.filter(s => !s.isLocal && s.role === 'user')
  if (userServers.length === 0) return msgs
  let changed = false
  const out = msgs.map(m => {
    if (!m.isLocal) return m
    const inFlight = m.status === 'streaming' || m.status === 'sending'
    if (!inFlight) return m
    const s = userServers.find(u => u.id !== m.id && u.prevId === m.prevId)
    if (s === undefined) return m
    changed = true
    return { ...m, prevId: s.id }
  })
  return changed ? out : msgs
}

/**
 * Drop local assistant placeholders the SERVER has now superseded.
 *
 * A streaming placeholder reuses no server id, so `mergeServer`'s id match can
 * never drop it — the persisted copy and the local placeholder then coexist as
 * two siblings (both `prevId = parent`), and the pair shuffles/duplicates
 * through every reconcile. The authoritative signal is POSITION, not id: if the
 * server now holds an assistant message with the SAME `prevId` as a local
 * assistant bubble, that server message IS the persisted form of that bubble,
 * so the local copy must go.
 *
 * This is what keeps a multi-step turn from stacking `assistant streaming`
 * bubbles and stops the "streaming B above user B" shuffle.
 *
 * Pure: returns the same array reference when nothing changes.
 */
export function dropSupersededLocalAssistants(
  msgs: ChatMessage[],
  server: ChatMessage[],
): ChatMessage[] {
  const serverAssistants = server.filter(s => !s.isLocal && s.role === 'assistant')
  if (serverAssistants.length === 0) return msgs
  // Server assistant count per parent: a local placeholder may coexist with a
  // persisted step, but only up to as many steps as the server has committed
  // for that parent. Any placeholder beyond the server's count is the IN-FLIGHT
  // next step and must survive.
  const committedByParent = new Map<string, number>()
  for (const s of serverAssistants) {
    committedByParent.set(s.prevId, (committedByParent.get(s.prevId) ?? 0) + 1)
  }
  const consumed = new Map<string, number>()
  let changed = false
  const out = msgs.filter(m => {
    if (!m.isLocal || m.role !== 'assistant') return true
    const budget = committedByParent.get(m.prevId)
    if (budget === undefined) return true
    const used = consumed.get(m.prevId) ?? 0
    if (used >= budget) return true // in-flight step with no server copy yet
    consumed.set(m.prevId, used + 1)
    changed = true
    return false
  })
  return changed ? out : msgs
}

/**
 * Order the list as a forest of `prevId` chains, then assign contiguous
 * `seq = index`. Siblings keep their array order (stable).
 *
 * A LOCAL bubble with no valid anchor is treated as the NEWEST thing and sorted
 * AFTER every server root, not by array position. Callers prepend in-flight
 * local bubbles (`[...inFlightLocal(), ...serverChat]`), so array-order roots
 * would put a momentarily-unanchored streaming placeholder ABOVE the messages
 * it answers — the "retry puts the new message at the bottom while the reply
 * streams at the top" bug.
 */
export function orderMessages(msgs: ChatMessage[]): ChatMessage[] {
  const index = new Map<string, number>()
  for (let i = 0; i < msgs.length; i++) index.set(msgs[i]!.id, i)
  const byId = new Map(msgs.map(m => [m.id, m]))
  const children = new Map<string, ChatMessage[]>()
  const serverRoots: ChatMessage[] = []
  const localRoots: ChatMessage[] = []
  for (const m of msgs) {
    const p = m.prevId
    // A parent we actually hold (never self, never a dangling id) makes this a
    // child; everything else is a root. Dangling ids are common transiently
    // (pagination window), so they must not drop the row.
    if (p && p !== m.id && byId.has(p)) {
      const arr = children.get(p)
      if (arr) arr.push(m)
      else children.set(p, [m])
    } else if (m.isLocal) {
      localRoots.push(m)
    } else {
      serverRoots.push(m)
    }
  }
  const byArrayOrder = (a: ChatMessage, b: ChatMessage) =>
    (index.get(a.id) ?? 0) - (index.get(b.id) ?? 0)
  const out: ChatMessage[] = []
  const seen = new Set<string>()
  const visit = (m: ChatMessage) => {
    if (seen.has(m.id)) return // cycle guard (defensive)
    seen.add(m.id)
    out.push(m)
    const kids = children.get(m.id)
    if (kids) for (const k of [...kids].sort(byArrayOrder)) visit(k)
  }
  // Server roots first (their array order), then unanchorable LOCAL bubbles
  // (newest) last — never above the chain.
  for (const r of [...serverRoots].sort(byArrayOrder)) visit(r)
  for (const r of [...localRoots].sort(byArrayOrder)) visit(r)
  // Defensive: any row unreachable via the walk (cyclic prevId) is appended in
  // array order so it is never silently dropped.
  for (const m of msgs) if (!seen.has(m.id)) out.push(m)
  return out.map((m, i) => ({ ...m, seq: i }))
}
