// VoiceRecorder — the web port of flutter voice_web.dart: MediaRecorder →
// a WebM/Opus blob wrapped as an UploadedFileSource for ingestFile.

/** Minimum clip size; a shorter blob is an accidental tap (see stop()). */
const MIN_VOICE_BYTES = 4096

export class VoiceRecorder {
  private media: MediaRecorder | null = null
  private chunks: Blob[] = []
  private stream: MediaStream | null = null
  private cancelled = false
  /**
   * The in-flight `start()`. `getUserMedia` is async, so a release that lands
   * before it resolves must WAIT for the stream and then stop it — otherwise
   * the mic stays open (a leaked recording indicator) and stop() sees no
   * MediaRecorder yet.
   */
  private starting: Promise<void> | null = null
  /** Set when stop()/cancel() ran while start() was still pending. */
  private stopRequested = false

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
    if (this.starting !== null) return true
    this.stopRequested = false
    this.cancelled = false
    this.chunks = []
    const p = (async () => {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      // A release may have arrived while getUserMedia was pending: do not
      // attach a recorder, just release the freshly-granted stream.
      if (this.stopRequested) {
        stream.getTracks().forEach(t => t.stop())
        return
      }
      this.stream = stream
      const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/webm')
          ? 'audio/webm'
          : ''
      const media = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream)
      media.ondataavailable = e => {
        if (e.data.size > 0) this.chunks.push(e.data)
      }
      this.media = media
      media.start(250)
    })()
    this.starting = p
    try {
      await p
      return this.media !== null
    } catch {
      return false
    } finally {
      this.starting = null
    }
  }

  /** Stop every live track immediately (releases the mic / recording dot). */
  private teardown() {
    this.media = null
    this.stream?.getTracks().forEach(t => t.stop())
    this.stream = null
  }

  /** Stop and return the recording as an upload source (null when empty). */
  async stop(): Promise<{ name: string; mimeType: string; bytes: Uint8Array } | null> {
    // Flag first so a still-pending start() tears its stream down on arrival,
    // then wait for it so we observe the recorder it (maybe) created.
    this.stopRequested = true
    const pending = this.starting
    if (pending !== null) {
      try { await pending } catch { /* start failed */ }
    }
    const m = this.media
    if (m === null) {
      // No recorder (tap before getUserMedia resolved, or start failed): make
      // sure nothing is left holding the mic.
      this.teardown()
      return null
    }
    const done = new Promise<void>(res => {
      m.onstop = () => res()
    })
    if (m.state !== 'inactive') m.stop()
    await done
    const blob = new Blob(this.chunks, { type: m.mimeType || 'audio/webm' })
    this.teardown()
    if (this.cancelled || blob.size === 0) return null
    // Reject an accidental tap: WebM/Opus has no fixed bytes-per-second, but a
    // sub-half-second clip is only a few KB (header + a couple of frames).
    // The Flutter recorder uses a ~0.4s byte threshold; mirror it.
    if (blob.size < MIN_VOICE_BYTES) return null
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
    this.stopRequested = true
    const pending = this.starting
    if (pending !== null) {
      try { await pending } catch { /* start failed */ }
    }
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
    this.stopRequested = true
    this.teardown()
  }
}
