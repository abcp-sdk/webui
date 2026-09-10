<script lang="ts">
  import { store } from './lib/store.svelte'
  import { agent } from './lib/agent'
  import { setLanguage, loadLanguage, t, type Lang } from './lib/i18n'
  import type { Theme as ThemeType } from './lib/theme'
  import { Button } from './lib/components/ui/button'
  import { Input } from './lib/components/ui/input'
  import { Label } from './lib/components/ui/label'
  import { Separator } from './lib/components/ui/separator'
  import {
    Menu,
    Plus,
    Pencil,
    Trash2,
    Sun,
    Moon,
    Monitor,
    Send,
    Square,
    FileOutput,
    Languages,
  } from '@lucide/svelte'

  const LANG_OPTIONS = ['zh', 'en'] as const satisfies Lang[]
  const THEME_OPTIONS = ['system', 'light', 'dark'] as const satisfies ThemeType[]

  let promptText = $state('')
  let providerIds: string[] = $state([])
  let provider = $state('')
  let models: { id: string; name: string; variants: { id: string; name: string }[] }[] = $state([])
  let modelId = $state('')
  let variant = $state('')
  let presets: { id: string }[] = $state([])
  let themeOpen = $state(false)
  let drawerOpen = $state(false)
  let lang = $state<Lang>('zh')

  // The session model is a canonical "provider_id/model_id" reference (a bare
  // model id is never resolved by flat lookup). provider_id is REQUIRED by
  // ListModels, so the provider is picked first, its models are fetched, and
  // the selected variant is read off the chosen model.
  const variants = $derived(
    models.find(m => m.id === modelId)?.variants ?? [],
  )

  const loadModels = async (pid: string) => {
    if (!pid) {
      models = []
      return
    }
    const r = await agent.listModels({ providerId: pid })
    models = r.models
  }

  const applyModel = (name: string) => {
    const ref = modelId ? `${provider}/${modelId}` : ''
    void store.switchModel(name, ref, variant)
  }

  $effect(() => {
    loadLanguage()
    lang = current_lang()
    void store.refreshSessions()
    void agent.listProviders({}).then(async r => {
      providerIds = r.providers.map(p => p.providerId)
      if (providerIds.length > 0 && !provider) {
        provider = providerIds[0]
        await loadModels(provider)
      }
    })
    void agent.listPresets({}).then(r => (presets = r.presets))
  })

  function current_lang(): Lang {
    if (localStorage.getItem('agent.lang') === 'en') return 'en'
    return 'zh'
  }

  function shift(v: string | null | undefined): string | null {
    return v && v !== '' ? v : null
  }

  async function deleteSession(name: string) {
    await store.deleteSession(name)
  }

  async function renameSession(name: string) {
    const next = prompt(t('rename'), name)
    if (next && next.trim()) await store.renameSession(name, next.trim())
  }

  async function onSubmit(e: Event) {
    e.preventDefault()
    const tx = promptText.trim()
    if (!tx) return
    promptText = ''
    await store.send(tx)
  }

  function onThemeChange(t: ThemeType) {
    store.setTheme(t)
    themeOpen = false
  }

  function onLangChange(l: Lang) {
    setLanguage(l)
    lang = l
  }
</script>

<svelte:head>
  <style>
    :root { color-scheme: light dark; }
    html[data-theme='light'] { color-scheme: light; }
    html[data-theme='dark'] { color-scheme: dark; }
  </style>
</svelte:head>

<main class:compact={store.isCompact} data-theme={store.theme === 'system' ? '' : store.theme}>
  <!-- Left: session list -->
  <aside class="sessions">
    <div class="sess-head">
      <strong>{t('sessions')}</strong>
      <Button variant="ghost" size="icon-sm" onclick={() => store.createSession()}>
        <Plus class="size-4" />
      </Button>
    </div>
    <ul>
      {#each store.sessions as s (s.name)}
        <li>
          <button
            class:active={s.name === store.activeName}
            class="sess"
            onclick={() => store.selectSession(s.name)}
          >
            <span class="title">{shift(s.name) ?? s.name}</span>
            <span class="prev">{shift(s.lastMessagePreview) ?? ''}</span>
          </button>
          <div class="sess-menu">
            <Button variant="ghost" size="icon-xs" onclick={() => renameSession(s.name)}>
              <Pencil class="size-3" />
            </Button>
            <Button variant="ghost" size="icon-xs" onclick={() => deleteSession(s.name)}>
              <Trash2 class="size-3" />
            </Button>
          </div>
        </li>
      {:else}
        <li class="empty">{t('noSessions')}</li>
      {/each}
    </ul>
  </aside>

  <!-- Right: chat -->
  <section class="chat">
    <header class="chat-head">
      {#if store.isCompact}<Button variant="ghost" size="icon-sm" onclick={() => (drawerOpen = !drawerOpen)}><Menu class="size-4" /></Button>{/if}
      <span class="title">{shift(store.activeName) ?? t('appName')}</span>
      <div class="controls">
        <Button variant="ghost" size="icon-sm" onclick={() => (themeOpen = !themeOpen)}>
          <Languages class="size-4" />
        </Button>
        {#if themeOpen}
          <div class="theme-menu">
            {#each LANG_OPTIONS as l (l)}
              <Button variant="ghost" onclick={() => onLangChange(l)}>
                {l}
              </Button>
            {/each}
            <Separator />
            {#each THEME_OPTIONS as tt (tt)}
              <Button variant="ghost" onclick={() => onThemeChange(tt)} class="inline-flex items-center gap-1">
                {#if tt === 'system'}<Monitor class="size-4" />{:else if tt === 'light'}<Sun class="size-4" />{:else}<Moon class="size-4" />{/if}
              </Button>
            {/each}
          </div>
        {/if}
        <select
          value={provider}
          onchange={(e) => {
            provider = e.currentTarget.value
            modelId = ''
            variant = ''
            void loadModels(provider)
          }}
        >
          {#each providerIds as pid (pid)}
            <option value={pid}>{pid}</option>
          {/each}
        </select>
        <select
          value={modelId}
          onchange={(e) => {
            modelId = e.currentTarget.value
            variant = ''
            if (store.activeName && modelId) {
              store.switchModel(store.activeName, `${provider}/${modelId}`)
            }
          }}
        >
          <option value="">{t('model')}</option>
          {#each models as m (m.id)}
            <option value={m.id}>{m.name || m.id}</option>
          {/each}
        </select>
        {#if variants.length}
          <select
            value={variant}
            onchange={(e) => {
              variant = e.currentTarget.value
              if (store.activeName) applyModel(store.activeName)
            }}
          >
            <option value="">{t('variantNone')}</option>
            {#each variants as v (v.id)}
              <option value={v.id}>{v.name || v.id}</option>
            {/each}
          </select>
        {/if}
        <select
          onchange={(e) => store.activeName && store.setPreset(store.activeName, e.currentTarget.value)}
        >
          <option value="">{t('preset')}</option>
          {#each presets as p (p.id)}
            <option value={p.id}>{p.id}</option>
          {/each}
        </select>
        <Button
          variant="ghost"
          size="icon-sm"
          onclick={() => store.activeName && store.interrupt(store.activeName)}
          title={t('stop')}
        >
          <Square class="size-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          onclick={() => store.activeName && store.compact(store.activeName)}
          title={t('compact')}
        >
          <FileOutput class="size-4" />
        </Button>
      </div>
    </header>

    <div class="messages">
      {#if store.loading}
        <div class="empty">{t('loading')}</div>
      {:else if store.messages.length === 0}
        <div class="empty">{t('noMessages')}</div>
      {:else}
        {#each store.messages as m (m.id)}
          <div class="msg {m.role}">
            {#if m.tools.length}
              <div class="tools">
                {#each m.tools as tool (tool.id)}
                  <details>
                    <summary>⚙ {tool.name}</summary>
                    <pre>{tool.output}</pre>
                  </details>
                {/each}
              </div>
            {/if}
            {#if m.reasoning}
              <details class="reasoning">
                <summary>{t('thinking')}</summary>
                <div class="text">{m.reasoning}</div>
              </details>
            {/if}
            {#if m.text}
              <div class="text">{m.text}</div>
            {/if}
            {#if m.streaming}
              <span class="caret">▍</span>
            {/if}
          </div>
        {/each}
      {/if}
    </div>

    <form class="composer" onsubmit={onSubmit}>
      <Input bind:value={promptText} placeholder={t('messagePlaceholder')} autocomplete="off" />
      <Button type="submit" disabled={store.sending}>
        <Send class="size-4" />
        {t('send')}
      </Button>
    </form>
  </section>
</main>

{#if store.isCompact && drawerOpen}
  <div role="button" tabindex="0" class="drawer-backdrop" onclick={() => (drawerOpen = false)} onkeydown={(e) => { if (e.key === "Escape") drawerOpen = false; }}>
    <div role="dialog" tabindex="0" class="drawer" onclick={(e) => e.stopPropagation()} onkeydown={(e) => { if (e.key === "Escape") drawerOpen = false; }}>
      {#each store.sessions as s (s.name)}
        <button class="drawer-item" class:active={s.name === store.activeName}
          onclick={() => { store.selectSession(s.name); drawerOpen = false; }}>
          <span class="title">{shift(s.name) ?? s.name}</span>
          <span class="prev">{shift(s.lastMessagePreview) ?? ''}</span>
        </button>
      {/each}
    </div>
  </div>
{/if}


<style>
  main { display: flex; height: 100vh; font-family: system-ui, sans-serif; transition: background-color .25s, color .25s; }
  main.compact aside { display: none; }
  main.compact .chat { border-left: none; }

  aside { width: 300px; min-width: 300px; border-right: 1px solid var(--border); height: 100%; overflow: auto; }
  .sess-head { display: flex; justify-content: space-between; align-items: center; padding: 12px; border-bottom: 1px solid var(--border); }
  ul { list-style: none; margin: 0; padding: 0; }
  li { display: flex; align-items: center; }
  li .sess { flex: 1; text-align: left; padding: 10px 12px; border-bottom: 1px solid var(--border); }
  li .sess.active { background: var(--accent-soft); }
  .title { display: block; font-weight: 600; }
  .prev { display: block; font-size: 12px; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .sess-menu { display: none; padding-right: 6px; }
  li:hover .sess-menu { display: flex; gap: 2px; }

  .chat { flex: 1; display: flex; flex-direction: column; height: 100%; }
  .chat-head { display: flex; align-items: center; justify-content: space-between; padding: 10px 14px; border-bottom: 1px solid var(--border); position: relative; }
  .chat-head .title { font-weight: 700; }
  .controls { display: flex; gap: 8px; align-items: center; position: relative; }
  .theme-menu { position: absolute; top: 44px; right: 0; background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 4px; display: flex; flex-direction: column; z-index: 5; }

  .messages { flex: 1; overflow: auto; padding: 16px; display: flex; flex-direction: column; gap: 10px; }
  .msg { max-width: 640px; white-space: pre-wrap; padding: 10px 14px; border-radius: 12px; }
  .msg.user { align-self: flex-end; background: var(--accent); color: #fff; }
  .msg.assistant, .msg.system { align-self: flex-start; background: var(--surface); }
  .empty { margin: auto; color: var(--muted); }
  .reasoning { font-size: 13px; color: var(--muted); }
  .reasoning .text { white-space: pre-wrap; }
  .tools summary { font-size: 13px; color: var(--accent); cursor: pointer; }
  .tools pre { font-size: 12px; background: var(--code-bg); padding: 6px; border-radius: 6px; overflow: auto; max-height: 200px; }
  .caret { animation: blink 1s steps(1) infinite; }
  @keyframes blink { 50% { opacity: 0; } }

  .drawer-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,.4); z-index: 20; }
  .drawer { position: absolute; left: 0; top: 0; bottom: 0; width: 280px; background: var(--surface); border-right: 1px solid var(--border); padding: 8px; overflow: auto; }
  .drawer-item { display: block; width: 100%; text-align: left; padding: 10px 12px; border-radius: 8px; }
  .drawer-item.active { background: var(--accent-soft); }
  .composer { display: flex; gap: 8px; padding: 10px 14px; border-top: 1px solid var(--border); }

  :global(:root) {
    --border: hsl(0 0% 32%); --surface: hsl(0 0% 14%); --text: hsl(0 0% 94%);
    --muted: hsl(0 0% 62%); --accent: hsl(240 64% 52%); --accent-soft: hsl(240 64% 52% / .25);
    --code-bg: hsl(0 0% 10%);
  }
  :global(html[data-theme='light']) {
    --border: hsl(0 0% 84%); --surface: #fff; --text: hsl(0 0% 12%);
    --muted: hsl(0 0% 45%); --accent: hsl(240 60% 45%); --accent-soft: hsl(240 60% 45% / .15);
    --code-bg: hsl(0 0% 96%);
  }
  :global(html[data-theme='dark']) {
    --border: hsl(0 0% 32%); --surface: hsl(0 0% 14%); --text: hsl(0 0% 94%);
    --muted: hsl(0 0% 62%); --accent: hsl(240 64% 52%); --accent-soft: hsl(240 64% 52% / .25);
    --code-bg: hsl(0 0% 10%);
  }
  :global(body) { margin: 0; }
</style>
