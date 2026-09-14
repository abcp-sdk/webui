<script lang="ts">
  // ToolPartView — web port of flutter widgets/tool_part.dart: a foldable tool
  // card (header icon+name+status, sections for input / content / metadata,
  // first-class media refs from data.images/videos/audio).
  import type { ChatPart, ToolState } from '$lib/models'
  import type { AgentApi } from '$lib/api'
  import { t } from '$lib/i18n.svelte'
  import { mediaUrl, mimeToKind } from '$lib/media'
  import { cn } from '$lib/utils'
  import { Check, LoaderCircle, AlertCircle, ChevronDown, ChevronRight } from '@lucide/svelte'

  let {
    part,
    isStreaming = false,
    api,
  }: {
    part: ChatPart
    isStreaming?: boolean
    api: AgentApi
  } = $props()

  let open = $state(true)
  let inputOpen = $state(true)
  let contentOpen = $state(true)
  let metaOpen = $state(true)

  const toolState: ToolState | null = $derived(part.state ?? null)
  const tool = $derived(part.tool)
  const status = $derived(toolState?.status ?? 'complete')
  const hasError = $derived(status === 'error')
  const running = $derived(isStreaming && status === 'running')
  const input = $derived((toolState?.input ?? {}) as Record<string, unknown>)

  const output = $derived(toolState?.output ?? '')
  const meta = $derived((toolState?.data ?? {}) as Record<string, unknown>)
  const metaEntries = $derived(Object.entries(meta).filter(([k]) => !['images', 'videos', 'audio'].includes(k)))

  interface MediaRef {
    code: string
    mime?: string | null
    name?: string | null
  }
  const mediaRefs = $derived.by(() => {
    const out: MediaRef[] = []
    const collect = (v: unknown) => {
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        const code = (v as Record<string, unknown>)['code']
        if (typeof code === 'string' && code) {
          out.push({
            code,
            mime: ((v as Record<string, unknown>)['mime'] as string) ?? null,
            name: ((v as Record<string, unknown>)['name'] as string) ?? null,
          })
        }
      }
    }
    for (const key of ['images', 'videos', 'audio']) {
      const v = meta[key]
      if (Array.isArray(v)) v.forEach(collect)
      else collect(v)
    }
    return out
  })

  const mediaUrls = $state<Record<string, string>>({})
  $effect(() => {
    for (const r of mediaRefs) {
      if (!mediaUrls[r.code]) {
        void mediaUrl(api, r.code).then(u => {
          if (u) mediaUrls[r.code] = u
        })
      }
    }
  })

  function prettyJson(o: unknown): string {
    try {
      return JSON.stringify(o, null, 2)
    } catch {
      return String(o)
    }
  }
</script>

<div
  class={cn(
    'rounded-md border text-meta',
    hasError ? 'border-destructive/40 bg-destructive/5' : 'border-border/50 bg-muted/30',
  )}
>
  <!-- header -->
  <button
    type="button"
    class="flex w-full items-center gap-2 px-2.5 py-2 text-left"
    onclick={() => (open = !open)}
  >
    {#if running}
      <LoaderCircle class="size-3.5 animate-spin text-muted-foreground" />
    {:else if hasError}
      <AlertCircle class="size-3.5 text-destructive" />
    {:else}
      <Check class="size-3.5 text-success" />
    {/if}
    <span class="min-w-0 flex-1 truncate font-medium">{tool || toolState?.title || 'tool'}</span>
    {#if open}<ChevronDown class="size-3 text-muted-foreground" />{:else}<ChevronRight class="size-3 text-muted-foreground" />{/if}
  </button>

  {#if open}
    <div class="space-y-2 px-2.5 pb-2.5">
      <!-- input section -->
      {#if Object.keys(input).length}
        <div class="rounded-sm border border-border/40">
          <button
            type="button"
            class="flex w-full items-center justify-between px-2 py-1 text-micro text-muted-foreground"
            onclick={() => (inputOpen = !inputOpen)}
          >
            <span>{t('toolInputParams')}</span><span>{inputOpen ? '▾' : '▸'}</span>
          </button>
          {#if inputOpen}
            <pre class="max-h-52 overflow-auto px-2 pb-2 font-mono text-micro">{prettyJson(input)}</pre>
          {/if}
        </div>
      {/if}

      <!-- content section -->
      {#if output}
        <div class="rounded-sm border border-border/40">
          <button
            type="button"
            class="flex w-full items-center justify-between px-2 py-1 text-micro text-muted-foreground"
            onclick={() => (contentOpen = !contentOpen)}
          >
            <span>{hasError ? t('error') : t('content')}</span><span>{contentOpen ? '▾' : '▸'}</span>
          </button>
          {#if contentOpen}
            <pre class="max-h-72 overflow-auto px-2 pb-2 font-mono text-micro whitespace-pre-wrap">{output}</pre>
          {/if}
        </div>
      {/if}

      <!-- media refs (first-class cards) -->
      {#if mediaRefs.length}
        <div class="flex flex-wrap gap-2">
          {#each mediaRefs as r (r.code)}
            {@const kind = mimeToKind(r.mime)}
            {#if kind === 'image' && mediaUrls[r.code]}
              <img src={mediaUrls[r.code]} alt={r.name ?? r.code} class="max-h-40 rounded-md border border-border/50" />
            {:else if kind === 'video' && mediaUrls[r.code]}
              <video src={mediaUrls[r.code]} controls class="max-h-48 rounded-md border border-border/50"><track kind="captions" /></video>
            {:else if kind === 'audio' && mediaUrls[r.code]}
              <audio src={mediaUrls[r.code]} controls class="w-64"></audio>
            {:else if mediaUrls[r.code]}
              <a href={mediaUrls[r.code]} download={r.name ?? r.code} class="text-primary underline">{r.name ?? r.code}</a>
            {/if}
          {/each}
        </div>
      {/if}

      <!-- metadata section -->
      {#if metaEntries.length}
        <div class="rounded-sm border border-border/40">
          <button
            type="button"
            class="flex w-full items-center justify-between px-2 py-1 text-micro text-muted-foreground"
            onclick={() => (metaOpen = !metaOpen)}
          >
            <span>{t('metadata')}</span><span>{metaOpen ? '▾' : '▸'}</span>
          </button>
          {#if metaOpen}
            <div class="max-h-40 space-y-1 overflow-auto px-2 pb-2 text-micro">
              {#each metaEntries as [k, v] (k)}
                <div class="flex gap-2">
                  <span class="shrink-0 text-muted-foreground">{k}</span>
                  <span class="min-w-0 break-all font-mono">{typeof v === 'object' ? prettyJson(v) : String(v)}</span>
                </div>
              {/each}
            </div>
          {/if}
        </div>
      {/if}
    </div>
  {/if}
</div>
