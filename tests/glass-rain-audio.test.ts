import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RainAudio } from '../src/glass/rain/audio'

let contexts: Context[], page: EventTarget & { hidden: boolean }, gestures: EventTarget, audio: RainAudio
const parameter = () => ({ value: 0, setTargetAtTime: vi.fn(), cancelScheduledValues: vi.fn(), setValueAtTime: vi.fn() })
class Context {
  sampleRate = 8000
  currentTime = 0
  state = 'suspended'
  destination = {}
  gains: ReturnType<typeof parameter>[] = []
  source = { buffer: null, loop: false, connect: vi.fn(), start: vi.fn(), stop: vi.fn(), disconnect: vi.fn() }
  resume = vi.fn(async () => { this.state = 'running' })
  suspend = vi.fn(async () => { this.state = 'suspended' })
  close = vi.fn(async () => { this.state = 'closed' })
  constructor() { contexts.push(this) }
  decodeAudioData = vi.fn(async () => ({ duration: 60 }))
  createBufferSource() { return this.source }
  createGain() {
    const gain = parameter()
    this.gains.push(gain)
    return { gain, connect: vi.fn(), disconnect: vi.fn() }
  }
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
  it('attacks on the first impact packet, follows its density, and takes the loudest contact', async () => {
    audio.set(1,.5,'glass')
    gestures.dispatchEvent(new Event('pointerdown'))
    expect(contexts).toHaveLength(0)
    audio.brushHits(0, 8)
    await vi.waitFor(() => expect(contexts[0].source.start).toHaveBeenCalledOnce())
    const gain = contexts[0].gains[0]
    const attack = () => gain.setTargetAtTime.mock.calls.at(-2)!
    const initial = attack()[0]
    expect(initial).toBeGreaterThan(.25)
    expect(attack()[2]).toBeLessThan(.01)
    audio.brushHits(1, 8)
    expect(attack()[0]).toBe(initial)
    audio.brushHits(0, 16)
    expect(attack()[0]).toBeGreaterThan(initial)
    contexts[0].currentTime = 1
    audio.brushHits(0, 1)
    expect(attack()[0]).toBeLessThan(initial / 2)
    expect(gain.setTargetAtTime.mock.lastCall).toEqual([0, 1.035, .04])
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(contexts[0].source.start).toHaveBeenCalledOnce()
    page.hidden = true; page.dispatchEvent(new Event('visibilitychange'))
    expect(contexts[0].suspend).toHaveBeenCalledOnce()
  })
  it('prepares the glass sample before interaction without starting live output', async () => {
    audio.dispose()
    const decode = vi.fn(async () => ({ duration: 93 }))
    vi.stubGlobal('OfflineAudioContext', class { decodeAudioData = decode })
    audio = new RainAudio()
    await vi.waitFor(() => expect(decode).toHaveBeenCalledOnce())
    expect(contexts).toHaveLength(0)
    audio.set(0, .5)
    gestures.dispatchEvent(new Event('pointerdown'))
    audio.brushHits(0, 10)
    await vi.waitFor(() => expect(contexts[0].source.start).toHaveBeenCalledOnce())
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(contexts[0].decodeAudioData).not.toHaveBeenCalled()
  })
  it('lets the tin loop swell and recede independently of glass impacts', async () => {
    audio.set(1, .5)
    gestures.dispatchEvent(new Event('pointerdown'))
    await vi.waitFor(() => expect(contexts[0].source.start).toHaveBeenCalledOnce())
    const context = contexts[0], tin = context.gains[0]
    expect(tin.setTargetAtTime.mock.lastCall).toEqual([.5, 0, .9])
    audio.brushHits(0, 10)
    expect(tin.setTargetAtTime).toHaveBeenCalledTimes(1)
    vi.useFakeTimers()
    try {
      audio.set(0, .5)
      expect(tin.setTargetAtTime.mock.lastCall).toEqual([0, 0, 1.5])
      vi.advanceTimersByTime(1000)
      expect(context.suspend).not.toHaveBeenCalled()
      audio.set(1, .5)
      vi.advanceTimersByTime(11000)
      expect(context.suspend).not.toHaveBeenCalled()
      audio.set(0, .5)
      vi.advanceTimersByTime(11000)
      expect(context.suspend).toHaveBeenCalledOnce()
    } finally { vi.useRealTimers() }
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
