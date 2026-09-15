<script lang="ts">
  // MessageBubble — web port of flutter widgets/message_bubble.dart:
  // reasoning-first ordering, file-ref chips, foldable reasoning + compaction
  // blocks, tool cards, error styling and the hover actions row
  // (copy / retry / edit / undo with confirm).
  import type { AgentApi } from '$lib/api'
  import type { ChatMessage, ChatPart } from '$lib/models'
  import { t } from '$lib/i18n.svelte'
  import { renderMarkdown } from '$lib/markdown'
  import { showToast } from '$lib/toast.svelte'
  import { cn } from '$lib/utils'
  import { Copy, RefreshCw, Pencil, Undo2, Brain, ChevronDown, ChevronRight } from '@lucide/svelte'
  import ToolPartView from './ToolPartView.svelte'
  import MediaAttachment from './MediaAttachment.svelte'
  import FileRefText from './FileRefText.svelte'

  let {
    msg,
    api,
    onUndo,
    onResend,
    onEdit,
  }: {
    msg: ChatMessage
    api: AgentApi
    onUndo: (messageId: string) => void
    onResend?: ((text: string) => void) | null
    onEdit?: ((text: string) => void) | null
  } = $props()

  const isUser = $derived(msg.role === 'user')
  const isError = $derived(msg.role === 'error')
  const isSystem = $derived(msg.role === 'system' || msg.role === 'event')
  const isStreaming = $derived(msg.status === 'streaming')

  // Reasoning always renders ABOVE the rest (stable partition).
  const ordered = $derived<ChatPart[]>([
    ...msg.parts.filter(p => p.type === 'reasoning'),
    ...msg.parts.filter(p => p.type !== 'reasoning'),
  ])

  const hasText = $derived(msg.parts.some(p => p.type === 'text' || p.type === 'reasoning'))

  let reasoningOpen = $state(false)
  let editOpen = $state(false)
  let editText = $state('')
  let undoOpen = $state(false)

  function textOfMessage(): string {
    return msg.parts.filter(p => p.type === 'text').map(p => p.text).join('\n')
  }

  function copy() {
    const text = msg.parts
      .filter(p => p.type === 'text' || p.type === 'reasoning')
      .map(p => p.text)
      .join('\n')
    void navigator.clipboard.writeText(text).then(() => showToast(t('copied')))
  }

  function beginEdit() {
    editText = textOfMessage()
    editOpen = true
  }

  function fmtTime(iso: string): string {
    const d = new Date(iso)
    if (isNaN(d.getTime())) return ''
    const now = new Date()
    const mins = Math.floor((now.getTime() - d.getTime()) / 60000)
    const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
    if (mins < 1) return t('timeJustNow')
    if (mins < 60) return t('timeMinAgo', { n: mins })
    if (d.toDateString() === now.toDateString()) return hm
    return `${d.getMonth() + 1}/${d.getDate()} ${hm}`
  }

</script>

{#if isStreaming && ordered.length === 0}
  <div class="mb-3 flex items-center gap-2 text-micro text-muted-foreground">
    <span class="size-3 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-muted-foreground"></span>
    {t('thinking')}
  </div>
{:else}
  <div class={cn('mb-3 flex flex-col', isSystem ? 'items-center' : isUser ? 'items-end' : 'items-start')}>
    <div
      class={cn(
        'max-w-[92%] rounded-md border px-3 py-2.5',
        isError && 'border-destructive/40 bg-destructive/10',
        isSystem && 'border-muted-foreground/25 bg-muted/30',
        isUser && !isError && !isSystem && 'border-primary/40 bg-primary/12',
        !isUser && !isError && !isSystem && 'border-border/50 bg-card',
      )}
    >
      <div class="flex flex-col items-start gap-2 text-left">
        {#if isError}
          <span class="text-micro font-semibold text-destructive">{t('error')}</span>
        {/if}
        {#each ordered as part (part.id)}
          {#if part.type === 'text'}
            <FileRefText text={part.text} {api} />
          {:else if part.type === 'file'}
            {@const a = { api, code: part.code ?? '', name: part.name ?? '', mime: part.mime, size: part.size ?? null }}
            <MediaAttachment {...a} />
          {:else if part.type === 'reasoning'}
            <div class="w-full rounded-sm border border-border/40 bg-muted/20">
              <button
                type="button"
                class="flex w-full items-center gap-1.5 px-2 py-1 text-micro text-muted-foreground"
                onclick={() => (reasoningOpen = !reasoningOpen)}
              >
                <Brain class="size-3.5" />
                <span>{t('thinkLabel')}{isStreaming ? '…' : ''}</span>
                {#if isStreaming}
                  <span class="size-2 animate-pulse rounded-full bg-warning"></span>
                {/if}
                <span class="ml-auto">{#if reasoningOpen}<ChevronDown class="size-3" />{:else}<ChevronRight class="size-3" />{/if}</span>
              </button>
              {#if reasoningOpen}
                <div class="md-body px-2 pb-2 text-muted-foreground">{@html renderMarkdown(part.text)}</div>
              {/if}
            </div>
          {:else if part.type === 'tool' && part.state}
            <div class="w-full">
              <ToolPartView {part} {isStreaming} {api} />
            </div>
          {:else if part.type === 'compaction'}
            <div class="w-full rounded-sm border border-border/40 bg-muted/20 px-2 py-1.5 text-micro text-muted-foreground">
              <span class="font-semibold">{t('compactedLabel')}</span>
              {#if part.text}
                <span class="opacity-80"> · {part.text.slice(0, 120)}{part.text.length > 120 ? '…' : ''}</span>
              {/if}
            </div>
          {/if}
        {/each}
      </div>
    </div>

    {#if !isStreaming && !isSystem}
      <div class={cn('mt-1 flex items-center gap-0.5 text-micro text-muted-foreground', isUser ? 'justify-end' : 'justify-start')}>
        {#if hasText}
          <button type="button" class="rounded p-0.5 hover:bg-muted" title={t('copy')} aria-label={t('copy')} onclick={copy}><Copy class="size-3.5" /></button>
        {/if}
        {#if isUser && onResend}
          <button type="button" class="rounded p-0.5 hover:bg-muted" title={t('retry')} aria-label={t('retry')} onclick={() => onResend?.(textOfMessage())}><RefreshCw class="size-3.5" /></button>
        {/if}
        {#if isUser && onEdit}
          <button type="button" class="rounded p-0.5 hover:bg-muted" title={t('edit')} aria-label={t('edit')} onclick={beginEdit}><Pencil class="size-3.5" /></button>
        {/if}
        <button type="button" class="rounded p-0.5 hover:bg-muted" title={t('undo')} aria-label={t('undo')} onclick={() => (undoOpen = true)}><Undo2 class="size-3.5" /></button>
        {#if msg.createdAt}
          <span class="ml-1 tabular-nums opacity-70">{fmtTime(msg.createdAt)}</span>
        {/if}
      </div>
    {/if}
  </div>
{/if}

<!-- edit dialog -->
{#if editOpen}
  <div class="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 p-4" role="presentation">
    <div class="w-[min(92vw,520px)] rounded-lg border border-border bg-card p-4 shadow-xl">
      <div class="mb-3 text-sm font-semibold">{t('editMessage')}</div>
      <textarea bind:value={editText} rows="5" class="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:border-ring"></textarea>
      <div class="mt-3 flex justify-end gap-2">
        <button type="button" class="rounded-md px-3 py-1.5 text-sm hover:bg-muted" onclick={() => (editOpen = false)}>{t('cancel')}</button>
        <button
          type="button"
          class="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground hover:bg-primary/80"
          onclick={() => {
            const v = editText.trim()
            editOpen = false
            if (v) onEdit?.(v)
          }}
        >{t('apply')}</button>
      </div>
    </div>
  </div>
{/if}

<!-- undo confirm -->
{#if undoOpen}
  <div class="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 p-4" role="presentation">
    <div class="w-[min(92vw,420px)] rounded-lg border border-border bg-card p-4 shadow-xl">
      <div class="mb-2 text-sm font-semibold">{t('undoTitle')}</div>
      <div class="text-meta text-muted-foreground">{t('undoBody')}</div>
      <div class="mt-3 flex justify-end gap-2">
        <button type="button" class="rounded-md px-3 py-1.5 text-sm hover:bg-muted" onclick={() => (undoOpen = false)}>{t('cancel')}</button>
        <button
          type="button"
          class="rounded-md bg-destructive px-3 py-1.5 text-sm text-white hover:bg-destructive/80"
          onclick={() => {
            undoOpen = false
            onUndo(msg.id)
          }}
        >{t('undo')}</button>
      </div>
    </div>
  </div>
{/if}
