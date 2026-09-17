<script lang="ts">
  import { AppIcons } from '$lib/icons'
  // GatewayForm — web port of flutter GatewayFormScreen: a Vercel-compatible
  // gateway provider (id + baseUrl + key, Discover button, text vs multimodal
  // model rows). Several gateways may coexist; the id is editable when new.
  import type { PageProps } from '$lib/page-props'
  import { t } from '$lib/i18n.svelte'
  import { showToast, showErrorToast } from '$lib/toast.svelte'
  import { GATEWAY_API_TYPE, GATEWAY_PROVIDER_ID } from './common'
  import ModelRow from './ModelRow.svelte'

  let { store, showBack = false }: PageProps = $props()

  const draft = $derived(store.providerDraft)
  let id = $state(GATEWAY_PROVIDER_ID)
  let url = $state('')
  let key = $state('')
  let registering = $state(false)
  let discovering = $state(false)

  $effect(() => {
    const d = store.providerDraft
    if (d) {
      id = d.id || GATEWAY_PROVIDER_ID
      url = d.baseUrl
      key = d.apiKey
    }
  })

  const canSave = $derived(url.trim() !== '' && !registering)
  const textModels = $derived((draft?.models ?? []).filter(m => (m.contextLimit ?? 0) > 0))
  const multiModels = $derived((draft?.models ?? []).filter(m => (m.contextLimit ?? 0) <= 0))

  async function discover() {
    const d = store.providerDraft
    if (!d || !url.trim()) return
    discovering = true
    try {
      const r = await store.api.discoverGatewayModels({
        providerId: (id.trim() || GATEWAY_PROVIDER_ID),
        apiType: GATEWAY_API_TYPE,
        baseUrl: url.trim(),
        apiKey: key,
      })
      if (r.error && !r.models.length) {
        showErrorToast(r.error)
      } else {
        d.models = r.models
        showToast(t('discoveredModels', { n: r.models.length }))
      }
    } catch (e) {
      showErrorToast(String(e))
    }
    discovering = false
  }

  function removeModel(mid: string) {
    const d = store.providerDraft
    if (!d) return
    d.models = d.models.filter(m => m.id !== mid)
  }

  async function save() {
    const d = store.providerDraft
    if (!d) return
    d.id = (id.trim() || GATEWAY_PROVIDER_ID)
    d.apiType = GATEWAY_API_TYPE
    d.baseUrl = url.trim()
    d.apiKey = key
    if (!d.baseUrl) return
    registering = true
    try {
      await store.api.registerProvider({
        providerId: d.id,
        apiType: GATEWAY_API_TYPE,
        baseUrl: d.baseUrl,
        apiKey: d.apiKey,
        models: d.models,
      })
      store.bumpProvidersRevision()
      store.endProviderDraft()
      showToast(t('saved'))
      store.popPage()
    } catch (e) {
      showErrorToast(String(e))
    }
    registering = false
  }
</script>

{#if !draft}
  <div class="flex h-full items-center justify-center">
    <span class="size-6 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-muted-foreground"></span>
  </div>
{:else}
  <div class="flex h-full w-full flex-col">
    <header class="flex h-12 shrink-0 items-center gap-2 border-b border-border px-2">
      {#if showBack}
        <button
          type="button"
          class="rounded p-1.5 hover:bg-muted"
          onclick={() => {
            store.endProviderDraft()
            store.popPage()
          }}
        >←</button>
      {/if}
      <span class="text-sm font-semibold">{t('gatewayTitle')}</span>
    </header>

    <div class="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
      <p class="text-micro text-muted-foreground">{t('gatewayHint')}</p>

      <label class="block">
        <span class="mb-1 block text-meta text-muted-foreground">{t('providerIdReq')}</span>
        <input bind:value={id} class="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono text-sm outline-none focus-visible:border-ring" />
      </label>

      <label class="block">
        <span class="mb-1 block text-meta text-muted-foreground">{t('baseUrlReq')}</span>
        <input bind:value={url} class="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring" />
      </label>

      <label class="block">
        <span class="mb-1 block text-meta text-muted-foreground">{t('apiKeyReq')}</span>
        <input bind:value={key} type="password" class="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring" />
      </label>

      <div class="flex items-center gap-2 pt-1">
        <span class="flex-1 text-meta font-semibold">{t('modelsLabel')}</span>
        <button
          type="button"
          class="rounded-md border border-border px-2.5 py-1 text-meta hover:bg-muted disabled:opacity-40"
          disabled={discovering || !url.trim()}
          onclick={() => void discover()}
        >{discovering ? t('connecting') : t('discoverModels')}</button>
        <button
          type="button"
          class="rounded p-1.5 text-primary hover:bg-muted"
          title={t('addModel')}
          onclick={() => store.pushPage({ kind: 'gateway_model', key: 'gateway_model_new', modelId: null })}
        ><AppIcons.add class="size-4" /></button>
      </div>

      {#if textModels.length}
        <div class="pt-1 text-micro font-semibold tracking-wider text-muted-foreground uppercase">{t('capText')}</div>
        {#each textModels as m (m.id)}
          <ModelRow model={m} onTap={() => store.pushPage({ kind: 'gateway_model', key: `gateway_model_${m.id}`, modelId: m.id })} onRemove={() => removeModel(m.id)} />
        {/each}
      {/if}

      {#if multiModels.length}
        <div class="pt-2 text-micro font-semibold tracking-wider text-muted-foreground uppercase">{t('multimodal')}</div>
        {#each multiModels as m (m.id)}
          <ModelRow model={m} onTap={() => store.pushPage({ kind: 'gateway_model', key: `gateway_model_${m.id}`, modelId: m.id })} onRemove={() => removeModel(m.id)} />
        {/each}
      {/if}
    </div>

    <div class="border-t border-border p-3">
      <button
        type="button"
        class="h-10 w-full rounded-md bg-primary text-sm font-medium text-primary-foreground hover:bg-primary/80 disabled:opacity-40"
        disabled={!canSave}
        onclick={() => void save()}
      >{registering ? t('registering') : t('save')}</button>
    </div>
  </div>
{/if}
