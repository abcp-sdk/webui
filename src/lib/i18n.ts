// Strong-typed i18n store (zh/en). Dictionary is `as const` so keys become a
// literal union; `t(key)` is fully type-safe with zero casts.
import { derived, writable, type Readable, type Writable } from 'svelte/store'

const messages = {
  zh: {
    appName: 'Agent',
    sessions: '会话',
    newSession: '新会话',
    noSessions: '暂无会话',
    rename: '重命名',
    delete: '删除',
    create: '新建',
    model: '模型',
    preset: '预设',
    stop: '停止',
    compact: '压缩',
    theme: '主题',
    themeSystem: '跟随系统',
    themeLight: '浅色',
    themeDark: '深色',
    send: '发送',
    messagePlaceholder: '输入消息…',
    loading: '加载中…',
    noMessages: '暂无消息，发送一条开始对话。',
    selectOrCreate: '选择一个会话或创建一个新的',
    thinking: '思考中…',
    interrupt: '中断',
    error: '出错了',
  },
  en: {
    appName: 'Agent',
    sessions: 'Sessions',
    newSession: 'New session',
    noSessions: 'No sessions',
    rename: 'Rename',
    delete: 'Delete',
    create: 'Create',
    model: 'Model',
    preset: 'Preset',
    stop: 'Stop',
    compact: 'Compact',
    theme: 'Theme',
    themeSystem: 'System',
    themeLight: 'Light',
    themeDark: 'Dark',
    send: 'Send',
    messagePlaceholder: 'Type a message…',
    loading: 'Loading…',
    noMessages: 'No messages yet. Send one to start.',
    selectOrCreate: 'Select a session or create a new one',
    thinking: 'Thinking…',
    interrupt: 'Interrupt',
    error: 'Error',
  },
} as const

export type Lang = keyof typeof messages
export type MessageKey = keyof (typeof messages)['zh']

const STORAGE_KEY = 'agent.lang'

function validLang(v: string | null): v is Lang {
  return v === 'zh' || v === 'en'
}

/** The reactive language store. */
export const language: Writable<Lang> = writable<Lang>('zh')

export function setLanguage(l: Lang) {
  language.set(l)
  if (typeof window !== 'undefined') localStorage.setItem(STORAGE_KEY, l)
}

export function loadLanguage() {
  if (typeof window === 'undefined') return
  const raw = localStorage.getItem(STORAGE_KEY)
  if (validLang(raw)) language.set(raw)
}

let _lang: Lang = 'zh'
language.subscribe((v) => (_lang = v))

/** Type-safe translation: key restricted to [MessageKey]. Zero casts. */
export function t(key: MessageKey): string {
  return messages[_lang][key]
}

/** Reactive translation fn derived from [language] for Svelte components. */
export function tStore(): Readable<(k: MessageKey) => string> {
  return derived(language, ($l) => (k: MessageKey) => messages[$l][k])
}
