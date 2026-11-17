import {
  BufferAttribute, BufferGeometry, CatmullRomCurve3, Color, DoubleSide, DynamicDrawUsage, Group, InstancedBufferAttribute,
  InstancedMesh, Matrix4, Mesh, MeshDepthMaterial, MeshStandardMaterial, Quaternion, RGBADepthPacking,
  TubeGeometry, Vector2, Vector3, Vector4,
} from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { leafTextures } from './textures'
import { random } from './settings'
import { branchMotionGLSL, createPlantDynamics, MAX_PLANTS, motionLimits } from './dynamics'
import type { BladeBinding, PlantBody } from './dynamics'

export interface Leaf {
  position: Vector3
  direction: Vector3
  length: number
  width: number
  twist: number
  phase: number
  age: number
  species: number
  plant: number
}
export interface Stem { points: Vector3[]; radius: number; plant: number }
export interface PlantForm {
  lean?: Vector3
  nodes?: number
  branches?: number
  paired?: boolean
  leafScale?: number
  branchBias?: number
  senescence?: number
  leafStart?: number
  branchStart?: number
  branchEnd?: number
  branchNodes?: number
}

export function leafGeometry(species = 0, rows = 24, columns = 8) {
  const positions: number[] = [], uv: number[] = [], indices: number[] = []
  for (let row = 0; row <= rows; row++) {
    const t = row / rows
    const profile = Math.max(0, Math.sin(Math.PI * (species === 2 ? Math.pow(t, .72) : t)))
    const silhouette = Math.pow(profile, species === 1 ? .92 : .7)
      * [ .44, .28, .49, .19 ][species] * (1 - t * (species === 2 ? .12 : .28))
    for (let column = 0; column <= columns; column++) {
      const s = column / columns * 2 - 1
      const serration = 1 + (species === 3 ? .045 : .019) * Math.sin(t * Math.PI * 46)
      const x = s * silhouette * serration * (1 + s * .035 * Math.sin(t * 11))
      const fold = .062 * (1 - Math.abs(s)) * Math.sin(Math.PI * t)
      const cup = -(species === 2 ? .11 : .07) * s * s * Math.sin(Math.PI * t)
      const tip = -(species === 1 ? .2 : .12) * t * t * t
        + .023 * Math.sin(t * 9 + s * 2) * Math.sin(Math.PI * t)
      positions.push(x, t, fold + cup + tip)
      uv.push(column / columns, t)
      if (row < rows && column < columns) {
        const a = row * (columns + 1) + column, b = a + columns + 1
        indices.push(a, a + 1, b, a + 1, b + 1, b)
      }
    }
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3))
  geometry.setAttribute('uv', new BufferAttribute(new Float32Array(uv), 2))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  return geometry
}

// Irregular internodes, decussate pairs or spiral phyllotaxis, and lateral shoots
// give each plant a skeleton rather than distributing loose leaves in a volume.
export function growPlant(seed: number, root: Vector3, height: number, spread: number, species = 0, form: PlantForm = {}) {
  const rng = random(seed), leaves: Leaf[] = [], stems: Stem[] = []
  const shoot = (base: Vector3, rise: number, lean: Vector3, level: number) => {
    const count = level === 0 ? form.nodes ?? 16 : form.branchNodes ?? 8, phase = rng() * Math.PI * 2
    const points: Vector3[] = []
    for (let i = 0; i <= count; i++) {
      const t = i === 0 || i === count ? i / count : (i + (rng() - .5) * .48) / count
      const arch = Math.sin(Math.PI * t)
      points.push(base.clone().add(new Vector3(
        lean.x * t + arch * Math.sin(phase) * spread * .12 + Math.sin(t * 7 + phase) * .018 * t,
        rise * (t - (level === 0 ? .025 : .1) * arch),
        lean.z * t + arch * Math.cos(phase) * spread * .09,
      )))
    }
    stems.push({ points, radius: level === 0 ? .0042 : .0021, plant: 0 })
    for (let i = level === 0 ? Math.max(2, Math.ceil(count * (form.leafStart ?? 0))) : 1; i <= count; i++) {
      const p = points[i], t = i / count, pairs = form.paired ? 2 : 1
      const azimuth = phase + i * (form.paired ? Math.PI / 2 : 2.399963)
      for (let pair = 0; pair < pairs; pair++) {
        const angle = azimuth + pair * Math.PI + (rng() - .5) * .38
        const radial = new Vector3(Math.cos(angle), 0, Math.sin(angle) * .62).normalize()
        const petioleEnd = p.clone().addScaledVector(radial, .035 + rng() * .065)
        petioleEnd.y += .012 + rng() * .035
        stems.push({ points: [p.clone(), p.clone().lerp(petioleEnd, .5).add(new Vector3(0, .014, 0)), petioleEnd], radius: .0011, plant: 0 })
        const droop = rng() < .24 ? -.65 : 0
        const direction = radial.clone().multiplyScalar(.8 + rng() * .35)
          .add(new Vector3(0, .12 + t * .45 + (rng() - .5) * .65 + droop, (rng() - .4) * .25)).normalize()
        const age = rng() < (form.senescence ?? .025) ? rng() * .05 : .16 + rng() * .84
        leaves.push({
          position: petioleEnd, direction,
          length: Math.max(.115, (.19 + rng() * .16) * (form.leafScale ?? 1)
            * (level === 0 ? 1 : .86) * (.65 + .4 * Math.sin(Math.PI * t * .92))),
          width: .72 + rng() * .46,
          twist: (rng() - .5) * 2.65,
          phase: rng() * Math.PI * 2,
          age, species: species === 0 && age > .78 ? 2 : species, plant: 0,
        })
      }
    }
    if (level > 0) return
    const branches = form.branches ?? 3
    for (let branch = 0; branch < branches; branch++) {
      const start = form.branchStart ?? .29, end = form.branchEnd ?? .78
      const t = start + (end - start) * branch / Math.max(1, branches - 1) + (rng() - .5) * .06
      const node = Math.max(2, Math.min(count - 1, Math.round(t * count)))
      const angle = phase + branch * 2.399963
      const radial = new Vector3(Math.cos(angle) + (form.branchBias ?? 0), 0, Math.sin(angle) * .48).normalize()
      const reach = spread * (.72 + rng() * .35) * (1 - t * .45)
      shoot(points[node], rise * (.24 + rng() * .16) * (1 - t * .15), radial.multiplyScalar(reach), 1)
    }
  }
  shoot(root, height, form.lean ?? new Vector3((rng() - .5) * spread * .9, 0, (rng() - .6) * spread * .5), 0)
  return { leaves, stems }
}

export function growFern(seed: number, root: Vector3, fronds = 6) {
  const rng = random(seed), leaves: Leaf[] = [], stems: Stem[] = []
  for (let frond = 0; frond < fronds; frond++) {
    const angle = rng() * Math.PI * 2, reach = .28 + rng() * .45, rise = .8 + rng() * .42
    const points = Array.from({ length: 16 }, (_, i) => {
      const t = i / 15
      return root.clone().add(new Vector3(Math.cos(angle) * reach * t,
        rise * Math.sin(t * Math.PI * .58) - .2 * t * t, Math.sin(angle) * reach * .4 * t))
    })
    stems.push({ points, radius: .0018, plant: 0 })
    for (let node = 2; node < points.length; node++) for (const side of [-1, 1]) {
      const t = node / 15, p = points[node]
      const direction = new Vector3(side * (.8 + rng() * .2), .22 + t * .4, (rng() - .5) * .6).normalize()
      const petioleEnd = p.clone().addScaledVector(direction, .009)
      stems.push({ points: [p.clone(), petioleEnd], radius: .00055, plant: 0 })
      leaves.push({ position: petioleEnd, direction, length: (.055 + .085 * Math.sin(t * Math.PI)) * (1 - t * .3),
        width: .8 + rng() * .2, twist: (rng() - .5) * 1.2, phase: rng() * Math.PI * 2, age: .18 + rng() * .55, species: 3, plant: 0 })
    }
  }
  return { leaves, stems }
}

export function growGarden() {
  const leaves: Leaf[] = [], stems: Stem[] = [], plants: PlantBody[] = [], rng = random(8702)
  // Authored clusters preserve the photograph's open, dark middle. Randomness
  // lives within the plants, rather than filling every available patch of view.
  const plantings: [Vector3, number, number, number, PlantForm][] = [
    [new Vector3(.62, .12, -.32), 2.6, .56, 0, { lean: new Vector3(.18, 0, -.08), nodes: 13, branches: 4, paired: true, branchBias: .65, leafScale: 1.08 }],
    [new Vector3(1.03, .03, -.4), 2.05, .46, 0, { lean: new Vector3(-.12, 0, -.1), nodes: 13, branches: 3, leafScale: 1.03 }],
    [new Vector3(.72, .16, -.62), 2.68, .5, 2, { lean: new Vector3(.28, 0, -.14), nodes: 12, branches: 3, leafScale: .88 }],
    [new Vector3(-1.3, -.12, -.42), 2.8, .38, 0, { lean: new Vector3(.56, 0, -.07), nodes: 8, branches: 2, branchNodes: 4,
      leafStart: .68, branchStart: .64, branchEnd: .86, leafScale: 1.1 }],
    [new Vector3(-.38, -.04, -.27), 1.6, .31, 1, { lean: new Vector3(-.16, 0, -.04), nodes: 9, branches: 2, leafStart: .25, leafScale: 1.3, senescence: .7 }],
    [new Vector3(1.08, .05, -.32), 1.25, .45, 2, { nodes: 10, branches: 2, paired: true, branchBias: .7, leafScale: 1.13 }],
    [new Vector3(-1.35, -.08, -1.7), 2.8, .4, 1, { nodes: 9, branches: 1, branchNodes: 4, branchStart: .75, leafStart: .64, leafScale: .88 }],
    [new Vector3(1.6, 0, -1.45), 3.05, .58, 0, { nodes: 13, branches: 3, paired: true, leafScale: .9 }],
  ]
  for (let i = 0; i < 10; i++) {
    const side = i % 2 ? -1 : 1
    plantings.push([new Vector3(side * (.95 + rng() * 3.8), -.08, -1.4 - rng() * 1.7),
      1.3 + rng() * 1.9, .38 + rng() * .3, i % 3,
      { nodes: 11, branches: side > 0 ? 2 : 1, leafStart: side > 0 ? .1 : .55,
        branchStart: side > 0 ? .29 : .7, leafScale: .8 + rng() * .25, branchBias: side * .4 }])
  }
  plantings.forEach(([root, height, spread, species, form], i) => {
    const plant = growPlant(100 + i * 39, root, height, spread, species, form)
    plants.push({ root, height, radius: .0042, species })
    plant.leaves.forEach(leaf => { leaf.plant = i }); plant.stems.forEach(stem => { stem.plant = i })
    leaves.push(...plant.leaves); stems.push(...plant.stems)
  })
  for (const [seed, root, count] of [[1971, new Vector3(-1.08, .08, -.4), 4], [373, new Vector3(-1.44, .12, -.65), 3]] as const) {
    const fern = growFern(seed, root, count)
    const index = plants.length
    plants.push({ root, height: 1.2, radius: .0026, species: 3 })
    fern.leaves.forEach(leaf => { leaf.plant = index }); fern.stems.forEach(stem => { stem.plant = index })
    leaves.push(...fern.leaves); stems.push(...fern.stems)
  }
  // Shoots approaching the pane bend back smoothly. Transform shared endpoints
  // only once so every petiole, fork, and frond remains connected.
  const points = new Set(stems.flatMap(stem => stem.points))
  leaves.forEach(leaf => points.add(leaf.position))
  plants.forEach(plant => points.add(plant.root))
  points.forEach(point => { point.z = -.16 - .05 * Math.log1p(Math.exp((-point.z - .16) / .05)) })
  return { leaves, stems, plants, plantCount: plants.length }
}

export const windGLSL = branchMotionGLSL

export const leafDeformationGLSL = /* glsl */`
attribute vec2 leafMotion;
attribute vec2 leafDynamics;
varying float vLeafAge;
mat3 greenhouseLeafRotation(float h) {
  float twist = ((leafMotion.y - .5) * .24 + leafDynamics.y) * h * h;
  float pitch = leafDynamics.x * h * h;
  mat3 twistRotation = mat3(cos(twist), 0., -sin(twist), 0., 1., 0., sin(twist), 0., cos(twist));
  mat3 pitchRotation = mat3(1., 0., 0., 0., cos(pitch), sin(pitch), 0., -sin(pitch), cos(pitch));
  return pitchRotation * twistRotation;
}
vec3 greenhouseLeafNormal(vec3 p, vec3 n) {
  float h = p.y;
  float twistCoefficient = (leafMotion.y - .5) * .24 + leafDynamics.y;
  float twist = twistCoefficient * h * h, pitch = leafDynamics.x * h * h;
  mat3 ry = mat3(cos(twist), 0., -sin(twist), 0., 1., 0., sin(twist), 0., cos(twist));
  mat3 rx = mat3(1., 0., 0., 0., cos(pitch), sin(pitch), 0., -sin(pitch), cos(pitch));
  mat3 rotation = rx * ry;
  vec3 dy = rotation[1] + cross(vec3(1., 0., 0.), rotation * p) * (2. * h * leafDynamics.x)
    + rx * cross(vec3(0., 1., 0.), ry * p) * (2. * h * twistCoefficient);
  mat3 cofactor = mat3(cross(dy, rotation[2]), cross(rotation[2], rotation[0]), cross(rotation[0], dy));
  return normalize(cofactor * n);
}
`

export function foliageMaterials(maps: ReturnType<typeof leafTextures>, earlierLook = false) {
  const uniforms = {
    uPlantRoots: { value: Array.from({ length: MAX_PLANTS }, () => new Vector4(0, 0, 0, 1)) },
    uBranchBend: { value: Array.from({ length: MAX_PLANTS }, () => new Vector2()) },
  }
  const leaf = new MeshStandardMaterial({ map: maps.color, normalMap: maps.normal, normalScale: new Vector2(earlierLook ? .45 : .32, earlierLook ? .45 : .32), roughness: earlierLook ? .43 : .4, side: DoubleSide, envMapIntensity: earlierLook ? .48 : .45 })
  const depth = new MeshDepthMaterial({ depthPacking: RGBADepthPacking, side: DoubleSide })
  const stem = new MeshStandardMaterial({ color: '#394a25', roughness: .79, envMapIntensity: .35 })
  const stemDepth = new MeshDepthMaterial({ depthPacking: RGBADepthPacking })
  const inject = (material: typeof leaf | typeof depth, isLeaf: boolean, backlight: boolean) => {
    material.onBeforeCompile = shader => {
      Object.assign(shader.uniforms, uniforms)
      shader.vertexShader = windGLSL + (isLeaf ? leafDeformationGLSL : '') + shader.vertexShader
      if (isLeaf) shader.vertexShader = shader.vertexShader
        .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\nobjectNormal = greenhouseLeafNormal(position, objectNormal);')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLeafAge = leafMotion.y;\ntransformed = greenhouseLeafRotation(position.y) * transformed;')
      // Apply identical world-space bending in the beauty and shadow programs.
      shader.vertexShader = shader.vertexShader.replace('#include <project_vertex>', /* glsl */`
        vec4 gardenPosition = vec4(transformed, 1.);
        #ifdef USE_INSTANCING
          gardenPosition = instanceMatrix * gardenPosition;
        #endif
        gardenPosition = modelMatrix * gardenPosition;
        ${material instanceof MeshStandardMaterial ? /* glsl */`
          #ifndef FLAT_SHADED
            vec3 gardenWorldNormal = inverseTransformDirection(transformedNormal, viewMatrix);
            vNormal = normalize((viewMatrix * vec4(greenhouseBranchNormal(gardenWorldNormal, gardenPosition.xyz), 0.)).xyz);
          #endif
        ` : ''}
        gardenPosition.xyz += greenhouseWind(gardenPosition.xyz);
        vec4 mvPosition = viewMatrix * gardenPosition;
        gl_Position = projectionMatrix * mvPosition;
      `).replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\n#if defined(USE_SHADOWMAP)\nworldPosition = gardenPosition;\n#endif')
      if (backlight) shader.fragmentShader = 'varying float vLeafAge;\n' + shader.fragmentShader
        .replace('#include <roughnessmap_fragment>', /* glsl */`
          #include <roughnessmap_fragment>
          // Young waxy leaves catch a smaller, brighter highlight than old ones.
          ${earlierLook ? '' : 'roughnessFactor = clamp(roughnessFactor * (.72 + .62 * (1. - vLeafAge)), .22, .6);'}
        `).replace('#include <lights_fragment_end>', /* glsl */`
        #include <lights_fragment_end>
        // Thin-leaf forward scattering. Shadow visibility still modulates the sunlight.
        #if NUM_DIR_LIGHTS > 0
          for (int leafLight = 0; leafLight < NUM_DIR_LIGHTS; leafLight++) {
            float leafThrough = pow(max(dot(-normal, directionalLights[leafLight].direction), 0.), 1.5);
            reflectedLight.directDiffuse += diffuseColor.rgb * directionalLights[leafLight].color
              * leafThrough * ${earlierLook ? '.22' : '(.16 + vLeafAge * .17)'} * getShadowMask();
          }
        #endif
      `).replace('#include <shadowmap_pars_fragment>', '#include <shadowmap_pars_fragment>\n#include <shadowmask_pars_fragment>')
    }
    material.customProgramCacheKey = () => `glass-garden-${isLeaf ? 'leaf' : 'stem'}-${backlight}-${earlierLook}-v4`
  }
  inject(leaf, true, true); inject(depth, true, false)
  inject(stem, false, false); inject(stemDepth, false, false)
  return { leaf, depth, stem, stemDepth, uniforms }
}

export interface FoliageOptions {
  garden?: { leaves: Leaf[]; stems: Stem[]; plants: PlantBody[] }
  textures?: typeof leafTextures
  geometry?: typeof leafGeometry
  earlierLook?: boolean
  windScale?: number
}
export function createFoliage(options: FoliageOptions = {}) {
  const group = new Group(), maps = (options.textures ?? leafTextures)(), materials = foliageMaterials(maps, options.earlierLook)
  const { leaves, stems, plants } = options.garden ?? growGarden(), rng = random(5901)
  const bindings: BladeBinding[] = []
  const geometries: BufferGeometry[] = []
  const up = new Vector3(0, 1, 0), matrix = new Matrix4(), rotation = new Quaternion(), twist = new Quaternion(), color = new Color(), vertex = new Vector3()
  for (let species = 0; species < 4; species++) {
    const collection = leaves.filter(leaf => leaf.species === species)
    if (!collection.length) continue
    const geometry = (options.geometry ?? leafGeometry)(species)
    const motion = new Float32Array(collection.length * 2)
    const leafDynamics = new InstancedBufferAttribute(new Float32Array(collection.length * 2), 2).setUsage(DynamicDrawUsage)
    const mesh = new InstancedMesh(geometry, materials.leaf, collection.length)
    mesh.customDepthMaterial = materials.depth
    mesh.castShadow = mesh.receiveShadow = true
    // The vertex shader bends beyond the static instance bounds.
    mesh.frustumCulled = false
    collection.forEach((leaf, i) => {
      rotation.setFromUnitVectors(up, leaf.direction)
      twist.setFromAxisAngle(up, leaf.twist)
      rotation.multiply(twist)
      matrix.compose(leaf.position, rotation, new Vector3(leaf.length * leaf.width, leaf.length, leaf.length))
      // Keep the whole curved lamina behind the pane even at maximum breeze.
      // Moving its shared petiole endpoint retains a connected skeleton.
      const position = geometry.getAttribute('position')
      const plant = plants[leaf.plant], motionScale = plant.leafMotion ?? 1
      let front = -Infinity, sweptFront = -Infinity
      for (let j = 0; j < position.count; j++) {
        vertex.fromBufferAttribute(position, j)
        const angle = ((options.earlierLook && plant.paneGap ? 0 : Math.abs((leaf.age - .5) * .24)) + (motionLimits.pitch + motionLimits.torsion) * motionScale) * vertex.y ** 2
        const sweptRadius = 2 * vertex.length() * Math.sin(angle * .5) * leaf.length * Math.max(1, leaf.width)
        vertex.applyMatrix4(matrix)
        front = Math.max(front, vertex.z); sweptFront = Math.max(sweptFront, vertex.z + sweptRadius)
      }
      const branchReach = motionLimits.branchDepth * 1.296 * (plant.depthMotion ?? 1)
      const clearance = plant.paneGap ? Math.max(0, front + .035, sweptFront + plant.paneGap + branchReach)
        : Math.max(0, front + .12, sweptFront + .05)
      if (clearance) { leaf.position.z -= clearance; matrix.elements[14] = leaf.position.z }
      mesh.setMatrixAt(i, matrix)
      const normal = new Vector3(0, 0, 1).applyQuaternion(rotation)
      bindings.push({ ...leaf, normal, pitchNormal: new Vector3().crossVectors(new Vector3(1, 0, 0).applyQuaternion(rotation), normal),
        torsionNormal: new Vector3().crossVectors(leaf.direction, normal), attribute: leafDynamics, index: i, motionScale })
      const yellow = leaf.age < .055, young = leaf.age > .78, fern = leaf.species === 3
      if (options.earlierLook) color.setHSL(yellow ? .13 : .27 + rng() * .045, yellow ? .48 : .3 + rng() * .2, .23 + rng() * .2)
      else color.setHSL(yellow ? .125 : fern ? .29 + rng() * .035 : .225 + rng() * .055,
        yellow ? .52 : .3 + rng() * .2, yellow ? .43 : (young ? .38 : fern ? .2 : .24) + rng() * .11)
      mesh.setColorAt(i, color)
      motion.set([leaf.phase, options.earlierLook && plant.paneGap ? .5 : leaf.age], i * 2)
    })
    geometry.setAttribute('leafMotion', new InstancedBufferAttribute(motion, 2))
    geometry.setAttribute('leafDynamics', leafDynamics)
    geometry.setAttribute('plantIndex', new InstancedBufferAttribute(Float32Array.from(collection, leaf => leaf.plant), 1))
    geometries.push(geometry); group.add(mesh)
  }
  const tubes = stems.map(stem => {
    const curve = new CatmullRomCurve3(stem.points), segments = stem.points.length > 3 ? 16 : 4
    const tube = new TubeGeometry(curve, segments, stem.radius, 4, false), position = tube.getAttribute('position')
    for (let ring = 0; ring <= segments; ring++) {
      const center = curve.getPointAt(ring / segments), taper = .42 + .58 * Math.pow(1 - ring / segments, .6)
      for (let side = 0; side <= 4; side++) {
        const index = ring * 5 + side
        vertex.fromBufferAttribute(position, index).sub(center).multiplyScalar(taper).add(center)
        position.setXYZ(index, vertex.x, vertex.y, vertex.z)
      }
    }
    tube.computeVertexNormals()
    tube.setAttribute('plantIndex', new BufferAttribute(new Float32Array(position.count).fill(stem.plant), 1))
    return tube
  })
  const stemGeometry = mergeGeometries(tubes)
  tubes.forEach(tube => tube.dispose())
  if (stemGeometry) {
    const mesh = new Mesh(stemGeometry, materials.stem)
    mesh.customDepthMaterial = materials.stemDepth
    mesh.castShadow = mesh.receiveShadow = true
    mesh.frustumCulled = false
    group.add(mesh); geometries.push(stemGeometry)
  }
  const dynamics = createPlantDynamics(plants, bindings, options.windScale)
  materials.uniforms.uPlantRoots.value = dynamics.roots
  materials.uniforms.uBranchBend.value = dynamics.bends
  return {
    group, uniforms: materials.uniforms, leafCount: leaves.length, leaves, stems, plants,
    update(delta: number, breeze: number) { dynamics.advance(delta, breeze) },
    dispose() {
      group.traverse(object => { if (object instanceof InstancedMesh) object.dispose() })
      geometries.forEach(geometry => geometry.dispose())
      maps.color.dispose(); maps.normal.dispose()
      materials.leaf.dispose(); materials.depth.dispose(); materials.stem.dispose(); materials.stemDepth.dispose()
    },
  }
}
