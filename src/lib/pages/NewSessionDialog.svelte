<script lang="ts">
  // NewSessionDialog — create a session with an EXPLICIT agent language pinned
  // at creation (中文 / English). The language defaults to the tenant default
  // but is always visible and editable, so a session's language is stable for
  // its lifetime instead of silently following a mutable tenant config.
  import { t } from '$lib/i18n.svelte'
  import { Dialog } from '$lib/components/ui/dialog'
  import { Input } from '$lib/components/ui/input'
  import { Select } from '$lib/components/ui/select'

  let {
    open = $bindable(false),
    defaultLocale = 'en',
    onCreate,
  }: {
    open?: boolean
    defaultLocale?: 'zh' | 'en'
    onCreate: (name: string, locale: 'zh' | 'en') => void
  } = $props()

  let name = $state('')
  let locale = $state<'zh' | 'en'>('en')
  let busy = $state(false)

  // Re-seed the language from the tenant default each time the dialog opens.
  $effect(() => {
    if (open) {
      locale = defaultLocale
    }
  })

  const canCreate = $derived(name.trim() !== '' && !busy)

  function submit() {
    if (!canCreate) return
    onCreate(name.trim(), locale)
  }
</script>

<Dialog bind:open title={t('newSession')}>
  {#snippet children()}
    <div class="flex flex-col gap-3">
      <label class="block">
        <span class="mb-1 block text-meta text-muted-foreground">{t('sessionNameLabel')}</span>
        <Input bind:value={name} placeholder={t('sessionNamePlaceholder')} />
      </label>
      <label class="block">
        <span class="mb-1 block text-meta text-muted-foreground">{t('agentLocale')}</span>
        <Select
          bind:value={locale}
          items={[
            { value: 'zh', label: '中文' },
            { value: 'en', label: 'English' },
          ]}
        />
      </label>
    </div>
  {/snippet}
  {#snippet footer()}
    <button type="button" class="rounded-md px-3 py-1.5 text-sm hover:bg-muted" onclick={() => (open = false)}>{t('cancel')}</button>
    <button
      type="button"
      class="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground hover:bg-primary/80 disabled:opacity-50"
      disabled={!canCreate}
      onclick={submit}
    >{t('create')}</button>
  {/snippet}
</Dialog>
