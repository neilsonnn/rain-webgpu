import { ACESFilmicToneMapping, HalfFloatType, LinearFilter, SRGBColorSpace, WebGLRenderer, WebGLRenderTarget } from 'three'
import { createGuideModel } from './model'
import type { ExampleKind, ExampleValues } from './examples'

export function createGuideRenderer(canvas: HTMLCanvasElement, scroll: HTMLElement, values: () => ExampleValues, onFailure: () => void) {
  const renderer = new WebGLRenderer({ canvas, alpha: true, antialias: false, powerPreference: 'low-power' })
  renderer.outputColorSpace = SRGBColorSpace; renderer.toneMapping = ACESFilmicToneMapping
  renderer.autoClear = false; renderer.transmissionResolutionScale = .75
  const target = new WebGLRenderTarget(1, 1, { type: HalfFloatType, minFilter: LinearFilter, magFilter: LinearFilter, depthBuffer: true })
  let model: ReturnType<typeof createGuideModel>
  try { model = createGuideModel(renderer, target.texture) }
  catch (error) { target.dispose(); renderer.dispose(); renderer.forceContextLoss(); throw error }
  const slots = Array.from(scroll.querySelectorAll<HTMLElement>('[data-glass-example]'))
  let frame = 0, disposed = false, failed = false, lastWidth = 0, lastHeight = 0
  const fail = () => { if (failed || disposed) return; failed = true; cancelAnimationFrame(frame); frame = 0; onFailure() }
  renderer.debug.onShaderError = fail
  const lost = (event: Event) => { event.preventDefault(); fail() }
  const draw = () => {
    frame = 0
    if (disposed || failed || document.hidden) return
    try {
      const width = scroll.clientWidth, height = scroll.clientHeight
      if (width <= 0 || height <= 0) return
      const ratio = Math.min(window.devicePixelRatio || 1, 1.5, Math.sqrt(1800000 / (width * height)))
      if (width !== lastWidth || height !== lastHeight || ratio !== renderer.getPixelRatio()) {
        renderer.setPixelRatio(ratio); renderer.setSize(width, height, false)
        canvas.style.width = `${width}px`; canvas.style.height = `${height}px`
        lastWidth = width; lastHeight = height
      }
      // Move with the essay between paint requests: asynchronous touch scroll
      // then carries the last image with its text instead of sliding behind it.
      canvas.style.transform = `translateY(${scroll.scrollTop}px)`
      const viewport = canvas.getBoundingClientRect(), settings = values()
      renderer.setRenderTarget(null); renderer.setScissorTest(false); renderer.setClearColor(0, 0); renderer.clear()
      for (const element of slots) {
        const rect = element.getBoundingClientRect()
        const top = Math.max(rect.top, viewport.top), bottom = Math.min(rect.bottom, viewport.bottom)
        const left = Math.max(rect.left, viewport.left), right = Math.min(rect.right, viewport.right)
        if (bottom <= top || right <= left || rect.width <= 0 || rect.height <= 0) continue
        const kind = element.dataset.glassExample as ExampleKind
        const targetWidth = Math.min(900, Math.round(rect.width * ratio)), targetHeight = Math.round(targetWidth * rect.height / rect.width)
        if (target.width !== targetWidth || target.height !== targetHeight) target.setSize(targetWidth, targetHeight)
        model.prepare(kind, settings, rect.width / rect.height)
        // setRenderTarget installs its pixel viewport. setViewport here would
        // multiply it by the canvas DPR a second time on retina displays.
        renderer.setRenderTarget(target); renderer.setScissorTest(false)
        renderer.toneMappingExposure = 1; renderer.setClearColor('#0c130f', 1); renderer.clear()
        renderer.render(model.scene, model.camera)
        renderer.setRenderTarget(null); renderer.setScissorTest(true)
        renderer.setViewport(rect.left - viewport.left, viewport.bottom - rect.bottom, rect.width, rect.height)
        renderer.setScissor(left - viewport.left, viewport.bottom - bottom, right - left, bottom - top)
        renderer.toneMappingExposure = kind === 'lighting' ? 2 ** settings.lighting : 1
        model.showOutput(); renderer.render(model.scene, model.screenCamera)
      }
      renderer.setScissorTest(false)
    } catch (error) { console.warn('Glass guide illustration failed.', error); fail() }
  }
  function invalidate() { if (!frame && !disposed && !failed && !document.hidden) frame = requestAnimationFrame(draw) }
  const visibility = () => { cancelAnimationFrame(frame); frame = 0; if (!document.hidden) invalidate() }
  const resize = new ResizeObserver(invalidate)
  resize.observe(scroll); for (const element of slots) resize.observe(element)
  scroll.addEventListener('scroll', invalidate, { passive: true })
  window.addEventListener('resize', invalidate)
  document.addEventListener('visibilitychange', visibility)
  canvas.addEventListener('webglcontextlost', lost)
  void document.fonts.ready.then(invalidate)
  invalidate()
  return {
    invalidate,
    dispose() {
      if (disposed) return
      disposed = true; cancelAnimationFrame(frame); resize.disconnect()
      scroll.removeEventListener('scroll', invalidate); window.removeEventListener('resize', invalidate)
      document.removeEventListener('visibilitychange', visibility); canvas.removeEventListener('webglcontextlost', lost)
      model.dispose(); target.dispose(); renderer.dispose(); renderer.forceContextLoss()
    },
  }
}
