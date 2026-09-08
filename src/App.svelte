<script lang="ts">
  import { agent } from './lib/agent'
  import { store } from './lib/store.svelte'

  let promptText = $state('')
  let models: { id: string }[] = $state([])
  let presets: { id: string }[] = $state([])

  $effect(() => {
    void store.refreshSessions()
    void agent.listModels({}).then(r => (models = r.models))
    void agent.listPresets({}).then(r => (presets = r.presets))
  })

  async function onCreate() {
    await agent.createSession({})
    await store.refreshSessions()
  }

  async function onDelete(name: string) {
    await agent.deleteSession({ id: name })
    await store.refreshSessions()
  }

  async function onSubmit(e: Event) {
    e.preventDefault()
    const t = promptText.trim()
    if (!t) return
    promptText = ''
    await store.send(t)
  }

  async function onInterrupt() {
    if (store.activeId) await agent.interrupt({ id: store.activeId })
  }

  async function onCompact() {
    if (store.activeId) await agent.compact({ id: store.activeId })
  }
</script>

<main>
  <aside>
    <button onclick={onCreate}>+ New session</button>
    <ul>
      {#each store.sessions as s (s.name)}
        <li>
          <button
            class:active={s.name === store.activeId}
            onclick={() => store.selectSession(s.name)}
          >
            {s.name}
          </button>
          <button onclick={() => onDelete(s.name)}>×</button>
        </li>
      {/each}
    </ul>
  </aside>

  <section>
    <header>
      <select
        onchange={(e) =>
          store.activeId &&
          agent.setModel({ id: store.activeId, model: e.currentTarget.value })}
      >
        <option value="">model</option>
        {#each models as m (m.id)}
          <option value={m.id}>{m.id}</option>
        {/each}
      </select>
      <select
        onchange={(e) =>
          store.activeId &&
          agent.updateSettings({ id: store.activeId, preset: e.currentTarget.value })}
      >
        <option value="">preset</option>
        {#each presets as p (p.id)}
          <option value={p.id}>{p.id}</option>
        {/each}
      </select>
      <button onclick={onInterrupt}>Stop</button>
      <button onclick={onCompact}>Compact</button>
    </header>

    <ul>
      {#each store.messages as m (m.id)}
        <li>
          <strong>{m.role}</strong>
          <pre>{JSON.stringify(m)}</pre>
        </li>
      {/each}
    </ul>

    <form onsubmit={onSubmit}>
      <input bind:value={promptText} placeholder="Message" />
      <button disabled={store.sending} type="submit">Send</button>
    </form>
  </section>
</main>

<style>
  main { display: flex; height: 100vh; font-family: system-ui; }
  aside { width: 260px; border-right: 1px solid #888; padding: 12px; }
  section { flex: 1; display: flex; flex-direction: column; }
  header { display: flex; gap: 8px; align-items: center; padding: 8px; border-bottom: 1px solid #888; }
  ul { list-style: none; margin: 0; padding: 12px; flex: 1; overflow: auto; }
  li { margin: 6px 0; }
  form { display: flex; gap: 8px; padding: 8px; border-top: 1px solid #888; }
  input { flex: 1; }
  .active { font-weight: 700; }
</style>
