<script lang="ts">
  // ContextMenu — a small fixed-position menu opened AT a pointer point
  // (desktop right-click on a session row / mobile long-press). Deliberately
  // NOT the DropdownMenu primitive: that one anchors to a trigger element,
  // while this must appear exactly where the pointer/finger was.
  //
  // Closes on: item pick, outside pointerdown, Escape, any scroll, resize.
  // The position is clamped into the viewport after mount.
  import { cn } from '$lib/utils'

  export interface ContextMenuItem {
    value: string
    label: string
    destructive?: boolean
  }

  let {
    x,
    y,
    items,
    onPick,
    onClose,
  }: {
    x: number
    y: number
    items: ContextMenuItem[]
    onPick: (value: string) => void
    onClose: () => void
  } = $props()

  let el = $state<HTMLDivElement | null>(null)

  // Clamp into the viewport once the real size is known. The menu never moves
  // while open (it is remounted per open), so an imperative style update is
  // enough — no reactive position state.
  $effect(() => {
    if (!el) return
    const r = el.getBoundingClientRect()
    const px = Math.max(8, Math.min(x, window.innerWidth - r.width - 8))
    const py = Math.max(8, Math.min(y, window.innerHeight - r.height - 8))
    el.style.left = `${px}px`
    el.style.top = `${py}px`
  })

  function onWindowPointerdown(e: PointerEvent) {
    if (el && !el.contains(e.target as Node)) onClose()
  }
  function onScroll() {
    onClose()
  }
</script>

<svelte:window
  onpointerdown={onWindowPointerdown}
  onkeydown={(e) => e.key === 'Escape' && onClose()}
  onscroll={onScroll}
  onresize={onClose}
/>

<div
  bind:this={el}
  class="fixed z-50 min-w-44 overflow-hidden rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-lg"
  style="left:{x}px; top:{y}px"
  role="menu"
>
  {#each items as it (it.value)}
    <button
      type="button"
      role="menuitem"
      class={cn(
        'relative flex w-full cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none hover:bg-muted',
        it.destructive && 'text-destructive',
      )}
      onclick={() => onPick(it.value)}
    >
      {it.label}
    </button>
  {/each}
</div>
