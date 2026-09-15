<script lang="ts">
  import { Plus, ChevronRight, LayoutGrid, CircleDot, Circle } from '@lucide/svelte'
  // ProvidersList — web port of flutter ProvidersListScreen: the two sections
  // (text providers + the single Vercel-compatible gateway), default-model
  // pick (sets `default_model` config), add/edit entry points.
  import type { PageProps } from '$lib/page-props'
  import type { ProviderInfo } from '$lib/models'
  import { t } from '$lib/i18n.svelte'
  import { showErrorToast } from '$lib/toast.svelte'
  import { GATEWAY_API_TYPE, GATEWAY_PROVIDER_ID, apiTypeLabelKey } from './common'

  let { store, showBack = false }: PageProps = $props()

  const providers = $state<Record<string, ProviderInfo>>({})
  let loading = $state(true)
  let defaultModel = $state('')
  let pickOpen = $state(false)
  let seenRevision = 0

  $effect(() => {
    void load()
  })

  // reload when a provider was registered/removed
  $effect(() => {
    if (store.providersRevision !== seenRevision) {
      seenRevision = store.providersRevision
      void reload()
    }
  })

  async function reload() {
    try {
      Object.keys(providers).forEach(k => delete providers[k])
      const p = await store.api.providers()
      for (const [k, v] of Object.entries(p)) providers[k] = v
    } catch {
      /* offline */
    }
  }

  async function load() {
    try {
      defaultModel = await store.api.config('default_model')
    } catch {
      /* unset */
    }
    await reload()
    loading = false
  }

  const all = $derived(Object.values(providers))
  const textProviders = $derived(
    all.filter(p => p.apiType !== GATEWAY_API_TYPE).sort((a, b) => (a.providerId < b.providerId ? -1 : 1)),
  )
  const gateway = $derived(all.find(p => p.apiType === GATEWAY_API_TYPE) ?? null)

  const defaultRefs = $derived.by(() => {
    const refs: string[] = []
    for (const p of textProviders) {
      for (const m of p.models) {
        if ((m.contextLimit ?? 0) > 0) refs.push(`${p.providerId}/${m.id}`)
      }
    }
    refs.sort()
    if (defaultModel && !refs.includes(defaultModel)) refs.unshift(defaultModel)
    return refs
  })

  async function pickDefault(ref: string) {
    pickOpen = false
    if (ref === defaultModel) return
    try {
      await store.api.setConfigKey('default_model', ref)
      defaultModel = ref
    } catch (e) {
      showErrorToast(String(e))
    }
  }

  function addText() {
    store.beginProviderDraft(null)
    store.pushPage({ kind: 'provider_form', key: 'provider_form' })
  }

  function edit(p: ProviderInfo) {
    store.beginProviderDraft(p)
    store.pushPage({ kind: 'provider_form', key: 'provider_form' })
  }

  function editGateway() {
    store.beginProviderDraft(
      gateway ?? {
        providerId: GATEWAY_PROVIDER_ID,
        apiType: GATEWAY_API_TYPE,
        baseUrl: '',
        apiKey: '',
        models: [],
      },
    )
    store.pushPage({ kind: 'gateway_form', key: 'gateway_form' })
  }

  function apiTypeLabel(apiType: string): string {
    const key = apiTypeLabelKey(apiType)
    return key ? t(key) : apiType
  }
</script>

<div class="flex h-full w-full flex-col">
  <header class="flex h-12 shrink-0 items-center gap-2 border-b border-border px-2">
    {#if showBack}
      <button type="button" class="rounded p-1.5 hover:bg-muted" onclick={() => store.popPage()}>←</button>
    {/if}
    <span class="text-sm font-semibold">{t('llmProviders')}</span>
    <button type="button" class="ml-auto rounded p-1.5 text-primary hover:bg-muted" title={t('addProvider')} onclick={addText}><Plus class="size-4" /></button>
  </header>

  <div class="min-h-0 flex-1 overflow-y-auto">
    {#if loading}
      <div class="flex justify-center py-8">
        <span class="size-6 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-muted-foreground"></span>
      </div>
    {:else}
      <div class="px-4 pt-4 pb-1 text-micro font-semibold tracking-wider text-muted-foreground uppercase">{t('providersSection')}</div>

      <!-- default model tile -->
      <button
        type="button"
        class="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-muted"
        onclick={() => (pickOpen = true)}
      >
        <span class="w-5 text-center text-primary">★</span>
        <span class="min-w-0 flex-1">
          <span class="block text-body font-medium">{t('defaultModel')}</span>
          <span class="block truncate text-micro text-muted-foreground">{defaultModel || t('none')}</span>
        </span>
        <ChevronRight class="size-4 text-muted-foreground" />
      </button>

      {#if textProviders.length === 0}
        <p class="px-4 py-2 text-meta text-muted-foreground">{t('noProviders')}</p>
      {/if}
      {#each textProviders as p (p.providerId)}
        <button type="button" class="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-muted" onclick={() => edit(p)}>
          <LayoutGrid class="size-5 shrink-0 text-primary" />
          <span class="min-w-0 flex-1">
            <span class="block text-body font-medium">{p.providerId}</span>
            <span class="block truncate text-micro text-muted-foreground">{apiTypeLabel(p.apiType)} · {t('modelsCount', { n: p.models.length })}</span>
          </span>
          <ChevronRight class="size-4 text-muted-foreground" />
        </button>
      {/each}

      <div class="mx-4 my-4 border-t border-border"></div>
      <div class="px-4 pb-1 text-micro font-semibold tracking-wider text-muted-foreground uppercase">{t('gatewaySection')}</div>
      <button type="button" class="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-muted" onclick={editGateway}>
        <span class="w-5 text-center" class:text-success={gateway} class:text-muted-foreground={!gateway}>◎</span>
        <span class="min-w-0 flex-1">
          <span class="block text-body font-medium">gateway</span>
          <span class="block truncate text-micro text-muted-foreground">
            {gateway ? `${t('modelsCount', { n: gateway.models.length })} · ${gateway.baseUrl}` : t('gatewayHint')}
          </span>
        </span>
        <ChevronRight class="size-4 text-muted-foreground" />
      </button>
      {#if gateway}
        <p class="px-4 pb-2 text-micro text-muted-foreground">{t('gatewayHint')}</p>
      {/if}
    {/if}
  </div>
</div>

{#if pickOpen}
  <div class="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4" role="presentation" onclick={() => (pickOpen = false)}>
    <div class="max-h-[70vh] w-[min(92vw,420px)] overflow-y-auto rounded-lg border border-border bg-card p-2 shadow-xl" onclick={e => e.stopPropagation()} role="presentation">
      <div class="px-3 py-2 text-sm font-semibold">{t('defaultModel')}</div>
      {#each ['', ...defaultRefs] as ref (ref)}
        <button
          type="button"
          class="flex w-full items-center gap-3 px-3 py-2.5 text-left text-meta hover:bg-muted"
          onclick={() => void pickDefault(ref)}
        >
          {#if ref === defaultModel}<CircleDot class="size-4 text-primary" />{:else}<Circle class="size-4 text-muted-foreground" />{/if}
          <span class="font-mono">{ref || t('none')}</span>
        </button>
      {/each}
    </div>
  </div>
{/if}
