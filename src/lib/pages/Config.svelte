<script lang="ts">
  import { Plus, ChevronRight, Palette, ArrowLeftRight, LayoutGrid, Sparkles, Wrench, Globe, Languages, CircleDot } from '@lucide/svelte'
  // Config — web port of flutter screens/config.dart: the settings root list
  // (appearance / backend switch / providers / presets / tools / language) and
  // the drill-in details (appearance, backends, presets, tools).
  import type { PageProps } from '$lib/page-props'
  import { t, getLocale, setLocale } from '$lib/i18n.svelte'
  import { Prefs } from '$lib/prefs'
  import { showToast, showErrorToast } from '$lib/toast.svelte'
  import type { Preset, ToolInfo } from '$lib/models'
  import { parseToolParams } from '$lib/models'
  import { Switch } from '$lib/components/ui/switch'
  import { Select } from '$lib/components/ui/select'
  import { Dialog } from '$lib/components/ui/dialog'
  import { actionSheet } from '$lib/dialogs'
  import { confirmDialog } from '$lib/dialogs'
  import BackendsDetail from './BackendsDetail.svelte'
  import PresetsDetail from './PresetsDetail.svelte'
  import ToolsDetail from './ToolsDetail.svelte'

  let {
    store,
    dark,
    onDarkMode,
    onSwitchBackend,
    onBackendSwitched,
    showBack = false,
    initialId,
  }: PageProps = $props()

  const isDetail = $derived(initialId != null)
  let pickLocaleOpen = $state(false)
  let pickAgentLocaleOpen = $state(false)

  function titleOf(id?: string): string {
    switch (id) {
      case 'providers':
        return t('llmProviders')
      case 'presets':
        return t('presets')
      case 'appearance':
        return t('appearance')
      case 'tools':
        return t('tools')
      case 'backends':
        return t('backendsTitle')
      default:
        return t('tabConfig')
    }
  }

  function pickLanguage(code: 'zh' | 'en') {
    if (code !== getLocale()) {
      setLocale(code)
      localStorage.setItem('agent.uiLocale', code)
    }
  }

  async function pickAgentLocale(code: string) {
    pickAgentLocaleOpen = false
    if (code === Prefs.loadAgentLocale()) return
    Prefs.saveAgentLocale(code)
    const value = Prefs.effectiveAgentLocale(getLocale() === 'zh')
    try {
      await store.api.setConfigKey('locale', value)
      showToast(t('agentLocaleApplied', { l: value }))
    } catch (e) {
      showErrorToast(String(e))
    }
  }

  interface Row {
    icon: any
    label: string
    onTap: () => void
    destructive?: boolean
  }

  const sections = $derived.by(() => {
    const appearance: Row[] = [
      { icon: Palette, label: t('appearance'), onTap: () => store.pushSibling({ kind: 'config_sub', key: 'config_sub_appearance', id: 'appearance' }) },
    ]
    const backend: Row[] = [
      {
        icon: ArrowLeftRight,
        label: t('switchBackend'),
        onTap: () => store.pushSibling({ kind: 'config_sub', key: 'config_sub_backends', id: 'backends' }),
        destructive: true,
      },
    ]
    const llm: Row[] = [
      { icon: LayoutGrid, label: t('llmProviders'), onTap: () => store.pushSibling({ kind: 'providers_list', key: 'providers_list' }) },
      { icon: Sparkles, label: t('presets'), onTap: () => store.pushSibling({ kind: 'config_sub', key: 'config_sub_presets', id: 'presets' }) },
    ]
    const workspace: Row[] = [
      { icon: Wrench, label: t('tools'), onTap: () => store.pushSibling({ kind: 'config_sub', key: 'config_sub_tools', id: 'tools' }) },
    ]
    const language: Row[] = [
      { icon: Globe, label: t('language'), onTap: () => (pickLocaleOpen = true) },
      { icon: Languages, label: t('agentLocale'), onTap: () => (pickAgentLocaleOpen = true) },
    ]
    return [
      { title: t('appearance'), rows: appearance },
      { title: t('backendSection'), rows: backend },
      { title: t('llm'), rows: llm },
      { title: t('workspace'), rows: workspace },
      { title: t('language'), rows: language },
    ]
  })
</script>

<div class="flex h-full w-full flex-col">
  <header class="flex h-12 shrink-0 items-center gap-2 border-b border-border px-2">
    {#if isDetail && showBack}
      <button type="button" class="rounded p-1.5 hover:bg-muted" onclick={() => store.popPage()}>←</button>
    {/if}
    <span class="text-sm font-semibold">{titleOf(initialId)}</span>
    {#if isDetail && initialId === 'presets'}
      <button type="button" class="ml-auto rounded p-1.5 text-primary hover:bg-muted" title={t('newPreset')} onclick={() => store.pushPage({ kind: 'preset_form', key: 'preset_form_new' })}><Plus class="size-[18px]" /></button>
    {/if}
  </header>

  <div class="min-h-0 flex-1 overflow-y-auto">
    {#if isDetail}
      {@render detail(initialId!)}
    {:else}
      {#each sections as s (s.title)}
        <div class="px-4 pt-4 pb-1 text-micro font-semibold tracking-wider text-muted-foreground uppercase">{s.title}</div>
        {#each s.rows as r (r.label)}
          <button
            type="button"
            class="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-muted {r.destructive ? 'text-destructive font-semibold' : ''}"
            onclick={r.onTap}
          >
            <r.icon class="size-5 shrink-0 {r.destructive ? 'text-destructive' : 'text-muted-foreground'}" />
            <span class="flex-1 text-body">{r.label}</span>
            <ChevronRight class="size-4 text-muted-foreground" />
          </button>
        {/each}
      {/each}
    {/if}
  </div>
</div>

{#snippet detail(id: string)}
  {#if id === 'appearance'}
    <div class="flex items-center justify-between px-4 py-4">
      <div>
        <div class="text-body">{t('darkMode')}</div>
        <div class="text-micro text-muted-foreground">{t('darkModeSub')}</div>
      </div>
      <Switch checked={dark} onchange={v => onDarkMode?.(v)} />
    </div>
  {:else if id === 'backends'}
    {@render backendsDetail()}
  {:else if id === 'presets'}
    {@render presetsDetail()}
  {:else if id === 'tools'}
    {@render toolsDetail()}
  {:else if id === 'providers'}
    <!-- handled by ProvidersList page -->
  {/if}
{/snippet}

{#snippet backendsDetail()}
  <BackendsDetail {store} onBackendSwitched={b => onBackendSwitched?.(b)} />
{/snippet}

{#snippet presetsDetail()}
  <PresetsDetail {store} />
{/snippet}

{#snippet toolsDetail()}
  <ToolsDetail {store} />
{/snippet}

{#if pickLocaleOpen}
  <Dialog bind:open={pickLocaleOpen} title={t('language')}>
    {#snippet children()}
      <div class="flex flex-col">
        {#each [['zh', '中文'], ['en', 'English']] as [code, label] (code)}
          <button
            type="button"
            class="flex w-full items-center gap-3 rounded-sm px-3 py-2.5 text-left text-body hover:bg-muted"
            onclick={() => {
              pickLanguage(code as 'zh' | 'en')
              pickLocaleOpen = false
            }}
          >
            {#if getLocale() === code}<CircleDot class="size-4 text-primary" />{:else}<span class="size-4 rounded-full border border-muted-foreground/50"></span>{/if} {label}
          </button>
        {/each}
      </div>
    {/snippet}
  </Dialog>
{/if}

{#if pickAgentLocaleOpen}
  <Dialog bind:open={pickAgentLocaleOpen} title={t('agentLocale')}>
    {#snippet children()}
      <div class="flex flex-col">
        {#each [['follow', t('agentLocaleFollow')], ['zh', '中文'], ['en', 'English']] as [code, label] (code)}
          <button
            type="button"
            class="flex w-full items-center gap-3 rounded-sm px-3 py-2.5 text-left text-body hover:bg-muted"
            onclick={() => void pickAgentLocale(code)}
          >
            {#if Prefs.loadAgentLocale() === code}<CircleDot class="size-4 text-primary" />{:else}<span class="size-4 rounded-full border border-muted-foreground/50"></span>{/if} {label}
          </button>
        {/each}
      </div>
    {/snippet}
  </Dialog>
{/if}
