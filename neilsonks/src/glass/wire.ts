import {
  Color, CylinderGeometry, Group, InstancedBufferAttribute, InstancedMesh, Matrix4,
  MeshDepthMaterial, MeshStandardMaterial, Quaternion, RGBADepthPacking, Vector3,
} from 'three'
import type { GlassSettings } from './settings'
import { defaults } from './settings'
import { conductorF0, dielectricFresnel, embeddedWireDepth, iron } from './optics'

export const wireVertexGLSL = /* glsl */`
attribute float wireAxis;
attribute float wirePhase;
uniform float uWireRadius;
varying vec3 vWireWorld;
vec3 wireForm(vec3 p) {
  if (wireAxis < .5) p.x += (sin(p.y * 7.1 + wirePhase) * .28 + sin(p.y * 24.7 + wirePhase * 2.3) * .065) * uWireRadius;
  else p.y += (sin(p.x * 6.3 + wirePhase) * .28 + sin(p.x * 22.1 + wirePhase * 2.3) * .065) * uWireRadius;
  return p;
}
`

export function wireMaterials() {
  const material = new MeshStandardMaterial({ metalness: 1, roughness: defaults.wireRoughness,
    color: new Color(...iron.n.map((n, i) => conductorF0(n, iron.k[i], defaults.ior)) as [number, number, number]) })
  const depth = new MeshDepthMaterial({ depthPacking: RGBADepthPacking })
  const uniforms = {
    uWireRadius: { value: defaults.wireRadius }, uWireRoughness: { value: defaults.wireRoughness },
    uWirePatina: { value: defaults.wirePatina }, uWireLightTransmission: { value: .957 },
  }
  for (const [m, beauty] of [[material, true], [depth, false]] as const) {
    m.onBeforeCompile = shader => {
      Object.assign(shader.uniforms, uniforms)
      shader.vertexShader = wireVertexGLSL + shader.vertexShader
        .replace('#include <project_vertex>', /* glsl */`
          vec4 wireWorld = modelMatrix * instanceMatrix * vec4(transformed, 1.);
          wireWorld.xyz = wireForm(wireWorld.xyz);
          vWireWorld = wireWorld.xyz;
          vec4 mvPosition = viewMatrix * wireWorld;
          gl_Position = projectionMatrix * mvPosition;
        `)
        .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\n#ifdef USE_SHADOWMAP\nworldPosition = wireWorld;\n#endif')
      if (beauty) shader.fragmentShader = /* glsl */`
        varying vec3 vWireWorld;
        uniform float uWireRoughness;
        uniform float uWirePatina;
        uniform float uWireLightTransmission;
      ` + shader.fragmentShader
        .replace('#include <roughnessmap_fragment>', /* glsl */`
          #include <roughnessmap_fragment>
          float wireOxide = .5 + .5 * sin(vWireWorld.x * 2100. + sin(vWireWorld.y * 1440.));
          float wirePitting = .5 + .5 * sin(vWireWorld.y * 9200. + vWireWorld.x * 7600.);
          roughnessFactor = clamp(uWireRoughness + uWirePatina * wireOxide * .23 + wirePitting * .025, .08, .95);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(.095, .065, .041), uWirePatina * wireOxide * .65);
        `)
        .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor *= 1. - uWirePatina * wireOxide * .8;')
        .replace('#include <opaque_fragment>', 'outgoingLight *= uWireLightTransmission;\n#include <opaque_fragment>')
    }
    m.customProgramCacheKey = () => `embedded-steel-wire-${beauty}-v4`
  }
  return { material, depth, uniforms }
}

export function createWireGrid(span = 8) {
  const group = new Group(), materials = wireMaterials()
  const capacity = Math.ceil(span / .018) + 3
  const meshes: InstancedMesh[] = []
  for (let axis = 0; axis < 2; axis++) {
    // Round, opaque wire with real cylindrical surface normals and depth.
    const geometry = new CylinderGeometry(1, 1, 1, 20, 48, true)
    geometry.setAttribute('wireAxis', new InstancedBufferAttribute(new Float32Array(capacity).fill(axis), 1))
    geometry.setAttribute('wirePhase', new InstancedBufferAttribute(Float32Array.from({ length: capacity }, (_, i) => (i * 2.399963 + axis * 1.71) % (Math.PI * 2)), 1))
    const mesh = new InstancedMesh(geometry, materials.material, capacity)
    mesh.customDepthMaterial = materials.depth
    mesh.layers.enable(1)
    mesh.castShadow = mesh.receiveShadow = true
    mesh.frustumCulled = false
    meshes.push(mesh); group.add(mesh)
  }
  const matrix = new Matrix4(), position = new Vector3(), scale = new Vector3(), rotation = new Quaternion()
  let construction = ''
  const update = (s: GlassSettings) => {
    materials.material.roughness = s.wireRoughness
    materials.uniforms.uWireRadius.value = s.wireRadius
    materials.uniforms.uWireRoughness.value = s.wireRoughness
    materials.uniforms.uWirePatina.value = s.wirePatina
    const entryF0 = dielectricFresnel(1, 1, s.ior)
    materials.uniforms.uWireLightTransmission.value = 1 - entryF0
    materials.material.color.setRGB(...iron.n.map((n, i) => conductorF0(n, iron.k[i], s.ior)) as [number, number, number])
    const key = [s.wireSpacing, s.wireRadius, s.thickness, s.wireDepth, s.relief, s.rearRelief].join('/')
    if (key === construction) return
    construction = key
    const halfCount = Math.floor(span / (2 * s.wireSpacing)), count = halfCount * 2 + 1
    const depth = embeddedWireDepth(s.thickness, s.wireRadius, s.wireDepth, s.relief, s.rearRelief)
    for (let axis = 0; axis < 2; axis++) {
      const mesh = meshes[axis]
      rotation.setFromAxisAngle(new Vector3(0, 0, 1), axis === 0 ? 0 : -Math.PI / 2)
      scale.set(s.wireRadius, span, s.wireRadius)
      for (let i = 0; i < count; i++) {
        const p = (i - halfCount) * s.wireSpacing
        // Slightly interpenetrating layers form the welded intersections.
        position.set(axis === 0 ? p : 0, axis === 0 ? 1.8 : p + 1.8,
          -depth + (axis === 0 ? 1 : -1) * s.wireRadius * .55)
        matrix.compose(position, rotation, scale)
        mesh.setMatrixAt(i, matrix)
      }
      mesh.count = count; mesh.instanceMatrix.needsUpdate = true
    }
  }
  const writeSurface = (enabled: boolean) => {
    materials.material.colorWrite = enabled; materials.material.depthWrite = enabled
  }
  return {
    group, materials, meshes, update, writeSurface,
    dispose() {
      meshes.forEach(mesh => { mesh.geometry.dispose(); mesh.dispose() })
      materials.material.dispose(); materials.depth.dispose()
    },
  }
}
