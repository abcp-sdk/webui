import { createAgentWebClient, type AgentWebClient } from '@abcp/agent-sdk'

/**
 * Agent web client (fetch / connect-web). Talks directly to the abc agent
 * backend over agent.v1.AgentService. Same-origin by default; override the
 * origin with VITE_AGENT_URL.
 */
const origin =
  (import.meta.env.VITE_AGENT_URL as string | undefined) ??
  (typeof window !== 'undefined' ? window.location.origin : 'http://localhost')

export const agent: AgentWebClient = createAgentWebClient({
  baseUrl: origin.replace(/\/+$/, ''),
})
