import { agent } from './agent'
import type { Session, Message } from '@abcp/agent-sdk'

interface StreamEvent {
  event: string
  params?: Record<string, unknown>
}

export type { Session, Message, StreamEvent }

export function listSessions() {
  return agent.listSessions({})
}

export function createSession(params?: { name?: string }) {
  return agent.createSession({ name: params?.name ?? '' })
}

export function deleteSession(id: string) {
  return agent.deleteSession({ id })
}

export function renameSession(id: string, name: string) {
  return agent.rename({ id, name })
}

export function listMessages(id: string, limit = 50) {
  return agent.listMessages({ id, limit })
}

export async function prompt(id: string, prompt: string) {
  const stream = agent.prompt({ id, prompt })
  for await (const ev of stream) {
    if (ev.event === 'accepted') return ev.params['message_id'] ?? ''
  }
  return ''
}

export function watchSession(id: string, signal?: AbortSignal) {
  return agent.watchSession({ id }, { signal })
}

export function switchModel(id: string, model: string, variant?: string) {
  return agent.setModel({ id, model, variant: variant ?? '' })
}

export function updateSettings(
  id: string,
  s: { preset?: string; systemPrompt?: string; maxTurns?: number },
) {
  return agent.updateSettings({ id, ...s })
}

export function interrupt(id: string) {
  return agent.interrupt({ id })
}

export function compact(id: string) {
  return agent.compact({ id })
}

export function listModels(providerId: string) {
  return agent.listModels({ providerId })
}

export function listPresets() {
  return agent.listPresets({})
}
