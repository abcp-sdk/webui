// Transport + typed client factory over the latest @abcp/agent-sdk
// (agent.v1.AgentService, Connect protocol). The caller owns baseUrl + token;
// the client is rebuilt on backend switch.
import { createClient, type Client, type Interceptor } from '@connectrpc/connect'
import { createConnectTransport } from '@connectrpc/connect-web'
import { AgentService } from '@abcp/agent-sdk'

export type AgentClient = Client<typeof AgentService>

function bearerInterceptor(token: string): Interceptor {
  return next => async req => {
    if (token) req.header.set('Authorization', `Bearer ${token}`)
    return await next(req)
  }
}

export function trimBase(baseUrl: string): string {
  return baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl
}

/** A fresh Connect-web client bound to one backend (baseUrl + bearer). */
export function createAgentClient(baseUrl: string, token: string): AgentClient {
  const transport = createConnectTransport({
    baseUrl: trimBase(baseUrl),
    interceptors: [bearerInterceptor(token)],
  })
  return createClient(AgentService, transport)
}
