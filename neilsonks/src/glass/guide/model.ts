import {
  BoxGeometry, BufferGeometry, CanvasTexture, ConeGeometry, CylinderGeometry, DataTexture,
  DirectionalLight, Float32BufferAttribute, Group, HemisphereLight, InstancedMesh, LineBasicMaterial,
  LineSegments, LinearFilter, LinearMipmapLinearFilter, Mesh, MeshBasicMaterial, MeshPhysicalMaterial, MeshStandardMaterial, NoColorSpace,
  Object3D, OrthographicCamera, PerspectiveCamera, PlaneGeometry, PMREMGenerator, RepeatWrapping,
  RGBAFormat, Scene, ShaderMaterial, SphereGeometry, SRGBColorSpace, Vector3,
} from 'three'
import type { Material, Texture, WebGLRenderer } from 'three'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
import { dielectricFresnel } from '../earlier/optics'
import type { ExampleKind, ExampleValues } from './examples'

function patternTexture(leaves = false) {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 256
  const ctx = canvas.getContext('2d')!
  if (!leaves) {
    const colors = ['#d4dac8', '#294c37', '#8da078', '#152b21']
    for (let x = 0; x < 256; x += 16) {
      ctx.fillStyle = colors[(x / 16) % colors.length]; ctx.fillRect(x, 0, 16, 256)
    }
    ctx.fillStyle = '#cbd6bd'; ctx.globalAlpha = .4
    for (let y = 0; y < 256; y += 32) ctx.fillRect(0, y, 256, 2)
  } else {
    ctx.fillStyle = '#0c160f'; ctx.fillRect(0, 0, 256, 256)
    ctx.strokeStyle = '#5d7950'; ctx.lineWidth = 2.5
    ctx.beginPath(); ctx.moveTo(127, 241); ctx.quadraticCurveTo(118, 138, 143, 30); ctx.stroke()
    const blades = [[128, 198, 74, -.95], [129, 165, 80, .85], [132, 129, 68, -.8], [138, 91, 64, .72], [142, 54, 44, -.2]]
    blades.forEach(([x, y, length, angle], index) => {
      ctx.save(); ctx.translate(x, y); ctx.rotate(angle)
      const gradient = ctx.createLinearGradient(-length * .4, -length * .5, length * .4, -length * .5)
      gradient.addColorStop(0, '#243e28'); gradient.addColorStop(.48, index % 2 ? '#a8bd79' : '#87b178'); gradient.addColorStop(1, '#456848')
      ctx.fillStyle = gradient; ctx.beginPath(); ctx.moveTo(0, 0)
      ctx.bezierCurveTo(-length * .45, -length * .32, -length * .26, -length * .74, 0, -length)
      ctx.bezierCurveTo(length * .35, -length * .7, length * .4, -length * .26, 0, 0); ctx.fill()
      ctx.strokeStyle = '#d3dc9b88'; ctx.lineWidth = .8; ctx.beginPath(); ctx.moveTo(0, -2); ctx.lineTo(0, -length + 4)
      for (let i = 1; i < 6; i++) {
        const y = -length * i / 7, width = Math.sin(i / 7 * Math.PI) * length * .23
        ctx.moveTo(0, y); ctx.lineTo(-width, y - length * .12); ctx.moveTo(0, y); ctx.lineTo(width, y - length * .13)
      }
      ctx.stroke(); ctx.restore()
    })
  }
  const texture = new CanvasTexture(canvas); texture.colorSpace = SRGBColorSpace
  return texture
}

function reliefTexture() {
  const size = 256, data = new Uint8Array(size * size * 4), tau = Math.PI * 2
  const height = (u: number, v: number) => Math.sin(u * tau * 9 + Math.sin(v * tau * 6) * .5) * Math.sin(v * tau * 10 + Math.cos(u * tau * 8)) * .22
    + Math.sin(u * tau * 24 + Math.sin(v * tau * 18)) * .07 + Math.sin((u + v) * tau * 5) * .15
  const epsilon = 1 / size
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / size, v = y / size, at = (y * size + x) * 4
    const nx = -(height(u + epsilon, v) - height(u - epsilon, v)) / (2 * epsilon) * .015
    const ny = -(height(u, v + epsilon) - height(u, v - epsilon)) / (2 * epsilon) * .015
    const length = Math.hypot(nx, ny, 1)
    data[at] = Math.round((nx / length * .5 + .5) * 255)
    data[at + 1] = Math.round((ny / length * .5 + .5) * 255)
    data[at + 2] = Math.round((1 / length * .5 + .5) * 255); data[at + 3] = 255
  }
  const texture = new DataTexture(data, size, size, RGBAFormat)
  texture.colorSpace = NoColorSpace; texture.wrapS = texture.wrapT = RepeatWrapping
  texture.generateMipmaps = true; texture.minFilter = LinearMipmapLinearFilter; texture.magFilter = LinearFilter; texture.needsUpdate = true
  return texture
}

export function createGuideModel(renderer: WebGLRenderer, output: Texture) {
  // One persistent scene and asset set serve every example. The small room is
  // used only to bake shared lighting, then immediately released.
  const scene = new Scene(), camera = new PerspectiveCamera(30, 2, .1, 20)
  camera.position.set(0, 0, 4.3)
  const screenCamera = new OrthographicCamera(-1, 1, 1, -1, 0, 2); screenCamera.position.z = 1
  const room = new RoomEnvironment(), pmrem = new PMREMGenerator(renderer)
  const environment = pmrem.fromScene(room, .025, .1, 50, { size: 128 })
  room.dispose(); pmrem.dispose(); scene.environment = environment.texture; scene.environmentIntensity = .9
  const geometries = new Set<BufferGeometry>(), materials = new Set<Material>()
  const stripes = patternTexture(), leaves = patternTexture(true), relief = reliefTexture()
  const textures = [stripes, leaves, relief]
  const geometry = <T extends BufferGeometry>(value: T) => { geometries.add(value); return value }
  const material = <T extends Material>(value: T) => { materials.add(value); return value }
  const stage = new Group(); scene.add(stage)
  const daylight = new HemisphereLight('#e8efdc', '#253d30', 1.1), sun = new DirectionalLight('#f1efdd', 2)
  sun.position.set(-3, 5, 4); stage.add(daylight, sun)
  const square = geometry(new PlaneGeometry(1, 1)), sphereGeometry = geometry(new SphereGeometry(.72, 48, 32))
  const cylinder = geometry(new CylinderGeometry(1, 1, 1, 10)), cone = geometry(new ConeGeometry(1, 1, 12))
  const glass = material(new MeshPhysicalMaterial({ color: '#ffffff', transmission: 1, opacity: 1, ior: 1.52,
    thickness: .12, roughness: .07, metalness: 0, normalMap: relief }))
  const steel = material(new MeshStandardMaterial({ color: '#acb3a5', metalness: 1, roughness: .26 }))
  const background = new Mesh(square, material(new MeshBasicMaterial({ map: stripes })))
  background.position.z = -.95; background.scale.set(4.5, 2.7, 1); stage.add(background)
  const pane = new Group(), slab = new Mesh(geometry(new BoxGeometry(2.7, 1.58, .12)), glass)
  pane.rotation.set(.12, -.36, -.035); pane.add(slab); stage.add(pane)
  const mesh = new InstancedMesh(cylinder, steel, 15), transform = new Object3D(); pane.add(mesh); mesh.frustumCulled = false
  function setWire(diameter: number) {
    const radius = diameter * .01 // millimetres, enlarged twenty times
    let index = 0
    for (let x = 0; x < 9; x++) {
      transform.position.set(-1.2 + x * .3, 0, radius); transform.rotation.set(0, 0, 0)
      transform.scale.set(radius, 1.5, radius); transform.updateMatrix(); mesh.setMatrixAt(index++, transform.matrix)
    }
    for (let y = 0; y < 6; y++) {
      transform.position.set(0, -.65 + y * .26, -radius); transform.rotation.set(0, 0, Math.PI * .5)
      transform.scale.set(radius, 2.6, radius); transform.updateMatrix(); mesh.setMatrixAt(index++, transform.matrix)
    }
    mesh.instanceMatrix.needsUpdate = true
  }
  const sphere = new Mesh(sphereGeometry, glass); stage.add(sphere)
  const smooth = material(new MeshStandardMaterial({ color: '#617d4f', roughness: .045, metalness: 0 }))
  const rough = material(new MeshStandardMaterial({ color: '#617d4f', roughness: .3, metalness: 0 }))
  const comparison = new Group(), left = new Mesh(sphereGeometry, smooth), right = new Mesh(sphereGeometry, rough)
  left.position.x = -.82; right.position.x = .82; left.scale.setScalar(.82); right.scale.setScalar(.82)
  comparison.add(left, right); stage.add(comparison)
  const lighting = new Mesh(sphereGeometry, rough); stage.add(lighting)

  const rayDiagram = new Group(); stage.add(rayDiagram)
  const medium = new Mesh(square, material(new MeshBasicMaterial({ color: '#24382a' })))
  medium.scale.set(4.4, 1.15, 1); medium.position.set(0, -.575, -.05); rayDiagram.add(medium)
  const boundary = new Mesh(square, material(new MeshBasicMaterial({ color: '#809b70' })))
  boundary.scale.set(4.4, .007, 1); boundary.position.z = -.02; rayDiagram.add(boundary)
  const normalPoints: number[] = []
  for (let y = -1.1; y < 1.1; y += .14) normalPoints.push(0, y, .01, 0, y + .065, .01)
  const normalGeometry = geometry(new BufferGeometry().setAttribute('position', new Float32BufferAttribute(normalPoints, 3)))
  rayDiagram.add(new LineSegments(normalGeometry, material(new LineBasicMaterial({ color: '#73836b' }))))
  const rays = ['#e8d6a3', '#f5f3df', '#a8d886'].map(color => {
    const paint = material(new MeshBasicMaterial({ color, transparent: true, depthWrite: false }))
    const line = new Mesh(cylinder, paint), head = new Mesh(cone, paint); rayDiagram.add(line, head)
    return { line, head, paint }
  })
  const direction = new Vector3(), up = new Vector3(0, 1, 0)
  function beam(index: number, x: number, y: number, incoming: boolean, weight: number) {
    const { line, head, paint } = rays[index], length = Math.hypot(x, y), radius = .006 + Math.sqrt(weight) * .01
    direction.set(x, y, 0).normalize()
    line.position.set(x * .5, y * .5, .03); line.quaternion.setFromUnitVectors(up, direction); line.scale.set(radius, length, radius)
    head.position.set(x * (incoming ? .15 : .82), y * (incoming ? .15 : .82), .03)
    if (incoming) direction.negate()
    head.quaternion.setFromUnitVectors(up, direction); head.scale.set(.035, .1, .035)
    paint.opacity = .15 + Math.sqrt(weight) * .85
  }

  const diffusion = material(new ShaderMaterial({
    uniforms: { uLeaves: { value: leaves }, uDistance: { value: .8 } },
    vertexShader: 'varying vec2 vUv; void main() { vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }',
    fragmentShader: /* glsl */`
      uniform sampler2D uLeaves;
      uniform float uDistance;
      varying vec2 vUv;
      void main() {
        vec2 p=vec2(fract(vUv.x*2.),vUv.y);
        float distance=vUv.x<.5 ? .03 : uDistance;
        float radius=distance*.13;
        vec3 color=vec3(0.); float total=0.;
        for (int y=-2;y<=2;y++) for (int x=-2;x<=2;x++) {
          vec2 q=vec2(float(x),float(y)); float weight=exp(-dot(q,q)*.45);
          color+=texture2D(uLeaves,clamp(p+q*radius*.5,vec2(.002),vec2(.998))).rgb*weight; total+=weight;
        }
        gl_FragColor=vec4(color/total,1.);
      }
    `,
  }))
  const depthStudy = new Mesh(square, diffusion); depthStudy.scale.set(4.3, 2.15, 1); stage.add(depthStudy)

  // This blit reuses the same scene, selecting a separate layer. A scratch
  // target keeps built-in transmission local to each example's viewport.
  const screen = new Mesh(geometry(new PlaneGeometry(2, 2)), material(new MeshBasicMaterial({ map: output, depthTest: false, depthWrite: false })))
  screen.layers.set(1); screenCamera.layers.set(1); screen.frustumCulled = false; scene.add(screen)
  const models = [background, pane, sphere, comparison, lighting, rayDiagram, depthStudy]
  return {
    scene, camera, screenCamera,
    prepare(kind: ExampleKind, values: ExampleValues, aspect: number) {
      for (const object of models) object.visible = false
      camera.aspect = aspect; camera.updateProjectionMatrix(); screen.visible = false
      glass.ior = 1.52; glass.thickness = .12; glass.roughness = .07; glass.normalScale.setScalar(0)
      if (kind === 'wire' || kind === 'normals') {
        background.visible = pane.visible = true; mesh.visible = kind === 'wire'
        glass.normalScale.setScalar(kind === 'wire' ? .13 : values.normals)
        if (kind === 'wire') setWire(values.wire)
      } else if (kind === 'ior') {
        background.visible = sphere.visible = true; glass.ior = values.ior; glass.thickness = 1.3; glass.roughness = .025
      } else if (kind === 'roughness') {
        comparison.visible = true; rough.roughness = values.roughness
      } else if (kind === 'fresnel') {
        rayDiagram.visible = true
        const angle = values.fresnel * Math.PI / 180, transmitted = Math.asin(Math.sin(angle) / 1.52)
        const reflected = dielectricFresnel(Math.cos(angle), 1, 1.52)
        beam(0, -Math.sin(angle) * 1.04, Math.cos(angle) * 1.04, true, 1)
        beam(1, Math.sin(angle) * 1.04, Math.cos(angle) * 1.04, false, reflected)
        beam(2, Math.sin(transmitted) * 1.04, -Math.cos(transmitted) * 1.04, false, 1 - reflected)
      } else if (kind === 'diffusion') {
        depthStudy.visible = true; diffusion.uniforms.uDistance.value = values.diffusion
      } else {
        lighting.visible = true; rough.roughness = .19
      }
    },
    showOutput() { screen.visible = true },
    dispose() {
      mesh.dispose(); environment.dispose()
      for (const value of geometries) value.dispose()
      for (const value of materials) value.dispose()
      for (const value of textures) value.dispose()
      scene.clear()
    },
  }
}
