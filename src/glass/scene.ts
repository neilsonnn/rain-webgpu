import { createRenderTimer } from './performance'
import {
  ACESFilmicToneMapping, Color, DepthTexture, HalfFloatType, LinearMipmapLinearFilter,
  Mesh, MOUSE, PCFSoftShadowMap, PerspectiveCamera, PlaneGeometry, Scene, SRGBColorSpace,
  TOUCH, UnsignedIntType, Vector2, Vector3, WebGLRenderer, WebGLRenderTarget,
} from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import type { GlassSettings } from './settings'
import { normalizeGlassSettings, saveGlassSettings } from './settings'
import { createFoliage } from './foliage'
import { createArchitecture, createEnvironment, greenhouseLights } from './environment'
import { createGlassMaterial } from './material'
import { rolledGlassTexture } from './textures'
import { createWireGrid } from './wire'
import { createGrading } from './grading'
import { dielectricFresnel, embeddedWireDepth } from './optics'
import type { GlassView, GlassSceneOptions } from './view'

export function mountGreenhouse(host: HTMLElement, settings: { current: GlassSettings }, onReady: () => void, onFailure: (message: string) => void, options: GlassSceneOptions = {}) {
  // Capture the current controls before any hot refresh or renderer rebuild.
  // Construction revisions preserve the user's optical and grading controls.
  settings.current = normalizeGlassSettings(settings.current)
  saveGlassSettings(settings.current)
  const renderer = new WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' })
  if (!renderer.extensions.has('EXT_color_buffer_float') && !renderer.extensions.has('EXT_color_buffer_half_float')) {
    renderer.dispose(); renderer.forceContextLoss()
    throw new Error('Half-float HDR rendering is unavailable.')
  }
  renderer.setClearColor('#000000')
  renderer.outputColorSpace = SRGBColorSpace
  renderer.toneMapping = ACESFilmicToneMapping
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = PCFSoftShadowMap
  renderer.domElement.setAttribute('aria-hidden', 'true')
  host.appendChild(renderer.domElement)

  const garden = new Scene(), surface = new Scene()
  garden.background = new Color('#050907')
  const camera = new PerspectiveCamera(48, 1, .05, 60)
  const gardenCamera = camera.clone()
  // Keep the user's orbit separate from the small animated camera offsets.
  // This prevents the ambient drift from accumulating inside OrbitControls.
  const orbitCamera = camera.clone()
  orbitCamera.position.set(0, 1.8, 2.25)
  const controls = new OrbitControls(orbitCamera, renderer.domElement)
  controls.target.set(0, 1.8, -.4)
  controls.enablePan = false; controls.enableZoom = true
  controls.zoomSpeed = .6; controls.minDistance = 1.05; controls.maxDistance = 4.8
  controls.enableDamping = true
  controls.dampingFactor = .09
  controls.rotateSpeed = .35
  controls.minAzimuthAngle = -.3; controls.maxAzimuthAngle = .3
  controls.minPolarAngle = Math.PI / 2 - .16; controls.maxPolarAngle = Math.PI / 2 + .16
  controls.mouseButtons = { RIGHT: MOUSE.ROTATE }
  controls.touches = { ONE: null, TWO: TOUCH.DOLLY_ROTATE }
  controls.update(); controls.saveState()
  const gardenDepth = new DepthTexture(1, 1, UnsignedIntType)
  const target = new WebGLRenderTarget(1, 1, {
    type: HalfFloatType, minFilter: LinearMipmapLinearFilter, generateMipmaps: true,
    depthTexture: gardenDepth,
  })
  const wireDepth = new DepthTexture(1, 1, UnsignedIntType)
  const wireTarget = new WebGLRenderTarget(1, 1, { type: HalfFloatType, samples: Math.min(4, renderer.capabilities.maxSamples), depthTexture: wireDepth })
  const composite = new WebGLRenderTarget(1, 1, { type: HalfFloatType, depthBuffer: false })
  const relief = rolledGlassTexture(), rearRelief = rolledGlassTexture(768, 7391)
  const glass = createGlassMaterial(target.texture, gardenDepth, relief, rearRelief, wireTarget.texture, wireDepth)
  const wire = createWireGrid(), grading = createGrading(composite.texture)
  const paneGeometry = new PlaneGeometry(32, 32)
  surface.add(new Mesh(paneGeometry, glass.material))
  const foliage = createFoliage(), architecture = createArchitecture()
  const lights = greenhouseLights(), surfaceLights = greenhouseLights()
  surfaceLights.sun.castShadow = surfaceLights.fill.castShadow = false
  lights.group.traverse(object => object.layers.enable(1))
  garden.add(foliage.group, architecture.group, lights.group, wire.mesh)
  surface.add(surfaceLights.group)
  let environment: WebGLRenderTarget | undefined
  let stopped = false, disposed = false, ready = false, frame = 0, time = 12, previous = 0
  let ratio = Math.min(window.devicePixelRatio || 1, 1.65)
  let slowFrames = 0, observedFrames = 0, lastWidth = 1, lastHeight = 1
  let savedSettings = settings.current
  const pointer = new Vector2(), smoothPointer = new Vector2(), drawingSize = new Vector2(), look = new Vector3()
  const failure = (message: string) => { stopped = true; cancelAnimationFrame(frame); onFailure(message) }
  renderer.debug.onShaderError = (context, program, vertex, fragment) => {
    console.error('Greenhouse shader failed.', context.getProgramInfoLog(program), context.getShaderInfoLog(vertex), context.getShaderInfoLog(fragment))
    failure('The glass shader could not run on this device. Try reloading the scene.')
  }
  const resize = () => {
    const { width, height } = host.getBoundingClientRect()
    lastWidth = Math.max(1, width); lastHeight = Math.max(1, height)
    const budget = Math.sqrt(2400000 / (lastWidth * lastHeight))
    renderer.setPixelRatio(Math.min(ratio, budget))
    renderer.setSize(lastWidth, lastHeight, false)
    renderer.getDrawingBufferSize(drawingSize)
    wire.materials.uniforms.uWireResolution.value.copy(drawingSize)
    target.setSize(drawingSize.x, drawingSize.y)
    wireTarget.setSize(drawingSize.x, drawingSize.y); composite.setSize(drawingSize.x, drawingSize.y)
    glass.uniforms.uGlassResolution.value.copy(drawingSize)
    grading.uniforms.uGradeResolution.value.copy(drawingSize)
    camera.aspect = lastWidth / lastHeight
    // Preserve the composition's width on narrow screens without stretching it.
    camera.fov = Math.atan(Math.tan(24 * Math.PI / 180) / Math.min(1, camera.aspect)) * 360 / Math.PI
    camera.updateProjectionMatrix()
    glass.uniforms.uGlassProjection.value.copy(camera.projectionMatrix)
  }
  const renderTimer = createRenderTimer(renderer, options.timings)
  const draw = (now: number) => {
    frame = 0
    if (disposed || stopped || document.hidden) { previous = 0; return }
    const s = settings.current, elapsed = previous ? (now - previous) / 1000 : 0
    if (s !== savedSettings) { saveGlassSettings(s); savedSettings = s }
    previous = now
    controls.update()
    if (s.playing) time += Math.min(elapsed, .05)
    if (s.playing) smoothPointer.lerp(pointer, 1 - Math.exp(-Math.min(elapsed || .016, .05) * 1.5))
    const drift = s.drift
    camera.position.copy(orbitCamera.position)
    camera.position.x += (Math.sin(time * .083) * .035 + smoothPointer.x * .016) * drift
    camera.position.y += (Math.sin(time * .11 + 1) * .022 + smoothPointer.y * .01) * drift
    camera.position.z += Math.sin(time * .067) * .018 * drift
    look.copy(controls.target)
    look.x += Math.sin(time * .07 + .5) * .012 * drift
    look.y += Math.cos(time * .081) * .009 * drift
    camera.lookAt(look)
    camera.updateMatrixWorld()
    // A wider source view provides real scene data beyond the visible edges
    // for strongly scattered rays, without enlarging the rendering budget.
    gardenCamera.copy(camera)
    gardenCamera.fov = Math.atan(Math.tan(camera.fov * Math.PI / 360) * 1.5) * 360 / Math.PI
    gardenCamera.updateProjectionMatrix()
    glass.uniforms.uGlassView.value.copy(camera.matrixWorldInverse)
    glass.uniforms.uGardenProjection.value.copy(gardenCamera.projectionMatrix)
    const detailed = options.timings?.expanded
    const simStart = detailed ? performance.now() : 0
    foliage.update(s.playing ? Math.min(elapsed, .05) : 0, s.breeze)
    const simulationMs = detailed ? performance.now() - simStart : 0
    glass.uniforms.uGlassRelief.value = s.relief
    glass.uniforms.uTextureScale.value = s.textureScale
    glass.uniforms.uGlassDiffusion.value = s.diffusion
    glass.uniforms.uFrontRoughness.value = s.surfaceRoughness
    glass.uniforms.uGridPitch.value = s.wireSpacing
    glass.uniforms.uGridRelief.value = s.gridRelief; glass.uniforms.uGridWidth.value = s.gridWidth
    glass.uniforms.uGridPebbling.value = s.gridPebbling
    glass.uniforms.uEmbeddedMesh.value = Number(s.embeddedMesh)
    glass.uniforms.uRearRelief.value = s.rearRelief
    glass.uniforms.uPaneThickness.value = s.thickness
    glass.uniforms.uWireDepth.value = embeddedWireDepth(s.thickness, s.wireRadius, s.wireDepth, s.relief, s.rearRelief)
    glass.uniforms.uDepthStrength.value = s.depthStrength; glass.uniforms.uDepthScale.value = s.depthScale
    glass.uniforms.uDepthCurve.value = s.depthCurve; glass.uniforms.uClearDepth.value = s.clearDepth
    glass.material.roughness = s.surfaceRoughness
    glass.material.ior = s.ior
    glass.material.envMapIntensity = s.reflectionStrength
    wire.update(s); wire.mesh.visible = s.glass && s.embeddedMesh
    architecture.update(s)
    lights.sky.intensity = s.skyFill
    garden.environmentIntensity = s.skyFill * 1.25
    const interfaceTransmission = 1 - dielectricFresnel(1, 1, s.ior)
    lights.fill.intensity = 2 * (s.glass ? interfaceTransmission ** 2 * Math.exp(-1.02 * s.thickness) : 1)
    grading.update(s)
    renderer.toneMappingExposure = s.exposure
    if (detailed) renderTimer.begin(now)
    const renderStart = detailed ? performance.now() : 0
    try {
      if (s.glass) {
        // Keep full geometric wire shadows while excluding its surface from the
        // garden color/depth. Its optical depth must not share the foliage blur.
        renderer.setRenderTarget(target)
        renderer.render(garden, gardenCamera)
        const background = garden.background
        try {
          if (s.embeddedMesh) {
            camera.layers.set(1)
            garden.background = null
            renderer.setClearColor(0x000000, 0)
            renderer.shadowMap.autoUpdate = false
            renderer.setRenderTarget(wireTarget)
            renderer.render(garden, camera)
          }
        } finally {
          camera.layers.set(0)
          garden.background = background
          renderer.setClearColor('#050907', 1)
          renderer.shadowMap.autoUpdate = true
        }
        renderer.setRenderTarget(composite)
        renderer.render(surface, camera)
      } else {
        renderer.setRenderTarget(composite)
        renderer.render(garden, camera)
      }
      renderer.setRenderTarget(null)
      grading.render(renderer)
    } catch (reason) {
      console.error('Greenhouse rendering failed.', reason)
      renderer.setRenderTarget(null)
      failure('The greenhouse could not finish rendering. Try reloading the scene.')
      return
    } finally { renderTimer.end() }
    options.timings?.record(elapsed, simulationMs, detailed ? performance.now() - renderStart : 0)
    if (!stopped && !ready) { ready = true; onReady() }
    if (s.playing && elapsed > 0 && observedFrames < 180) {
      observedFrames++
      if (elapsed > .034) slowFrames++
      if (observedFrames === 180 && slowFrames > 90 && ratio > .75) {
        ratio = Math.max(.75, ratio * .75); resize()
      }
    }
    if (s.playing && !stopped) invalidate()
    else previous = 0
  }
  const invalidate = () => {
    if (!frame && !disposed && !stopped && !document.hidden) frame = requestAnimationFrame(draw)
  }
  const visibility = () => {
    cancelAnimationFrame(frame); frame = 0; previous = 0
    if (!document.hidden) invalidate()
  }
  const lost = (event: Event) => {
    event.preventDefault()
    failure('The 3D connection was interrupted. Reload the scene to return to the greenhouse.')
  }
  const move = (event: PointerEvent) => {
    if (event.pointerType !== 'mouse') return
    const bounds = host.getBoundingClientRect()
    pointer.set(((event.clientX - bounds.left) / lastWidth - .5) * 2, (.5 - (event.clientY - bounds.top) / lastHeight) * 2).clampScalar(-1, 1)
  }
  const leave = () => pointer.set(0, 0)
  const startOrbit = () => { host.classList.add('glass-orbiting'); invalidate() }
  const endOrbit = () => { host.classList.remove('glass-orbiting'); invalidate() }
  const observer = new ResizeObserver(() => { resize(); invalidate() })
  const dispose = () => {
    if (disposed) return
    renderTimer.dispose()
    disposed = true; stopped = true; cancelAnimationFrame(frame)
    saveGlassSettings(settings.current)
    observer.disconnect()
    controls.removeEventListener('change', invalidate)
    controls.removeEventListener('start', startOrbit); controls.removeEventListener('end', endOrbit)
    controls.dispose(); host.classList.remove('glass-orbiting')
    document.removeEventListener('visibilitychange', visibility)
    host.removeEventListener('pointermove', move); host.removeEventListener('pointerleave', leave)
    renderer.domElement.removeEventListener('webglcontextlost', lost)
    foliage.dispose(); architecture.dispose(); lights.dispose(); surfaceLights.dispose(); wire.dispose(); grading.dispose()
    environment?.dispose(); target.dispose(); wireTarget.dispose(); composite.dispose()
    relief.dispose(); rearRelief.dispose(); paneGeometry.dispose(); glass.material.dispose()
    renderer.dispose(); renderer.forceContextLoss(); renderer.domElement.remove()
  }
  try {
    environment = createEnvironment(renderer)
    garden.environment = surface.environment = environment.texture
    garden.environmentIntensity = settings.current.skyFill * 1.25; surface.environmentIntensity = 1
    resize()
    observer.observe(host)
    document.addEventListener('visibilitychange', visibility)
    renderer.domElement.addEventListener('webglcontextlost', lost)
    controls.addEventListener('change', invalidate)
    controls.addEventListener('start', startOrbit); controls.addEventListener('end', endOrbit)
    host.addEventListener('pointermove', move); host.addEventListener('pointerleave', leave)
    invalidate()
  } catch (reason) {
    dispose()
    throw reason
  }
  const resetView = () => {
    // Flush residual damping before restoring the saved pose.
    controls.enableDamping = false
    controls.update(); controls.reset()
    controls.enableDamping = true
    invalidate()
  }
  const getView = (): GlassView => ({ position: orbitCamera.position.toArray(), target: controls.target.toArray(), time })
  const setView = (view: GlassView) => {
    controls.enableDamping = false
    controls.update()
    orbitCamera.position.fromArray(view.position); controls.target.fromArray(view.target)
    time = view.time
    controls.update(); controls.enableDamping = true
    invalidate()
  }
  return { invalidate, dispose, resetView, getView, setView }
}
