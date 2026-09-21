<script lang="ts">
  // Mailbox — the session's deferred-message queue. Renders each entry as a
  // readable CARD (never raw JSON): a type icon + label, the decoded message
  // text, attachment chips and the queued/consumed timestamps.
  import type { Component } from 'svelte'
  import type { PageProps } from '$lib/page-props'
  import { t } from '$lib/i18n.svelte'
  import type { MailboxEntry } from '$lib/models'
  import { cn } from '$lib/utils'
  import { AppIcons } from '$lib/icons'

  let { store }: PageProps = $props()

  let entries = $state<MailboxEntry[]>([])
  let loading = $state(true)
  let error = $state('')

  const sid = $derived(store.activeSessionId ?? '')

  $effect(() => {
    const id = sid
    if (!id) return
    loading = true
    void (async () => {
      try {
        entries = await store.api.mailbox(id)
        error = ''
      } catch (e) {
        error = String(e)
      }
      loading = false
    })()
  })

  function fmt(iso?: string | null): string {
    if (!iso) return ''
    const d = new Date(iso)
    return isNaN(d.getTime()) ? '' : d.toLocaleString()
  }

  /** Decoded view of one mailbox payload (never rendered as raw JSON). */
  interface EntryView {
    text: string
    attachmentCount: number
    attachments: Array<{ name: string; code: string }>
  }

  function viewOf(e: MailboxEntry): EntryView {
    let parsed: Record<string, unknown> | null = null
    try {
      const v = JSON.parse(e.payload)
      if (v && typeof v === 'object' && !Array.isArray(v)) parsed = v as Record<string, unknown>
    } catch {
      /* non-JSON payload: show it verbatim as text */
    }
    if (parsed === null) return { text: e.payload, attachmentCount: 0, attachments: [] }
    const text = String(parsed['text'] ?? parsed['prompt'] ?? parsed['content'] ?? '')
    const rawAtts = Array.isArray(parsed['attachments']) ? parsed['attachments'] : []
    const attachments = rawAtts
      .map(a => {
        const o = (a ?? {}) as Record<string, unknown>
        return { name: String(o['name'] ?? ''), code: String(o['code'] ?? '') }
      })
      .filter(a => a.code !== '' || a.name !== '')
    return { text, attachmentCount: attachments.length, attachments }
  }

  /** Type → icon + localized label + accent. */
  function metaOf(msgType: string): { icon: Component; label: string; cls: string } {
    switch (msgType) {
      case 'user_prompt':
        return { icon: AppIcons.user, label: t('mailboxPrompt'), cls: 'bg-primary/12 text-primary' }
      case 'interrupt':
        return { icon: AppIcons.stop, label: t('mailboxInterrupt'), cls: 'bg-destructive/12 text-destructive' }
      default:
        return { icon: AppIcons.bolt, label: t('mailboxEvent'), cls: 'bg-warning/12 text-warning' }
    }
  }
</script>

<div class="flex h-full w-full flex-col">
  <header class="flex h-12 shrink-0 items-center gap-2 border-b border-border px-2">
    <button type="button" class="rounded p-1.5 hover:bg-muted" aria-label={t('back')} onclick={() => store.popPage()}><AppIcons.back class="size-[18px]" /></button>
    <AppIcons.inbox class="size-[18px] text-muted-foreground" />
    <span class="text-sm font-semibold">{t('mailbox')}</span>
    {#if entries.length}
      <span class="ml-auto rounded-full bg-muted px-2 py-0.5 text-micro text-muted-foreground tabular-nums">{entries.length}</span>
    {/if}
  </header>
  <div class="min-h-0 flex-1 overflow-y-auto p-3">
    {#if loading}
      <div class="flex justify-center py-8">
        <span class="size-6 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-muted-foreground"></span>
      </div>
    {:else if error}
      <p class="text-meta text-destructive">{error}</p>
    {:else if entries.length === 0}
      <div class="flex flex-col items-center gap-2 py-12 text-muted-foreground">
        <AppIcons.inbox class="size-8 opacity-40" />
        <p class="text-meta">{t('noMessages')}</p>
      </div>
    {:else}
      <div class="space-y-2">
        {#each entries as e (e.id)}
          {@const v = viewOf(e)}
          {@const m = metaOf(e.msgType)}
          {@const TypeIcon = m.icon}
          {@const pending = e.status !== 'consumed'}
          <div class="overflow-hidden rounded-lg border border-border/60 bg-card">
            <!-- card header: type icon + label + status pill -->
            <div class="flex items-center gap-2 border-b border-border/40 px-3 py-2">
              <span class={cn('flex size-6 shrink-0 items-center justify-center rounded-md', m.cls)}>
                <TypeIcon class="size-3.5" />
              </span>
              <span class="text-meta font-semibold">{m.label}</span>
              <span
                class={cn(
                  'ml-auto rounded-full px-1.5 py-px text-[10px] font-medium',
                  pending ? 'bg-warning/20 text-warning' : 'bg-success/20 text-success',
                )}
              >{pending ? t('mailboxPending') : t('consumed')}</span>
            </div>

            <!-- body: decoded text (never JSON) -->
            <div class="px-3 py-2.5">
              {#if v.text}
                <p class="text-body whitespace-pre-wrap break-words">{v.text}</p>
              {:else}
                <p class="text-meta text-muted-foreground italic">{t('mailboxNoContent')}</p>
              {/if}

              <!-- attachment chips -->
              {#if v.attachmentCount}
                <div class="mt-2 flex flex-wrap gap-1.5">
                  {#each v.attachments as a (a.code)}
                    <span class="inline-flex max-w-full items-center gap-1 rounded-md border border-border/60 bg-muted/40 px-1.5 py-0.5 text-micro">
                      <AppIcons.attach class="size-3 shrink-0 text-muted-foreground" />
                      <span class="truncate">{a.name || a.code}</span>
                    </span>
                  {/each}
                </div>
              {/if}
            </div>

            <!-- footer: timestamps -->
            <div class="flex flex-wrap items-center gap-x-3 gap-y-0.5 border-t border-border/40 px-3 py-1.5 text-micro text-muted-foreground">
              <span class="inline-flex items-center gap-1">
                <AppIcons.clock class="size-3" />
                {t('mailboxSentAt', { arg1: fmt(e.createdAt) })}
              </span>
              {#if e.consumedAt}
                <span class="inline-flex items-center gap-1">
                  <AppIcons.check class="size-3" />
                  {t('mailboxConsumedAt', { arg1: fmt(e.consumedAt) })}
                </span>
              {/if}
              {#if e.effectiveAt}
                <span class="inline-flex items-center gap-1">
                  <AppIcons.clock class="size-3" />
                  {fmt(e.effectiveAt)}
                </span>
              {/if}
            </div>
          </div>
        {/each}
      </div>
    {/if}
  </div>
</div>
