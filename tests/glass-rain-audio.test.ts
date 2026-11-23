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
  it('reverses one short fade at each press and release without scheduling future volume changes', async () => {
    audio.set(0, .5)
    gestures.dispatchEvent(new Event('pointerdown'))
    audio.setBrushPressed(true)
    await vi.waitFor(() => expect(contexts[0].source.start).toHaveBeenCalledOnce())
    const context = contexts[0], gain = context.gains[0].setTargetAtTime
    context.currentTime = .007
    audio.setBrushPressed(false)
    context.currentTime = .012
    audio.setBrushPressed(true)
    audio.setBrushPressed(true)
    context.currentTime = .03
    audio.setBrushPressed(false)
    expect(gain.mock.calls).toEqual([[1, 0, .03], [0, .007, .06], [1, .012, .03], [0, .03, .06]])
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(context.source.start).toHaveBeenCalledOnce()
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
    audio.setBrushPressed(true)
    await vi.waitFor(() => expect(contexts[0].source.start).toHaveBeenCalledOnce())
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(contexts[0].decodeAudioData).not.toHaveBeenCalled()
  })
  it('keeps a new press audible if an earlier release is still suspending the output', async () => {
    audio.set(0, .5)
    gestures.dispatchEvent(new Event('pointerdown'))
    audio.setBrushPressed(true)
    await vi.waitFor(() => expect(contexts[0].source.start).toHaveBeenCalledOnce())
    const context = contexts[0]
    let finishSuspend!: () => void
    context.suspend.mockImplementationOnce(() => new Promise<void>(resolve => {
      finishSuspend = () => { context.state = 'suspended'; resolve() }
    }))
    vi.useFakeTimers()
    try {
      audio.setBrushPressed(false)
      vi.advanceTimersByTime(200)
      expect(context.suspend).not.toHaveBeenCalled()
      vi.advanceTimersByTime(250)
      expect(context.suspend).toHaveBeenCalledOnce()
      audio.setBrushPressed(true)
      finishSuspend()
      await Promise.resolve()
      expect(context.state).toBe('running')
      expect(context.gains[0].setTargetAtTime.mock.lastCall?.[0]).toBe(1)
    } finally { vi.useRealTimers() }
  })
  it('lets the tin loop swell and recede independently of brush presses', async () => {
    audio.set(1, .5)
    gestures.dispatchEvent(new Event('pointerdown'))
    await vi.waitFor(() => expect(contexts[0].source.start).toHaveBeenCalledOnce())
    const context = contexts[0], tin = context.gains[0]
    expect(tin.setTargetAtTime.mock.lastCall).toEqual([.5, 0, .9])
    audio.setBrushPressed(true)
    expect(tin.setTargetAtTime).toHaveBeenCalledTimes(1)
    audio.setBrushPressed(false)
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
