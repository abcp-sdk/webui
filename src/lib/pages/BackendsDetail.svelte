<script lang="ts">
  import { Trash2 } from '@lucide/svelte'
  // BackendsDetail — web port of flutter config.dart _BackendsDetail: the
  // saved-connections manager (switch / delete / add).
  import type { AppStore } from '$lib/store.svelte'
  import type { BackendCfg } from '$lib/models'
  import { t } from '$lib/i18n.svelte'
  import { Prefs } from '$lib/prefs'
  import { showToast } from '$lib/toast.svelte'
  import { Button } from '$lib/components/ui/button'

  let {
    store,
    onBackendSwitched,
  }: {
    store: AppStore
    onBackendSwitched?: ((b: BackendCfg) => void) | null
  } = $props()

  let backends = $state<BackendCfg[]>([])
  let activeBase = $derived(store.api.baseUrl)

  $effect(() => {
    backends = Prefs.backends()
  })

  async function remove(b: BackendCfg) {
    Prefs.removeBackend(b.baseUrl)
    backends = Prefs.backends()
    showToast(t('saved'))
  }
</script>

<div class="h-full w-full p-4">
  {#if backends.length === 0}
    <p class="py-2 text-meta text-muted-foreground">{t('noSavedBackends')}</p>
  {/if}
  <div class="space-y-2">
    {#each backends as b (b.baseUrl)}
      <div class="flex items-center gap-3 rounded-md border border-border bg-card px-3 py-2.5">
        <span class={activeBase === b.baseUrl ? 'text-primary' : 'text-muted-foreground'}>
          {activeBase === b.baseUrl ? '◉' : '▦'}
        </span>
        <span class="min-w-0 flex-1">
          <span class="block truncate text-body">{b.name || b.baseUrl}</span>
          <span class="block truncate text-micro text-muted-foreground">{b.baseUrl}</span>
        </span>
        <button type="button" class="rounded p-1.5 text-muted-foreground hover:bg-muted" title={t('deleteBackend')} onclick={() => void remove(b)}><Trash2 class="size-4" /></button>
        <Button size="sm" variant="outline" disabled={activeBase === b.baseUrl} onclick={() => onBackendSwitched?.(b)}>
          {activeBase === b.baseUrl ? t('connected') : t('connect')}
        </Button>
      </div>
    {/each}
  </div>
</div>
