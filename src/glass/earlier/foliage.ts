import {
  BufferAttribute, BufferGeometry, Color, DoubleSide, DynamicDrawUsage, Group, InstancedBufferAttribute,
  InstancedMesh, Matrix4, Mesh, MeshDepthMaterial, MeshPhysicalMaterial, MeshStandardMaterial, Quaternion, RGBADepthPacking,
  Vector2, Vector3,
} from 'three'
import { foldedLeaf, stemTube } from '../plant-geometry'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { leafTextures } from './textures'
import { random } from './settings'
import { arrangements } from './arrangements'
import type { SceneArrangement } from './arrangements'
import type { Arrangement } from '../presets'
import type { PlantBody } from '../dynamics'
import { bladeSweep, breezeEnvelope, breezeLeafGLSL, breezeWindGLSL } from './breeze'
import { growBreezePlant } from './planting'
import { createRainPlants, rainLeafGLSL } from '../rain/plants'
import { rainBranchGLSL } from '../rain/branches'
import type { RainShoot } from '../rain/branches'
import type { RainBinding } from '../rain/plants'
import { wetLeafParsGLSL } from '../rain/shaders'

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
  shoot?: RainShoot
}
export interface Stem { points: Vector3[]; radius: number; plant: number; shoot?: RainShoot }

export function leafGeometry(species = 0) {
  if (species === 1) return foldedLeaf(.29, .46, .11, .065)
  if (species === 2) return foldedLeaf(.38, .40, .18, .10)
  return foldedLeaf(.38, .45, .11, .065)
}

// A reproducible branching skeleton: leaves and their petioles share the same nodes.
export function growPlant(seed: number, root: Vector3, height: number, spread: number, species = 0) {
  const rng = random(seed), leaves: Leaf[] = [], stems: Stem[] = []
  const shoot = (base: Vector3, rise: number, lean: Vector3, level: number, parent?: RainShoot) => {
    const count = level === 0 ? 17 : 10, phase = rng() * Math.PI * 2
    const points: Vector3[] = []
    for (let i = 0; i <= count; i++) {
      const t = i / count
      points.push(base.clone().add(new Vector3(
        lean.x * t + Math.sin(t * 4 + phase) * .045 * t,
        rise * t,
        lean.z * t + Math.sin(t * 5 + phase * .7) * .055 * t,
      )))
    }
    const branch: RainShoot = { root: base, tip: points[count], radius: level === 0 ? .0052 : .0028, plant: 0, parent }
    stems.push({ points, radius: branch.radius, plant: 0, shoot: branch })
    for (let i = 2; i <= count; i++) {
      const p = points[i], side = i % 2 ? 1 : -1, t = i / count
      const reach = (.07 + rng() * .12) * (1 - t * .35)
      const petioleEnd = p.clone().add(new Vector3(side * reach, .025 + rng() * .04, .035 + rng() * .08))
      stems.push({ points: [p.clone(), p.clone().lerp(petioleEnd, .5).add(new Vector3(0, .015, 0)), petioleEnd], radius: .0014, plant: 0, shoot: branch })
      const direction = new Vector3(side * (.35 + rng() * .65), .2 + rng() * .65 - t * .24, -.25 + rng() * .6).normalize()
      leaves.push({
        position: petioleEnd, direction,
        length: (.17 + rng() * .14) * (level === 0 ? 1 : .85) * (1 - t * .22),
        width: .78 + rng() * .35,
        twist: (rng() - .5) * 1.7,
        phase: rng() * Math.PI * 2,
        age: rng(), species, plant: 0, shoot: branch,
      })
      if (level === 0 && (i === 5 || i === 9 || i === 13)) {
        shoot(p, rise * (.34 + rng() * .18), new Vector3(side * spread * (.6 + rng() * .4), 0, (rng() - .6) * spread), 1, branch)
      }
    }
  }
  shoot(root, height, new Vector3((rng() - .5) * spread * .9, 0, (rng() - .6) * spread * .5), 0)
  return { leaves, stems }
}

const windHeaderGLSL = /* glsl */`
uniform float uPlantTime;
uniform float uBreeze;
uniform float uPaneContact;
attribute float plantNear;
vec2 greenhouseContact(float z) {
  float q = clamp((-.02 - z) / .08, 0., 1.);
  if (z <= -.1 || uPaneContact < .5) return vec2(z, 1.);
  return vec2(-.02 - .08 * q * q * (2. - q), max(.0001, q * (4. - 3. * q)));
}
`
export const windGLSL = windHeaderGLSL + /* glsl */`
vec3 greenhouseWind(vec3 p) {
  float h = max(0., p.y);
  float wave = sin(uPlantTime * .43 + p.x * .75 + p.z * .3)
    + .38 * sin(uPlantTime * .79 - p.z * 1.3 + p.y * .6);
  float bend = min(h * h, 12.) * .0065 * uBreeze;
  return vec3(wave * bend, -.08 * abs(wave) * bend,
    sin(uPlantTime * .37 + p.x * .55) * bend * .5 * mix(1., .06, plantNear));
}
`

export const leafDeformationGLSL = /* glsl */`
attribute vec2 leafMotion;
mat3 greenhouseLeafRotation(float h) {
  float angle = sin(uPlantTime * 1.35 + leafMotion.x) * .045 * uBreeze * h * mix(1., .2, plantNear);
  return mat3(cos(angle), 0., -sin(angle), 0., 1., 0., sin(angle), 0., cos(angle));
}
`

export function foliageMaterials(maps: ReturnType<typeof leafTextures>, contact = false, enhanced = false) {
  const uniforms = { uPlantTime: { value: 0 }, uBreeze: { value: .65 }, uPaneContact: { value: Number(contact) },
    uRainBranches: { value: null as import('three').DataTexture | null }, uRainBranchCount: { value: 1 }, uRainSheen: { value: 1 } }
  const leaf = new MeshPhysicalMaterial({ clearcoat: 1, clearcoatRoughness: .18, map: maps.color, normalMap: maps.normal, normalScale: new Vector2(enhanced ? .32 : .45, enhanced ? .32 : .45), roughness: enhanced ? .38 : .43, side: DoubleSide, envMapIntensity: enhanced ? .6 : .48 })
  const depth = new MeshDepthMaterial({ depthPacking: RGBADepthPacking, side: DoubleSide })
  const stem = new MeshStandardMaterial({ color: '#394a25', roughness: .79, envMapIntensity: .35 })
  const stemDepth = new MeshDepthMaterial({ depthPacking: RGBADepthPacking })
  const inject = (material: MeshStandardMaterial | typeof depth, isLeaf: boolean, backlight: boolean) => {
    const contactNormal = material instanceof MeshStandardMaterial ? /* glsl */`
      #ifndef FLAT_SHADED
        if (uPaneContact > .5) {
          vec3 contactNormal = inverseTransformDirection(vNormal, viewMatrix);
          contactNormal = normalize(vec3(contactNormal.xy * paneContact.y, contactNormal.z));
          vNormal = normalize((viewMatrix * vec4(contactNormal, 0.)).xyz);
        }
      #endif
    ` : ''
    material.onBeforeCompile = shader => {
      Object.assign(shader.uniforms, uniforms)
      shader.vertexShader = (enhanced ? windHeaderGLSL + breezeWindGLSL : windGLSL)
        + rainBranchGLSL + (isLeaf ? rainLeafGLSL + (enhanced ? breezeLeafGLSL : leafDeformationGLSL) : '') + shader.vertexShader
      if (isLeaf) shader.vertexShader = shader.vertexShader
        .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>\nobjectNormal = ${enhanced ? 'greenhouseBreezeLeafNormal(position, objectNormal)' : 'greenhouseLeafRotation(position.y) * objectNormal'};\nobjectNormal = greenhouseRainLeafNormal(${enhanced ? 'greenhouseBreezeLeaf(position)' : 'greenhouseLeafRotation(position.y) * position'}, objectNormal);`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>\n${enhanced ? 'vLeafFinish = leafMotion;\ntransformed = greenhouseBreezeLeaf(transformed);' : 'transformed = greenhouseLeafRotation(position.y) * transformed;'}\ntransformed = greenhouseRainLeaf(transformed); vRainLeaf = rainLeaf.zw;`)
      shader.vertexShader = shader.vertexShader.replace('#include <project_vertex>', /* glsl */`
        vec4 gardenPosition = vec4(transformed, 1.);
        #ifdef USE_INSTANCING
          gardenPosition = instanceMatrix * gardenPosition;
        #endif
        gardenPosition = modelMatrix * gardenPosition;
        ${enhanced && material instanceof MeshStandardMaterial ? /* glsl */`
          #ifndef FLAT_SHADED
            vec3 gardenWorldNormal = inverseTransformDirection(transformedNormal, viewMatrix);
            vNormal = normalize((viewMatrix * vec4(greenhouseBreezeNormal(gardenPosition.xyz, gardenWorldNormal), 0.)).xyz);
          #endif
        ` : ''}
        ${material instanceof MeshStandardMaterial ? /* glsl */`
          #ifndef FLAT_SHADED
            vec3 rainWorldNormal = inverseTransformDirection(vNormal, viewMatrix);
            vNormal = normalize((viewMatrix * vec4(greenhouseRainBranchNormal(gardenPosition.xyz, rainWorldNormal), 0.)).xyz);
          #endif
        ` : ''}
        gardenPosition.xyz += greenhouseRainBranch(gardenPosition.xyz);
        gardenPosition.xyz += greenhouseWind(gardenPosition.xyz);
        vec2 paneContact = greenhouseContact(gardenPosition.z);
        gardenPosition.z = paneContact.x;
        ${contactNormal}
        vec4 mvPosition = viewMatrix * gardenPosition;
        gl_Position = projectionMatrix * mvPosition;
      `).replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\n#if defined(USE_SHADOWMAP)\nworldPosition = gardenPosition;\n#endif')
      if (backlight && enhanced) shader.fragmentShader = 'varying vec2 vLeafFinish;\n' + shader.fragmentShader
        .replace('#include <roughnessmap_fragment>', /* glsl */`
          #include <roughnessmap_fragment>
          roughnessFactor = clamp(roughnessFactor * (.72 + .65 * (1. - vLeafFinish.y) + .08 * sin(vLeafFinish.x)), .24, .56);
        `)
      if (backlight) shader.fragmentShader = wetLeafParsGLSL + shader.fragmentShader
        .replace('#include <map_fragment>', `#include <map_fragment>\ndiffuseColor.rgb *= mix(1., .76, clamp(vRainLeaf.x * uRainSheen, 0., 1.));`)
        .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, .23, clamp(vRainLeaf.x * uRainSheen, 0., 1.));`)
        .replace('#include <normal_fragment_maps>', /* glsl */`
          #include <normal_fragment_maps>
          // A continuous water coating follows the blade's broad curvature.
          // Keep a little vein relief, without a field of tiny mirror normals.
          vec3 rainLeafWaterNormal = normalize(mix(nonPerturbedNormal, normal, .12));
        `)
        .replace('#include <clearcoat_normal_fragment_maps>', /* glsl */`
          #include <clearcoat_normal_fragment_maps>
          #ifdef USE_CLEARCOAT
            clearcoatNormal = rainLeafWaterNormal;
          #endif
        `)
        .replace('#include <lights_physical_fragment>', /* glsl */`
          #include <lights_physical_fragment>
          #ifdef USE_CLEARCOAT
            material.clearcoat *= clamp(vRainLeaf.x * uRainSheen, 0., 1.);
            material.clearcoatF0 = vec3(.02037);
          #endif
        `)
      if (backlight) shader.fragmentShader = shader.fragmentShader.replace('#include <lights_fragment_end>', /* glsl */`
        #include <lights_fragment_end>
        #if NUM_DIR_LIGHTS > 0
          for (int leafLight = 0; leafLight < NUM_DIR_LIGHTS; leafLight++) {
            float leafThrough = pow(max(dot(-normal, directionalLights[leafLight].direction), 0.), 1.5);
            reflectedLight.directDiffuse += diffuseColor.rgb * directionalLights[leafLight].color
              * leafThrough * .22 * getShadowMask();
          }
        #endif
      `).replace('#include <shadowmap_pars_fragment>', '#include <shadowmap_pars_fragment>\n#include <shadowmask_pars_fragment>')
    }
    material.customProgramCacheKey = () => `glass-garden-${isLeaf ? 'leaf' : 'stem'}-${backlight}-${enhanced}-v7-rain-bones`
  }
  inject(leaf, true, true); inject(depth, true, false)
  inject(stem, false, false); inject(stemDepth, false, false)
  return { leaf, depth, stem, stemDepth, uniforms }
}

// Omit the three outermost left plantings and the one behind the plaster wall.
const removedOriginalSeeds = new Set([802, 880, 763, 685])

export function growGarden(arrangement: Arrangement = 'original', side?: 'left' | 'right') {
  const composition: SceneArrangement = arrangements[arrangement]
  const leaves: Leaf[] = [], stems: Stem[] = [], plants: PlantBody[] = [], rng = random(8702)
  const append = (plant: ReturnType<typeof growPlant>, root: Vector3, height: number, species: number, nearPane = false) => {
    if (side === 'left' && root.x >= 0 || side === 'right' && root.x < 0) return
    if (root.x < 0 && composition.pruneLeft) {
      const removed = new Set(plant.leaves.filter(leaf => leaf.phase / (Math.PI * 2) < composition.pruneLeft!).map(leaf => leaf.position))
      plant.leaves = plant.leaves.filter(leaf => !removed.has(leaf.position))
      plant.stems = plant.stems.filter(stem => !removed.has(stem.points.at(-1)!))
    }
    const index = plants.length
    plants.push({ root, height, radius: .0052, species, ...(nearPane ? { paneGap: .02, depthMotion: .06, leafMotion: .2 } : {}) })
    plant.leaves.forEach(leaf => { leaf.plant = index })
    plant.stems.forEach(stem => { stem.plant = index; if (stem.shoot) stem.shoot.plant = index })
    leaves.push(...plant.leaves); stems.push(...plant.stems)
  }
  const plantings: [number, number, number, number, number][] = [
    [.78, 0, -.38, 2.65, 0], [1.13, 0, -.58, 2.25, 0], [.28, -.08, -.82, 2.05, 0],
    [-.88, 0, -.56, 3.0, 1], [-1.24, -.05, -.85, 1.85, 0], [-.5, -.12, -.3, 1.18, 1],
    [1.6, 0, -1.5, 2.95, 1], [-1.65, 0, -1.7, 2.65, 1], [.52, 0, -1.95, 2.8, 0],
  ]
  for (let i = 0; i < 18; i++) plantings.push([(rng() - .5) * 10, -.05, -1.2 - rng() * 1.8, 1.1 + rng() * 2.3, i % 2])
  for (let i = 0; i < plantings.length; i++) {
    const [x, y, z, height, species] = plantings[i]
    const seed = 100 + i * 39, spread = .5 + rng() * .3
    if (arrangement === 'original' && removedOriginalSeeds.has(seed)) continue
    if (composition.mainPlantSeeds && !composition.mainPlantSeeds.includes(seed)) continue
    const root = new Vector3(x, y, z)
    append(growPlant(seed, root, height, spread, species), root, height, species)
  }
  for (const planting of composition.plantings) {
    const root = new Vector3(...planting.root)
    const plant = composition.motion === 'breeze' ? growBreezePlant(planting, root)
      : growPlant(planting.seed, root, planting.height, planting.spread, planting.species)
    if (composition.motion !== 'breeze') for (const leaf of plant.leaves) leaf.length *= planting.leafScale ?? 1
    append(plant, root, planting.height, planting.species, planting.nearPane)
  }
  const points = new Map<Vector3, boolean>()
  stems.forEach(stem => stem.points.forEach(point => points.set(point, Boolean(plants[stem.plant].paneGap))))
  leaves.forEach(leaf => points.set(leaf.position, Boolean(plants[leaf.plant].paneGap)))
  plants.forEach(plant => points.set(plant.root, Boolean(plant.paneGap)))
  points.forEach((near, point) => {
    if (near) point.z = -.03 - .025 * Math.log1p(Math.exp((-point.z - .03) / .025))
    else point.z -= composition.pullback
  })
  return { leaves, stems, plants, plantCount: plants.length, rng }
}

export function createFoliage(arrangement: Arrangement = 'original') {
  const composition: SceneArrangement = arrangements[arrangement]
  const enhanced = composition.motion === 'breeze'
  const group = new Group(), maps = leafTextures(), materials = foliageMaterials(maps, composition.contact, enhanced)
  const { leaves, stems, plants, rng } = growGarden(arrangement, composition.motion === 'split' ? 'right' : undefined)
  const geometries: BufferGeometry[] = [], rainBindings: RainBinding[] = []
  const up = new Vector3(0, 1, 0), matrix = new Matrix4(), rotation = new Quaternion(), twist = new Quaternion(), color = new Color()
  for (let species = 0; species < (enhanced ? 3 : 2); species++) {
    const collection = leaves.filter(leaf => leaf.species === species), geometry = leafGeometry(species)
    const motion = new Float32Array(collection.length * 2)
    const rainMotion = new InstancedBufferAttribute(new Float32Array(collection.length * 4), 4).setUsage(DynamicDrawUsage)
    const rainPlant = new InstancedBufferAttribute(new Float32Array(collection.length), 1)
    const proximity = new Float32Array(collection.length)
    const anchors = new Float32Array(collection.length * 4)
    const mesh = new InstancedMesh(geometry, materials.leaf, collection.length)
    mesh.customDepthMaterial = materials.depth
    mesh.castShadow = mesh.receiveShadow = true
    mesh.frustumCulled = false
    collection.forEach((leaf, i) => {
      rotation.setFromUnitVectors(up, leaf.direction)
      twist.setFromAxisAngle(up, leaf.twist)
      rotation.multiply(twist)
      matrix.compose(leaf.position, rotation, new Vector3(leaf.length * leaf.width, leaf.length, leaf.length))
      if (composition.clearance > 0) {
        // Keep the full curved blade and maximum sway away from the pane,
        // translating its shared petiole endpoint rather than flattening it.
        const positions = geometry.getAttribute('position'), vertex = new Vector3()
        const plant = plants[leaf.plant]
        let front = -Infinity, staticFront = -Infinity
        for (let j = 0; j < positions.count; j++) {
          vertex.fromBufferAttribute(positions, j)
          const swept = enhanced ? bladeSweep(vertex.length(), vertex.y, leaf.length * Math.max(1, leaf.width), plant.leafMotion ?? 1)
            : 2 * vertex.length() * Math.sin(.045 * 1.5 * .5 * (plant.leafMotion ?? 1)) * leaf.length * Math.max(1, leaf.width)
          vertex.applyMatrix4(matrix)
          front = Math.max(front, vertex.z + swept); staticFront = Math.max(staticFront, vertex.z)
        }
        const retreat = Math.max(0, front + (plant.paneGap ?? composition.clearance) + (enhanced ? breezeEnvelope.depth : .0585) * (plant.depthMotion ?? 1), plant.paneGap ? staticFront + .035 : 0)
        leaf.position.z -= retreat; matrix.elements[14] = leaf.position.z
      }
      mesh.setMatrixAt(i, matrix)
      rainBindings.push({ leaf, attribute: rainMotion, branchAttribute: rainPlant, index: i, orientation: rotation.clone() })
      rainPlant.setX(i, leaf.plant)
      const yellow = leaf.age < (enhanced ? leaf.position.x < 0 && leaf.position.y < 1.25 ? .16 : .065 : .055)
        && (enhanced || arrangement === 'original' || leaf.position.y < 1.5 && leaf.position.x < .15)
      if (enhanced) color.setHSL(yellow ? .105 + rng() * .045 : .255 + rng() * .08,
        yellow ? .48 + rng() * .12 : .32 + rng() * .22,
        yellow ? .38 + rng() * .11 : (leaf.age > .8 ? .32 : .19) + rng() * .12)
      else if (arrangement === 'original') color.setHSL(yellow ? .13 : .245 + rng() * .05, yellow ? .48 : .22 + rng() * .21, .29 + rng() * .22)
      else color.setHSL(yellow ? .13 : .27 + rng() * .045, yellow ? .48 : .3 + rng() * .2, .23 + rng() * .2)
      mesh.setColorAt(i, color)
      motion.set([leaf.phase, leaf.age], i * 2)
      proximity[i] = Number(Boolean(plants[leaf.plant].paneGap))
      const body = plants[leaf.plant]
      anchors.set([body.root.x, body.root.y, body.root.z, body.height], i * 4)
    })
    geometry.setAttribute('rainLeaf', rainMotion); geometry.setAttribute('rainPlant', rainPlant)
    geometry.setAttribute('leafMotion', new InstancedBufferAttribute(motion, 2))
    geometry.setAttribute('plantNear', new InstancedBufferAttribute(proximity, 1))
    if (enhanced) geometry.setAttribute('plantAnchor', new InstancedBufferAttribute(anchors, 4))
    geometries.push(geometry); group.add(mesh)
  }
  const rain = createRainPlants(plants, rainBindings, enhanced, stems.flatMap(stem => stem.shoot ? [stem.shoot] : []))
  const tubes = stems.map(stem => {
    const tube = stemTube(stem.points, stem.radius, enhanced ? .38 : 1)
    if (enhanced) {
      const positions = tube.getAttribute('position'), body = plants[stem.plant]
      const anchors = new Float32Array(positions.count * 4)
      for (let i = 0; i < positions.count; i++) anchors.set([body.root.x, body.root.y, body.root.z, body.height], i * 4)
      tube.setAttribute('plantAnchor', new BufferAttribute(anchors, 4))
    }
    tube.setAttribute('rainPlant', new BufferAttribute(new Float32Array(tube.getAttribute('position').count).fill(rain.branchIndex(stem.shoot, stem.plant)), 1))
    tube.setAttribute('plantNear', new BufferAttribute(new Float32Array(tube.getAttribute('position').count).fill(Number(Boolean(plants[stem.plant].paneGap))), 1))
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
  materials.uniforms.uRainBranches.value = rain.texture; materials.uniforms.uRainBranchCount.value = rain.branches.length
  return {
    group, rain, uniforms: materials.uniforms, leafCount: leaves.length, leaves, stems, plants,
    dispose() {
      rain.dispose()
      group.traverse(object => { if (object instanceof InstancedMesh) object.dispose() })
      geometries.forEach(geometry => geometry.dispose())
      maps.color.dispose(); maps.normal.dispose()
      materials.leaf.dispose(); materials.depth.dispose(); materials.stem.dispose(); materials.stemDepth.dispose()
    },
  }
}
