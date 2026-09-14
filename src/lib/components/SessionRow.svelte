<script lang="ts">
  // SessionRow — web port of flutter widgets/session_row.dart: a selectable
  // list row (title, preview subtitle, timestamp, unread dot/badge).
  import type { Session } from '$lib/models'
  import { sessionName } from '$lib/models'
  import { t } from '$lib/i18n.svelte'
  import { cn } from '$lib/utils'

  let {
    session,
    isActive = false,
    subtitle = '',
    unread = false,
    unreadCount = 0,
    selectable = false,
    selected = false,
    onTap,
    onLongPress,
  }: {
    session: Session
    isActive?: boolean
    subtitle?: string
    unread?: boolean
    unreadCount?: number
    selectable?: boolean
    selected?: boolean
    onTap?: () => void
    onLongPress?: (() => void) | null
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
    'flex w-full items-start gap-2.5 px-4 py-2.5 text-left transition-colors',
    isActive ? 'bg-primary/10' : 'hover:bg-muted/50',
  )}
  onclick={onTap}
  oncontextmenu={e => {
    if (onLongPress && !selectable) {
      e.preventDefault()
      onLongPress()
    }
  }}
>
  {#if selectable}
    <span
      class={cn(
        'mt-1 flex size-4 shrink-0 items-center justify-center rounded-full border',
        selected ? 'border-primary bg-primary text-primary-foreground' : 'border-muted-foreground/50',
      )}
    >
      {#if selected}<span class="text-[9px]">✓</span>{/if}
    </span>
  {/if}
  <span class="min-w-0 flex-1">
    <span class="flex items-center gap-1.5">
      {#if unread}
        <span class="size-1.5 shrink-0 rounded-full bg-primary"></span>
      {/if}
      <span class="truncate text-body font-medium">{sessionName(session)}</span>
      {#if unreadCount > 0}
        <span class="ml-auto shrink-0 rounded-full bg-destructive px-1.5 py-px text-[10px] font-semibold leading-4 text-white">{unreadCount > 99 ? '99+' : unreadCount}</span>
      {/if}
    </span>
    <span class="mt-0.5 flex items-center gap-2">
      <span class="min-w-0 flex-1 truncate text-meta text-muted-foreground">{subtitle || session.id}</span>
      <span class="shrink-0 text-micro text-muted-foreground">{fmtTime(session.lastMessageAt || session.updatedAt)}</span>
    </span>
  </span>
</button>
