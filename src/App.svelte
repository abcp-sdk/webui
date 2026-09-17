<script lang="ts">
  // App root — web port of flutter main.dart: prefs bootstrap (?base=&token=
  // seeding), the Setup gate (verified connect), the backends manager page and
  // the responsive two-tab shell.
  import { onMount } from 'svelte'
  import { AgentApi } from './lib/api'
  import { setLocale, t } from './lib/i18n.svelte'
  import { Prefs } from './lib/prefs'
  import { openLocalStore } from './lib/db'
  import { scopeOf } from './lib/scope'
  import type { LocalStore } from './lib/db'
  import { AppStore } from './lib/store.svelte'
  import { showErrorToast } from './lib/toast.svelte'
  import { setAuthExpiredHandler } from './lib/events'
  import { confirmDialog } from './lib/dialogs'
  import type { BackendCfg } from './lib/models'
  import { backendNameFor } from './lib/models'
  import Shell from './lib/Shell.svelte'
  import Overlays from './lib/components/Overlays.svelte'
  import { Button } from './lib/components/ui/button'
  import { Input } from './lib/components/ui/input'
  import { AppIcons } from '$lib/icons'

  type Phase = 'loading' | 'setup' | 'backends' | 'app'

  let phase = $state<Phase>('loading')
  let baseUrl = $state('')
  let token = $state('')
  // Light is the default appearance (every client).
  let dark = $state(false)
  let store = $state<AppStore | null>(null)
  let local: LocalStore | null = null

  // setup form
  let setupBase = $state('')
  let setupToken = $state('')
  let showToken = $state(false)
  let busy = $state(false)

  // backends page
  let backends = $state<BackendCfg[]>([])

  const savedLocale = localStorage.getItem('agent.uiLocale')
  setLocale((savedLocale as 'zh' | 'en') || 'zh')

  function applyDark(d: boolean) {
    dark = d
    document.documentElement.dataset.theme = d ? 'dark' : 'light'
    Prefs.saveDarkMode(d)
  }

  function setUiLocale(l: 'zh' | 'en') {
    setLocale(l)
    localStorage.setItem('agent.uiLocale', l)
  }

  // 401/403 anywhere → one-tap "sign in again" (flutter auth_gate.dart).
  setAuthExpiredHandler(async () => {
    if (phase !== 'app') return
    const ok = await confirmDialog({
      title: t('authExpiredTitle'),
      body: t('authExpiredBody'),
      confirmLabel: t('signInAgain'),
      destructive: true,
    })
    if (ok) logout()
  })

  onMount(() => {
    applyDark(Prefs.load().darkMode)
    void boot()
  })

  // ---- browser Back / swipe-back drives the in-app navigation stack ----
  // Every in-app "forward" navigation pushes a history entry; a popstate pops
  // one in-app page and re-arms a sentinel entry so the NEXT back still has
  // something to consume. Without this, the phone's edge-swipe / back button
  // did nothing (or left the SPA), so no page obeyed the system gesture.
  let navDepth = 0

  function inAppDepth(): number {
    if (!store || phase !== 'app') return 0
    return store.currentStack.length - 1
  }

  if (typeof window !== 'undefined') {
    window.history.replaceState({ agentNav: 0 }, '')
    window.addEventListener('popstate', () => {
      if (phase !== 'app' || !store) return
      if (store.currentStack.length > 1) {
        // Consume the back as one in-app pop … (pushState below does NOT fire
        // popstate, so this never recurses).
        store.popPage()
        navDepth = inAppDepth()
        window.history.pushState({ agentNav: navDepth + 1 }, '')
        navDepth += 1
      }
    })
  }

  // Mirror in-app pushes into history so Back/swipe has depth to consume.
  $effect(() => {
    const target = inAppDepth()
    for (let i = navDepth; i < target; i++) {
      window.history.pushState({ agentNav: i + 1 }, '')
    }
    if (target > navDepth) navDepth = target
  })

  // Where the connection form POINTS by default (the k3s standalone agent —
  // the same backend the other clients use). This is only a PREFILL for the
  // setup form: no token is ever baked in, so an install always starts at the
  // setup / backends flow and the user picks (or adds) their own account.
  // Overridable via ?base=…&token=… or VITE_AGENT_URL.
  const DEFAULT_BASE = (import.meta.env.VITE_AGENT_URL as string | undefined) ??
    'https://standalone-agent.temp.10.199.64.20.nip.io'

  async function boot() {
    // A saved connection (or an explicit ?base=&token= link) goes straight in;
    // otherwise the user lands on the connection form — an install must never
    // silently sign in with a baked-in account.
    const prefs = Prefs.load()
    let base = prefs.baseUrl ?? ''
    let tok = prefs.token ?? ''
    const qp = new URLSearchParams(location.search)
    if (qp.get('base')) base = qp.get('base')!
    if (qp.get('token')) tok = qp.get('token')!
    if (!base || !tok) {
      setupBase = (base || DEFAULT_BASE).replace(/\/+$/, '')
      setupToken = ''
      baseUrl = base
      token = tok
      phase = 'setup'
      return
    }
    if (base !== prefs.baseUrl || tok !== prefs.token) Prefs.save(base, tok)
    baseUrl = base
    token = tok
    await enterApp()
  }

  async function buildStore(): Promise<AppStore> {
    const api = await AgentApi.create(baseUrl, token)
    try {
      local = await openLocalStore(scopeOf(baseUrl, token))
    } catch {
      local = null
    }
    return new AppStore(api, local)
  }

  async function enterApp() {
    phase = 'loading'
    try {
      store = await buildStore()
      phase = 'app'
    } catch (e) {
      showErrorToast(String(e))
      phase = 'setup'
    }
  }

  async function connect() {
    const base = setupBase.trim()
    const tok = setupToken.trim()
    if (!base || !tok || busy) return
    busy = true
    try {
      const api = await AgentApi.create(base, tok)
      await api.listSessions() // verify before saving
      Prefs.save(base, tok)
      Prefs.upsertBackend({ name: backendNameFor(base), baseUrl: base, token: tok })
      baseUrl = base
      token = tok
      await enterApp()
    } catch (e) {
      showErrorToast(t('loadError', { e: String(e) }))
    }
    busy = false
  }

  function openBackends() {
    backends = Prefs.backends()
    phase = 'backends'
  }

  async function switchBackend(b: BackendCfg) {
    Prefs.save(b.baseUrl, b.token)
    baseUrl = b.baseUrl
    token = b.token
    await enterApp()
  }

  async function deleteBackend(b: BackendCfg) {
    Prefs.removeBackend(b)
    backends = Prefs.backends()
  }

  function logout() {
    Prefs.clearActive()
    token = ''
    store = null
    setupBase = baseUrl
    setupToken = ''
    phase = 'setup'
  }

  const canConnect = $derived(setupBase.trim() !== '' && setupToken.trim() !== '' && !busy)
</script>

{#if phase === 'app' && store}
  <Shell
    {store}
    {dark}
    onDarkMode={applyDark}
    onSwitchBackend={openBackends}
    onBackendSwitched={switchBackend}
    onUiLocale={setUiLocale}
    onAddUser={logout}
  />
{:else if phase === 'backends'}
  <div class="flex h-full flex-col">
    <header class="flex h-12 shrink-0 items-center gap-2 border-b border-border px-3">
      <button type="button" class="rounded p-1.5 hover:bg-muted" onclick={() => phase = token ? 'app' : 'setup'}><AppIcons.back class="size-[18px]" /></button>
      <span class="text-sm font-semibold">{t('backendsTitle')}</span>
    </header>
    <div class="flex-1 overflow-y-auto p-4">
      {#if backends.length === 0}
        <p class="p-2 text-meta text-muted-foreground">{t('noSavedBackends')}</p>
      {/if}
      <div class="space-y-2">
        {#each backends as b (b.baseUrl)}
          <div class="flex items-center gap-3 rounded-md border border-border bg-card px-3 py-2.5">
            {#if b.baseUrl === baseUrl}<AppIcons.target class="size-4 text-primary" />{:else}<AppIcons.server class="size-4 text-muted-foreground" />{/if}
            <span class="min-w-0 flex-1">
              <span class="block truncate text-body">{b.name || b.baseUrl}</span>
              <span class="block truncate text-micro text-muted-foreground">{b.baseUrl}</span>
            </span>
            <button type="button" class="rounded p-1.5 text-muted-foreground hover:bg-muted" title={t('deleteBackend')} onclick={() => void deleteBackend(b)}><AppIcons.delete class="size-4" /></button>
            <Button size="sm" variant="outline" onclick={() => void switchBackend(b)}>{t('connect')}</Button>
          </div>
        {/each}
      </div>
      <div class="mt-4 border-t border-border pt-2">
        <button type="button" class="flex w-full items-center gap-2 rounded-md px-3 py-2.5 text-left hover:bg-muted" onclick={logout}>
          <AppIcons.add class="size-4" />
          <span class="text-body">{t('addBackend')}</span>
        </button>
      </div>
    </div>
  </div>
{:else if phase === 'setup'}
  <div class="flex h-full items-center justify-center overflow-y-auto p-6">
    <div class="w-full max-w-[480px]">
      <h1 class="mb-6 text-xl font-semibold">{t('appTitle')}</h1>
      <label class="mb-4 block">
        <span class="mb-1.5 block text-meta text-muted-foreground">{t('gatewayUrl')}</span>
        <Input bind:value={setupBase} disabled={busy} placeholder="https://standalone-agent.temp.10.199.64.20.nip.io" />
      </label>
      <label class="mb-6 block">
        <span class="mb-1.5 block text-meta text-muted-foreground">{t('tokenLabel')}</span>
        <span class="relative block">
          <Input bind:value={setupToken} disabled={busy} type={showToken ? 'text' : 'password'} />
          <button
            type="button"
            class="absolute top-1/2 right-2 -translate-y-1/2 text-muted-foreground"
            onclick={() => (showToken = !showToken)}
          >{#if showToken}<AppIcons.eye_off class="size-4" />{:else}<AppIcons.eye class="size-4" />{/if}</button>
        </span>
      </label>
      <Button class="w-full" disabled={!canConnect} onclick={() => void connect()}>
        {busy ? t('connecting') : t('connect')}
      </Button>
      {#if Prefs.backends().length > 0}
        <button
          type="button"
          class="mt-3 w-full rounded-md px-3 py-2 text-meta text-muted-foreground hover:bg-muted"
          onclick={openBackends}
        >{t('backendsTitle')}</button>
      {/if}
    </div>
  </div>
{:else}
  <div class="flex h-full items-center justify-center">
    <span class="size-6 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-muted-foreground"></span>
  </div>
{/if}

<Overlays />
