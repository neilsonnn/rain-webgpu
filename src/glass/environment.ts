import {
  BoxGeometry, Color, CubeCamera, DirectionalLight, DoubleSide, Group, HalfFloatType,
  HemisphereLight, Mesh, MeshBasicMaterial, MeshStandardMaterial, PlaneGeometry,
  PMREMGenerator, Scene, Vector3, WebGLCubeRenderTarget,
} from 'three'
import type { WebGLRenderer } from 'three'
import { Sky } from 'three/addons/objects/Sky.js'
import type { GlassSettings } from './settings'

const sunDirection = new Vector3(-.62, .78, .28).normalize()

export function createEnvironment(renderer: WebGLRenderer) {
  const scene = new Scene(), sky = new Sky()
  sky.scale.setScalar(100)
  sky.material.uniforms.turbidity.value = 3.8
  sky.material.uniforms.rayleigh.value = 1.15
  sky.material.uniforms.mieCoefficient.value = .004
  sky.material.uniforms.mieDirectionalG.value = .78
  sky.material.uniforms.sunPosition.value.copy(sunDirection).multiplyScalar(100)
  scene.add(sky)
  // The camera is in shade, looking into a sunlit greenhouse. A dark near-side
  // enclosure with bright slits gives textured glass glints without making
  // every front-facing facet reflect an evenly bright sky.
  const beamGeometry = new BoxGeometry(.075, .1, 12)
  const beamMaterial = new MeshBasicMaterial({ color: '#17241c' })
  for (let x = -6; x <= 6; x += 1.2) {
    const beam = new Mesh(beamGeometry, beamMaterial)
    beam.position.set(x, 3.6, 0); scene.add(beam)
  }
  const shadeGeometry = new PlaneGeometry(18, 12)
  const shadeMaterial = new MeshBasicMaterial({ color: new Color(.004, .006, .005), side: DoubleSide })
  for (const position of [new Vector3(0, 1.8, 4.9), new Vector3(-5, 1.8, 0), new Vector3(5, 1.8, 0), new Vector3(0, -.6, 0)]) {
    const shade = new Mesh(shadeGeometry, shadeMaterial)
    shade.position.copy(position); shade.lookAt(0, 1.8, 0); scene.add(shade)
  }
  const openingMaterial = new MeshBasicMaterial({ color: new Color(18, 18.8, 17), side: DoubleSide })
  const openings = [
    { size: [4.7, .32], position: new Vector3(-.65, 2.5, 4.55) },
    { size: [.14, 3.8], position: new Vector3(1.55, 2.2, 4.5) },
    { size: [3.2, .16], position: new Vector3(-1.4, 3.55, 3.4) },
  ].map(({ size, position }) => {
    const geometry = new PlaneGeometry(size[0], size[1]), opening = new Mesh(geometry, openingMaterial)
    opening.position.copy(position); opening.lookAt(0, 1.8, 0); scene.add(opening)
    return geometry
  })
  const mullionGeometry = new BoxGeometry(.035, .4, .06)
  for (const x of [-2.15, -.8, .6]) {
    const mullion = new Mesh(mullionGeometry, beamMaterial)
    mullion.position.set(x, 2.5, 4.4); scene.add(mullion)
  }
  const cube = new WebGLCubeRenderTarget(512, { type: HalfFloatType })
  const capture = new CubeCamera(.1, 150, cube)
  capture.position.set(0, 1.8, 0)
  capture.update(renderer, scene)
  const generator = new PMREMGenerator(renderer)
  const environment = generator.fromCubemap(cube.texture)
  cube.dispose(); generator.dispose()
  sky.geometry.dispose(); sky.material.dispose()
  beamGeometry.dispose(); beamMaterial.dispose(); shadeGeometry.dispose(); shadeMaterial.dispose()
  openings.forEach(geometry => geometry.dispose()); openingMaterial.dispose(); mullionGeometry.dispose()
  return environment
}

export function createArchitecture() {
  const group = new Group()
  const recess = new MeshStandardMaterial({ color: new Color(.0024, .0034, .0028), roughness: .98, envMapIntensity: .18 })
  const geometries: BoxGeometry[] = []
  const box = (width: number, height: number, depth: number, x: number, y: number, z: number) => {
    const geometry = new BoxGeometry(width, height, depth), mesh = new Mesh(geometry, recess)
    mesh.position.set(x, y, z); mesh.castShadow = mesh.receiveShadow = true
    group.add(mesh); geometries.push(geometry)
  }
  // Only a dark light-blocking recess remains behind the foliage.
  box(18, 7, .12, 0, 2.5, -4.5)
  box(.1, 5.5, 3.5, -2.5, 2, -3)
  box(.1, 5.5, 3.5, 2.5, 2, -3)
  box(5, .16, 2.8, 0, 3.7, -3)
  return {
    group,
    update(settings: GlassSettings) { recess.color.setRGB(.012, .017, .014).multiplyScalar(settings.recessBrightness) },
    dispose() { geometries.forEach(geometry => geometry.dispose()); recess.dispose() },
  }
}

export function greenhouseLights() {
  const group = new Group()
  // Strong directional light and restrained sky fill keep leaf highlights
  // luminous without lifting the shaded opening behind them.
  const sun = new DirectionalLight('#fff5dc', 3.8)
  sun.target.position.set(.3, 1.4, -.8)
  sun.position.copy(sun.target.position).addScaledVector(sunDirection, 9)
  const sky = new HemisphereLight('#d3dfdc', '#18221b', .18)
  const fill = new DirectionalLight('#f0efdf', 2)
  fill.target.position.set(0, 1.6, -.5)
  fill.position.copy(fill.target.position).add(new Vector3(-4, 3, 4))
  group.add(sun, sun.target, sky, fill, fill.target)
  return { group, sun, fill, sky, dispose() { sun.dispose(); fill.dispose() } }
}
