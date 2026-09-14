// Prefs — the web port of flutter/lib/prefs.dart over localStorage.
// (Drafts + read watermarks ALSO mirror into sqlite; this file holds the
// connection, appearance, locale and backend-list state.)
import { backendNameFor, type BackendCfg } from './models'

const K_BASE = 'agent.baseUrl'
const K_TOKEN = 'agent.token'
const K_DARK = 'agent.darkMode'
const K_AGENT_LOCALE = 'agent.agentLocale'
const K_READ = 'agent.readSeqs'
const K_BACKENDS = 'agent.backends'

export interface PrefsSnapshot {
  baseUrl: string | null
  token: string | null
  darkMode: boolean
}

export const Prefs = {
  load(): PrefsSnapshot {
    return {
      baseUrl: localStorage.getItem(K_BASE),
      token: localStorage.getItem(K_TOKEN),
      darkMode: localStorage.getItem(K_DARK) !== '0',
    }
  },

  save(base: string, token: string) {
    localStorage.setItem(K_BASE, base)
    localStorage.setItem(K_TOKEN, token)
  },

  saveDarkMode(dark: boolean) {
    localStorage.setItem(K_DARK, dark ? '1' : '0')
  },

  loadAgentLocale(): string {
    return localStorage.getItem(K_AGENT_LOCALE) || 'follow'
  },

  saveAgentLocale(v: string) {
    localStorage.setItem(K_AGENT_LOCALE, v)
  },

  /** The effective agent locale pushed to the backend config KV. */
  effectiveAgentLocale(uiZh: boolean): string {
    const v = Prefs.loadAgentLocale()
    if (v === 'follow') return uiZh ? 'zh' : 'en'
    return v
  },

  // ---- read watermarks (localStorage mirror; sqlite is authoritative) ----

  loadReadWatermarks(): Record<string, number> {
    try {
      return JSON.parse(localStorage.getItem(K_READ) || '{}')
    } catch {
      return {}
    }
  },

  saveReadSeqs(seqs: Record<string, number>) {
    try {
      localStorage.setItem(K_READ, JSON.stringify(seqs))
    } catch {
      /* ignore quota */
    }
  },

  clearActive() {
    localStorage.removeItem(K_BASE)
    localStorage.removeItem(K_TOKEN)
  },

  // ---- saved backends ----

  backends(): BackendCfg[] {
    try {
      const list = JSON.parse(localStorage.getItem(K_BACKENDS) || '[]')
      return Array.isArray(list) ? list : []
    } catch {
      return []
    }
  },

  upsertBackend(b: BackendCfg) {
    const list = Prefs.backends().filter(x => x.baseUrl !== b.baseUrl)
    list.unshift(b)
    localStorage.setItem(K_BACKENDS, JSON.stringify(list))
  },

  removeBackend(baseUrl: string) {
    const list = Prefs.backends().filter(x => x.baseUrl !== baseUrl)
    localStorage.setItem(K_BACKENDS, JSON.stringify(list))
  },
}

export { backendNameFor }
