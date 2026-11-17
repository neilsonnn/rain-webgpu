import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import type { MutableRefObject } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { BufferAttribute, BufferGeometry, FloatType, DataTexture, RedFormat, RGBAFormat, NearestFilter, UnsignedByteType, MeshStandardMaterial, OrthographicCamera, Vector3 } from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { CHESS_LIGHTING as lighting } from '../chess/render/appearance'
import type { CityData, TerrainData } from './data'
import { cityMaterials } from './material'
import { unusedTiles } from './localTiles'
import type { LocalMapping } from './matching'
import { breathProgress, modes } from './motion'
import type { Settings, View } from './types'

function makeTerrain(data: TerrainData) {
  const n = data.size, [xmin, xmax, zmin, zmax] = data.bounds, positions = new Float32Array(n * n * 3), indices = []
  for (let z = 0; z < n; z++) for (let x = 0; x < n; x++) {
    const i = z * n + x
    positions.set([xmin + (xmax - xmin) * x / (n - 1), Math.max(0, data.heights[i] - .025), zmin + (zmax - zmin) * z / (n - 1)], i * 3)
  }
  for (let z = 0; z < n - 1; z++) for (let x = 0; x < n - 1; x++) {
    const a = z * n + x, b = a + 1, c = a + n, d = c + 1
    if (data.landMask[z * (n - 1) + x]) indices.push(a, c, b, b, c, d)
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(positions, 3)); geometry.setIndex(indices); geometry.computeVertexNormals()
  const material = new MeshStandardMaterial({ color: '#c9c9c9', roughness: .35, metalness: .04, transparent: true, depthWrite: false })
  const uniforms = { uLift: { value: 0 } }
  material.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, uniforms)
    shader.vertexShader = 'uniform float uLift;\n' + shader.vertexShader
      .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed.y *= uLift;')
      .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\nobjectNormal.y /= max(.001, uLift);')
  }
  material.customProgramCacheKey = () => 'city-ground-v1'
  return { geometry, material, uniforms }
}

function Camera({ data, view, viewVersion, rotate }: { data: CityData; view: View; viewVersion: number; rotate: boolean }) {
  const { camera, gl, size } = useThree(), controls = useMemo(() => new OrbitControls(camera, gl.domElement), [camera, gl])
  useEffect(() => {
    controls.enableDamping = true; controls.dampingFactor = .065
    controls.minPolarAngle = .08; controls.maxPolarAngle = Math.PI / 2 - .06
    controls.minZoom = 2; controls.maxZoom = 180; controls.zoomSpeed = .9
    return () => controls.dispose()
  }, [controls])
  useEffect(() => {
    const [xmin, xmax, zmin, zmax] = data.gridBounds
    const closeDowntown = view === 'downtown'
    const fullCityDowntown = closeDowntown && data.side > 100
    const compact = data.side <= 20
    const span = fullCityDowntown ? 48 : xmax - xmin
    const target = fullCityDowntown ? new Vector3(44, 0, -25) : new Vector3((xmin + xmax) / 2, 0, (zmin + zmax) / 2)
    controls.target.copy(target)
    const offset = view === 'top' ? new Vector3(0, 180, .01) : new Vector3(120, 125, 120)
    camera.position.copy(target).add(offset)
    camera.lookAt(target)
    const frameHeight = closeDowntown ? span * (compact ? 1.25 : .72) : view === 'top' ? span * 1.15 : span * 1.32 + (compact ? 0 : 8)
    const frameWidth = closeDowntown ? span * (compact ? 2.25 : 1.05) : view === 'top' ? span * 1.15 : span * (compact ? 2.5 : 1.7)
    ;(camera as OrthographicCamera).zoom = Math.min(size.height / frameHeight, size.width / frameWidth)
    camera.updateProjectionMatrix(); controls.update()
  }, [camera, controls, data, size.width, size.height, view, viewVersion])
  useFrame(() => { controls.autoRotate = rotate; controls.autoRotateSpeed = .3; controls.update() })
  return null
}
function Scene({ data, terrain, mapping, settings, onProgress, onReady, onFailure, view, viewVersion }: {
  data: CityData; terrain: TerrainData; settings: MutableRefObject<Settings>
  mapping: LocalMapping | null
  onProgress: (p: number, fps: number) => void; onReady: () => void; onFailure: (message?: string) => void; view: View; viewVersion: number
}) {
  const land = useMemo(() => makeTerrain(terrain), [terrain])
  const groundTexture = useMemo(() => {
    const t = new DataTexture(new Float32Array(terrain.heights), terrain.size, terrain.size, RedFormat, FloatType)
    t.needsUpdate = true; return t
  }, [terrain])
  const assets = useMemo(() => cityMaterials(data, terrain.bounds, groundTexture), [data, terrain.bounds, groundTexture])
  const localTextures = useMemo(() => {
    const [width, height] = mapping?.textureSize ?? [1, 1]
    const origins = new DataTexture(mapping?.origins ?? new Float32Array(4), width, height, RGBAFormat, FloatType)
    const occupied = new DataTexture(mapping?.occupied ?? new Uint8Array(1), width, height, RedFormat, UnsignedByteType)
    // Rows may have odd byte widths for tiny datasets.
    occupied.unpackAlignment = 1
    for (const texture of [origins, occupied]) { texture.minFilter = texture.magFilter = NearestFilter; texture.needsUpdate = true }
    return { origins, occupied, width, height }
  }, [mapping])
  const blanks = useMemo(() => unusedTiles(data, assets.uniforms.uMorph, assets.uniforms.uDarkTile, groundTexture), [data, assets, groundTexture])
  const clock = useRef({ time: 0, lastPlaying: false, epoch: -1, duration: 18, dwell: 1.2, report: 0, frames: 0, seconds: 0, ready: false })
  const mesh = useRef<import('three').Mesh>(null), groundMesh = useRef<import('three').Mesh>(null), blankMesh = useRef<import('three').Mesh>(null)
  const { gl } = useThree()
  useEffect(() => {
    const lost = (event: Event) => { event.preventDefault(); onFailure() }
    gl.domElement.addEventListener('webglcontextlost', lost)
    return () => gl.domElement.removeEventListener('webglcontextlost', lost)
  }, [gl, onFailure])
  useLayoutEffect(() => {
    const previous = gl.debug.onShaderError
    gl.debug.onShaderError = (context, program, vertex, fragment) => {
      console.error('City shader compilation failed.', context.getProgramInfoLog(program), context.getShaderInfoLog(vertex), context.getShaderInfoLog(fragment))
      previous?.(context, program, vertex, fragment)
      onFailure('The city shader could not compile. Please reload the updated preview.')
    }
    return () => { gl.debug.onShaderError = previous }
  }, [gl, onFailure])
  useEffect(() => () => { assets.material.dispose(); assets.depth.dispose(); land.geometry.dispose(); land.material.dispose(); groundTexture.dispose() }, [assets, land, groundTexture])
  useEffect(() => () => { localTextures.origins.dispose(); localTextures.occupied.dispose() }, [localTextures])
  useEffect(() => () => { blanks.geometry.dispose(); blanks.material.dispose() }, [blanks])
  useFrame((_, dt) => {
    const s = settings.current, c = clock.current, step = Math.min(dt, .05)
    const useLocal = s.mode === 'flow' && s.matching === 'local'
    if (useLocal && !mapping) return
    if (s.playing) {
      if (!c.lastPlaying || c.epoch !== s.epoch || c.duration !== s.duration || c.dwell !== s.dwell) {
        // Resume an inhale from the scrubber's current point without jumping.
        let low = 0, high = s.duration / 2 + s.dwell
        for (let i = 0; i < 20; i++) { const mid = (low + high) / 2; if (breathProgress(mid, s.duration, s.dwell) < s.progress) low = mid; else high = mid }
        c.time = (low + high) / 2
      }
      c.time += step; s.progress = breathProgress(c.time, s.duration, s.dwell)
    }
    c.lastPlaying = s.playing; c.epoch = s.epoch; c.duration = s.duration; c.dwell = s.dwell
    const u = assets.uniforms
    u.uMorph.value = s.progress; u.uMode.value = modes[s.mode].index; u.uHeight.value = s.height; u.uRiseEase.value = s.riseEase; u.uTerrain.value = s.terrain
    u.uSwell.value = s.swell; u.uWave.value = s.wave; u.uGap.value = s.gap; u.uGuard.value = Number(s.guard)
    u.uLocal.value = Number(useLocal)
    u.uUnmatched.value = Number(s.unmatched === 'grow')
    u.uLocalOrigins.value = localTextures.origins; u.uLocalSize.value.set(localTextures.width, localTextures.height)
    blanks.uniforms.uOccupied.value = localTextures.occupied; blanks.uniforms.uOccupiedSize.value.set(localTextures.width, localTextures.height)
    blanks.uniforms.uTileSide.value = mapping?.side ?? 1; blanks.geometry.instanceCount = mapping ? mapping.side ** 2 : 0
    blanks.material.wireframe = s.wireframe
    if (blankMesh.current) blankMesh.current.visible = useLocal
    assets.material.wireframe = s.wireframe
    gl.shadowMap.enabled = s.shadows
    if (mesh.current) mesh.current.castShadow = s.shadows
    if (groundMesh.current) groundMesh.current.visible = s.ground && s.progress > .4
    land.uniforms.uLift.value = s.terrain * s.progress
    land.material.opacity = Math.min(1, Math.max(0, (s.progress - .4) / .35))
    c.report += dt; c.seconds += dt; c.frames++
    if (c.report > .1) { onProgress(s.progress, Math.round(c.frames / c.seconds)); c.report = 0 }
    if (c.seconds > 2) { c.seconds = 0; c.frames = 0 }
    if (!c.ready) { c.ready = true; onReady() }
  })
  return <>
    <ambientLight intensity={lighting.ambient} />
    <hemisphereLight args={[lighting.sky, lighting.ground, lighting.hemisphere]} />
    <directionalLight position={lighting.position.map(v => v * 10) as [number, number, number]} intensity={lighting.directional} castShadow
      shadow-mapSize={lighting.shadowMap} shadow-bias={lighting.bias} shadow-normalBias={lighting.normalBias}
      shadow-camera-left={-115} shadow-camera-right={115} shadow-camera-top={115} shadow-camera-bottom={-115} shadow-camera-near={.5} shadow-camera-far={550} />
    <Camera data={data} view={view} viewVersion={viewVersion} rotate={settings.current.rotate} />
    <mesh ref={mesh} geometry={data.geometry} material={assets.material} customDepthMaterial={assets.depth} castShadow receiveShadow frustumCulled={false} />
    <mesh ref={blankMesh} geometry={blanks.geometry} material={blanks.material} visible={false} receiveShadow frustumCulled={false} />
    <mesh ref={groundMesh} geometry={land.geometry} material={land.material} receiveShadow renderOrder={-1} />
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -.003, 0]} receiveShadow>
      <planeGeometry args={[1200, 1200]} /><shadowMaterial opacity={.9} toneMapped={false} depthWrite={false} />
    </mesh>
  </>
}
export default function World(props: Parameters<typeof Scene>[0] & { visible: boolean }) {
  return <Canvas orthographic shadows frameloop={props.visible ? 'always' : 'never'} dpr={[1, 1.5]}
    camera={{ position: [120, 125, 120], zoom: 4, near: .1, far: 1000 }} gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}>
    <Scene {...props} />
  </Canvas>
}
