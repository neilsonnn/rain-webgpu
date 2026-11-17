import { afterEach, describe, expect, it, vi } from 'vitest'
import { requestWebGPUAdapter, webGPURequiredMessage } from '../src/glass/rain/webgpu'

afterEach(() => vi.unstubAllGlobals())

describe('required WebGPU adapter', () => {
  it('reports the requested message when WebGPU is absent', async () => {
    vi.stubGlobal('navigator', {})
    await expect(requestWebGPUAdapter()).rejects.toThrow(webGPURequiredMessage)
  })

  it('reports the requested message when the browser supplies no adapter', async () => {
    vi.stubGlobal('navigator', { gpu: { requestAdapter: vi.fn().mockResolvedValue(null) } })
    await expect(requestWebGPUAdapter()).rejects.toThrow(webGPURequiredMessage)
  })

  it('reports the requested message when adapter selection fails', async () => {
    vi.stubGlobal('navigator', { gpu: { requestAdapter: vi.fn().mockRejectedValue(new Error('GPU unavailable')) } })
    await expect(requestWebGPUAdapter()).rejects.toThrow(webGPURequiredMessage)
  })

  it('passes the usable adapter through to the scene', async () => {
    const adapter = { features: new Set() }
    const requestAdapter = vi.fn().mockResolvedValue(adapter)
    vi.stubGlobal('navigator', { gpu: { requestAdapter } })
    await expect(requestWebGPUAdapter()).resolves.toBe(adapter)
    expect(requestAdapter).toHaveBeenCalledOnce()
  })
})
