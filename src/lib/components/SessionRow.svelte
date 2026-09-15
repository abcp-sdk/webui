<script lang="ts">
  // SessionRow — web port of flutter widgets/session_row.dart: a selectable
  // list row (title, preview subtitle, fixed-width timestamp, unread badge,
  // subsession badge + expand chevron, child indent).
  import type { Session } from '$lib/models'
  import { sessionName } from '$lib/models'
  import { t } from '$lib/i18n.svelte'
  import { cn } from '$lib/utils'
  import { Check, ChevronDown, ChevronUp } from '@lucide/svelte'

  let {
    session,
    isActive = false,
    subtitle = '',
    unread = false,
    unreadCount = 0,
    selectable = false,
    selected = false,
    childCount = 0,
    expanded = false,
    isChild = false,
    onTap,
    onLongPress,
    onToggleExpand,
  }: {
    session: Session
    isActive?: boolean
    subtitle?: string
    unread?: boolean
    unreadCount?: number
    selectable?: boolean
    selected?: boolean
    childCount?: number
    expanded?: boolean
    isChild?: boolean
    onTap?: () => void
    onLongPress?: (() => void) | null
    onToggleExpand?: () => void
  } = $props()

  function fmtTime(iso: string): string {
    if (!iso) return ''
    const d = new Date(iso)
    if (isNaN(d.getTime())) return ''
    const diff = Date.now() - d.getTime()
    const mins = Math.floor(diff / 60000)
    if (mins < 1) return t('timeJustNow')
    if (mins < 60) return t('timeMinAgo', { arg1: mins })
    const hours = Math.floor(mins / 60)
    if (hours < 24) return t('timeHour', { arg1: hours })
    const days = Math.floor(hours / 24)
    if (days < 7) return t('timeDay', { arg1: days })
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' })
  }
</script>

<button
  type="button"
  class={cn(
    'flex w-full items-center gap-2.5 px-4 py-2.5 text-left transition-colors',
    !selected && (isActive ? 'bg-primary/10' : 'hover:bg-muted/50'),
    selected && 'bg-primary/15',
  )}
  onclick={onTap}
  oncontextmenu={e => {
    if (onLongPress && !selectable) {
      e.preventDefault()
      onLongPress()
    }
  }}
>
  {#if isChild}
    <span class="ml-2 h-[34px] w-0.5 shrink-0 rounded bg-muted-foreground/35"></span>
  {/if}
  {#if selectable}
    <span
      class={cn(
        'flex size-4 shrink-0 items-center justify-center rounded-full border',
        selected ? 'border-primary bg-primary text-primary-foreground' : 'border-muted-foreground/50',
      )}
    >
      {#if selected}<Check class="size-3" />{/if}
    </span>
  {/if}
  <span class="min-w-0 flex-1">
    <span class="flex items-center gap-1">
      {#if unread && !selectable}
        <span class="size-1.5 shrink-0 rounded-full bg-primary"></span>
      {/if}
      <span class="truncate text-body font-medium" class:text-primary={isActive}>{sessionName(session)}</span>
      {#if session.group && !isChild}
        <span class="shrink-0 rounded-full bg-primary/14 px-1.5 py-px text-[9px] text-primary">{t('subsessionBadge')}</span>
      {/if}
      {#if childCount > 0}
        <span
          role="button"
          tabindex="0"
          class="flex shrink-0 cursor-pointer items-center rounded-full bg-muted-foreground/14 px-1.5 py-px text-[9px] text-muted-foreground"
          onclick={e => {
            e.stopPropagation()
            onToggleExpand?.()
          }}
          onkeydown={e => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              e.stopPropagation()
              onToggleExpand?.()
            }
          }}
        >
          {t('subsessionCount', { arg1: childCount })}
          {#if expanded}<ChevronUp class="size-3" />{:else}<ChevronDown class="size-3" />{/if}
        </span>
      {/if}
      <!-- Fixed-width, right-aligned timestamp slot so every trailing chip ends
           at the same x on every row. -->
      <span class="ml-auto w-[52px] shrink-0 text-right text-micro text-muted-foreground">{fmtTime(session.lastMessageAt || session.updatedAt)}</span>
    </span>
    <span class="mt-0.5 flex items-center gap-2">
      <span class="min-w-0 flex-1 truncate text-meta text-muted-foreground">{subtitle || session.id}</span>
      {#if unread && !isActive && unreadCount > 0}
        <span class="shrink-0 rounded-full bg-destructive px-1.5 py-px text-[10px] font-semibold leading-4 text-white">{unreadCount > 99 ? '99+' : unreadCount}</span>
      {/if}
    </span>
  </span>
</button>
