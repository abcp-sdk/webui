<script lang="ts">
  // CapabilityIcon — vector icon for a model capability (port of flutter
  // providers.dart capabilityIcon; replaces the earlier emoji glyphs).
  import { MessageSquare, Image, Video, AudioLines, Mic, Layers, Zap, Asterisk } from '@lucide/svelte'

  let { capability, size = 14 }: { capability: string; size?: number } = $props()

  const icon = $derived.by(() => {
    switch (capability) {
      case 'image': return Image
      case 'video': return Video
      case 'speech': return AudioLines
      case 'transcription': return Mic
      case 'embedding': return Asterisk
      case 'reranking': return Layers
      case 'realtime': return Zap
      default: return MessageSquare
    }
  })
  const tone = $derived.by(() => {
    switch (capability) {
      case 'image': return 'text-warning'
      case 'video': return 'text-destructive'
      case 'speech': return 'text-primary'
      case 'transcription': return 'text-accent'
      default: return 'text-success'
    }
  })
</script>

<icon class="{tone} shrink-0" style="width:{size}px;height:{size}px" />
