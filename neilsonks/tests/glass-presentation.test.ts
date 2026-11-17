import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import projectPresets from '../src/glass/default-presets.json'
import { rainDefaults } from '../src/glass/rain/settings'
import { presentationSettings, savePresentationDefaults, settingsSnapshot } from '../src/glass/presentation'
import { bindAmbientPlayback } from '../src/glass/ambient-playback'

const store = new Map<string, string>()
beforeEach(() => {
  store.clear(); vi.stubEnv('DEV', true)
  vi.stubGlobal('localStorage', { getItem: vi.fn((key: string) => store.get(key) ?? null), setItem: (key: string, value: string) => store.set(key, value) })
})
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })

describe('locked Original presentation', () => {
  it('opens the exact project preset without letting earlier study drafts or personal reset defaults override it', () => {
    store.set('neilsonks:glass:earlier:v1', JSON.stringify({ contrast: .7, arrangement: 'canopy' }))
    store.set('neilsonks:glass:defaults:earlier:original:v1', JSON.stringify({ contrast: .8, textureScale: 3 }))
    expect(presentationSettings()).toEqual({ ...rainDefaults, ...projectPresets['earlier:original'] })
    expect(localStorage.getItem).not.toHaveBeenCalled()
    const snapshot = presentationSettings(); snapshot.contrast = 1
    expect(presentationSettings().contrast).toBe(projectPresets['earlier:original'].contrast)
  })
  it('saves to the recoverable project preset and exports an exact round-trip snapshot', async () => {
    const request = vi.fn().mockResolvedValue({ ok: true }); vi.stubGlobal('fetch', request)
    const settings = { ...presentationSettings(), relief: .471, depthScale: 1.03, contrast: 1.67 }
    await savePresentationDefaults(settings)
    expect(JSON.parse(request.mock.calls[0][1].body)).toEqual({ key: 'earlier:original', settings })
    expect(JSON.parse(settingsSnapshot(settings))).toEqual({ schemaVersion: 1, preset: 'earlier:original', settings })
    request.mockResolvedValue({ ok: false })
    await expect(savePresentationDefaults(settings)).rejects.toThrow()
  })
  it('persists explicit public debug saves in that browser without loading legacy drafts', async () => {
    vi.stubEnv('DEV', false)
    const settings = { ...presentationSettings(), textureScale: 1.3, saturation: .65 }
    await savePresentationDefaults(settings)
    expect(presentationSettings()).toEqual(settings)
    store.set('neilsonks:glass:presentation:original:v1', JSON.stringify({ contrast: 'broken', arrangement: 'canopy' }))
    expect(presentationSettings()).toEqual({ ...rainDefaults, ...projectPresets['earlier:original'] })
  })
})

const settle = async () => { for (let i = 0; i < 4; i++) await Promise.resolve() }
function playback() {
  const surface = new EventTarget(), page = Object.assign(new EventTarget(), { hidden: false })
  const audio = { setEnabled: vi.fn().mockResolvedValue(undefined), setVisible: vi.fn().mockResolvedValue(undefined), dispose: vi.fn() }
  const dispose = bindAmbientPlayback(audio, surface, page)
  return { surface, page, audio, dispose }
}
describe('standalone ambient activation', () => {
  it('starts directly on interaction, detaches after success, and pauses/resumes with page visibility', async () => {
    const { surface, page, audio, dispose } = playback()
    expect(audio.setEnabled).not.toHaveBeenCalled()
    surface.dispatchEvent(new Event('pointerdown'))
    expect(audio.setEnabled).toHaveBeenCalledWith(true)
    await settle()
    surface.dispatchEvent(new Event('pointerup')); surface.dispatchEvent(new Event('keydown'))
    expect(audio.setEnabled).toHaveBeenCalledTimes(1)
    page.hidden = true; page.dispatchEvent(new Event('visibilitychange'))
    expect(audio.setVisible).toHaveBeenLastCalledWith(false)
    page.hidden = false; page.dispatchEvent(new Event('visibilitychange'))
    expect(audio.setVisible).toHaveBeenLastCalledWith(true)
    dispose()
    page.dispatchEvent(new Event('visibilitychange')); surface.dispatchEvent(new Event('pointerdown'))
    expect(audio.setEnabled).toHaveBeenCalledTimes(1); expect(audio.setVisible).toHaveBeenCalledTimes(2); expect(audio.dispose).toHaveBeenCalledTimes(1)
  })
  it('retries a blocked start on the next tap and allows a gesture to recover failed visibility resume', async () => {
    const { surface, page, audio, dispose } = playback()
    audio.setEnabled.mockRejectedValueOnce(new Error('blocked'))
    surface.dispatchEvent(new Event('pointerdown')); await settle()
    surface.dispatchEvent(new Event('touchend')); await settle()
    expect(audio.setEnabled).toHaveBeenCalledTimes(2)
    audio.setVisible.mockRejectedValueOnce(new Error('resume blocked'))
    page.dispatchEvent(new Event('visibilitychange')); await settle()
    surface.dispatchEvent(new Event('keydown')); await settle()
    expect(audio.setEnabled).toHaveBeenCalledTimes(3)
    dispose()
  })
  it('does not let a stale pending activation disable retries after a newer attempt is rejected', async () => {
    const { surface, audio, dispose } = playback()
    let finish!: () => void
    audio.setEnabled.mockReturnValueOnce(new Promise<void>(resolve => { finish = resolve })).mockRejectedValueOnce(new Error('blocked'))
    surface.dispatchEvent(new Event('pointerdown')); surface.dispatchEvent(new Event('pointerup')); await settle()
    finish(); await settle()
    surface.dispatchEvent(new Event('touchend')); await settle()
    expect(audio.setEnabled).toHaveBeenCalledTimes(3)
    dispose()
  })
})
