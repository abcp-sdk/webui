// VoiceRecorder — the web port of flutter voice_web.dart: MediaRecorder →
// a WebM/Opus blob wrapped as an UploadedFileSource for ingestFile.
export class VoiceRecorder {
  private media: MediaRecorder | null = null
  private chunks: Blob[] = []
  private stream: MediaStream | null = null
  private cancelled = false

  async hasPermission(): Promise<boolean> {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true })
      s.getTracks().forEach(t => t.stop())
      return true
    } catch {
      return false
    }
  }

  async start(): Promise<boolean> {
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/webm')
          ? 'audio/webm'
          : ''
      this.media = mime ? new MediaRecorder(this.stream, { mimeType: mime }) : new MediaRecorder(this.stream)
      this.chunks = []
      this.cancelled = false
      this.media.ondataavailable = e => {
        if (e.data.size > 0) this.chunks.push(e.data)
      }
      this.media.start(250)
      return true
    } catch {
      return false
    }
  }

  private teardown() {
    this.media = null
    this.stream?.getTracks().forEach(t => t.stop())
    this.stream = null
  }

  /** Stop and return the recording as an upload source (null when empty). */
  async stop(): Promise<{ name: string; mimeType: string; bytes: Uint8Array } | null> {
    const m = this.media
    if (!m) return null
    const done = new Promise<void>(res => {
      m.onstop = () => res()
    })
    if (m.state !== 'inactive') m.stop()
    await done
    const blob = new Blob(this.chunks, { type: m.mimeType || 'audio/webm' })
    this.teardown()
    if (this.cancelled || blob.size === 0) return null
    const ext = blob.type.includes('webm') ? 'webm' : 'm4a'
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    return {
      name: `voice-${stamp}.${ext}`,
      mimeType: blob.type || 'audio/webm',
      bytes: new Uint8Array(await blob.arrayBuffer()),
    }
  }

  async cancel() {
    this.cancelled = true
    const m = this.media
    if (m && m.state !== 'inactive') {
      await new Promise<void>(res => {
        m.onstop = () => res()
        m.stop()
      })
    }
    this.teardown()
  }

  dispose() {
    this.teardown()
  }
}
