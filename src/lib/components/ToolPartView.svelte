<script lang="ts">
  // ToolPartView — web port of flutter widgets/tool_part.dart: a foldable tool
  // card (header icon+name+status, sections for input / content / metadata,
  // first-class media refs from data.images/videos/audio).
  import type { ChatPart, ToolState } from '$lib/models'
  import type { AgentApi } from '$lib/api'
  import { t } from '$lib/i18n.svelte'
  import { mediaUrl, mimeToKind } from '$lib/media'
  import { cn } from '$lib/utils'
  import {
    CheckCircle, LoaderCircle, AlertCircle, ChevronDown, ChevronRight, Info, Braces, FileText, TriangleAlert,
    Terminal, FilePen, FileSearch, FolderOpen, Trash2, Code, GitMerge, Package, Rocket, Download, Globe, ListChecks, History, Image as ImageIcon, Wrench, MoreHorizontal, GitCommitHorizontal, Diff,
} from '@lucide/svelte'

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

  const changeId = $derived((toolState?.changeId as string | undefined) ?? ((toolState?.data?.['change_id'] as string | undefined) ?? ''))
  const diffText = $derived((toolState?.diff as string | undefined) ?? ((toolState?.data?.['diff'] as string | undefined) ?? ''))
  const additions = $derived((toolState?.additions as number | undefined) ?? 0)
  const deletions = $derived((toolState?.deletions as number | undefined) ?? 0)
  const hasMeta = $derived(!!changeId || !!diffText || additions > 0 || deletions > 0)

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

  /** Tool-kind glyph + tint (flutter `ToolIcon`). */
  function toolGlyph(name: string) {
    const n = name.toLowerCase()
    if (n.includes('sandbox-run') || n.includes('shell') || n.includes('exec')) return { Icon: Terminal, cls: 'text-warning' }
    if (n.includes('read') || n.includes('write') || n.includes('edit'))
      return { Icon: n.includes('write') ? FilePen : FileText, cls: 'text-primary' }
    if (n.includes('grep') || n.includes('search')) return { Icon: FileSearch, cls: 'text-primary' }
    if (n.includes('glob') || n.includes('ls') || n.includes('explore')) return { Icon: FolderOpen, cls: 'text-primary' }
    if (n.includes('delete')) return { Icon: Trash2, cls: 'text-destructive' }
    if (n.includes('git') || n.includes('change') || n.includes('diff')) return { Icon: Code, cls: 'text-muted-foreground' }
    if (n.includes('rebuild') || n.includes('rebase')) return { Icon: GitMerge, cls: 'text-muted-foreground' }
    if (n.includes('build') || n.includes('image') || n.includes('docker')) return { Icon: Package, cls: 'text-accent' }
    if (n.includes('deploy') || n.includes('release') || n.includes('helm')) return { Icon: Rocket, cls: 'text-success' }
    if (n.includes('package') || n.includes('publish') || n.includes('registry')) return { Icon: Package, cls: 'text-success' }
    if (n.includes('pull') || n.includes('download') || n.includes('fetch')) return { Icon: Download, cls: 'text-accent' }
    if (n.includes('web') || n.includes('browser') || n.includes('navigate') || n.includes('click') || n.includes('type') || n.includes('snapshot'))
      return { Icon: Globe, cls: 'text-accent' }
    if (n.includes('todo') || n.includes('job') || n.includes('task')) return { Icon: ListChecks, cls: 'text-accent' }
    if (n.includes('history') || n.includes('memory') || n.includes('file_info')) return { Icon: History, cls: 'text-accent' }
    if (n.includes('image_read') || n.includes('image')) return { Icon: ImageIcon, cls: 'text-accent' }
    return { Icon: Wrench, cls: 'text-muted-foreground' }
  }

  /** flutter `toolDisplayName`: `todowrite` shows as `todo`. */
  function toolDisplayName(name: string): string {
    return name === 'todowrite' ? 'todo' : name
  }

  const glyph = $derived(toolGlyph(tool))

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
    'rounded-sm text-meta',
    hasError ? 'bg-destructive/5' : 'bg-muted/35',
  )}
>
  <!-- header: status icon → tool glyph → name → italic title → chevron -->
  <button
    type="button"
    class="flex w-full items-center gap-1 px-2 py-1 text-left"
    onclick={() => (open = !open)}
  >
    {#if running}
      <MoreHorizontal class="size-3.5 shrink-0 text-warning" />
    {:else if hasError}
      <AlertCircle class="size-3.5 shrink-0 text-destructive" />
    {:else}
      <CheckCircle class="size-3.5 shrink-0 text-success" />
    {/if}
    <glyph.Icon class={cn('size-3.5 shrink-0', glyph.cls)} />
    <span class="min-w-0 truncate font-semibold text-muted-foreground">{toolDisplayName(tool || toolState?.title || 'tool')}</span>
    {#if toolState?.title}
      <span class="min-w-0 flex-1 truncate text-micro text-muted-foreground italic">{toolState.title}</span>
    {:else}
      <span class="flex-1"></span>
    {/if}
    {#if open}<ChevronDown class="size-3.5 shrink-0 text-muted-foreground" />{:else}<ChevronRight class="size-3.5 shrink-0 text-muted-foreground" />{/if}
  </button>

  {#if open}
    <div class="space-y-2 px-2.5 pb-2.5">
      <!-- input section -->
      {#if Object.keys(input).length}
        <div class="rounded-sm border border-border/50 bg-background/50">
          <button
            type="button"
            class="flex w-full items-center gap-1 px-2 py-1 text-micro text-muted-foreground"
            onclick={() => (inputOpen = !inputOpen)}
          >
            {#if inputOpen}<ChevronDown class="size-3.5" />{:else}<ChevronRight class="size-3.5" />{/if}
            <Braces class="size-[13px] text-primary" />
            <span>{t('toolInputParams')}</span>
          </button>
          {#if inputOpen}
            <pre class="max-h-52 overflow-auto px-2 pb-2 font-mono text-[11px]">{prettyJson(input)}</pre>
          {/if}
        </div>
      {/if}

      <!-- content section -->
      {#if hasError}
        <div class="rounded-sm border border-destructive/40 bg-background/50">
          <button type="button" class="flex w-full items-center gap-1 px-2 py-1 text-micro text-destructive">
            <ChevronDown class="size-3.5" />
            <TriangleAlert class="size-[13px]" />
            <span>{t('error')}</span>
          </button>
          <pre class="max-h-52 overflow-auto px-2 pb-2 font-mono text-[11px] whitespace-pre-wrap text-destructive">{toolState?.error}</pre>
        </div>
      {/if}

      <div class="rounded-sm border border-border/50 bg-background/50">
        <button
          type="button"
          class="flex w-full items-center gap-1 px-2 py-1 text-micro text-muted-foreground"
          onclick={() => (contentOpen = !contentOpen)}
        >
          {#if contentOpen}<ChevronDown class="size-3.5" />{:else}<ChevronRight class="size-3.5" />{/if}
          <FileText class="size-[13px] text-primary" />
          <span>{t('toolContent')}</span>
        </button>
        {#if contentOpen}
          <div class="px-2 pb-2">
            {#if running}
              <p class="text-micro text-muted-foreground italic">{t('running')}</p>
            {:else if output}
              <pre class="max-h-72 overflow-auto font-mono text-[11px] whitespace-pre-wrap">{output}</pre>
            {/if}
          </div>
        {/if}
      </div>

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
      {#if hasMeta}
        <div class="rounded-sm border border-border/50 bg-background/50">
          <button
            type="button"
            class="flex w-full items-center gap-1 px-2 py-1 text-micro text-muted-foreground"
            onclick={() => (metaOpen = !metaOpen)}
          >
            {#if metaOpen}<ChevronDown class="size-3.5" />{:else}<ChevronRight class="size-3.5" />{/if}
            <Info class="size-[13px] text-primary" />
            <span>{t('metadata')}</span>
          </button>
          {#if metaOpen}
            <div class="px-2 pb-2">
              {#if changeId}
                <div class="flex items-center gap-1 pb-1 text-micro">
                  <GitCommitHorizontal class="size-[13px] text-primary" />
                  <span class="text-muted-foreground">change_id</span>
                  <span class="min-w-0 truncate font-mono text-primary">{changeId}</span>
                </div>
              {/if}
              {#if (additions ?? 0) > 0 || (deletions ?? 0) > 0}
                <div class="flex items-center gap-1 pb-1 text-micro">
                  <Diff class="size-[13px] {deletions ? 'text-destructive' : 'text-success'}" />
                  <span class="text-muted-foreground">diff</span>
                  <span class="font-mono {deletions ? 'text-destructive' : 'text-success'}">+{additions ?? 0} -{deletions ?? 0}</span>
                </div>
              {/if}
              {#if diffText}
                <div class="max-h-52 overflow-auto rounded-sm bg-muted/40 p-1 font-mono text-[11px] whitespace-pre-wrap">{diffText}</div>
              {/if}
            </div>
          {/if}
        </div>
      {/if}
    </div>
  {/if}
</div>
