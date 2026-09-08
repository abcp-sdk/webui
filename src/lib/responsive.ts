// Responsive breakpoints (shared by all components).
export type Breakpoint = 'compact' | 'medium' | 'wide'

export function breakpoint(): Breakpoint {
  if (typeof window === 'undefined') return 'wide'
  const w = window.innerWidth
  if (w < 600) return 'compact'
  if (w < 1024) return 'medium'
  return 'wide'
}

export function createResponsive() {
  let bp = $state<Breakpoint>(breakpoint())
  const update = () => (bp = breakpoint())
  const onResize = () => window.addEventListener('resize', update)
  const offResize = () => window.removeEventListener('resize', update)
  // re-export a state object so runes track reactivity
  return {
    get bp() {
      return bp
    },
    isCompact: () => bp === 'compact',
    onResize,
    offResize,
  }
}
