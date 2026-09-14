// Shared provider helpers — port of the providers.dart top-level constants.
export const GATEWAY_API_TYPE = 'vercel-compatible-gateway'
export const GATEWAY_PROVIDER_ID = 'gateway'

/** Text-provider api types (a text provider carries ONLY text models). */
export const TEXT_API_TYPES = ['openai-compatible', 'openai', 'anthropic', 'gemini'] as const

/** Multimodal capabilities for the gateway model TEST selector. */
export const MULTIMODAL_CAPABILITIES = ['text', 'image', 'video', 'speech', 'transcription'] as const

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

export function capabilityIcon(capability: string): string {
  switch (capability) {
    case 'image':
      return '🖼'
    case 'video':
      return '🎬'
    case 'speech':
      return '〰'
    case 'transcription':
      return '🎙'
    case 'embedding':
      return '✳'
    case 'reranking':
      return '≡'
    case 'realtime':
      return '⚡'
    default:
      return '💬'
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
      return 'apiTypeGemini'
    case GATEWAY_API_TYPE:
      return 'apiTypeGateway'
    default:
      return ''
  }
}
