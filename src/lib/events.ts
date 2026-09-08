// Strong-typed agent stream events. The raw `WatchSessionResponse` (with its
// `params: Struct`) is coerced to exactly one of these at the SDK boundary;
// UI/store code below only ever sees these typed variants — zero casts.
export type AgentEvent =
  | { kind: 'text-delta'; id: string; text: string }
  | { kind: 'reasoning-delta'; id: string; text: string }
  | { kind: 'tool-call'; id: string; name: string }
  | { kind: 'tool-result'; id: string; output: string }
  | { kind: 'tool-error'; id: string; output: string }
  | { kind: 'turn-complete' }
  | { kind: 'status'; type: 'busy' | 'running' | 'idle' | string }
  | { kind: 'error'; message: string }
  | { kind: 'unknown'; event: string }

function str(v: unknown): string {
  return typeof v === 'string' ? v : v == null ? '' : String(v)
}

/** Coerce a raw watch/prompt message into a typed [AgentEvent]. */
export function toAgentEvent(
  event: string,
  params: Record<string, unknown>,
): AgentEvent {
  switch (event) {
    case 'text-delta':
      return { kind: 'text-delta', id: str(params['id']), text: str(params['text']) }
    case 'reasoning-delta':
      return { kind: 'reasoning-delta', id: str(params['id']), text: str(params['text']) }
    case 'tool-call':
      return {
        kind: 'tool-call',
        id: str(params['toolCallId'] ?? params['id']),
        name: str(params['toolName'] ?? params['name'] ?? 'tool'),
      }
    case 'tool-result':
      return {
        kind: 'tool-result',
        id: str(params['toolCallId'] ?? params['id']),
        output: str(params['formatted'] ?? params['output'] ?? params['result']),
      }
    case 'tool-error':
      return {
        kind: 'tool-error',
        id: str(params['toolCallId'] ?? params['id']),
        output: str(params['formatted'] ?? params['output'] ?? params['result'] ?? params['error']),
      }
    case 'turn-complete':
      return { kind: 'turn-complete' }
    case 'status':
      return { kind: 'status', type: str(params['type'] ?? '') }
    case 'error':
    case 'provider-error':
      return { kind: 'error', message: str(params['message'] ?? params['error']) }
    default:
      return { kind: 'unknown', event }
  }
}
