// Prefs — the web port of flutter/lib/prefs.dart over localStorage.
// (Drafts + read watermarks ALSO mirror into sqlite; this file holds the
// connection, appearance, locale and backend-list state.)
import { backendNameFor, type BackendCfg } from './models'
import { scopeOf } from './scope'

const K_BASE = 'agent.baseUrl'
const K_TOKEN = 'agent.token'
const K_DARK = 'agent.darkMode'
const K_AGENT_LOCALE = 'agent.agentLocale'
const K_READ = 'agent.readSeqs'
const K_BACKENDS = 'agent.backends'

/// The scope the in-memory read watermarks belong to ('' before load).
let readScope = ''

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
      // Light is the default appearance: only an explicit '1' enables dark.
      darkMode: localStorage.getItem(K_DARK) === '1',
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
  // Keyed per CONNECTION SCOPE (gateway + token): two users / two tenants on
  // the same device must not share unread state.

  loadReadWatermarks(baseUrl: string, token: string): Record<string, number> {
    const scope = baseUrl && token ? scopeOf(baseUrl, token) : ''
    readScope = scope
    if (!scope) return {}
    try {
      return JSON.parse(localStorage.getItem(`${K_READ}.${scope}`) || '{}')
    } catch {
      return {}
    }
  },

  saveReadSeqs(seqs: Record<string, number>) {
    if (!readScope) return
    try {
      localStorage.setItem(`${K_READ}.${readScope}`, JSON.stringify(seqs))
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

  // One gateway host may serve several tenants, so a saved user is identified
  // by the FULL connection (baseUrl + token), not the host alone.
  upsertBackend(b: BackendCfg) {
    const list = Prefs.backends().filter(x => !(x.baseUrl === b.baseUrl && x.token === b.token))
    list.unshift(b)
    localStorage.setItem(K_BACKENDS, JSON.stringify(list))
  },

  removeBackend(b: BackendCfg) {
    const list = Prefs.backends().filter(x => !(x.baseUrl === b.baseUrl && x.token === b.token))
    localStorage.setItem(K_BACKENDS, JSON.stringify(list))
  },
}

export { backendNameFor }
