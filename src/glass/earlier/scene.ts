import { createRenderTimer } from '../performance'
import {
  ACESFilmicToneMapping, Color, DepthTexture, HalfFloatType, LinearMipmapLinearFilter,
  DoubleSide, MOUSE, Mesh, MeshNormalMaterial, PerspectiveCamera, Scene, SRGBColorSpace,
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
import { createPane, standalonePaneSize } from './pane'
import { SoftOrbitControls, touchPinchGain } from '../orbit'
import { createStorm } from '../rain/storm'
import { attachWaterTouch } from '../rain/touch'
import { defaultQuality, qualityLevels, supportedLevel, supportedWireSamples, type GpuQuality } from '../quality'

export function mountGreenhouse(host: HTMLElement, settings: { current: GlassSettings }, onReady: () => void, onFailure: (message: string) => void, options: GlassSceneOptions = {}) {
  // Capture the current controls before any hot refresh or renderer rebuild.
  // Construction revisions preserve the user's optical and grading controls.
  settings.current = normalizeGlassSettings(settings.current, options.standalone ? defaults : undefined)
  if (!options.standalone) saveGlassSettings(settings.current)
  const arrangement = settings.current.arrangement, composition: SceneArrangement = arrangements[arrangement]
  const paneSize = options.standalone ? standalonePaneSize : composition.pane
  const renderer = new WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' })
  if (!renderer.extensions.has('EXT_color_buffer_float') && !renderer.extensions.has('EXT_color_buffer_half_float')) {
    renderer.dispose(); renderer.forceContextLoss()
    throw new Error('Half-float HDR rendering is unavailable.')
  }
  renderer.setClearColor('#000000')
  renderer.outputColorSpace = SRGBColorSpace
  renderer.toneMapping = ACESFilmicToneMapping
  renderer.domElement.setAttribute('aria-hidden', 'true')
  host.appendChild(renderer.domElement)

  const garden = new Scene(), surface = new Scene(), frontRain = new Scene()
  const meshMaterial = new MeshNormalMaterial({ side: DoubleSide })
  garden.background = new Color(composition.background)
  const camera = new PerspectiveCamera(48, 1, .05, 60)
  const gardenCamera = camera.clone()
  // Keep the user's orbit separate from the small animated camera offsets.
  // This prevents the ambient drift from accumulating inside OrbitControls.
  const orbitCamera = camera.clone()
  orbitCamera.position.set(0, 1.8, 2.25)
  if (options.standalone) {
    // Look up and right across the pane from a closer, lower-left orbit.
    const radius = 1.55, yaw = -.36, pitch = Math.PI / 2 + .19
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
  const gl = renderer.getContext() as WebGL2RenderingContext
  const wireLevels = supportedWireSamples(gl)
  const filterLevels = qualityLevels.reliefFilter.filter(n => n <= Math.max(1, renderer.capabilities.getMaxAnisotropy()))
  options.onQualityCaps?.({ wireSamples: wireLevels, reliefFilter: filterLevels })
  const wireTarget = new WebGLRenderTarget(1, 1, {
    type: HalfFloatType, depthTexture: wireDepth,
    minFilter: LinearMipmapLinearFilter, generateMipmaps: true,
  })
  const composite = new WebGLRenderTarget(1, 1, { type: HalfFloatType, depthBuffer: true })
  const relief = rolledGlassTexture(), rearRelief = rolledGlassTexture(768, 7391)
  const wire = paneSize ? createWireGrid(paneSize.width, paneSize.height, paneSize.centerY) : createWireGrid()
  const glass = createGlassMaterial(target.texture, gardenDepth, relief, rearRelief, wireTarget.texture, wireDepth, paneSize ? wire.surfaceGrid : undefined)
  const grading = createGrading(composite.texture), pane = createPane(glass.material, paneSize)
  pane.update(settings.current); surface.add(pane.group)
  const foliage = createFoliage(arrangement), architecture = createArchitecture(arrangement)
  const springFoliage = composition.motion === 'split' ? createSpringFoliage({
    garden: growGarden(arrangement, 'left'), textures: leafTextures, geometry: leafGeometry, earlierLook: true, windScale: composition.windScale,
  }) : undefined
  const rain = createStorm(renderer, foliage.rain, () => settings.current, paneSize, () => {
    if (rain.backend !== 'starting') options.onRainBackend?.(rain.backend)
    invalidate()
  }, options.timings, { adapter: options.gpuAdapter, terrain: {texture:relief,grid:wire.surfaceGrid}, onFailure: message => { waterTouch.suspend(); failure(message) } })
  frontRain.add(rain.front); garden.add(rain.mesh)
  glass.uniforms.uRainWater.value = rain.surface.texture
  glass.uniforms.uRainBounds.value.copy(rain.surface.bounds)
  glass.uniforms.uRainTexel.value = rain.surface.texel
  glass.uniforms.uRainDirectField.value = 1
  const lights = greenhouseLights(arrangement), surfaceLights = greenhouseLights(arrangement)
  lights.group.traverse(object => object.layers.enable(1))
  garden.add(foliage.group, architecture.group, lights.group, wire.mesh)
  if (springFoliage) garden.add(springFoliage.group)
  surface.add(surfaceLights.group)
  const drySun = lights.sun.intensity, drySurfaceSun = surfaceLights.sun.intensity
  let environment: WebGLRenderTarget | undefined
  let paneEnvironment: WebGLRenderTarget | undefined
  let stopped = false, disposed = false, ready = false, frame = 0, time = 12, previous = 0
  let lastWidth = 0, lastHeight = 0
  let savedSettings = settings.current
  const pointer = new Vector2(), smoothPointer = new Vector2(), drawingSize = new Vector2(), look = new Vector3()
  const failure = (message: string) => { stopped = true; cancelAnimationFrame(frame); onFailure(message) }
  const drawFrontRain = () => {
    if (!rain.front.visible) return
    const clear = renderer.autoClear
    renderer.autoClear = false
    try { renderer.render(frontRain, camera) }
    finally { renderer.autoClear = clear }
  }
  const drawMeshes = () => {
    const rainVisible = rain.mesh.visible
    garden.overrideMaterial = meshMaterial
    rain.mesh.visible = false
    try {
      renderer.setRenderTarget(null)
      renderer.render(garden, camera)
    } finally {
      garden.overrideMaterial = null
      rain.mesh.visible = rainVisible
    }
  }
  renderer.debug.onShaderError = (context, program, vertex, fragment) => {
    console.error('Greenhouse shader failed.', context.getProgramInfoLog(program), context.getShaderInfoLog(vertex), context.getShaderInfoLog(fragment))
    failure('The glass shader could not run on this device. Try reloading the scene.')
  }
  const pixelRatio = () => options.quality?.current.pixelRatio || window.devicePixelRatio || 1
  const resize = () => {
    const bounds = renderer.domElement.getBoundingClientRect()
    const width = Math.max(1, bounds.width), height = Math.max(1, bounds.height), ratio = pixelRatio()
    if (width === lastWidth && height === lastHeight && ratio === renderer.getPixelRatio()) return
    lastWidth = width; lastHeight = height
    renderer.setDrawingBufferSize(width, height, ratio)
    drawingSize.set(gl.drawingBufferWidth, gl.drawingBufferHeight)
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
    options.onRenderSize?.(drawingSize.x, drawingSize.y)
  }
  const renderTimer = createRenderTimer(renderer, options.timings)
  const glassTimer = createRenderTimer(renderer, options.timings, 'glassGpu')
  let appliedQuality: GpuQuality | undefined
  function applyQuality(q: GpuQuality) {
    glass.setQuality(q)
    const anisotropy = supportedLevel(q.reliefFilter, filterLevels)
    for (const map of [relief, rearRelief]) if (map.anisotropy !== anisotropy) {
      map.anisotropy = anisotropy; map.needsUpdate = true
    }
    const wireCount = supportedLevel(q.wireSamples, wireLevels)
    const samples = wireCount === 1 ? 0 : wireCount
    if (wireTarget.samples !== samples) {
      wireTarget.dispose()
      wireTarget.samples = samples
    }
    glass.uniforms.uRainTexel.value = 1 / q.waterSize
    appliedQuality = q
  }
  let sampleGlass = false
  const draw = (now: number) => {
    frame = 0
    if (disposed || stopped || document.hidden) { previous = 0; return }
    if (renderer.getPixelRatio() !== pixelRatio()) resize()
    const s = settings.current, elapsed = previous ? (now - previous) / 1000 : 0
    const playing = s.playing && !options.openingFrame?.current
    const delta = playing ? Math.min(elapsed, .05) : 0
    const quality = options.quality?.current ?? defaultQuality
    if (quality !== appliedQuality) applyQuality(quality)
    if (s !== savedSettings) { if (!options.standalone) saveGlassSettings(s); savedSettings = s }
    previous = now
    controls.update(elapsed || 1 / 60)
    time += delta
    const detailed = options.timings?.expanded
    let simStart = detailed ? performance.now() : 0
    waterTouch.update(now, options.centerTaps?.current ?? false)
    rain.update(delta, s, time, quality)
    let simulationMs = detailed ? performance.now() - simStart : 0
    host.dataset.rainBackend = rain.backend
    if (playing) smoothPointer.lerp(pointer, 1 - Math.exp(-Math.min(elapsed || .016, .05) * 1.5))
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
    const profileView = options.profileView?.current ?? 'scene'
    const showPane = s.glass && profileView === 'scene'
    const drawGlassFace = showPane && camera.position.z > 0
    pane.update(s)
    // A wider source view provides real scene data beyond the visible edges
    // for strongly scattered rays, without enlarging the rendering budget.
    gardenCamera.copy(camera)
    gardenCamera.fov = Math.atan(Math.tan(camera.fov * Math.PI / 360) * 1.5) * 360 / Math.PI
    gardenCamera.updateProjectionMatrix()
    glass.uniforms.uGlassView.value.copy(camera.matrixWorldInverse)
    glass.uniforms.uGardenProjection.value.copy(gardenCamera.projectionMatrix)
    glass.uniforms.uGlassViewProjection.value.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
    glass.uniforms.uGardenViewProjection.value.multiplyMatrices(gardenCamera.projectionMatrix, camera.matrixWorldInverse)
    foliage.uniforms.uRainSheen.value = s.rainWetness
    glass.uniforms.uRainWetness.value = rain.wetness
    // A passing shower softens direct sun without changing the saved grade.
    lights.sun.intensity = drySun * (1 - rain.strength * .28)
    surfaceLights.sun.intensity = drySurfaceSun * (1 - rain.strength * .2)
    foliage.uniforms.uPlantTime.value = time
    foliage.uniforms.uBreeze.value = s.breeze
    if (detailed && springFoliage) simStart = performance.now()
    springFoliage?.update(delta, s.breeze)
    if (detailed && springFoliage) simulationMs += performance.now() - simStart
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
    wire.update(s); wire.mesh.visible = showPane && s.embeddedMesh
    const interfaceTransmission = 1 - dielectricFresnel(1, 1, s.ior)
    lights.fill.intensity = composition.fill * (s.glass ? interfaceTransmission ** 2 * Math.exp(-1.02 * s.thickness) : 1)
    grading.update(s)
    renderer.toneMappingExposure = s.exposure
    if (detailed) {
      if (!drawGlassFace && options.timings) options.timings.glassGpu = undefined
      sampleGlass = drawGlassFace && !sampleGlass
      if (!sampleGlass) renderTimer.begin(now)
    }
    const renderStart = detailed ? performance.now() : 0
    try {
      if (profileView === 'meshes') {
        drawMeshes()
      } else if (drawGlassFace) {
        rain.renderWater()
        glass.uniforms.uRainWater.value = rain.surface.texture
        glass.uniforms.uRainBounds.value.copy(rain.surface.bounds)
        // Render the wire separately from the garden so its optical depth stays sharp.
        renderer.setRenderTarget(target)
        renderer.render(garden, gardenCamera)
        const background = garden.background
        try {
          if (s.embeddedMesh) {
            camera.layers.set(1)
            garden.background = null
            renderer.setClearColor(0x000000, 0)
            renderer.setRenderTarget(wireTarget)
            renderer.render(garden, camera)
          }
        } finally {
          camera.layers.set(0)
          garden.background = background
          renderer.setClearColor(options.standalone ? '#000000' : composition.background, 1)
        }
        renderer.setRenderTarget(composite)
        if (!options.standalone && composition.pane) {
          // The unfiltered garden remains visible outside the cut pane. Its
          // depth also occludes glass when orbiting behind the foliage.
          wire.mesh.visible = false
          renderer.render(garden, camera)
          renderer.autoClear = false
        }
        if (detailed && sampleGlass) glassTimer.begin(now)
        try { renderer.render(surface, camera) }
        finally {
          glassTimer.end()
          renderer.autoClear = true; wire.mesh.visible = s.embeddedMesh
        }
      } else {
        renderer.setRenderTarget(composite)
        renderer.render(garden, camera)
        if (showPane && pane.edges) {
          // Only the cut edges are visible from behind. No refraction targets.
          renderer.autoClear = false
          try { renderer.render(surface, camera) } finally { renderer.autoClear = true }
        }
      }
      if (profileView !== 'meshes') {
        drawFrontRain()
        renderer.setRenderTarget(null)
        grading.render(renderer)
      }
    } catch (reason) {
      console.error('Greenhouse rendering failed.', reason)
      renderer.setRenderTarget(null)
      failure('The greenhouse could not finish rendering. Try reloading the scene.')
      return
    } finally { renderTimer.end() }
    options.timings?.record(elapsed, simulationMs, detailed ? performance.now() - renderStart : 0)
    if (!stopped && !ready && rain.surface.ready) { ready = true; onReady() }
    if (playing && !stopped) invalidate()
    else previous = 0
  }
  const invalidate = () => {
    if (!frame && !disposed && !stopped && !document.hidden) frame = requestAnimationFrame(draw)
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
      touchPose.radius *= distanceRatio ** touchPinchGain
      orbitCamera.position.copy(touchOffset.setFromSpherical(touchPose)).add(controls.target)
      controls.update()
    }
    invalidate()
  }, options.onBrushPressed, paneSize, options.touchOrbit)
  const dispose = () => {
    if (disposed) return
    renderTimer.dispose(); glassTimer.dispose()
    disposed = true; stopped = true; cancelAnimationFrame(frame)
    if (!options.standalone) saveGlassSettings(settings.current)
    observer.disconnect()
    controls.removeEventListener('change', invalidate)
    controls.removeEventListener('start', startOrbit); controls.removeEventListener('end', endOrbit)
    waterTouch.dispose(); controls.dispose(); host.classList.remove('glass-orbiting')
    document.removeEventListener('visibilitychange', visibility)
    host.removeEventListener('pointermove', move); host.removeEventListener('pointerleave', leave)
    renderer.domElement.removeEventListener('webglcontextlost', lost)
    rain.dispose(); foliage.dispose(); springFoliage?.dispose(); architecture.dispose(); lights.dispose(); surfaceLights.dispose(); wire.dispose(); grading.dispose()
    delete host.dataset.rainBackend
    environment?.dispose(); paneEnvironment?.dispose(); target.dispose(); wireTarget.dispose(); composite.dispose()
    relief.dispose(); rearRelief.dispose(); pane.dispose(); glass.material.dispose(); meshMaterial.dispose()
    renderer.dispose(); renderer.forceContextLoss(); renderer.domElement.remove()
  }
  try {
    environment = createEnvironment(renderer)
    if (options.standalone) paneEnvironment = createEnvironment(renderer, .35)
    garden.environment = environment.texture
    surface.environment = (paneEnvironment ?? environment).texture
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
  return { invalidate, dispose, resetView, getView, setView }
}
