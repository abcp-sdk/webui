<script lang="ts">
  import { store } from './lib/store.svelte'
  import { agent } from './lib/agent'

  let promptText = $state('')
  let models: { id: string }[] = $state([])
  let presets: { id: string }[] = $state([])
  let themeOpen = $state(false)

  $effect(() => {
    void store.refreshSessions()
    void agent.listModels({}).then(r => (models = r.models))
    void agent.listPresets({}).then(r => (presets = r.presets))
  })

  function shift(v: string | null | undefined): string | null {
    return v && v !== '' ? v : null
  }

  async function deleteSession(name: string) {
    await store.deleteSession(name)
  }

  async function renameSession(name: string) {
    const next = prompt('New name for session', name)
    if (next && next.trim()) await store.renameSession(name, next.trim())
  }

  async function onSubmit(e: Event) {
    e.preventDefault()
    const t = promptText.trim()
    if (!t) return
    promptText = ''
    await store.send(t)
  }

  function onThemeChange(t: string) {
    store.setTheme(t as 'light' | 'dark' | 'system')
    themeOpen = false
  }
</script>

<svelte:head>
  <style>
    :root { color-scheme: light dark; }
    html[data-theme='light'] { color-scheme: light; }
    html[data-theme='dark'] { color-scheme: dark; }
  </style>
  <script>
    // nothing
  </script>
</svelte:head>

<main class:compact={store.isCompact} data-theme={store.theme === 'system' ? '' : store.theme}>
  <!-- Left: session list -->
  <aside class="sessions">
    <div class="sess-head">
      <strong>Sessions</strong>
      <button onclick={() => store.createSession()}>+</button>
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
            <button onclick={() => renameSession(s.name)}>✎</button>
            <button onclick={() => deleteSession(s.name)}>×</button>
          </div>
        </li>
      {/each}
    </ul>
  </aside>

  <!-- Right: chat -->
  <section class="chat">
    <header class="chat-head">
      <span class="title">{shift(store.activeName) ?? 'Agent'}</span>
      <div class="controls">
        <select
          onchange={(e) => store.activeName && store.switchModel(store.activeName, e.currentTarget.value)}
        >
          <option value="">model</option>
          {#each models as m (m.id)}
            <option value={m.id}>{m.id}</option>
          {/each}
        </select>
        <select
          onchange={(e) => store.activeName && store.setPreset(store.activeName, e.currentTarget.value)}
        >
          <option value="">preset</option>
          {#each presets as p (p.id)}
            <option value={p.id}>{p.id}</option>
          {/each}
        </select>
        <button onclick={() => store.activeName && store.interrupt(store.activeName)}>Stop</button>
        <button onclick={() => store.activeName && store.compact(store.activeName)}>Compact</button>
        <button onclick={() => (themeOpen = !themeOpen)}>◐</button>
        {#if themeOpen}
          <div class="theme-menu">
            {#each ['light', 'dark', 'system'] as t (t)}
              <button onclick={() => onThemeChange(t)} class:sel={store.theme === t}>{t}</button>
            {/each}
          </div>
        {/if}
      </div>
    </header>

    <div class="messages">
      {#if store.loading}
        <div class="empty">Loading…</div>
      {:else if store.messages.length === 0}
        <div class="empty">No messages. Send one below.</div>
      {:else}
        {#each store.messages as m (m.id)}
          <div class="msg {m.role}">
            {#if m.tools.length}
              <div class="tools">
                {#each m.tools as t (t.id)}
                  <details>
                    <summary>⚙ {t.name}</summary>
                    <pre>{t.output}</pre>
                  </details>
                {/each}
              </div>
            {/if}
            {#if m.reasoning}
              <details class="reasoning">
                <summary>Thinking…</summary>
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
      <input bind:value={promptText} placeholder="Message" autocomplete="off" />
      <button type="submit" disabled={store.sending}>Send</button>
    </form>
  </section>
</main>

<style>
  main { display: flex; height: 100vh; font-family: system-ui, sans-serif; transition: background-color .25s, color .25s; }
  main.compact aside { display: none; }
  main.compact .chat { border-left: none; }

  aside { width: 300px; min-width: 300px; border-right: 1px solid var(--border); height: 100%; overflow: auto; }
  .sess-head { display: flex; justify-content: space-between; align-items: center; padding: 12px; border-bottom: 1px solid var(--border); }
  .sess-head button { font-size: 18px; }
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
  .theme-menu button { text-align: left; padding: 6px 10px; }
  .theme-menu button.sel { background: var(--accent-soft); }

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

  .composer { display: flex; gap: 8px; padding: 10px 14px; border-top: 1px solid var(--border); }
  .composer input { flex: 1; padding: 10px 12px; border: 1px solid var(--border); border-radius: 8px; background: var(--surface); color: var(--text); }
  .composer button { padding: 10px 16px; border-radius: 8px; }

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
