import { describe, expect, it } from 'vitest'
import {
  compareMessages,
  dropSupersededLocalAssistants,
  orderMessages,
  reanchorInFlightLocals,
} from './message-order'
import type { ChatMessage } from './models'

/** Minimal message factory; only the fields ordering touches are set. */
function msg(over: Partial<ChatMessage> & { id: string }): ChatMessage {
  return {
    role: 'user',
    status: 'complete',
    parts: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    prevId: '',
    isLocal: false,
    seq: 0,
    ...over,
  }
}

const ids = (msgs: ChatMessage[]) => msgs.map(m => m.id)

describe('compareMessages', () => {
  it('orders purely by seq', () => {
    const a = msg({ id: 'a', seq: 2 })
    const b = msg({ id: 'b', seq: 1 })
    expect(compareMessages(a, b)).toBeGreaterThan(0)
    expect(compareMessages(b, a)).toBeLessThan(0)
  })

  it('IGNORES createdAt (the clock-skew bug): earlier timestamp with larger seq still sorts later', () => {
    const placeholder = msg({ id: 'assistant', seq: 2, createdAt: '2020-01-01T00:00:00.000Z' })
    const persistedUser = msg({ id: 'user', seq: 1, createdAt: '2030-01-01T00:00:00.000Z' })
    const sorted = [placeholder, persistedUser].sort(compareMessages)
    expect(ids(sorted)).toEqual(['user', 'assistant'])
  })

  it('treats a missing seq as last', () => {
    const withSeq = msg({ id: 'a', seq: 5 })
    const without = msg({ id: 'b', seq: undefined })
    expect(compareMessages(without, withSeq)).toBeGreaterThan(0)
  })
})

describe('orderMessages (chain anchoring)', () => {
  it('renders user A -> assistant A -> user B -> assistant B even though the server user message arrives while assistant A is LOCAL/streaming', () => {
    // The exact reported race: assistant A is a local streaming placeholder
    // anchored to user A; user B lands later as a SERVER message anchored to
    // assistant A's chain position.
    const uA = msg({ id: 'uA', isLocal: false })
    const aA = msg({ id: 'aA', role: 'assistant', status: 'streaming', isLocal: true, prevId: 'uA' })
    const uB = msg({ id: 'uB', isLocal: false, prevId: 'aA' })
    const aB = msg({ id: 'aB', role: 'assistant', status: 'streaming', isLocal: true, prevId: 'uB' })

    // Array order deliberately uB-first to prove order comes from the chain,
    // not from insertion order or server/local partitioning.
    const ordered = orderMessages([uA, aA, aB, uB])
    expect(ids(ordered)).toEqual(['uA', 'aA', 'uB', 'aB'])
  })

  it('keeps a local placeholder immediately after its anchor even when server rows arrive later in the array', () => {
    const uA = msg({ id: 'uA', isLocal: false })
    const aA = msg({ id: 'aA', role: 'assistant', status: 'streaming', isLocal: true, prevId: 'uA' })
    // Server copies arrive at the END of the array (delta append).
    const uB = msg({ id: 'uB', isLocal: false, prevId: 'aA' })
    const serverAA = msg({ id: 'aA-server', role: 'assistant', isLocal: false, prevId: 'uA' })
    void serverAA
    expect(ids(orderMessages([uA, aA, uB]))).toEqual(['uA', 'aA', 'uB'])
  })

  it('orders a clean server chain by prevId regardless of array order', () => {
    const m3 = msg({ id: 'm3', isLocal: false, prevId: 'm2' })
    const m1 = msg({ id: 'm1', isLocal: false })
    const m2 = msg({ id: 'm2', isLocal: false, prevId: 'm1' })
    expect(ids(orderMessages([m3, m1, m2]))).toEqual(['m1', 'm2', 'm3'])
  })

  it('keeps root order stable (array order) for sibling roots', () => {
    const r1 = msg({ id: 'r1', isLocal: false })
    const r2 = msg({ id: 'r2', isLocal: false })
    expect(ids(orderMessages([r1, r2]))).toEqual(['r1', 'r2'])
    expect(ids(orderMessages([r2, r1]))).toEqual(['r2', 'r1'])
  })

  it('keeps sibling children in array order', () => {
    const root = msg({ id: 'root', isLocal: false })
    const c1 = msg({ id: 'c1', isLocal: false, prevId: 'root' })
    const c2 = msg({ id: 'c2', isLocal: false, prevId: 'root' })
    expect(ids(orderMessages([root, c1, c2]))).toEqual(['root', 'c1', 'c2'])
  })

  it('puts an UNANCHORED local bubble at the tail, below server roots (retry bug)', () => {
    // A streaming placeholder whose anchor is momentarily invalid ('' or a
    // dangling id) must NOT sort above the chain just because callers prepend
    // local bubbles to the array.
    const server1 = msg({ id: 's1', isLocal: false })
    const server2 = msg({ id: 's2', isLocal: false, prevId: 's1' })
    const placeholder = msg({ id: 'ph', role: 'assistant', status: 'streaming', isLocal: true, prevId: '' })
    // Caller array order deliberately puts the local placeholder FIRST.
    expect(ids(orderMessages([placeholder, server1, server2]))).toEqual(['s1', 's2', 'ph'])
  })

  it('orders a sibling local placeholder after the server user message that shares its parent (mailbox B bug)', () => {
    // assistant A (server) -> local streaming A anchored to it; then user B
    // arrives as a SERVER message with the same parent. The placeholder must
    // follow user B, not sit beside it.
    const aA = msg({ id: 'aA', role: 'assistant', isLocal: false })
    const phA = msg({ id: 'phA', role: 'assistant', status: 'streaming', isLocal: true, prevId: 'aA' })
    const uB = msg({ id: 'uB', isLocal: false, prevId: 'aA' })
    // Siblings keep array order: local placeholder created first would render
    // before uB unless the controller re-anchors it. Here we assert the
    // ORDERING primitive itself respects an explicit re-anchor.
    const reanchored = { ...phA, prevId: 'uB' }
    expect(ids(orderMessages([aA, uB, reanchored]))).toEqual(['aA', 'uB', 'phA'])
  })

  it('does not drop a row whose prevId points outside the held window (dangling parent)', () => {
    const orphan = msg({ id: 'orphan', isLocal: false, prevId: 'not-held' })
    const other = msg({ id: 'other', isLocal: false })
    const ordered = orderMessages([orphan, other])
    expect(ordered).toHaveLength(2)
    expect(new Set(ids(ordered))).toEqual(new Set(['orphan', 'other']))
  })

  it('is cycle-safe (prevId loop cannot drop or hang)', () => {
    const a = msg({ id: 'a', isLocal: false, prevId: 'b' })
    const b = msg({ id: 'b', isLocal: false, prevId: 'a' })
    const ordered = orderMessages([a, b])
    expect(ordered).toHaveLength(2)
    expect(new Set(ids(ordered))).toEqual(new Set(['a', 'b']))
  })

  it('assigns contiguous seqs matching the output order', () => {
    const ordered = orderMessages([
      msg({ id: 'l', isLocal: true }),
      msg({ id: 'a', isLocal: false }),
      msg({ id: 'b', isLocal: false, prevId: 'a' }),
    ])
    expect(ordered.map(m => m.seq)).toEqual([0, 1, 2])
  })

  it('does not mutate the input array or its elements', () => {
    const input = [msg({ id: 'a', isLocal: false, seq: 99 }), msg({ id: 'l', isLocal: true, seq: 0 })]
    const snapshot = input.map(m => ({ id: m.id, seq: m.seq }))
    orderMessages(input)
    expect(input.map(m => ({ id: m.id, seq: m.seq }))).toEqual(snapshot)
  })
})

describe('reanchorInFlightLocals (mailbox B bug)', () => {
  it('moves an in-flight local reply to follow the newly-arrived server user message', () => {
    const aA = msg({ id: 'aA', role: 'assistant', isLocal: false })
    const phA = msg({ id: 'phA', role: 'assistant', status: 'streaming', isLocal: true, prevId: 'aA' })
    const uB = msg({ id: 'uB', isLocal: false, prevId: 'aA' })
    const out = reanchorInFlightLocals([aA, phA, uB], [uB])
    expect(ids(out)).toEqual(['aA', 'phA', 'uB'])
    expect(out.find(m => m.id === 'phA')!.prevId).toBe('uB')
    // And the chain order now renders user B before its reply.
    expect(ids(orderMessages(out))).toEqual(['aA', 'uB', 'phA'])
  })

  it('leaves already-complete locals untouched', () => {
    const aA = msg({ id: 'aA', role: 'assistant', isLocal: false })
    const done = msg({ id: 'done', role: 'assistant', status: 'complete', isLocal: true, prevId: 'aA' })
    const uB = msg({ id: 'uB', isLocal: false, prevId: 'aA' })
    const out = reanchorInFlightLocals([aA, done, uB], [uB])
    expect(out.find(m => m.id === 'done')!.prevId).toBe('aA')
  })

  it('ignores non-user server messages', () => {
    const aA = msg({ id: 'aA', role: 'assistant', isLocal: false })
    const ph = msg({ id: 'ph', role: 'assistant', status: 'streaming', isLocal: true, prevId: 'aA' })
    const aB = msg({ id: 'aB', role: 'assistant', isLocal: false, prevId: 'aA' })
    const out = reanchorInFlightLocals([aA, ph], [aB])
    expect(out.find(m => m.id === 'ph')!.prevId).toBe('aA')
  })

  it('returns the SAME reference when nothing changes (no needless re-render)', () => {
    const aA = msg({ id: 'aA', role: 'assistant', isLocal: false })
    const arr = [aA]
    expect(reanchorInFlightLocals(arr, [])).toBe(arr)
    expect(reanchorInFlightLocals(arr, [aA])).toBe(arr)
  })
})

describe('dropSupersededLocalAssistants', () => {
  it('drops a local assistant placeholder once the server holds its step (same parent)', () => {
    const u = msg({ id: 'u', isLocal: false })
    const localStep = msg({ id: 'ph', role: 'assistant', status: 'complete', isLocal: true, prevId: 'u' })
    const serverStep = msg({ id: 's1', role: 'assistant', isLocal: false, prevId: 'u' })
    const out = dropSupersededLocalAssistants([u, localStep], [u, serverStep])
    expect(ids(out)).toEqual(['u'])
  })

  it('keeps the in-flight step when the server has committed fewer steps for that parent', () => {
    const u = msg({ id: 'u', isLocal: false })
    const done1 = msg({ id: 'ph1', role: 'assistant', status: 'complete', isLocal: true, prevId: 'u' })
    const inflight2 = msg({ id: 'ph2', role: 'assistant', status: 'streaming', isLocal: true, prevId: 'u' })
    const server1 = msg({ id: 's1', role: 'assistant', isLocal: false, prevId: 'u' })
    const out = dropSupersededLocalAssistants([u, done1, inflight2], [u, server1])
    // One server step consumes ONE local placeholder; the streaming one remains.
    expect(out).toHaveLength(2)
    expect(out.map(m => m.id)).toContain('ph2')
  })

  it('leaves locals whose parent has no server assistant at all', () => {
    const u = msg({ id: 'u', isLocal: false })
    const ph = msg({ id: 'ph', role: 'assistant', status: 'streaming', isLocal: true, prevId: 'u' })
    const out = dropSupersededLocalAssistants([u, ph], [u])
    expect(ids(out)).toEqual(['u', 'ph'])
  })

  it('returns the SAME reference when nothing changes', () => {
    const u = msg({ id: 'u', isLocal: false })
    const arr = [u]
    expect(dropSupersededLocalAssistants(arr, [])).toBe(arr)
  })
})
