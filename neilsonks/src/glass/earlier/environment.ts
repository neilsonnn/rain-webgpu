import {
  BackSide, BoxGeometry, Color, CubeCamera, CylinderGeometry, DirectionalLight, Group, HalfFloatType,
  HemisphereLight, LatheGeometry, Mesh, MeshBasicMaterial, MeshStandardMaterial, PlaneGeometry,
  PMREMGenerator, Scene, Shape, ShapeGeometry, Vector2, Vector3, WebGLCubeRenderTarget,
} from 'three'
import type { WebGLRenderer } from 'three'
import { Sky } from 'three/addons/objects/Sky.js'
import { plasterTexture } from './textures'
import { arrangements } from './arrangements'
import type { SceneArrangement } from './arrangements'
import type { Arrangement } from '../presets'

const sunDirection = new Vector3(-.6, .8, -.2).normalize()

export function createEnvironment(renderer: WebGLRenderer) {
  const scene = new Scene(), sky = new Sky()
  sky.scale.setScalar(100)
  sky.material.uniforms.turbidity.value = 3.8
  sky.material.uniforms.rayleigh.value = 1.15
  sky.material.uniforms.mieCoefficient.value = .004
  sky.material.uniforms.mieDirectionalG.value = .78
  sky.material.uniforms.sunPosition.value.copy(sunDirection).multiplyScalar(100)
  scene.add(sky)
  const beamGeometry = new BoxGeometry(.075, .1, 12)
  const beamMaterial = new MeshBasicMaterial({ color: '#17241c' })
  for (let x = -6; x <= 6; x += 1.2) {
    const beam = new Mesh(beamGeometry, beamMaterial)
    beam.position.set(x, 3.6, 0); scene.add(beam)
  }
  const wallGeometry = new PlaneGeometry(7, 6)
  const wallMaterial = new MeshBasicMaterial({ color: new Color(1.65, 1.62, 1.4), side: BackSide })
  const wall = new Mesh(wallGeometry, wallMaterial)
  wall.position.set(-4, .8, 3); wall.rotation.y = -.5; scene.add(wall)
  const openingGeometry = new PlaneGeometry(5, 1.8)
  const openingMaterial = new MeshBasicMaterial({ color: new Color(12, 12.3, 11.5) })
  const opening = new Mesh(openingGeometry, openingMaterial)
  opening.position.set(-1.7, 3.4, 4.5)
  opening.lookAt(0, 1.8, 0)
  scene.add(opening)
  const cube = new WebGLCubeRenderTarget(256, { type: HalfFloatType })
  const capture = new CubeCamera(.1, 150, cube)
  capture.position.set(0, 1.8, 0)
  capture.update(renderer, scene)
  const generator = new PMREMGenerator(renderer)
  const environment = generator.fromCubemap(cube.texture)
  cube.dispose(); generator.dispose()
  sky.geometry.dispose(); sky.material.dispose()
  beamGeometry.dispose(); beamMaterial.dispose(); wallGeometry.dispose(); wallMaterial.dispose()
  openingGeometry.dispose(); openingMaterial.dispose()
  return environment
}

export function createArchitecture(arrangement: Arrangement = 'original') {
  const composition: SceneArrangement = arrangements[arrangement]
  const group = new Group(), plaster = plasterTexture()
  const wall = new MeshStandardMaterial({ color: composition.wallColor, roughness: .95, bumpMap: plaster, bumpScale: .012, map: plaster })
  const recess = new MeshStandardMaterial({ color: composition.recess, roughness: .91 })
  const steel = new MeshStandardMaterial({ color: '#26322c', roughness: .68, metalness: .45 })
  const clay = new MeshStandardMaterial({ color: '#654332', roughness: .94, bumpMap: plaster, bumpScale: .008 })
  const soil = new MeshStandardMaterial({ color: '#252c1d', roughness: 1, bumpMap: plaster, bumpScale: .02 })
  const geometries: (BoxGeometry | PlaneGeometry | LatheGeometry | CylinderGeometry | ShapeGeometry)[] = []
  const box = (width: number, height: number, depth: number, x: number, y: number, z: number, material = steel) => {
    const geometry = new BoxGeometry(width, height, depth), mesh = new Mesh(geometry, material)
    mesh.position.set(x, y, z); mesh.castShadow = mesh.receiveShadow = true
    group.add(mesh); geometries.push(geometry)
  }
  box(18, 7, .12, 0, 2.5, -3.5, recess)
  if (arrangement === 'original') box(4.5, 5.8, .18, -2.95, 2.5, -2.15, wall)
  else {
    // Interrupted, rounded pale wall patches sit behind the foliage, separated
    // by actual dark gaps rather than a white rectangle or a screen overlay.
    for (const patch of composition.patches) {
      const shape = new Shape(), points = patch.outline
      shape.moveTo((points.at(-1)![0] + points[0][0]) / 2, (points.at(-1)![1] + points[0][1]) / 2)
      points.forEach((point, i) => {
        const next = points[(i + 1) % points.length]
        shape.quadraticCurveTo(point[0], point[1], (point[0] + next[0]) / 2, (point[1] + next[1]) / 2)
      })
      shape.closePath()
      const geometry = new ShapeGeometry(shape), mesh = new Mesh(geometry, wall)
      mesh.position.set(...patch.position); mesh.receiveShadow = true
      mesh.name = 'Pale wall patch'; group.add(mesh); geometries.push(geometry)
    }
    box(composition.wallGap, 1.02, .15, -1.3, 2.04, -2.04, recess)
    soil.color.set('#071009')
  }
  box(.085, 5, .14, -.63, 2.2, -1.95)
  box(.055, 5, .12, 1.74, 2.2, -2.7)
  box(8, .07, .16, 0, .55, -2.6)
  box(8, .07, .16, 0, 3.38, -2.6)
  box(20, .1, 10, 0, -.14, -2, soil)
  for (let x = -5; x <= 5; x += 1.15) box(.06, .1, 7, x, 3.6, -1)
  const profile = [new Vector2(.13, 0), new Vector2(.15, .025), new Vector2(.215, .36), new Vector2(.23, .37), new Vector2(.23, .41), new Vector2(.205, .41), new Vector2(.20, .36)]
  const potGeometry = new LatheGeometry(profile, 36), dirtGeometry = new CylinderGeometry(.2, .2, .02, 32)
  geometries.push(potGeometry, dirtGeometry)
  for (const [x, z, scale] of arrangement === 'original' ? [[.78, -.38, 1], [-.87, -.56, .8], [1.7, -1.3, 1.3], [-.5, -.3, .7], [-2.1, -1.2, 1.2]] : []) {
    const pot = new Mesh(potGeometry, clay), dirt = new Mesh(dirtGeometry, soil)
    pot.position.set(x, -.11, z); pot.scale.setScalar(scale)
    dirt.position.set(x, -.11 + .37 * scale, z); dirt.scale.setScalar(scale)
    pot.castShadow = pot.receiveShadow = dirt.receiveShadow = true
    group.add(pot, dirt)
  }
  return {
    group,
    dispose() { geometries.forEach(geometry => geometry.dispose()); [wall, recess, steel, clay, soil].forEach(material => material.dispose()); plaster.dispose() },
  }
}

export function greenhouseLights(arrangement: Arrangement = 'original') {
  const composition: SceneArrangement = arrangements[arrangement]
  const group = new Group()
  const sun = new DirectionalLight('#fff3d5', 3.2)
  sun.target.position.set(.3, 1.4, -.8)
  sun.position.copy(sun.target.position).addScaledVector(sunDirection, 9)
  sun.castShadow = true
  sun.shadow.mapSize.set(2048, 2048)
  sun.shadow.camera.left = -5; sun.shadow.camera.right = 5
  sun.shadow.camera.top = 5; sun.shadow.camera.bottom = -5
  sun.shadow.camera.near = .1; sun.shadow.camera.far = 18
  sun.shadow.normalBias = .008; sun.shadow.bias = -.00015
  const sky = new HemisphereLight('#cddedb', '#283724', composition.skyFill)
  const fill = new DirectionalLight('#e4e6d4', composition.fill)
  fill.target.position.set(0, 1.6, -.5)
  fill.position.copy(fill.target.position).add(new Vector3(-4, 3, 4))
  fill.castShadow = true
  fill.shadow.mapSize.set(4096, 4096)
  fill.shadow.camera.left = -2.6; fill.shadow.camera.right = 2.6
  fill.shadow.camera.top = 2.6; fill.shadow.camera.bottom = -2.6
  fill.shadow.camera.near = .1; fill.shadow.camera.far = 14
  fill.shadow.normalBias = .0006; fill.shadow.bias = -.000025
  group.add(sun, sun.target, sky, fill, fill.target)
  return { group, sun, fill, dispose() { sun.shadow.dispose(); fill.shadow.dispose() } }
}
