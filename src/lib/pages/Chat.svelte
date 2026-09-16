<script lang="ts">
  // Chat — web port of flutter screens/chat.dart: top bar (status lamp,
  // context tokens, name pill → settings, menu: compact/mailbox/fork/delete),
  // local-first message list (load-more at top, follow-bottom), composer with
  // draft persistence, attachment tiles (upload/retry/remove), attach sheet,
  // drag&drop, clipboard media paste, voice recording and settings dialog.
  import type { PageProps } from '$lib/page-props'
  import { MessagesController } from '$lib/messages.svelte'
  import { untrack } from 'svelte'
  import { t } from '$lib/i18n.svelte'
  import { confirmDialog, promptDialog } from '$lib/dialogs'
  import { showErrorToast, showToast } from '$lib/toast.svelte'
  import { guessMime, mimeToKind } from '$lib/media'
  import type { ModelInfo, ModelVariantInfo, Preset, ProviderInfo, Session, UploadedFile } from '$lib/models'
  import { modelRefOf, sessionName } from '$lib/models'
  import { VoiceRecorder } from '$lib/voice'
  import { cn } from '$lib/utils'
  import { DropdownMenu, DropdownMenuItem, DropdownMenuSeparator } from '$lib/components/ui/dropdown-menu'
  import { Popover } from '$lib/components/ui/popover'
  import { Select } from '$lib/components/ui/select'
  import { Dialog } from '$lib/components/ui/dialog'
  import { FileText, Image, Mic, Paperclip, Send, Square, X, ChevronLeft, LoaderCircle, RotateCcw, Download, MessageSquare } from '@lucide/svelte'
  import MessageBubble from '$lib/components/MessageBubble.svelte'
  import MediaAttachment from '$lib/components/MediaAttachment.svelte'

  let { store }: PageProps = $props()

  // The controller instance is REACTIVE: switching sessions replaces it, and
  // the message list must re-render against the NEW one. With a plain (non
  // $state) field the template kept reading the old controller — the header
  // updated (it derives from the store) while the message list did not, which
  // is exactly the "switch chat, content does not refresh" bug. Disposal reads
  // it through `untrack` so the effect does not depend on it.
  let ctrl = $state<MessagesController | null>(null)
  let providers = $state<Record<string, ProviderInfo>>({})
  let presets: Preset[] = $state([])
  let localUrls = $state<Record<string, string>>({})

  // settings dialog state
  let settingsOpen = $state(false)
  let infoOpen = $state(false)
  let selectedRef = $state('')
  let variant = $state('')
  let preset = $state('')
  let locale = $state('')
  let allModels = $state<ModelInfo[]>([])
  let loadingModels = $state(false)
  let modelsLoaded = $state(false)

  // composer state
  let text = $state('')
  let attachments = $state<UploadedFile[]>([])
  let recording = $state(false)
  let dragging = $state(false)
  let followBottom = $state(true)

  let listEl: HTMLElement | null = $state(null)
  let taEl: HTMLTextAreaElement | null = $state(null)
  const recorder = new VoiceRecorder()

  const session = $derived<Session | null>(store.activeSession)
  const sid = $derived(session?.id ?? '')

  // (Re)boot the controller whenever the open session changes.
  $effect(() => {
    const id = sid
    if (!id) {
      untrack(() => {
        ctrl?.dispose()
        ctrl = null
      })
      return
    }
    const prev = untrack(() => ctrl)
    const c = new MessagesController(store.api, () => id, store.local, {
      sendFailed: e => t('sendFailed', { e: String(e) }),
    })
    ctrl = c
    prev?.dispose()
    c.init()
    // restore draft
    const d = store.chatDrafts[id]
    text = d?.text ?? ''
    attachments = d?.attachments ?? []
    void loadMeta()
    return () => {
      c.dispose()
    }
  })

  async function loadMeta() {
    try {
      providers = await store.api.providers()
    } catch {
      /* providers optional for chat */
    }
    try {
      presets = await store.api.presets()
    } catch {
      /* presets optional */
    }
  }

  // ---- scroll behaviour ----

  function onScroll() {
    if (!listEl) return
    const nearBottom = listEl.scrollHeight - listEl.scrollTop - listEl.clientHeight < 80
    followBottom = nearBottom
    if (listEl.scrollTop < 60 && ctrl?.hasMore && !ctrl.loading) {
      void ctrl.loadMore()
    }
  }

  $effect(() => {
    if (!ctrl || !listEl) return
    void ctrl.revision
    if (followBottom) {
      requestAnimationFrame(() => {
        if (listEl) listEl.scrollTop = listEl.scrollHeight
      })
    }
  })

  // ---- draft persistence ----

  let draftTimer: ReturnType<typeof setTimeout> | null = null
  function persistDraft() {
    if (!sid) return
    store.saveDraftText(sid, text)
    store.saveDraftAttachments(sid, attachments)
  }

  function schedulePersist() {
    draftTimer && clearTimeout(draftTimer)
    draftTimer = setTimeout(persistDraft, 300)
  }

  // ---- sending ----

  // Uploads currently in flight (so send can await them all first).
  const inflightUploads = new Set<Promise<void>>()
  let sending = $state(false)

  function canSend(): boolean {
    return (!!text.trim() || attachments.some(a => a.code)) && !!(ctrl && !ctrl.sending)
  }

  async function send() {
    if (!canSend() || !ctrl || sending) return
    sending = true
    // If any attachment is still uploading, wait for every in-flight upload to
    // finish before sending (flutter _send).
    if (inflightUploads.size) {
      await Promise.allSettled([...inflightUploads])
      if (ctrl.sending) { sending = false; return }
    }
    // ALL-or-NOTHING: refuse the send while any attachment lacks a server code
    // (still uploading or failed) — never send a partial batch.
    const failed = attachments.filter(a => a.uploadState === 'error' || !a.code || a.code.startsWith('tmp-'))
    if (failed.length) {
      sending = false
      showErrorToast(t('uploadFailedRetry', { arg1: failed.length }))
      return
    }
    const body = text
    const files = attachments.filter(a => a.code)
    text = ''
    attachments = []
    persistDraft()
    sending = false
    await ctrl.send(body, files)
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault()
      void send()
    }
  }

  // ---- attachments ----

  async function uploadOne(src: { name: string; mimeType: string; bytes: Uint8Array }) {
    if (!sid) return
    const localKey = `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    localUrls[localKey] = URL.createObjectURL(new Blob([new Uint8Array(src.bytes)], { type: src.mimeType }))
    const pending: UploadedFile = {
      code: localKey,
      name: src.name,
      mime: src.mimeType,
      size: src.bytes.length,
      localPath: localUrls[localKey],
      deduped: false,
      uploadState: 'uploading',
      sha256: null,
    }
    attachments = [...attachments, pending]
    const job = (async () => {
      try {
        const done = await store.api.uploadFile({ path: '', name: src.name, mimeType: src.mimeType, bytes: src.bytes })
        attachments = attachments.map(a => (a === pending ? done : a))
      } catch (e) {
        attachments = attachments.map(a =>
          a === pending ? { ...a, uploadState: 'error', error: String(e) } : a,
        )
      }
      schedulePersist()
    })()
    inflightUploads.add(job)
    try { await job } finally { inflightUploads.delete(job) }
  }

  function removeAttachment(a: UploadedFile) {
    attachments = attachments.filter(x => x !== a)
    if (localUrls[a.code]) {
      URL.revokeObjectURL(localUrls[a.code])
      delete localUrls[a.code]
    }
    schedulePersist()
  }

  async function retryUpload(a: UploadedFile) {
    if (!a.localPath) return
    try {
      const res = await fetch(a.localPath)
      const blob = await res.blob()
      const bytes = new Uint8Array(await blob.arrayBuffer())
      const done = await store.api.uploadFile({
        path: '',
        name: a.name ?? 'file',
        mimeType: a.mime ?? blob.type,
        bytes,
      })
      attachments = attachments.map(x => (x === a ? done : x))
    } catch (e) {
      showErrorToast(String(e))
    }
    schedulePersist()
  }

  function pickFiles(accept: string) {
    const input = document.createElement('input')
    input.type = 'file'
    input.multiple = true
    if (accept) input.accept = accept
    input.onchange = () => {
      for (const f of input.files ?? []) {
        void f.arrayBuffer().then(buf =>
          uploadOne({ name: f.name, mimeType: f.type || guessMime(f.name), bytes: new Uint8Array(buf) }),
        )
      }
    }
    input.click()
  }

  async function onDrop(e: DragEvent) {
    e.preventDefault()
    dragging = false
    for (const f of e.dataTransfer?.files ?? []) {
      const buf = new Uint8Array(await f.arrayBuffer())
      void uploadOne({ name: f.name, mimeType: f.type || guessMime(f.name), bytes: buf })
    }
  }

  function onPaste(e: ClipboardEvent) {
    for (const item of e.clipboardData?.items ?? []) {
      if (item.kind === 'file') {
        const f = item.getAsFile()
        if (!f) continue
        e.preventDefault()
        void f.arrayBuffer().then(buf =>
          uploadOne({ name: f.name || 'pasted.png', mimeType: f.type || guessMime(f.name), bytes: new Uint8Array(buf) }),
        )
      }
    }
  }

  // ---- voice ----

  async function toggleRecording() {
    if (recording) {
      const src = await recorder.stop()
      recording = false
      if (src) void uploadOne(src)
    } else {
      const ok = await recorder.start()
      if (ok) recording = true
      else showErrorToast(t('voicePermission'))
    }
  }

  // ---- settings dialog ----

  async function showSettings() {
    if (!session) return
    selectedRef = session.model
    variant = session.variant
    preset = session.preset
    locale = session.locale ?? ''
    settingsOpen = true
    if (!modelsLoaded) {
      loadingModels = true
      const out: ModelInfo[] = []
      for (const pid of Object.keys(providers)) {
        try {
          out.push(...(await store.api.models(pid)))
        } catch {
          /* provider skipped */
        }
      }
      allModels = out
      loadingModels = false
      modelsLoaded = true
      if (out.length && !out.some(m => modelRefOf(m) === selectedRef)) {
        selectedRef = modelRefOf(out[0]!)
      }
    }
  }

  const modelOptions = $derived.by(() => {
    const opts = allModels.map(m => ({ value: modelRefOf(m), label: modelRefOf(m) }))
    if (selectedRef && !allModels.some(m => modelRefOf(m) === selectedRef)) {
      opts.unshift({ value: selectedRef, label: selectedRef })
    }
    return opts
  })

  const variantsForModel = $derived.by(() => {
    const sel = allModels.filter(m => modelRefOf(m) === selectedRef)
    return sel.length ? sel[0]!.variants : ([] as ModelVariantInfo[])
  })

  $effect(() => {
    if (variantsForModel.length && !variantsForModel.some(v => v.id === variant)) variant = ''
  })

  async function applySettings() {
    settingsOpen = false
    if (!sid) return
    try {
      const updated = await store.api.settings(sid, {
        ...(selectedRef ? { model: selectedRef } : {}),
        variant,
        ...(preset ? { preset } : {}),
        locale,
      })
      store.applySession(updated)
      showToast(t('saved'))
    } catch (e) {
      showErrorToast(String(e))
    }
  }

  // ---- menu actions ----

  async function menuAction(v: string) {
    switch (v) {
      case 'compact': {
        const ok = await confirmDialog({ title: t('compactHistory'), body: t('compactConfirm'), confirmLabel: t('apply') })
        if (ok && sid) {
          try {
            await store.api.compact(sid)
            showToast(t('compactedLabel'))
          } catch (e) {
            showErrorToast(String(e))
          }
        }
        break
      }
      case 'mailbox':
        store.pushPage({ kind: 'chat_overlay', key: 'chat_overlay', overlay: 'mailbox' })
        break
      case 'fork': {
        const branch = await promptDialog({ title: t('fork'), confirmLabel: t('create') })
        if (!branch) return
        const ok = await store.forkSession(branch)
        if (ok) showToast(t('saved'))
        else showErrorToast(t('forkFailed'))
        break
      }
      case 'delete': {
        const ok = await confirmDialog({ title: t('deleteSession'), body: session ? t('deleteSessionBody', { arg1: sessionName(session) }) : '', confirmLabel: t('delete'), destructive: true })
        if (ok && sid) {
          try {
            await store.deleteSession(sid)
          } catch (e) {
            showErrorToast(String(e))
          }
        }
        break
      }
    }
  }

  function fmtContext(tokens: number): string {
    if (tokens <= 0) return ''
    if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`
    if (tokens >= 10_000) return `${Math.round(tokens / 1000)}k`
    return `${(tokens / 1000).toFixed(1)}k`
  }

  const ctxLabel = $derived(fmtContext((session?.lastInputTokens ?? 0) + (session?.lastOutputTokens ?? 0)))
  const presetOptions = $derived([
    ...presets.map(p => p.id),
    ...(preset && !presets.some(p => p.id === preset) ? [preset] : []),
  ])
  const tileDim = 56

  function isLocalPreview(a: UploadedFile): string {
    return a.localPath || localUrls[a.code] || ''
  }
</script>

{#if !sid}
  <div class="flex h-full items-center justify-center text-meta text-muted-foreground">{t('noSessions')}</div>
{:else if ctrl}
  <div
    class="relative flex h-full w-full min-h-0 flex-col" role="application"
    ondragover={e => {
      e.preventDefault()
      dragging = true
    }}
    ondragleave={e => {
      // Only clear when the pointer actually leaves the container, not when it
      // crosses an inner child (which also fires dragleave).
      if (e.relatedTarget && (e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) return
      dragging = false
    }}
    ondrop={e => void onDrop(e)}
  >
    <!-- top bar -->
    <header class="relative flex h-12 shrink-0 items-center border-b border-border/50 px-1">
      <div class="flex min-w-0 items-center gap-2">
        <button type="button" class="rounded p-1.5 hover:bg-muted" aria-label="back" onclick={() => store.popPage()}><ChevronLeft class="size-[18px]" /></button>
        <span class={cn('size-2 rounded-full', ctrl.sending ? 'bg-warning' : 'bg-success')}></span>
        {#if ctxLabel}
          <span class="text-micro text-muted-foreground tabular-nums">{ctxLabel}</span>
        {/if}
      </div>
      <div class="pointer-events-none absolute inset-x-0 flex justify-center">
        <button
          type="button"
          class="pointer-events-auto max-w-[45%] truncate rounded-full border border-primary/40 bg-primary/14 px-3 py-1 text-meta text-primary hover:bg-primary/20"
          onclick={() => (infoOpen = true)}
          title={t('settingsTitle')}
        >
          {session?.model || session?.id}
        </button>
      </div>
      <div class="ml-auto">
        <DropdownMenu label={t('settingsTitle')}>
          <DropdownMenuItem onSelect={() => void menuAction('compact')}>{t('compactHistory')}</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => void menuAction('mailbox')}>{t('mailbox')}</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => void menuAction('fork')}>{t('fork')}</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem class="text-destructive" onSelect={() => void menuAction('delete')}>{t('deleteSession')}</DropdownMenuItem>
        </DropdownMenu>
      </div>
    </header>

    <!-- messages -->
    <div bind:this={listEl} class="min-h-0 flex-1 overflow-y-auto px-3 py-3" onscroll={onScroll}>
      {#if ctrl.loading && ctrl.messages.length === 0}
        <div class="flex h-full items-center justify-center">
          <span class="size-6 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-muted-foreground"></span>
        </div>
      {:else}
        {#each ctrl.sorted as msg (msg.id)}
          <MessageBubble
            {msg}
            api={store.api}
            onUndo={id => void ctrl!.revert(id)}
            onResend={txt => void ctrl!.resendFrom(ctrl!.messages.find(m => m.id === msg.id)!, txt)}
            onEdit={txt => void ctrl!.resendFrom(ctrl!.messages.find(m => m.id === msg.id)!, txt)}
          />
        {/each}
      {/if}
    </div>

    <!-- composer -->
    <div class="shrink-0 border-t border-border/50 p-2">
      {#if attachments.length}
        <div class="mb-2 flex flex-wrap gap-1">
          {#each attachments as a (a.code + a.name)}
            <div class="relative">
              <MediaAttachment
                api={store.api}
                code={a.code}
                name={a.name ?? ''}
                mime={a.mime}
                size={a.size ?? null}
                dimension={tileDim}
                localUrl={a.uploadState !== 'done' ? isLocalPreview(a) : ''}
              />
              <button
                type="button"
                class={cn(
                  'absolute top-0.5 right-0.5 flex size-4 items-center justify-center rounded-full text-[10px] text-white',
                  a.uploadState === 'uploading' ? 'bg-muted-foreground/70'
                  : a.uploadState === 'error' ? 'bg-destructive'
                  : 'bg-muted-foreground/70 hover:bg-destructive',
                )}
                onclick={() => (a.uploadState === 'error' ? void retryUpload(a) : removeAttachment(a))}
                title={a.uploadState === 'error' ? t('retry') : t('delete')}
              >
                {#if a.uploadState === 'uploading'}<LoaderCircle class="size-2.5 animate-spin" />{:else if a.uploadState === 'error'}<RotateCcw class="size-2.5" />{:else}<X class="size-2.5" />{/if}
              </button>
            </div>
          {/each}
        </div>
      {/if}

      <div class="flex items-end gap-1.5">
        <Popover side="top" align="start">
          {#snippet trigger()}
            <button
              type="button"
              class="rounded-full p-2 text-muted-foreground outline-none hover:bg-muted data-[state=open]:bg-muted"
              title={t('attach')}
              aria-label={t('attach')}
            >
              <Paperclip class="size-[18px]" />
            </button>
          {/snippet}
          <div class="w-44 py-0.5">
            <button type="button" class="flex w-full items-center gap-2 rounded-sm px-3 py-2 text-left text-meta hover:bg-muted" onclick={() => pickFiles('image/*')}>
              <Image class="size-[18px]" /> {t('chooseImage')}
            </button>
            <button type="button" class="flex w-full items-center gap-2 rounded-sm px-3 py-2 text-left text-meta hover:bg-muted" onclick={() => pickFiles('')}>
              <FileText class="size-[18px]" /> {t('chooseFile')}
            </button>
          </div>
        </Popover>

        <textarea
          bind:this={taEl}
          bind:value={text}
          rows="1"
          class="max-h-40 min-h-9 flex-1 resize-none rounded-lg border border-input bg-transparent px-3 py-2 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring"
          placeholder={t('typeMessage')}
          onkeydown={onKeydown}
          onpaste={onPaste}
          oninput={e => {
            schedulePersist()
            const el = e.currentTarget
            el.style.height = 'auto'
            el.style.height = `${Math.min(el.scrollHeight, 160)}px`
          }}
        ></textarea>

        {#if recording}
          <button type="button" class="animate-pulse rounded-full bg-destructive p-2 text-white" title={t('stop')} aria-label={t('stop')} onclick={() => void toggleRecording()}><Square class="size-[18px]" /></button>
        {:else}
          <button type="button" class="rounded-full p-2 text-muted-foreground hover:bg-muted" title={t('recordVoice')} aria-label={t('recordVoice')} onclick={() => void toggleRecording()}><Mic class="size-[18px]" /></button>
        {/if}

        {#if ctrl.sending}
          <button type="button" class="rounded-full bg-primary p-2 text-primary-foreground" title={t('stop')} aria-label={t('stop')} onclick={() => ctrl!.stop()}><Square class="size-[18px]" /></button>
        {:else}
          <button
            type="button"
            class="rounded-full bg-primary p-2 text-primary-foreground disabled:opacity-40"
            disabled={!canSend()}
            title={t('send')}
            aria-label={t('send')}
            onclick={() => void send()}
          ><Send class="size-[18px]" /></button>
        {/if}
      </div>
    </div>

    <!-- drop overlay -->
    {#if dragging}
      <div class="pointer-events-none absolute inset-0 z-40 flex items-center justify-center bg-primary/8">
        <div class="flex items-center gap-2 rounded-lg border-2 border-primary bg-card px-4 py-3 text-body">
          <Download class="size-6" />
          {t('dropToAttach')}
        </div>
      </div>
    {/if}
  </div>

  <!-- session info dialog -->
  <Dialog bind:open={infoOpen} title={t('sessionInfo')}>
    {#snippet children()}
      <div class="space-y-2">
        <div class="flex items-center gap-2">
          <MessageSquare class="size-4 text-primary" />
          <span class="truncate text-meta font-bold">{session?.id}</span>
        </div>
        {#each [
          [t('modelLabel'), session?.model || t('none')],
          [t('variantLabel'), session?.variant || t('variantNone')],
          [t('presetLabel'), session?.preset || t('none')],
          [t('agentLocale'), session?.locale || t('agentLocaleFollow')],
          [t('sessionGroupLabel'), session?.group || t('none')],
        ] as [label, value] (label)}
          <div class="flex items-start gap-3 border-t border-border/40 pt-2 first:border-t-0 first:pt-0">
            <span class="w-24 shrink-0 text-micro text-muted-foreground">{label}</span>
            <span class="min-w-0 flex-1 text-meta font-semibold">{value}</span>
          </div>
        {/each}
      </div>
    {/snippet}
    {#snippet footer()}
      <button type="button" class="rounded-md px-3 py-1.5 text-sm hover:bg-muted" onclick={() => (infoOpen = false)}>{t('close')}</button>
      <button
        type="button"
        class="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground hover:bg-primary/80"
        onclick={() => {
          infoOpen = false
          void showSettings()
        }}
      >{t('edit')}</button>
    {/snippet}
  </Dialog>

  <!-- settings dialog -->
  <Dialog bind:open={settingsOpen} title={t('settingsTitle')}>
    {#snippet children()}
      <div class="space-y-3">
        <label class="block">
          <span class="mb-1 block text-meta text-muted-foreground">{t('modelLabel')}</span>
          <Select
            bind:value={selectedRef}
            placeholder={loadingModels ? t('loading') : t('none')}
            items={modelOptions}
          />
        </label>
        {#if variantsForModel.length}
          <label class="block">
            <span class="mb-1 block text-meta text-muted-foreground">{t('variantLabel')}</span>
            <Select
              bind:value={variant}
              items={[{ value: '', label: t('variantNone') }, ...variantsForModel.map(v => ({ value: v.id, label: v.name || v.id }))]}
            />
          </label>
        {/if}
        <label class="block">
          <span class="mb-1 block text-meta text-muted-foreground">{t('presetLabel')}</span>
          <Select bind:value={preset} items={presetOptions.map(id => ({ value: id, label: id }))} />
        </label>
        <label class="block">
          <span class="mb-1 block text-meta text-muted-foreground">{t('agentLocale')}</span>
          <Select
            bind:value={locale}
            items={[
              { value: '', label: t('agentLocaleFollow') },
              { value: 'zh', label: '中文' },
              { value: 'en', label: 'English' },
            ]}
          />
        </label>
        <p class="text-micro text-muted-foreground">{t('turnsByPreset')}</p>
        <p class="text-micro text-muted-foreground">{t('sysPromptByPreset')}</p>
      </div>
    {/snippet}
    {#snippet footer()}
      <button type="button" class="rounded-md px-3 py-1.5 text-sm hover:bg-muted" onclick={() => (settingsOpen = false)}>{t('cancel')}</button>
      <button type="button" class="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground hover:bg-primary/80" onclick={() => void applySettings()}>{t('save')}</button>
    {/snippet}
  </Dialog>
{/if}
