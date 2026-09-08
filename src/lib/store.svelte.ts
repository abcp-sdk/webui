import { agent } from './agent'
import type { Session, Message } from '@abcp/agent-sdk'

/**
 * Svelte-5 runes store as a class (exporting reassigned `$state` from a module
 * is not allowed; a class with `$state` fields is the supported pattern).
 */
class AgentStore {
  sessions = $state<Session[]>([])
  activeId = $state<string>('')
  messages = $state<Message[]>([])
  sending = $state(false)

  async refreshSessions() {
    const r = await agent.listSessions({})
    this.sessions = r.sessions
  }

  async selectSession(id: string) {
    this.activeId = id
    const r = await agent.listMessages({ id, limit: 50 })
    this.messages = r.messages
  }

  async send(prompt: string) {
    if (!this.activeId) return
    this.sending = true
    try {
      await agent.prompt({ id: this.activeId, prompt })
    } finally {
      this.sending = false
    }
  }
}

export const store = new AgentStore()
