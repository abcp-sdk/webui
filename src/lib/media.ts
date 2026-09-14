// Media helpers — the web port of flutter media_cache + download_service:
// a per-code blob-URL cache for inline rendering + a save-as download.
import type { AgentApi } from './api'

const urlCache = new Map<string, string>()
const inflight = new Map<string, Promise<string>>()

/** Object URL for a file code (cached); '' when the fetch fails. */
export function mediaUrl(api: AgentApi, code: string): Promise<string> {
  const hit = urlCache.get(code)
  if (hit) return Promise.resolve(hit)
  const pending = inflight.get(code)
  if (pending) return pending
  const p = api
    .fetchFileBlob(code)
    .then(blob => {
      const url = URL.createObjectURL(blob)
      urlCache.set(code, url)
      return url
    })
    .catch(() => '')
  inflight.set(code, p)
  return p
}

export function dropMediaUrl(code: string) {
  const url = urlCache.get(code)
  if (url) {
    URL.revokeObjectURL(url)
    urlCache.delete(code)
  }
}

/** Save-as download of a file code (download_service_web.dart). */
export async function downloadFile(api: AgentApi, code: string, name: string) {
  const blob = await api.fetchFileBlob(code)
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name || code
  document.body.append(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

export function mimeToKind(mime?: string | null): 'image' | 'audio' | 'video' | 'file' {
  if (!mime) return 'file'
  if (mime.startsWith('image/')) return 'image'
  if (mime.startsWith('audio/')) return 'audio'
  if (mime.startsWith('video/')) return 'video'
  return 'file'
}

export function guessMime(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  const table: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    svg: 'image/svg+xml',
    bmp: 'image/bmp',
    mp3: 'audio/mpeg',
    wav: 'audio/wav',
    ogg: 'audio/ogg',
    webm: 'audio/webm',
    m4a: 'audio/mp4',
    mp4: 'video/mp4',
    mov: 'video/quicktime',
    webmv: 'video/webm',
    pdf: 'application/pdf',
    txt: 'text/plain',
    md: 'text/markdown',
    csv: 'text/csv',
    json: 'application/json',
    zip: 'application/zip',
  }
  return table[ext] || 'application/octet-stream'
}

export function formatBytes(size?: number | null): string {
  if (!size || size <= 0) return ''
  const units = ['B', 'KB', 'MB', 'GB']
  let i = 0
  let v = size
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1)} ${units[i]}`
}
