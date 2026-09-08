import { agent, toAgentEvent, type AgentEvent } from './agent'
import {
  type Session,
  type Message,
  type Part,
} from '@abcp/agent-sdk'
import { create } from '@bufbuild/protobuf'
import { PartSchema } from '@abcp/agent-sdk'
import { breakpoint, type Breakpoint } from './responsive'
import { loadTheme, applyTheme, saveTheme, type Theme } from './theme'

interface LocalMessage {
  id: string
  role: string
  prevId: string
  createdAt: string
  parts: Part[]
  __local?: boolean
}

export interface DisplayMessage {
  id: string
  role: string
  text: string
  reasoning: string
  tools: { id: string; name: string; output: string }[]
  streaming: boolean
}

function toDisplay(m: { id: string; role: string; parts?: Part[]; __local?: boolean }): DisplayMessage {
  let text = ''
  let reasoning = ''
  const tools: { id: string; name: string; output: string }[] = []
  for (const p of m.parts ?? []) {
    if (p.type === 'text') text += p.data
    else if (p.type === 'reasoning') reasoning += p.data
    else if (p.type === 'tool') {
      let name = p.data
      let output = ''
      try {
        const j = JSON.parse(p.data)
        name = String(j['toolName'] ?? j['name'] ?? name)
        output = String(j['formatted'] ?? j['output'] ?? j['result'] ?? '')
      } catch {
        // already plain
      }
      tools.push({ id: p.id, name, output })
    }
  }
  return { id: m.id, role: m.role, text, reasoning, tools, streaming: !!m.__local }
}

class AgentStore {
  sessions = $state<Session[]>([])
  activeName = $state<string>('')
  messages = $state<DisplayMessage[]>([])
  sending = $state(false)
  loading = $state(false)
  theme = $state<Theme>(loadTheme())
  bp = $state<Breakpoint>(breakpoint())
  private controller: AbortController | null = null
  private raw: LocalMessage[] = []

  constructor() {
    applyTheme(this.theme)
    window.addEventListener('resize', () => (this.bp = breakpoint()))
  }

  get isCompact() {
    return this.bp === 'compact'
  }

  setTheme(t: Theme) {
    this.theme = t
    saveTheme(t)
  }

  async refreshSessions() {
    const r = await agent.listSessions({})
    this.sessions = r.sessions
  }

  async selectSession(name: string) {
    this.activeName = name
    this.loading = true
    this.stopStream()
    try {
      const r = await agent.listMessages({ id: name, limit: 50 })
      this.raw = [...(r.messages as LocalMessage[])]
      this.messages = this.raw.map(toDisplay)
    } finally {
      this.loading = false
    }
    this.startStream(name)
  }

  private startStream(name: string) {
    this.stopStream()
    this.controller = new AbortController()
    void (async () => {
      try {
        const stream = agent.watchSession({ id: name }, { signal: this.controller!.signal })
        for await (const ev of stream) {
          this.handleEvent(toAgentEvent(ev.event, (ev.params ?? {}) as Record<string, unknown>))
        }
      } catch {
        // aborted / switched
      }
    })()
  }

  private stopStream() {
    this.controller?.abort()
    this.controller = null
  }

  private handleEvent(ev: AgentEvent) {
    switch (ev.kind) {
      case 'text-delta':
        this.appendDelta(ev.id, ev.text, false)
        break
      case 'reasoning-delta':
        this.appendDelta(ev.id, ev.text, true)
        break
      case 'tool-call': {
        this.ensureTool(ev.id, ev.name)
        break
      }
      case 'tool-result':
      case 'tool-error': {
        this.toolResult(ev.id, ev.output)
        break
      }
      case 'turn-complete':
        this.finish()
        break
      case 'status': {
        if (ev.type === 'busy' || ev.type === 'running') this.sending = true
        else this.finish()
        break
      }
      case 'error':
        this.finish()
        break
      default:
        break
    }
  }

  private ensureStreaming(): LocalMessage {
    const last = this.raw[this.raw.length - 1]
    if (last && last.__local) return last
    const m: LocalMessage = { id: `__stream-${Date.now()}`, role: 'assistant', prevId: '', createdAt: '', parts: [], __local: true }
    this.raw = [...this.raw, m]
    this.sending = true
    this.messages = this.raw.map(toDisplay)
    return m
  }

  private appendDelta(pid: string, text: string, reasoning: boolean) {
    const msg = this.ensureStreaming()
    const parts = [...msg.parts]
    const key = reasoning ? `r${pid}` : pid
    const idx = parts.findIndex(p => p.id === key)
    if (idx >= 0) parts[idx] = { ...parts[idx], data: (parts[idx].data ?? '') + text }
    else parts.push(makePart({ id: key, type: reasoning ? 'reasoning' : 'text', data: text }))
    msg.parts = parts
    this.messages = this.raw.map(toDisplay)
  }

  private ensureTool(id: string, name: string) {
    const msg = this.ensureStreaming()
    const parts = [...msg.parts]
    if (!parts.some(p => p.id === id && p.type === 'tool')) {
      parts.push(makePart({ id, type: 'tool', data: name }))
      msg.parts = parts
      this.messages = this.raw.map(toDisplay)
    }
  }

  private toolResult(id: string, output: string) {
    for (let i = this.raw.length - 1; i >= 0; i--) {
      const msg = this.raw[i]
      const parts = [...msg.parts]
      const idx = parts.findIndex(p => p.id === id && p.type === 'tool')
      if (idx >= 0) {
        parts[idx] = { ...parts[idx], data: output }
        msg.parts = parts
        this.messages = this.raw.map(toDisplay)
        return
      }
    }
  }

  private finish() {
    this.sending = false
    this.raw = this.raw.filter(m => !m.__local)
    this.messages = this.raw.map(toDisplay)
  }

  async send(text: string) {
    if (!this.activeName) return
    const t = text.trim()
    if (!t) return
    this.sending = true
    const m: LocalMessage = {
      id: `__user-${Date.now()}`,
      role: 'user',
      prevId: '',
      createdAt: '',
      parts: [makePart({ id: 't0', type: 'text', data: t })],
      __local: true,
    }
    this.raw = [...this.raw, m]
    this.messages = this.raw.map(toDisplay)
    try {
      await agent.prompt({ id: this.activeName, prompt: t })
    } catch {
      // stream surfaces errors
    }
  }

  async createSession() {
    await agent.createSession({})
    await this.refreshSessions()
  }

  async deleteSession(name: string) {
    await agent.deleteSession({ id: name })
    if (this.activeName === name) {
      this.stopStream()
      this.activeName = ''
      this.messages = []
      this.raw = []
    }
    await this.refreshSessions()
  }

  async renameSession(name: string, next: string) {
    await agent.rename({ id: name, name: next })
    if (this.activeName === name) this.activeName = next
    await this.refreshSessions()
  }

  interrupt(name: string) {
    return agent.interrupt({ id: name })
  }

  compact(name: string) {
    return agent.compact({ id: name })
  }

  switchModel(name: string, model: string) {
    return agent.setModel({ id: name, model })
  }

  setPreset(name: string, preset: string) {
    return agent.updateSettings({ id: name, preset })
  }
}

function makePart(init: { id: string; type: string; data: string }): Part {
  return create(PartSchema, { id: init.id, type: init.type, data: init.data, messageId: '', seq: init.data.length })
}

export const store = new AgentStore()
