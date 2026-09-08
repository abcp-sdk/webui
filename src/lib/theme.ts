export type Theme = 'light' | 'dark' | 'system'

const KEY = 'agent.theme'
const BROWSER = typeof window !== 'undefined'

export function currentScheme(): 'light' | 'dark' {
  if (BROWSER && window.matchMedia('(prefers-color-scheme: dark)').matches) {
    return 'dark'
  }
  return 'light'
}

export function loadTheme(): Theme {
  if (!BROWSER) return 'system'
  return (localStorage.getItem(KEY) as Theme) || 'system'
}

export function applyTheme(theme: Theme) {
  if (!BROWSER) return
  const scheme = theme === 'system' ? currentScheme() : theme
  document.documentElement.dataset.theme = scheme
  document.documentElement.style.colorScheme = scheme
}

export function saveTheme(theme: Theme) {
  if (!BROWSER) return
  localStorage.setItem(KEY, theme)
  applyTheme(theme)
}

export function watchScheme(cb: (scheme: 'light' | 'dark') => void): () => void {
  const mq = window.matchMedia('(prefers-color-scheme: dark)')
  const onChange = () => cb(mq.matches ? 'dark' : 'light')
  mq.addEventListener('change', onChange)
  return () => mq.removeEventListener('change', onChange)
}
