// Shared provider helpers — port of the providers.dart top-level constants.
export const GATEWAY_API_TYPE = 'vercel-compatible-gateway'
export const GATEWAY_PROVIDER_ID = 'gateway'

/** Capability tags (mirrors the server matrix; used when a form needs the
 * full list, e.g. the gateway model whose kind comes from discovery). */
export const MULTIMODAL_CAPABILITIES = [
  'text',
  'image',
  'video',
  'speech',
  'transcription',
  'embedding',
  'rerank',
] as const

export function isGatewayProvider(apiType: string): boolean {
  return apiType === GATEWAY_API_TYPE
}

/** Localized capability label key. */
export function capabilityLabelKey(capability: string): string {
  switch (capability) {
    case 'image':
      return 'capImage'
    case 'video':
      return 'capVideo'
    case 'speech':
      return 'capSpeech'
    case 'transcription':
      return 'capTranscription'
    case 'embedding':
      return 'capEmbedding'
    case 'reranking':
      return 'capReranking'
    case 'realtime':
      return 'capRealtime'
    default:
      return 'capText'
  }
}

export function apiTypeLabelKey(apiType: string): string {
  switch (apiType) {
    case 'openai-compatible':
      return 'apiTypeOpenaiCompat'
    case 'openai':
      return 'apiTypeOpenai'
    case 'anthropic':
      return 'apiTypeAnthropic'
    case 'gemini':
    case 'google':
      return 'apiTypeGemini'
    case 'deepseek':
      return 'apiTypeDeepseek'
    case 'cohere':
      return 'apiTypeCohere'
    case GATEWAY_API_TYPE:
      return 'apiTypeGateway'
    default:
      return ''
  }
}
