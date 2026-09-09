import { createClient } from '@connectrpc/connect'
import { createConnectTransport } from '@connectrpc/connect-web'
import { AgentService, bearerInterceptor } from '@abcp/agent-sdk'
import { toAgentEvent, type AgentEvent } from './events'
import type { Session, Message } from '@abcp/agent-sdk'

/**
 * Agent client over the connect-web transport. Talks directly to the abc agent
 * backend over agent.v1.AgentService. Same-origin by default; override the
 * origin with VITE_AGENT_URL. Per the connectrpc convention, the transport is
 * built here (the SDK only ships the generated client + interceptors).
 */
const origin =
  (import.meta.env.VITE_AGENT_URL as string | undefined) ??
  (typeof window !== 'undefined' ? window.location.origin : 'http://localhost')

const transport = createConnectTransport({
  baseUrl: origin.replace(/\/+$/, ''),
  interceptors: [bearerInterceptor('')],
})

export const agent = createClient(AgentService, transport)

export type { Session, Message }
export { toAgentEvent, type AgentEvent }
