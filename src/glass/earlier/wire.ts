import {
  Color, CylinderGeometry, Group, InstancedBufferAttribute, InstancedMesh, Matrix4,
  MeshDepthMaterial, MeshStandardMaterial, Quaternion, RGBADepthPacking, Vector2, Vector3,
} from 'three'
import type { GlassSettings } from './settings'
import { conductorF0, dielectricFresnel, embeddedWireDepth, zinc } from './optics'

export const wireVertexGLSL = /* glsl */`
attribute float wireAxis;
uniform float uWireRadius;
uniform vec2 uWireResolution;
varying vec3 vWireWorld;
varying float vWireCoverage;
vec3 wireForm(vec3 p) {
  if (wireAxis < .5) p.x += sin(p.y * 7.1) * uWireRadius * .28;
  else p.y += sin(p.x * 6.3) * uWireRadius * .28;
  return p;
}
`

export function wireMaterials() {
  // The wire buffer stores premultiplied pixel coverage. Resolved cylinders
  // remain opaque; subpixel cylinders retain their integrated color/coverage.
  const material = new MeshStandardMaterial({ metalness: 1, roughness: .34, color: new Color(.66, .67, .67), transparent: true, depthWrite: true })
  const depth = new MeshDepthMaterial({ depthPacking: RGBADepthPacking })
  const uniforms = {
    uWireRadius: { value: .00038 }, uWireResolution: { value: new Vector2(1, 1) }, uWireRoughness: { value: .34 },
    uWirePatina: { value: .3 }, uWireLightTransmission: { value: .957 },
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
          ${beauty ? /* glsl */`
            // Rasterize a minimum 1.5-pixel footprint, conserving the actual
            // strand's projected coverage. Only screen XY expands: physical
            // depth, metal normals and the shadow geometry are unchanged.
            vec4 wireCenter = modelMatrix * instanceMatrix * vec4(0., position.y, 0., 1.);
            wireCenter.xyz = wireForm(wireCenter.xyz);
            vec4 centerClip = projectionMatrix * viewMatrix * wireCenter;
            float radiusPixels = uWireRadius * abs(projectionMatrix[1][1]) * uWireResolution.y * .5 / max(.001, -mvPosition.z);
            float expansion = max(1., .75 / max(.00001, radiusPixels));
            gl_Position.xy += (gl_Position.xy - centerClip.xy * gl_Position.w / max(.001, centerClip.w)) * (expansion - 1.);
            vWireCoverage = 1. / expansion;
          ` : ''}
        `)
        .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\n#ifdef USE_SHADOWMAP\nworldPosition = wireWorld;\n#endif')
      if (beauty) shader.fragmentShader = /* glsl */`
        varying vec3 vWireWorld;
        varying float vWireCoverage;
        uniform float uWireRoughness;
        uniform float uWirePatina;
        uniform float uWireLightTransmission;
        float wireFilteredSine(float phase) {
          vec2 footprint = vec2(dFdx(phase), dFdy(phase));
          return sin(phase) * exp(-.125 * dot(footprint, footprint));
        }
      ` + shader.fragmentShader
        .replace('#include <roughnessmap_fragment>', /* glsl */`
          #include <roughnessmap_fragment>
          float wireOxide = .5 + .5 * wireFilteredSine(vWireWorld.x * 2100. + wireFilteredSine(vWireWorld.y * 1440.));
          float wirePitting = .5 + .5 * wireFilteredSine(vWireWorld.y * 9200. + vWireWorld.x * 7600.);
          roughnessFactor = clamp(uWireRoughness + uWirePatina * wireOxide * .25 + wirePitting * .04, .08, .95);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(.17, .19, .16), uWirePatina * wireOxide * .45);
        `)
        .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor *= 1. - uWirePatina * wireOxide * .35;')
        .replace('#include <opaque_fragment>', 'outgoingLight *= uWireLightTransmission;\ndiffuseColor.a *= vWireCoverage;\n#include <opaque_fragment>')
    }
    m.customProgramCacheKey = () => `embedded-zinc-wire-${beauty}-v3-filtered-coverage`
  }
  return { material, depth, uniforms }
}

export function createWireGrid(width = 8, height = width, centerY = 1.8) {
  const group = new Group(), materials = wireMaterials()
  const surfaceGrid = { origin: new Vector2(0, centerY), warp: { value: .00038 * .28 } }
  const capacity = Math.ceil(Math.max(width, height) / .018) + 3
  const meshes: InstancedMesh[] = []
  for (let axis = 0; axis < 2; axis++) {
    // Round, opaque wire with real cylindrical surface normals and depth.
    const geometry = new CylinderGeometry(1, 1, 1, 12, 48, true)
    geometry.setAttribute('wireAxis', new InstancedBufferAttribute(new Float32Array(capacity).fill(axis), 1))
    const mesh = new InstancedMesh(geometry, materials.material, capacity)
    mesh.customDepthMaterial = materials.depth
    mesh.layers.enable(1)
    let strandCount = 0
    mesh.onBeforeRender = (_renderer, _scene, camera) => {
      strandCount = mesh.count
      if (!camera.layers.isEnabled(1)) mesh.count = 0
    }
    mesh.onAfterRender = () => { mesh.count = strandCount }
    mesh.castShadow = mesh.receiveShadow = true
    mesh.frustumCulled = false
    meshes.push(mesh); group.add(mesh)
  }
  const matrix = new Matrix4(), position = new Vector3(), scale = new Vector3(), rotation = new Quaternion()
  let construction = ''
  const update = (s: GlassSettings) => {
    materials.material.roughness = s.wireRoughness
    materials.uniforms.uWireRadius.value = s.wireRadius
    surfaceGrid.warp.value = s.wireRadius * .28
    materials.uniforms.uWireRoughness.value = s.wireRoughness
    materials.uniforms.uWirePatina.value = s.wirePatina
    const entryF0 = dielectricFresnel(1, 1, s.ior)
    materials.uniforms.uWireLightTransmission.value = 1 - entryF0
    materials.material.color.setRGB(...zinc.n.map((n, i) => conductorF0(n, zinc.k[i], s.ior)) as [number, number, number])
    const key = [s.wireSpacing, s.wireRadius, s.thickness, s.wireDepth, s.relief, s.rearRelief].join('/')
    if (key === construction) return
    construction = key
    const depth = embeddedWireDepth(s.thickness, s.wireRadius, s.wireDepth, s.relief, s.rearRelief)
    for (let axis = 0; axis < 2; axis++) {
      const mesh = meshes[axis]
      const halfCount = Math.floor(((axis === 0 ? width : height) - 2 * s.wireRadius) / (2 * s.wireSpacing)), count = halfCount * 2 + 1
      rotation.setFromAxisAngle(new Vector3(0, 0, 1), axis === 0 ? 0 : -Math.PI / 2)
      scale.set(s.wireRadius, axis === 0 ? height : width, s.wireRadius)
      for (let i = 0; i < count; i++) {
        const p = (i - halfCount) * s.wireSpacing
        // Slightly interpenetrating layers form the welded intersections.
        position.set(axis === 0 ? p : 0, axis === 0 ? centerY : p + centerY,
          -depth + (axis === 0 ? 1 : -1) * s.wireRadius * .55)
        matrix.compose(position, rotation, scale)
        mesh.setMatrixAt(i, matrix)
      }
      mesh.count = count; mesh.instanceMatrix.needsUpdate = true
    }
  }
  return {
    group, materials, meshes, update, surfaceGrid,
    dispose() {
      meshes.forEach(mesh => { mesh.geometry.dispose(); mesh.dispose() })
      materials.material.dispose(); materials.depth.dispose()
    },
  }
}
