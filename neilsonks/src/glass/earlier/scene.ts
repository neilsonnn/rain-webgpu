import { createRenderTimer } from '../performance'
import {
  ACESFilmicToneMapping, Color, DepthTexture, HalfFloatType, LinearMipmapLinearFilter,
  MOUSE, PCFSoftShadowMap, PerspectiveCamera, Scene, SRGBColorSpace,
  Spherical, UnsignedIntType, Vector2, Vector3, WebGLRenderer, WebGLRenderTarget,
} from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import type { GlassSettings } from './settings'
import { defaults, normalizeGlassSettings, saveGlassSettings } from './settings'
import { createFoliage, growGarden, leafGeometry } from './foliage'
import { createFoliage as createSpringFoliage } from '../foliage'
import { createArchitecture, createEnvironment, greenhouseLights } from './environment'
import { createGlassMaterial } from './material'
import { leafTextures, rolledGlassTexture } from './textures'
import { createWireGrid } from './wire'
import { createGrading } from './grading'
import { dielectricFresnel, embeddedWireDepth } from './optics'
import type { GlassView, GlassSceneOptions } from '../view'
import { arrangements } from './arrangements'
import type { SceneArrangement } from './arrangements'
import { createPane } from './pane'
import { SoftOrbitControls } from '../orbit'
import { createStorm } from '../rain/storm'
import { createRainHanging } from '../rain/storm/hanging'
import { attachWaterTouch } from '../rain/touch'

export function mountGreenhouse(host: HTMLElement, settings: { current: GlassSettings }, onReady: () => void, onFailure: (message: string) => void, options: GlassSceneOptions = {}) {
  // Capture the current controls before any hot refresh or renderer rebuild.
  // Construction revisions preserve the user's optical and grading controls.
  settings.current = normalizeGlassSettings(settings.current, options.standalone ? defaults : undefined)
  if (!options.standalone) saveGlassSettings(settings.current)
  const arrangement = settings.current.arrangement, composition: SceneArrangement = arrangements[arrangement]
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

  const garden = new Scene(), surface = new Scene(), frontRain = new Scene(), backRain = new Scene()
  garden.background = new Color(composition.background)
  const camera = new PerspectiveCamera(48, 1, .05, 60)
  const gardenCamera = camera.clone()
  // Keep the user's orbit separate from the small animated camera offsets.
  // This prevents the ambient drift from accumulating inside OrbitControls.
  const orbitCamera = camera.clone()
  orbitCamera.position.set(0, 1.8, 2.25)
  if (options.standalone) {
    // Begin moderately left and slightly above, at the same zoom distance.
    const radius = 2.65, yaw = -.22, pitch = Math.PI / 2 - .06
    orbitCamera.position.set(
      radius * Math.sin(pitch) * Math.sin(yaw),
      1.8 + radius * Math.cos(pitch),
      -.4 + radius * Math.sin(pitch) * Math.cos(yaw),
    )
  }
  let controls: OrbitControls | SoftOrbitControls
  if (options.standalone) controls = new SoftOrbitControls(orbitCamera, host, new Vector3(0, 1.8, -.4))
  else {
    const studyControls = new OrbitControls(orbitCamera, renderer.domElement)
    studyControls.target.set(0, 1.8, -.4)
    studyControls.enablePan = Boolean(composition.pane); studyControls.enableZoom = true
    studyControls.zoomSpeed = .6; studyControls.minDistance = composition.pane ? .25 : 1.05; studyControls.maxDistance = composition.pane ? Infinity : 4.8
    studyControls.enableDamping = true
    studyControls.dampingFactor = .09
    studyControls.rotateSpeed = .35
    studyControls.minAzimuthAngle = composition.pane ? -Infinity : -.3; studyControls.maxAzimuthAngle = composition.pane ? Infinity : .3
    studyControls.minPolarAngle = composition.pane ? 0 : Math.PI / 2 - .16; studyControls.maxPolarAngle = composition.pane ? Math.PI : Math.PI / 2 + .16
    studyControls.mouseButtons = { RIGHT: MOUSE.ROTATE }
    controls = studyControls
  }
  controls.update(); controls.saveState()
  const gardenDepth = new DepthTexture(1, 1, UnsignedIntType)
  const target = new WebGLRenderTarget(1, 1, {
    type: HalfFloatType, minFilter: LinearMipmapLinearFilter, generateMipmaps: true,
    depthTexture: gardenDepth,
  })
  const wireDepth = new DepthTexture(1, 1, UnsignedIntType)
  const wireTarget = new WebGLRenderTarget(1, 1, {
    type: HalfFloatType, samples: Math.min(4, renderer.capabilities.maxSamples), depthTexture: wireDepth,
    minFilter: LinearMipmapLinearFilter, generateMipmaps: true,
  })
  const composite = new WebGLRenderTarget(1, 1, { type: HalfFloatType, depthBuffer: true })
  const relief = rolledGlassTexture(), rearRelief = rolledGlassTexture(768, 7391)
  relief.anisotropy = rearRelief.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy())
  const wire = composition.pane ? createWireGrid(composition.pane.width, composition.pane.height, composition.pane.centerY) : createWireGrid()
  const glass = createGlassMaterial(target.texture, gardenDepth, relief, rearRelief, wireTarget.texture, wireDepth, composition.pane ? wire.surfaceGrid : undefined)
  const grading = createGrading(composite.texture), pane = createPane(glass.material, composition.pane)
  pane.update(settings.current); surface.add(pane.group)
  const foliage = createFoliage(arrangement), architecture = createArchitecture(arrangement)
  const springFoliage = composition.motion === 'split' ? createSpringFoliage({
    garden: growGarden(arrangement, 'left'), textures: leafTextures, geometry: leafGeometry, earlierLook: true, windScale: composition.windScale,
  }) : undefined
  const hanging = createRainHanging()
  const rain = createStorm(renderer, foliage.rain, hanging, () => settings.current, composition.pane, () => {
    if (rain.backend !== 'starting') options.onRainBackend?.(rain.backend)
    invalidate()
  }, options.timings, { adapter: options.gpuAdapter, terrain: {texture:relief,grid:wire.surfaceGrid}, onFailure: message => { waterTouch.suspend(); failure(message) } })
  frontRain.add(rain.front); backRain.add(rain.mesh)
  glass.uniforms.uRainWater.value = rain.surface.texture
  glass.uniforms.uRainBounds.value.copy(rain.surface.bounds)
  glass.uniforms.uRainTexel.value = rain.surface.texel
  glass.uniforms.uRainDirectField.value = 1
  const lights = greenhouseLights(arrangement), surfaceLights = greenhouseLights(arrangement)
  surfaceLights.sun.castShadow = surfaceLights.fill.castShadow = false
  lights.group.traverse(object => object.layers.enable(1))
  garden.add(foliage.group, architecture.group, lights.group, wire.group, hanging.group)
  if (springFoliage) garden.add(springFoliage.group)
  surface.add(surfaceLights.group)
  const drySun = lights.sun.intensity, drySurfaceSun = surfaceLights.sun.intensity
  let environment: WebGLRenderTarget | undefined
  let stopped = false, disposed = false, ready = false, frame = 0, time = 12, previous = 0
  let suspended = Boolean(options.suspended)
  let ratio = Math.min(window.devicePixelRatio || 1, 1.65)
  let slowFrames = 0, observedFrames = 0, lastWidth = 1, lastHeight = 1
  let savedSettings = settings.current
  const pointer = new Vector2(), smoothPointer = new Vector2(), drawingSize = new Vector2(), look = new Vector3()
  const failure = (message: string) => { stopped = true; cancelAnimationFrame(frame); onFailure(message) }
  const drawRain = (scene: Scene, view: PerspectiveCamera) => {
    if (!(scene === frontRain ? rain.front.visible : rain.mesh.visible)) return
    const clear = renderer.autoClear, shadows = renderer.shadowMap.autoUpdate
    renderer.autoClear = false; renderer.shadowMap.autoUpdate = false
    try { renderer.render(scene, view) }
    finally { renderer.autoClear = clear; renderer.shadowMap.autoUpdate = shadows }
  }
  renderer.debug.onShaderError = (context, program, vertex, fragment) => {
    console.error('Greenhouse shader failed.', context.getProgramInfoLog(program), context.getShaderInfoLog(vertex), context.getShaderInfoLog(fragment))
    failure('The glass shader could not run on this device. Try reloading the scene.')
  }
  const resize = () => {
    if (suspended) return
    const { width, height } = host.getBoundingClientRect()
    lastWidth = Math.max(1, width); lastHeight = Math.max(1, height)
    const budget = Math.sqrt(2400000 / (lastWidth * lastHeight))
    renderer.setPixelRatio(Math.min(ratio, budget))
    renderer.setSize(lastWidth, lastHeight, false)
    renderer.getDrawingBufferSize(drawingSize)
    target.setSize(drawingSize.x, drawingSize.y)
    wireTarget.setSize(drawingSize.x, drawingSize.y); composite.setSize(drawingSize.x, drawingSize.y)
    glass.uniforms.uGlassResolution.value.copy(drawingSize)
    rain.uniforms.uRainResolution.value.copy(drawingSize)
    wire.materials.uniforms.uWireResolution.value.copy(drawingSize)
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
    if (disposed || stopped || suspended || document.hidden) { previous = 0; return }
    const s = settings.current, elapsed = previous ? (now - previous) / 1000 : 0
    if (s !== savedSettings) { if (!options.standalone) saveGlassSettings(s); savedSettings = s }
    previous = now
    controls.update(elapsed || 1 / 60)
    if (s.playing) time += Math.min(elapsed, .05)
    const detailed = options.timings?.expanded
    let simStart = detailed ? performance.now() : 0
    waterTouch.update(now, options.centerTaps?.current ?? false)
    rain.update(s.playing ? Math.min(elapsed, .05) : 0, s, time)
    let simulationMs = detailed ? performance.now() - simStart : 0
    host.dataset.rainBackend = rain.backend
    if (s.playing) smoothPointer.lerp(pointer, 1 - Math.exp(-Math.min(elapsed || .016, .05) * 1.5))
    const drift = s.drift
    camera.position.copy(orbitCamera.position)
    camera.position.x += (Math.sin(time * .083) * .035 + smoothPointer.x * .016) * drift
    camera.position.y += (Math.sin(time * .11 + 1) * .022 + smoothPointer.y * .01) * drift
    camera.position.z += Math.sin(time * .067) * .018 * drift
    camera.position.add(rain.shake.offset)
    look.copy(controls.target)
    look.x += Math.sin(time * .07 + .5) * .012 * drift
    look.y += Math.cos(time * .081) * .009 * drift
    camera.lookAt(look)
    camera.rotateZ(rain.shake.roll)
    camera.updateMatrixWorld()
    const paneSide = composition.pane && camera.position.z < -s.thickness * .5 ? -1 : 1
    glass.uniforms.uPaneSide.value = paneSide
    pane.update(s)
    // A wider source view provides real scene data beyond the visible edges
    // for strongly scattered rays, without enlarging the rendering budget.
    gardenCamera.copy(camera)
    gardenCamera.fov = Math.atan(Math.tan(camera.fov * Math.PI / 360) * 1.5) * 360 / Math.PI
    gardenCamera.updateProjectionMatrix()
    glass.uniforms.uGlassView.value.copy(camera.matrixWorldInverse)
    glass.uniforms.uGardenProjection.value.copy(gardenCamera.projectionMatrix)
    foliage.uniforms.uRainSheen.value = s.rainWetness
    glass.uniforms.uRainWetness.value = rain.wetness
    // A passing shower softens direct sun without changing the saved grade.
    lights.sun.intensity = drySun * (1 - rain.strength * .28)
    surfaceLights.sun.intensity = drySurfaceSun * (1 - rain.strength * .2)
    foliage.uniforms.uPlantTime.value = time
    foliage.uniforms.uBreeze.value = s.breeze
    if (detailed && springFoliage) simStart = performance.now()
    springFoliage?.update(s.playing ? Math.min(elapsed, .05) : 0, s.breeze)
    if (detailed && springFoliage) simulationMs += performance.now() - simStart
    glass.uniforms.uGlassRelief.value = s.relief
    glass.uniforms.uTextureScale.value = s.textureScale
    glass.uniforms.uGlassDiffusion.value = paneSide > 0 ? s.diffusion : s.surfaceRoughness
    glass.uniforms.uFrontRoughness.value = paneSide > 0 ? s.surfaceRoughness : s.diffusion
    glass.uniforms.uGridPitch.value = s.wireSpacing
    glass.uniforms.uGridRelief.value = s.gridRelief; glass.uniforms.uGridWidth.value = s.gridWidth
    glass.uniforms.uGridPebbling.value = s.gridPebbling
    glass.uniforms.uEmbeddedMesh.value = Number(s.embeddedMesh)
    glass.uniforms.uRearRelief.value = s.rearRelief
    glass.uniforms.uPaneThickness.value = s.thickness
    const embedDepth = embeddedWireDepth(s.thickness, s.wireRadius, s.wireDepth, s.relief, s.rearRelief)
    glass.uniforms.uWireDepth.value = paneSide > 0 ? embedDepth : s.thickness - embedDepth
    glass.uniforms.uDepthStrength.value = s.depthStrength; glass.uniforms.uDepthScale.value = s.depthScale
    glass.uniforms.uDepthCurve.value = s.depthCurve; glass.uniforms.uClearDepth.value = s.clearDepth
    glass.material.roughness = paneSide > 0 ? s.surfaceRoughness : s.diffusion
    glass.material.ior = s.ior
    wire.update(s); wire.group.visible = s.glass && s.embeddedMesh
    // Coverage blending needs the rear strand family first at intersections.
    wire.meshes.forEach((mesh, axis) => { mesh.renderOrder = axis === (paneSide > 0 ? 0 : 1) ? 1 : 0 })
    const interfaceTransmission = 1 - dielectricFresnel(1, 1, s.ior)
    lights.fill.intensity = composition.fill * (s.glass ? interfaceTransmission ** 2 * Math.exp(-1.02 * s.thickness) : 1)
    grading.update(s)
    renderer.toneMappingExposure = s.exposure
    if (detailed) renderTimer.begin(now)
    const renderStart = detailed ? performance.now() : 0
    try {
      rain.renderWater()
      glass.uniforms.uRainWater.value = rain.surface.texture
      glass.uniforms.uRainBounds.value.copy(rain.surface.bounds)
      if (s.glass) {
        // Keep full geometric wire shadows while excluding its surface from the
        // garden color/depth. Its optical depth must not share the foliage blur.
        wire.writeSurface(false)
        renderer.setRenderTarget(target)
        renderer.render(garden, gardenCamera)
        drawRain(backRain, gardenCamera)
        const background = garden.background
        try {
          if (s.embeddedMesh) {
            wire.writeSurface(true)
            camera.layers.set(1)
            garden.background = null
            renderer.setClearColor(0x000000, 0)
            renderer.shadowMap.autoUpdate = false
            renderer.setRenderTarget(wireTarget)
            renderer.render(garden, camera)
          }
        } finally {
          wire.writeSurface(false)
          camera.layers.set(0)
          garden.background = background
          renderer.setClearColor(composition.background, 1)
          renderer.shadowMap.autoUpdate = true
        }
        renderer.setRenderTarget(composite)
        if (composition.pane) {
          // The unfiltered garden remains visible outside the cut pane. Its
          // depth also occludes glass when orbiting behind the foliage.
          wire.group.visible = false
          renderer.shadowMap.autoUpdate = false
          renderer.render(garden, camera)
          drawRain(backRain, camera)
          renderer.autoClear = false
          try { renderer.render(surface, camera) }
          finally { renderer.autoClear = true; renderer.shadowMap.autoUpdate = true; wire.group.visible = s.embeddedMesh }
        } else renderer.render(surface, camera)
      } else {
        renderer.setRenderTarget(composite)
        renderer.render(garden, camera)
        drawRain(backRain, camera)
      }
      drawRain(frontRain, camera)
      renderer.setRenderTarget(null)
      grading.render(renderer)
    } catch (reason) {
      console.error('Greenhouse rendering failed.', reason)
      renderer.setRenderTarget(null)
      failure('The greenhouse could not finish rendering. Try reloading the scene.')
      return
    } finally { renderTimer.end() }
    options.timings?.record(elapsed, simulationMs, detailed ? performance.now() - renderStart : 0)
    if (!stopped && !ready && rain.surface.ready) { ready = true; onReady() }
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
    if (!frame && !disposed && !stopped && !suspended && !document.hidden) frame = requestAnimationFrame(draw)
  }
  const visibility = () => {
    cancelAnimationFrame(frame); frame = 0; previous = 0
    if (document.hidden) waterTouch.suspend()
    else invalidate()
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
  const touchPose = new Spherical(), touchOffset = new Vector3()
  const waterTouch = attachWaterTouch(host,camera,() => settings.current,rain.surface,invalidate,() => {
    controls.enableDamping = false; controls.update(); controls.enableDamping = true
  }, (dx, dy, distanceRatio) => {
    if (controls instanceof SoftOrbitControls) controls.drag(dx, dy, distanceRatio)
    else {
      const scale = Math.PI * 2 * controls.rotateSpeed / Math.max(1, host.clientHeight)
      touchPose.setFromVector3(touchOffset.copy(orbitCamera.position).sub(controls.target))
      touchPose.theta -= dx * scale; touchPose.phi -= dy * scale; touchPose.makeSafe()
      touchPose.radius *= distanceRatio
      orbitCamera.position.copy(touchOffset.setFromSpherical(touchPose)).add(controls.target)
      controls.update()
    }
    invalidate()
  }, options.onWaterFlow)
  const dispose = () => {
    if (disposed) return
    renderTimer.dispose()
    disposed = true; stopped = true; cancelAnimationFrame(frame)
    if (!options.standalone) saveGlassSettings(settings.current)
    observer.disconnect()
    controls.removeEventListener('change', invalidate)
    controls.removeEventListener('start', startOrbit); controls.removeEventListener('end', endOrbit)
    waterTouch.dispose(); controls.dispose(); host.classList.remove('glass-orbiting')
    document.removeEventListener('visibilitychange', visibility)
    host.removeEventListener('pointermove', move); host.removeEventListener('pointerleave', leave)
    renderer.domElement.removeEventListener('webglcontextlost', lost)
    rain.dispose(); hanging.dispose(); foliage.dispose(); springFoliage?.dispose(); architecture.dispose(); lights.dispose(); surfaceLights.dispose(); wire.dispose(); grading.dispose()
    delete host.dataset.rainBackend
    environment?.dispose(); target.dispose(); wireTarget.dispose(); composite.dispose()
    relief.dispose(); rearRelief.dispose(); pane.dispose(); glass.material.dispose()
    renderer.dispose(); renderer.forceContextLoss(); renderer.domElement.remove()
  }
  try {
    environment = createEnvironment(renderer)
    garden.environment = surface.environment = environment.texture
    garden.environmentIntensity = composition.environment; surface.environmentIntensity = 1
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
  const setSuspended = (value: boolean) => {
    if (disposed || suspended === value) return
    suspended = value; cancelAnimationFrame(frame); frame = 0; previous = 0
    if (value) waterTouch.suspend()
    else { resize(); invalidate() }
  }
  return { invalidate, dispose, resetView, getView, setView, setSuspended }
}
