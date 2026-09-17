<script lang="ts">
  // MediaAttachment — web port of flutter widgets/media_attachment.dart:
  // inline attachment rendering (image / video / audio player / file chip) +
  // a full-screen viewer dialog.
  import type { AgentApi } from '$lib/api'
  import { t } from '$lib/i18n.svelte'
  import { downloadFile, formatBytes, mediaUrl, mimeToKind } from '$lib/media'
  import { cn } from '$lib/utils'
  import { AppIcons } from '$lib/icons'

  let {
    api,
    code,
    name = '',
    mime,
    size,
    dimension,
    localUrl = '',
    onTap,
  }: {
    api: AgentApi
    code: string
    name?: string
    mime?: string | null
    size?: number | null
    /** Square tile size for composer chips (px); omit for inline bubbles. */
    dimension?: number
    /** Local preview (object URL) while uploading. */
    localUrl?: string
    onTap?: () => void
  } = $props()

  let url = $state('')
  let imgError = $state(false)
  let viewerOpen = $state(false)

  $effect(() => {
    if (code && !url) {
      void mediaUrl(api, code).then(u => {
        if (u) url = u
      })
    }
  })

  const shown = $derived(url || localUrl)
  const kind = $derived(mimeToKind(mime))

  function open() {
    if (!shown) return
    onTap?.()
    viewerOpen = true
  }
</script>

{#if dimension}
  <!-- composer tile -->
  <button
    type="button"
    class="relative shrink-0 overflow-hidden rounded-md border border-border/50 bg-muted"
    style="width:{dimension}px;height:{dimension}px"
    onclick={open}
    disabled={!shown}
  >
    {#if kind === 'image' && shown}
      {#if imgError}
        <AppIcons.image_off class="m-auto size-5 text-muted-foreground" />
      {:else}
        <img src={shown} alt={name} class="size-full object-cover" onerror={() => (imgError = true)} />
      {/if}
    {:else if shown && (kind === 'audio')}
      <AppIcons.music class="m-auto size-5 text-muted-foreground" />
    {:else if shown && kind === 'video'}
      <AppIcons.film class="m-auto size-5 text-muted-foreground" />
    {:else}
      <span class="flex size-full flex-col items-center justify-center gap-0.5 text-micro text-muted-foreground">
        <AppIcons.file class="size-4" />
      </span>
    {/if}
  </button>
{:else}
  <!-- inline bubble attachment -->
  <div class="flex flex-wrap gap-2">
    {#if kind === 'image' && shown}
      {#if imgError}
        <span class="flex items-center gap-2 rounded-md border border-border/40 px-2.5 py-1.5 text-meta text-muted-foreground">
          <AppIcons.image_off class="size-4" /> {name || code}
        </span>
      {:else}
        <button type="button" class="rounded-md" onclick={open} aria-label={name || code} title={name || code}>
          <img src={shown} onerror={() => (imgError = true)} alt={name || code} title={name || code} class="max-h-64 cursor-zoom-in rounded-md border border-border/50" />
        </button>
      {/if}
    {:else if kind === 'video' && shown}
      <video src={shown} controls class="max-h-72 rounded-md border border-border/50"><track kind="captions" /></video>
    {:else if kind === 'audio' && shown}
      <audio src={shown} controls class="w-full min-w-56"></audio>
    {:else if shown}
      <button
        type="button"
        class="flex items-center gap-2 rounded-md border border-border/50 bg-muted/50 px-2.5 py-1.5 text-meta hover:bg-muted"
        onclick={() => void downloadFile(api, code, name)}
      >
        <AppIcons.file class="size-4" />
        <span class="max-w-56 truncate">{name || code}</span>
        {#if size}
          <span class="text-micro text-muted-foreground">{formatBytes(size)}</span>
        {/if}
        <AppIcons.download class="size-3 text-muted-foreground" />
      </button>
    {:else}
      <span class="flex items-center gap-2 rounded-md border border-border/40 px-2.5 py-1.5 text-meta text-muted-foreground">
        {name || code} {formatBytes(size)}
      </span>
    {/if}
  </div>
{/if}

{#if viewerOpen}
  <div
    class="fixed inset-0 z-[90] flex items-center justify-center bg-black/80 p-6"
    role="button"
    tabindex="0"
    onclick={() => (viewerOpen = false)}
    onkeydown={e => e.key === 'Escape' && (viewerOpen = false)}
  >
    <div class="max-h-full max-w-full overflow-auto" onclick={e => e.stopPropagation()} role="presentation">
      {#if kind === 'image'}
        <img src={shown} alt={name} class="max-h-[85vh] max-w-[90vw] rounded-md" />
      {:else if kind === 'video'}
        <video src={shown} controls autoplay class="max-h-[85vh] max-w-[90vw] rounded-md"><track kind="captions" /></video>
      {:else if kind === 'audio'}
        <audio src={shown} controls autoplay class="w-80"></audio>
      {/if}
      <div class="mt-2 flex items-center justify-between gap-4 text-meta text-white/80">
        <span class="truncate">{name || code} {size ? `· ${formatBytes(size)}` : ''}</span>
        <button type="button" class="underline" onclick={() => shown && void downloadFile(api, code, name)}>{t('download')}</button>
      </div>
    </div>
    <button
      type="button"
      class={cn('absolute top-4 right-4 rounded-full bg-white/10 px-3 py-1.5 text-sm text-white hover:bg-white/20')}
      onclick={() => (viewerOpen = false)}
    >
      <AppIcons.close class="size-5" />
    </button>
  </div>
{/if}
