import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RainAudio } from '../src/glass/rain/audio'

let contexts: Context[], page: EventTarget & { hidden: boolean }, gestures: EventTarget, audio: RainAudio
const parameter = () => ({ value: 0, setTargetAtTime: vi.fn() })
class Context {
  sampleRate = 8000
  currentTime = 0
  state = 'suspended'
  destination = {}
  source = { buffer: null, loop: false, connect: vi.fn(), start: vi.fn(), stop: vi.fn(), disconnect: vi.fn() }
  resume = vi.fn(async () => { this.state = 'running' })
  suspend = vi.fn(async () => { this.state = 'suspended' })
  close = vi.fn(async () => { this.state = 'closed' })
  constructor() { contexts.push(this) }
  decodeAudioData = vi.fn(async () => ({ duration: 60 }))
  createBufferSource() { return this.source }
  createGain() { return { gain: parameter(), connect: vi.fn(), disconnect: vi.fn() } }
}
beforeEach(() => {
  contexts = []; page = Object.assign(new EventTarget(), { hidden: false }); gestures = new EventTarget()
  vi.stubGlobal('document', page); vi.stubGlobal('window', gestures); vi.stubGlobal('AudioContext', Context)
  vi.stubGlobal('navigator', { userActivation: { hasBeenActive: false } })
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(16) })))
  audio = new RainAudio()
})
afterEach(() => { audio.dispose(); vi.unstubAllGlobals() })

describe('rain audio lifecycle', () => {
  it('uses one glass loop as touch flow changes and keeps it silent until touched', async () => {
    audio.set(1,.5,'glass')
    gestures.dispatchEvent(new Event('pointerdown'))
    expect(contexts).toHaveLength(0)
    audio.touch(.25,.5)
    await vi.waitFor(() => expect(contexts[0].source.start).toHaveBeenCalledOnce())
    audio.touch(.8,.5)
    audio.touch(.8,.5)
    audio.touch(.4,.5)
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(contexts[0].source.start).toHaveBeenCalledOnce()
    audio.touch(0,.5)
    page.hidden = true; page.dispatchEvent(new Event('visibilitychange'))
    expect(contexts[0].suspend).toHaveBeenCalledOnce()
  })
  it('allocates no audio while dry and suspends a shower when hidden', async () => {
    audio.set(0, .5); gestures.dispatchEvent(new Event('pointerdown'))
    expect(contexts).toHaveLength(0)
    audio.set(.8, .5)
    await vi.waitFor(() => expect(contexts[0].source.start).toHaveBeenCalledOnce())
    expect(contexts).toHaveLength(1)
    expect(contexts[0].source.loop).toBe(true)
    expect(fetch).toHaveBeenCalledTimes(1)
    page.hidden = true; page.dispatchEvent(new Event('visibilitychange'))
    expect(contexts[0].suspend).toHaveBeenCalledOnce()
    page.hidden = false; page.dispatchEvent(new Event('visibilitychange'))
    expect(contexts[0].resume).toHaveBeenCalledTimes(2)
    audio.dispose(); gestures.dispatchEvent(new Event('pointerdown'))
    expect(contexts[0].close).toHaveBeenCalled(); expect(contexts[0].source.stop).toHaveBeenCalled()
    expect(contexts[0].resume).toHaveBeenCalledTimes(2)
  })
  it('retries browser-blocked playback on a later gesture and stops activating when muted', async () => {
    audio.set(.8, .5)
    expect(contexts).toHaveLength(0)
    gestures.dispatchEvent(new Event('pointerdown'))
    await vi.waitFor(() => expect(contexts[0].source.start).toHaveBeenCalledOnce())
    contexts[0].state = 'suspended'; contexts[0].resume.mockRejectedValueOnce(new Error('gesture required'))
    gestures.dispatchEvent(new Event('pointerdown')); await Promise.resolve(); await Promise.resolve()
    gestures.dispatchEvent(new Event('keydown')); await Promise.resolve()
    expect(contexts[0].resume).toHaveBeenCalledTimes(3)
    audio.set(.8, 0); contexts[0].state = 'suspended'
    gestures.dispatchEvent(new Event('pointerdown'))
    expect(contexts[0].resume).toHaveBeenCalledTimes(3)
  })
})
