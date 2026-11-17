import {
  BoxGeometry, Color, CylinderGeometry, DoubleSide, Group, InstancedMesh, LatheGeometry,
  Mesh, MeshPhysicalMaterial, MeshStandardMaterial, Object3D, TorusGeometry, Vector2, Vector3,
} from 'three'
import type { BufferGeometry, Material } from 'three'
import type { GlassSettings } from '../../settings'
import type { StormCollider } from './colliders'
import { random } from '../../settings'

type EmitDrip = (point: Vector3, velocity: Vector3, diameter: number) => void

// A small suspended assemblage: an open cup, a folded tab and a shallow bowl.
// Their collider frames follow the same pendulums as their visible geometry.
export function createRainHanging() {
  const group = new Group(), suspension = new Group(), geometries = new Set<BufferGeometry>(), materials = new Set<Material>()
  const rng = random(842119), local = new Vector3(), impulse = new Vector3(), dripPoint = new Vector3(), dripVelocity = new Vector3()
  const metal = new MeshPhysicalMaterial({ color: '#a7a69b', metalness: .94, roughness: .32, clearcoat: .5, clearcoatRoughness: .22, side: DoubleSide })
  const darkMetal = new MeshStandardMaterial({ color: '#333b35', metalness: .85, roughness: .42 })
  const chainMetal = new MeshPhysicalMaterial({ color: '#62645a', metalness: .9, roughness: .36, clearcoat: .85, clearcoatRoughness: .18 })
  const film = new MeshPhysicalMaterial({ color: '#a2b3a6', metalness: .08, roughness: .2, clearcoat: 1, clearcoatRoughness: .16,
    transparent: true, opacity: .6, depthWrite: false, side: DoubleSide, envMapIntensity: 1.3 })
  for (const material of [metal, darkMetal, chainMetal, film]) materials.add(material)
  const uniforms = { uChainTime: { value: 0 }, uChainFlow: { value: 0 } }
  film.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, uniforms)
    const declarations = 'uniform float uChainTime; uniform float uChainFlow; varying vec2 vChainCoord;\n'
    shader.vertexShader = declarations + shader.vertexShader.replace('#include <begin_vertex>', `
      #include <begin_vertex>
      vChainCoord=vec2(uv.x,position.y);
      float packets=pow(.5+.5*sin(position.y*19.+uChainTime*8.+sin(uv.x*25.13)*1.8),5.);
      transformed.xz*=.72+packets*.38*uChainFlow;
    `)
    shader.fragmentShader = declarations + shader.fragmentShader
      .replace('#include <color_fragment>', `
        #include <color_fragment>
        float around=vChainCoord.x*6.2831853;
        float running=vChainCoord.y*23.+uChainTime*(7.+uChainFlow*6.);
        float threads=.5+.5*sin(around*4.+sin(running*.29+around)*.8);
        float bulges=pow(.5+.5*sin(running+sin(around*3.)*2.),7.);
        float links=.5+.5*cos(vChainCoord.y*114.24);
        float water=smoothstep(.51,.9,threads)*(.28+bulges*.65)+bulges*.25*links;
        diffuseColor.a*=clamp(uChainFlow,0.,1.)*water;
        diffuseColor.rgb*=.65+bulges*.35;
      `)
      .replace('#include <normal_fragment_maps>', `
        #include <normal_fragment_maps>
        normal=normalize(normal+vec3(-dFdx(water),-dFdy(water),0.)*.14);
      `)
  }
  film.customProgramCacheKey = () => 'rain-chain-runnels-v1'

  function mesh(geometry: BufferGeometry, material: Material, parent: Group, x = 0, y = 0, z = 0) {
    geometries.add(geometry)
    const object = new Mesh(geometry, material); object.position.set(x, y, z)
    object.castShadow = object.receiveShadow = true; parent.add(object); return object
  }
  function cord(parent: Group, length: number, x: number, top: number, z: number) {
    return mesh(new CylinderGeometry(.0014, .0014, length, 5), darkMetal, parent, x, top - length * .5, z)
  }
  const cupProfile = [new Vector2(0, -.085), new Vector2(.062, -.085), new Vector2(.067, -.074),
    new Vector2(.087, .073), new Vector2(.088, .083), new Vector2(.083, .086),
    new Vector2(.081, .074), new Vector2(.061, -.069), new Vector2(0, -.069)]
  const cup = new LatheGeometry(cupProfile, 32)
  const bowl = new LatheGeometry([new Vector2(0, -.035), new Vector2(.046, -.025), new Vector2(.065, .008),
    new Vector2(.063, .013), new Vector2(.041, -.019), new Vector2(0, -.025)], 28)
  const plate = new BoxGeometry(.115, .235, .003)
  const bodyGeometries = [cup, plate, bowl], radii = [.088, .065, .065], halfHeights = [.085, .118, .035]
  const mounts = [[-.19, -1.02, 0, .3], [.205, -1.02, -.025, .46], [.015, -1.02, .02, .81]]
  suspension.position.set(-.23, 3.67, -.88); group.add(suspension)
  cord(suspension, 1.02, 0, 0, 0)
  mesh(new BoxGeometry(.48, .012, .012), metal, suspension, 0, -1.02)
  mesh(new TorusGeometry(.019, .003, 6, 16), darkMetal, group, -.23, 3.67, -.88)
  const bodies = mounts.map(([x, y, z, length], index) => {
    const pivot = new Group(), shell = new Group(); pivot.position.set(x, y, z); suspension.add(pivot)
    cord(pivot, length, 0, 0, 0); shell.position.y = -length; pivot.add(shell)
    mesh(bodyGeometries[index], metal, shell)
    if (index === 1) shell.rotation.y = -.35
    else {
      const rim = mesh(new TorusGeometry(radii[index] - .003, .0023, 7, 32), metal, shell, 0, index === 0 ? .08 : .009)
      rim.rotation.x = Math.PI * .5
    }
    return { pivot, shell, length, x: 0, z: 0, vx: 0, vz: 0, spin: 0, spinVelocity: 0 }
  })
  const colliders: StormCollider[] = [], bindings: { body: number; center: Vector3; normal: Vector3; across: Vector3; along: Vector3 }[] = []
  function collider(body: number, center: Vector3, normal: Vector3, across: Vector3, along: Vector3, width: number, height: number) {
    colliders.push({ center: new Vector3(), normal: new Vector3(), across: new Vector3(), along: new Vector3(), width, height })
    bindings.push({ body, center, normal, across, along })
  }
  bodies.forEach((_, i) => {
    collider(i, new Vector3(0, halfHeights[i], 0), new Vector3(0, 1, 0), new Vector3(1, 0, 0), new Vector3(0, 0, 1), radii[i], i === 1 ? .003 : radii[i])
    collider(i, new Vector3(0, 0, i === 1 ? .003 : radii[i] * .65), new Vector3(0, 0, 1), new Vector3(1, 0, 0), new Vector3(0, 1, 0), radii[i], halfHeights[i])
    collider(i, new Vector3(i === 1 ? .0575 : radii[i] * .65, 0, 0), new Vector3(1, 0, 0), new Vector3(0, 0, 1), new Vector3(0, 1, 0), i === 1 ? .003 : radii[i], halfHeights[i])
  })

  const chains = [new Group(), new Group()], chainLength = 4.2, linkPitch = .055
  const linkGeometry = new TorusGeometry(.022, .0038, 7, 18), filmGeometry = new CylinderGeometry(.035, .035, chainLength, 12, 96, true)
  geometries.add(linkGeometry); geometries.add(filmGeometry)
  const transform = new Object3D(), color = new Color(), chainMeshes: InstancedMesh[] = [], films: Mesh[] = []
  chains.forEach((chain, index) => {
    chain.position.set(1.47 + index * .155, 3.7, -1.2 - index * .18); group.add(chain)
    const count = Math.ceil(chainLength / linkPitch), links = new InstancedMesh(linkGeometry, chainMetal, count)
    links.castShadow = links.receiveShadow = true; chain.add(links); chainMeshes.push(links)
    for (let i = 0; i < count; i++) {
      transform.position.set(Math.sin(i * 1.7 + index) * .002, -i * linkPitch, 0)
      transform.rotation.set(0, (i % 2) * Math.PI * .5 + .18, Math.sin(i * 2.3) * .07)
      transform.scale.set(1, 1.65, 1); transform.updateMatrix(); links.setMatrixAt(i, transform.matrix)
      color.setHSL(.13 + rng() * .025, .05 + rng() * .06, .6 + rng() * .3); links.setColorAt(i, color)
    }
    const flowing = mesh(filmGeometry, film, chain, 0, -chainLength * .5)
    flowing.castShadow = false; flowing.renderOrder = 1; films.push(flowing)
    const outlet = mesh(new CylinderGeometry(.07, .027, .14, 20, 1, true), darkMetal, chain, 0, .07)
    outlet.rotation.z = -.07
  })
  mesh(new BoxGeometry(.6, .1, .16), darkMetal, group, 1.54, 3.9, -1.31)
  let wet = 0, dripHazard = 0, nextDrip = .5, rootX = 0, rootZ = 0, rootVX = 0, rootVZ = 0

  function updateFrames() {
    group.updateMatrixWorld(true)
    bindings.forEach((binding, index) => {
      const matrix = bodies[binding.body].shell.matrixWorld, value = colliders[index]
      value.center.copy(binding.center).applyMatrix4(matrix)
      value.normal.copy(binding.normal).transformDirection(matrix)
      value.across.copy(binding.across).transformDirection(matrix)
      value.along.copy(binding.along).transformDirection(matrix)
    })
  }
  updateFrames()
  return {
    group, colliders,
    hit(index: number, point: Vector3, velocity: Vector3, diameter: number) {
      const binding = bindings[index]; if (!binding) return
      const body = bodies[binding.body], force = Math.min(.35, diameter ** 3 * 1e6 * velocity.length() * .015)
      local.copy(point); body.shell.worldToLocal(local)
      impulse.copy(velocity).normalize().multiplyScalar(force)
      body.vz -= impulse.x / Math.max(.2, body.length); body.vx += impulse.z / Math.max(.2, body.length)
      body.spinVelocity += (local.x * velocity.z - local.z * velocity.x) * force * 15
      rootVZ -= impulse.x * .12; rootVX += impulse.z * .12
    },
    update(dt: number, time: number, settings: GlassSettings, strength: number, emit: EmitDrip) {
      wet += ((settings.rain ? strength * settings.rainChainFlow : 0) - wet) * (1 - Math.exp(-dt * .75))
      uniforms.uChainTime.value = time; uniforms.uChainFlow.value = wet
      films.forEach(value => { value.visible = wet > .002 })
      const gust = Math.sin(time * .71 + Math.sin(time * 1.13)) * .6 + Math.sin(time * 1.89) * .4
      const wind = settings.rainWind * settings.rainWindStrength * strength * (1 + gust * .65)
      const h = dt / Math.max(1, Math.ceil(dt * 120))
      for (let t = 0; t < dt - 1e-8; t += h) {
        rootVX += (-rootX * 10 - rootVX * .65 - strength * .022 * (1 + gust)) * h
        rootVZ += (-rootZ * 10 - rootVZ * .65 - wind * .1) * h
        rootX = Math.max(-.16, Math.min(.16, rootX + rootVX * h)); rootZ = Math.max(-.16, Math.min(.16, rootZ + rootVZ * h))
        for (const body of bodies) {
          const gravity = 9.81 / body.length
          body.vx += (-gravity * Math.sin(body.x) - body.vx * .9 - strength * .035) * h
          body.vz += (-gravity * Math.sin(body.z) - body.vz * .9 - wind * .08) * h
          body.x = Math.max(-.35, Math.min(.35, body.x + body.vx * h)); body.z = Math.max(-.35, Math.min(.35, body.z + body.vz * h))
          body.spinVelocity += (-body.spin * .8 - body.spinVelocity * .7) * h; body.spin += body.spinVelocity * h
          body.pivot.rotation.set(body.x, body.spin, body.z)
        }
      }
      suspension.rotation.set(rootX, 0, rootZ)
      chains.forEach((chain, i) => { chain.rotation.z = wind * .009 + Math.sin(time * 1.6 + i * 1.3) * wet * .006 })
      updateFrames()
      dripHazard += wet * (32 + 58 * strength) * dt
      let emitted = 0
      while (dripHazard > nextDrip && emitted++ < 24) {
        dripHazard -= nextDrip; nextDrip = -Math.log(Math.max(.0001, rng()))
        const chain = chains[rng() < .6 ? 0 : 1], y = -Math.floor(rng() * (chainLength / linkPitch)) * linkPitch
        const angle = rng() * Math.PI * 2
        dripPoint.set(Math.cos(angle) * .029, y, Math.sin(angle) * .029).applyMatrix4(chain.matrixWorld)
        dripVelocity.set(wind * .2 + Math.cos(angle) * (.08 + wet * .18), -(.5 + rng() * 1.8) * (1 + wet), Math.sin(angle) * .15)
        emit(dripPoint, dripVelocity, (.002 + rng() ** 2 * .005) * Math.max(1, settings.rainDropSize / 2))
      }
      metal.clearcoat = .4 + Math.min(1, wet) * .5
    },
    dispose() {
      for (const value of chainMeshes) value.dispose()
      for (const geometry of geometries) geometry.dispose()
      for (const material of materials) material.dispose()
      group.clear()
    },
  }
}
