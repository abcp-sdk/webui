<script lang="ts">
  // PdfView — pdfjs-dist canvas renderer, lazily imported. The worker is
  // loaded from the bundled build via a Vite `?url` import so it stays
  // same-origin (no CDN), which also keeps the ConnectRPC-only backend
  // contract self-contained.
  import { onMount } from 'svelte'
  import { t } from '$lib/i18n.svelte'
  import { AppIcons } from '$lib/icons'

  let { src }: { src: string } = $props()

  let host: HTMLDivElement | null = $state(null)
  let loading = $state(true)
  let error = $state(false)
  let pages = $state(0)
  let progress = $state(0)

  onMount(() => {
    let cancelled = false
    void (async () => {
      try {
        const pdfjs = await import('pdfjs-dist')
        const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default
        pdfjs.GlobalWorkerOptions.workerSrc = workerUrl
        const res = await fetch(src)
        const data = new Uint8Array(await res.arrayBuffer())
        const doc = await pdfjs.getDocument({ data }).promise
        if (cancelled) return
        pages = doc.numPages
        const scale = Math.min(2, (window.devicePixelRatio || 1) * 1.4)
        for (let i = 1; i <= doc.numPages; i++) {
          if (cancelled || host === null) return
          const page = await doc.getPage(i)
          const viewport = page.getViewport({ scale })
          const canvas = document.createElement('canvas')
          canvas.width = Math.floor(viewport.width)
          canvas.height = Math.floor(viewport.height)
          canvas.className = 'mx-auto mb-3 max-w-full rounded bg-white shadow'
          const ctx = canvas.getContext('2d')
          if (ctx) {
            await page.render({ canvasContext: ctx, viewport, canvas }).promise
          }
          host.append(canvas)
          progress = i
        }
        loading = false
      } catch {
        error = true
        loading = false
      }
    })()
    return () => {
      cancelled = true
    }
  })
</script>

<div class="max-h-[82vh] w-[min(94vw,900px)] overflow-auto rounded-md bg-black/30 p-3">
  {#if loading}
    <div class="flex flex-col items-center gap-2 p-6 text-meta text-white/70">
      <span class="size-7 animate-spin rounded-full border-2 border-white/20 border-t-white/80"></span>
      <span>{t('loading')}{pages > 0 ? ` ${progress}/${pages}` : ''}</span>
    </div>
  {/if}
  {#if error}
    <div class="flex items-center justify-center gap-2 p-6 text-meta text-white/70">
      <AppIcons.error class="size-4" /> {t('fileUnsupported')}
    </div>
  {/if}
  <div bind:this={host}></div>
</div>
