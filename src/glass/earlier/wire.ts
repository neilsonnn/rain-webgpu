import {
  InstancedBufferAttribute, InstancedMesh, Matrix4, MeshStandardMaterial,
  NoBlending, PlaneGeometry, Quaternion, Vector2, Vector3,
} from 'three'
import type { GlassSettings } from './settings'
import { conductorF0, dielectricFresnel, embeddedWireDepth, zinc } from './optics'
import { iron } from '../optics'

type Finish = 'zinc' | 'iron'

export function wireMaterials(finish: Finish = 'zinc') {
  const galvanized = finish === 'zinc'
  const material = new MeshStandardMaterial({ metalness: 1, roughness: .34, blending: NoBlending })
  const uniforms = {
    uWireRadius: { value: .00038 }, uWireResolution: { value: new Vector2(1, 1) }, uWireRoughness: { value: .34 },
    uWirePatina: { value: .3 }, uWireLightTransmission: { value: .957 },
  }
  const shape = /* glsl */`
    uniform float uWireRadius;
    varying vec4 vWireProfile;
    float wireOffset() {
      float warp = .28 * sin(vWireProfile.z) ${galvanized ? '' : '+ .065 * sin(vWireProfile.w)'};
      return vWireProfile.x - uWireRadius * vWireProfile.y * warp;
    }
  `
  material.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, uniforms)
    shader.vertexShader = `uniform float uWireRadius;
      uniform vec2 uWireResolution;
      attribute float wirePhase;
      varying vec4 vWireProfile;
      varying vec3 vWireSide, vWireFront, vWireWorld;
    ` + shader.vertexShader.replace('#include <project_vertex>', /* glsl */`
      mat4 wireMatrix = modelMatrix * instanceMatrix;
      vec4 wireCenter = wireMatrix * vec4(0., position.y, 0., 1.);
      vec4 centerView = viewMatrix * wireCenter;
      vec3 along = normalize(mat3(viewMatrix) * wireMatrix[1].xyz);
      vec3 eye = isPerspectiveMatrix(projectionMatrix) ? -centerView.xyz : vec3(0., 0., 1.);
      vec3 side = cross(along, eye);
      side *= inversesqrt(max(dot(side, side), 1e-12));
      bool vertical = abs(instanceMatrix[1].y) > abs(instanceMatrix[1].x);
      vec3 warpAxis = vertical ? vec3(1., 0., 0.) : vec3(0., 1., 0.);
      float travel = vertical ? wireCenter.y : wireCenter.x;
      float halfWidth = uWireRadius * ${galvanized ? '1.28' : '1.345'};
      // Give narrow strands enough raster coverage to shade their subpixel edge.
      halfWidth += 1.5 * abs(centerView.z) / (projectionMatrix[1][1] * uWireResolution.y);
      vWireSide = side; vWireFront = cross(side, along); vWireWorld = wireCenter.xyz;
      vWireProfile = vec4(position.x * halfWidth, dot(side, mat3(viewMatrix * modelMatrix) * warpAxis),
        travel * (vertical ? 7.1 : 6.3) + wirePhase, travel * (vertical ? 24.7 : 22.1) + wirePhase * 2.3);
      vec4 mvPosition = centerView + vec4(side * vWireProfile.x, 0.);
      gl_Position = projectionMatrix * mvPosition;
    `)
    shader.fragmentShader = shape + /* glsl */`
      varying vec3 vWireSide, vWireFront, vWireWorld;
      uniform float uWireRoughness, uWirePatina, uWireLightTransmission;
      float wireFilteredSine(float phase) {
        vec2 footprint = vec2(dFdx(phase), dFdy(phase));
        return sin(phase) * exp(-.125 * dot(footprint, footprint));
      }
    ` + shader.fragmentShader
      .replace('#include <roughnessmap_fragment>', /* glsl */`
        #include <roughnessmap_fragment>
        float offset = wireOffset();
        float pixelWidth = max(fwidth(offset), 1e-8);
        float left = max(-uWireRadius, offset - .5 * pixelWidth);
        float right = min(uWireRadius, offset + .5 * pixelWidth);
        float coverage = clamp((right - left) / pixelWidth, 0., 1.);
        if (coverage <= 0.) discard;
        float wireOxide = .5 + .5 * wireFilteredSine(vWireWorld.x * 2100. + wireFilteredSine(vWireWorld.y * 1440.));
        float pitting = .5 + .5 * wireFilteredSine(vWireWorld.y * 9200. + vWireWorld.x * 7600.);
        roughnessFactor = clamp(uWireRoughness + uWirePatina * wireOxide * ${galvanized ? '.25 + pitting * .04' : '.23 + pitting * .025'}, .08, .95);
        diffuseColor.rgb = mix(diffuseColor.rgb, ${galvanized ? 'vec3(.17, .19, .16), uWirePatina * wireOxide * .45' : 'vec3(.095, .065, .041), uWirePatina * wireOxide * .65'});
      `)
      .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>\nmetalnessFactor *= 1. - uWirePatina * wireOxide * ${galvanized ? '.35' : '.8'};`)
      .replace('#include <normal_fragment_begin>', /* glsl */`
        #include <normal_fragment_begin>
        float radial = clamp((left + right) * .5 / uWireRadius, -1., 1.);
        normal = normalize(radial * vWireSide + sqrt(max(0., 1. - radial * radial)) * vWireFront);
        nonPerturbedNormal = normal;
      `)
      .replace('#include <opaque_fragment>', /* glsl */`
        gl_FragColor = vec4(outgoingLight * uWireLightTransmission * coverage, coverage);
      `)
  }
  material.customProgramCacheKey = () => `wire-ribbon-${finish}`
  return { material, uniforms }
}

export function createWireGrid(width = 8, height = width, centerY = 1.8, finish: Finish = 'zinc') {
  const materials = wireMaterials(finish), metal = finish === 'zinc' ? zinc : iron
  const surfaceGrid = { origin: new Vector2(0, centerY), warp: { value: .00038 * .28 } }
  const capacity = Math.ceil((width + height) / .018) + 2
  const geometry = new PlaneGeometry(2, 1)
  const phases = new InstancedBufferAttribute(new Float32Array(capacity), 1)
  geometry.setAttribute('wirePhase', phases)
  const mesh = new InstancedMesh(geometry, materials.material, capacity)
  mesh.count = 0
  mesh.layers.set(1)
  mesh.frustumCulled = false
  const matrix = new Matrix4(), position = new Vector3(), scale = new Vector3(), rotation = new Quaternion()
  const zAxis = new Vector3(0, 0, 1)
  let construction = ''
  const update = (s: GlassSettings) => {
    materials.material.roughness = s.wireRoughness
    materials.uniforms.uWireRadius.value = s.wireRadius
    surfaceGrid.warp.value = s.wireRadius * .28
    materials.uniforms.uWireRoughness.value = s.wireRoughness
    materials.uniforms.uWirePatina.value = s.wirePatina
    materials.uniforms.uWireLightTransmission.value = 1 - dielectricFresnel(1, 1, s.ior)
    materials.material.color.setRGB(...metal.n.map((n, i) => conductorF0(n, metal.k[i], s.ior)) as [number, number, number])
    const key = [s.wireSpacing, s.wireRadius, s.thickness, s.wireDepth, s.relief, s.rearRelief].join('/')
    if (key === construction) return
    construction = key
    const depth = embeddedWireDepth(s.thickness, s.wireRadius, s.wireDepth, s.relief, s.rearRelief)
    let strandCount = 0
    for (let axis = 0; axis < 2; axis++) {
      const span = axis === 0 ? width : height
      const halfCount = Math.floor((span / 2 - s.wireRadius) / s.wireSpacing)
      rotation.setFromAxisAngle(zAxis, axis === 0 ? 0 : -Math.PI / 2)
      scale.set(s.wireRadius, axis === 0 ? height : width, s.wireRadius)
      // The nearer family is first, so depth testing rejects covered crossings.
      for (let i = -halfCount; i <= halfCount; i++) {
        const p = i * s.wireSpacing
        position.set(axis === 0 ? p : 0, axis === 0 ? centerY : p + centerY, -depth + (axis === 0 ? .55 : -.55) * s.wireRadius)
        mesh.setMatrixAt(strandCount, matrix.compose(position, rotation, scale))
        phases.setX(strandCount, finish === 'iron' ? ((i + halfCount) * 2.399963 + axis * 1.71) % (2 * Math.PI) : 0)
        strandCount++
      }
    }
    mesh.count = strandCount
    mesh.instanceMatrix.needsUpdate = true
    phases.needsUpdate = true
  }
  return {
    mesh, materials, update, surfaceGrid,
    dispose() { mesh.dispose(); geometry.dispose(); materials.material.dispose() },
  }
}
