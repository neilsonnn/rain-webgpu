export const webGPURequiredMessage = 'Please open on a WebGPU compatible device.'

export class WebGPUUnavailableError extends Error {
  constructor() { super(webGPURequiredMessage); this.name = 'WebGPUUnavailableError' }
}

export async function requestWebGPUAdapter(): Promise<GPUAdapter> {
  if (typeof navigator === 'undefined' || !navigator.gpu) throw new WebGPUUnavailableError()
  try {
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' })
    if (adapter) return adapter
  } catch { /* Report the same compatibility message for unavailable adapters. */ }
  throw new WebGPUUnavailableError()
}
