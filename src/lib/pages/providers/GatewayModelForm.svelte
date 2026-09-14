<script lang="ts">
  // GatewayModelForm — web port of flutter GatewayModelScreen: a GATEWAY model
  // entry (id, optional context; kind implied: ctx>0 text, 0 multimodal) with
  // capability-scoped test.
  import type { PageProps } from '$lib/page-props'
  import { t } from '$lib/i18n.svelte'
  import { showToast, showErrorToast } from '$lib/toast.svelte'
  import { MULTIMODAL_CAPABILITIES, capabilityIcon, capabilityLabelKey, GATEWAY_API_TYPE, GATEWAY_PROVIDER_ID } from './common'

  let { store, showBack = false, modelId = null }: PageProps & { modelId?: string | null } = $props()

  const draft = $derived(store.providerDraft)
  const existing = $derived(draft?.models.find(m => m.id === modelId) ?? null)
  const isEdit = $derived(modelId != null)

  let mid = $state('')
  let name = $state('')
  let ctx = $state('')
  let modelType = $state('text')
  let testing = $state(false)
  let testOk = $state<boolean | null>(null)
  let testMsg = $state('')

  $effect(() => {
    mid = existing?.id ?? ''
    name = existing?.name ?? ''
    ctx = existing && (existing.contextLimit ?? 0) > 0 ? String(existing.contextLimit) : ''
    modelType = existing && (existing.contextLimit ?? 0) > 0 ? 'text' : existing?.modelType || 'text'
  })

  const canSave = $derived(mid.trim() !== '')

  function save() {
    const d = store.providerDraft
    if (!d) return
    const id = mid.trim()
    if (!id) return
    const c = parseInt(ctx.trim()) || 0
    if (isEdit) d.models = d.models.filter(m => m.id !== modelId)
    d.models = d.models.filter(m => m.id !== id)
    d.models = [
      ...d.models,
      {
        id,
        name: name.trim() || id,
        // ctx > 0 marks a text model; 0 marks a multimodal model (kind tag).
        contextLimit: c,
        modelType: c > 0 ? '' : modelType,
      },
    ]
    store.popPage()
  }

  async function test() {
    const d = store.providerDraft
    if (!d || !mid.trim()) return
    testing = true
    testOk = null
    testMsg = ''
    try {
      const capability = parseInt(ctx.trim()) > 0 ? 'text' : modelType
      const r = await store.api.testProvider({
        apiType: GATEWAY_API_TYPE,
        baseUrl: d.baseUrl,
        apiKey: d.apiKey,
        providerId: GATEWAY_PROVIDER_ID,
        model: `${GATEWAY_PROVIDER_ID}/${mid.trim()}`,
        capability,
      })
      testOk = r.ok
      testMsg = r.ok ? t('testModelOk', { r: String(r.result ?? '') }) : String(r.result ?? t('testFailed'))
    } catch (e) {
      testOk = false
      testMsg = String(e)
    }
    testing = false
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
        <button type="button" class="rounded p-1.5 hover:bg-muted" onclick={() => store.popPage()}>←</button>
      {/if}
      <span class="text-sm font-semibold">{isEdit ? t('editModel') : t('addModel')}</span>
      <button type="button" class="ml-auto text-sm text-primary disabled:opacity-40" disabled={!canSave} onclick={save}>{t('save')}</button>
    </header>

    <div class="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
      <label class="block">
        <span class="mb-1 block text-meta text-muted-foreground">{t('modelIdReq')}</span>
        <input bind:value={mid} class="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono text-sm outline-none focus-visible:border-ring" />
      </label>

      <label class="block">
        <span class="mb-1 block text-meta text-muted-foreground">{t('modelName')}</span>
        <input bind:value={name} class="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring" />
      </label>

      <label class="block">
        <span class="mb-1 block text-meta text-muted-foreground">{t('contextLengthLabel')}</span>
        <input bind:value={ctx} type="number" min="0" class="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring" />
        <span class="mt-1 block text-micro text-muted-foreground">{t('gatewayModelsHint')}</span>
      </label>

      {#if !(parseInt(ctx.trim()) > 0)}
        <div>
          <span class="mb-1 block text-meta text-muted-foreground">{t('capability')}</span>
          <div class="flex flex-wrap gap-1.5">
            {#each MULTIMODAL_CAPABILITIES as c (c)}
              <button
                type="button"
                class="flex items-center gap-1 rounded-full border px-2.5 py-1 text-micro {modelType === c ? 'border-primary/50 bg-primary/15 text-primary' : 'border-border text-muted-foreground hover:bg-muted'}"
                onclick={() => (modelType = c)}
              >{capabilityIcon(c)} {t(capabilityLabelKey(c))}</button>
            {/each}
          </div>
        </div>
      {/if}

      <div class="pt-2">
        <button
          type="button"
          class="rounded-md border border-border px-3 py-1.5 text-meta hover:bg-muted disabled:opacity-40"
          disabled={testing || !mid.trim()}
          onclick={() => void test()}
        >{testing ? t('connecting') : t('test')}</button>
        {#if testOk !== null}
          <div class="mt-2 rounded-md border {testOk ? 'border-success/40 bg-success/10 text-success' : 'border-destructive/40 bg-destructive/10 text-destructive'} px-3 py-2 text-micro">
            {testMsg}
          </div>
        {/if}
      </div>
    </div>
  </div>
{/if}
