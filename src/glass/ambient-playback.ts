type Ambience = { setEnabled(value: boolean): Promise<void>; setVisible(value: boolean): Promise<void>; dispose(): void }

// AudioContext.resume/play must be called inside the interaction, before any
// awaits. Keep listening after rejection so a later gesture can try again.
export function bindAmbientPlayback(ambience: Ambience, surface: EventTarget, page: Pick<Document, 'hidden' | 'addEventListener' | 'removeEventListener'> = document) {
  let disposed = false, attempt = 0
  const events = ['pointerdown', 'pointerup', 'touchend', 'keydown'] as const
  const listen = () => events.forEach(event => surface.addEventListener(event, start, { passive: true }))
  const unlisten = () => events.forEach(event => surface.removeEventListener(event, start))
  const start = () => {
    if (disposed) return
    const revision = ++attempt
    void ambience.setEnabled(true).then(() => { if (!disposed && revision === attempt) unlisten() }).catch(() => { /* Retry on the next interaction. */ })
  }
  const visibility = () => {
    void ambience.setVisible(!page.hidden).catch(() => { if (!disposed) { attempt++; listen() } })
  }
  listen(); page.addEventListener('visibilitychange', visibility)
  return () => {
    disposed = true; unlisten(); page.removeEventListener('visibilitychange', visibility); ambience.dispose()
  }
}
