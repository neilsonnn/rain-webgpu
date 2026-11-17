import { describe, expect, it } from 'vitest'
import { parse } from '@shaderfrog/glsl-parser'
import preprocess from '@shaderfrog/glsl-parser/preprocessor/index.js'
import { DataTexture, ShaderChunk, ShaderLib } from 'three'
import type { WebGLRenderer } from 'three'
import { createGlassMaterial } from '../src/glass/material'
import { foliageMaterials } from '../src/glass/foliage'
import { wireMaterials } from '../src/glass/wire'
import { createGrading } from '../src/glass/grading'
import { createGlassMaterial as earlierGlass } from '../src/glass/earlier/material'
import { foliageMaterials as earlierFoliage } from '../src/glass/earlier/foliage'
import { wireMaterials as earlierWire } from '../src/glass/earlier/wire'
import { createGrading as earlierGrading } from '../src/glass/earlier/grading'
import { waterVertexGLSL, waterFragmentGLSL } from '../src/glass/rain/surface'
import { rainVertexGLSL, rainFragmentGLSL } from '../src/glass/rain/shaders'

function expand(source: string): string {
  return source.replace(/#include\s+<([\w]+)>/g, (_, name: keyof typeof ShaderChunk) => {
    if (!(name in ShaderChunk)) throw new Error(`Unknown shader chunk: ${name}`)
    return expand(ShaderChunk[name])
  })
}

function programs(earlier = false, earlierLook = false, breeze = false) {
  const map = new DataTexture(), glass = (earlier ? earlierGlass : createGlassMaterial)(map, map, map, map, map, map)
  const foliage = earlier ? earlierFoliage({ color: map, normal: map }, false, breeze) : foliageMaterials({ color: map, normal: map }, earlierLook)
  const wire = (earlier ? earlierWire : wireMaterials)()
  const variants = [
    { name: 'glass', material: glass.material, source: ShaderLib.physical, defines: '#define PHYSICAL\n#define USE_ENVMAP\n#define ENVMAP_TYPE_CUBE_UV\n#define CUBEUV_MAX_MIP 8.\n#define CUBEUV_TEXEL_WIDTH .001\n#define CUBEUV_TEXEL_HEIGHT .001\n' },
    { name: 'leaf', material: foliage.leaf, source: earlier ? ShaderLib.physical : ShaderLib.standard, defines: (earlier ? '#define PHYSICAL\n#define USE_CLEARCOAT\n' : '') + '#define USE_INSTANCING\n#define USE_MAP\n#define USE_NORMALMAP\n#define USE_NORMALMAP_TANGENTSPACE\n#define USE_UV\n#define USE_SHADOWMAP\n#define DOUBLE_SIDED\n' },
    { name: 'leaf shadow', material: foliage.depth, source: ShaderLib.depth, defines: '#define USE_INSTANCING\n#define DEPTH_PACKING 3201\n' },
    { name: 'stem', material: foliage.stem, source: ShaderLib.standard, defines: '#define USE_SHADOWMAP\n' },
    { name: 'stem shadow', material: foliage.stemDepth, source: ShaderLib.depth, defines: '#define DEPTH_PACKING 3201\n' },
    { name: 'cylindrical wire', material: wire.material, source: ShaderLib.standard, defines: '#define USE_INSTANCING\n#define USE_SHADOWMAP\n' },
    { name: 'wire shadow', material: wire.depth, source: ShaderLib.depth, defines: '#define USE_INSTANCING\n#define DEPTH_PACKING 3201\n' },
  ]
  const counts = '#define NUM_DIR_LIGHTS 2\n#define NUM_POINT_LIGHTS 0\n#define NUM_SPOT_LIGHTS 0\n#define NUM_RECT_AREA_LIGHTS 0\n#define NUM_HEMI_LIGHTS 1\n#define NUM_DIR_LIGHT_SHADOWS 1\n#define NUM_POINT_LIGHT_SHADOWS 0\n#define NUM_SPOT_LIGHT_SHADOWS 0\n#define NUM_SPOT_LIGHT_MAPS 0\n#define NUM_SPOT_LIGHT_COORDS 0\n#define NUM_SPOT_LIGHT_SHADOWS_WITH_MAPS 0\n#define SHADOWMAP_TYPE_PCF_SOFT\n'
  const result = variants.map(({ name, material, source, defines }) => {
    const shader = { uniforms: {}, vertexShader: source.vertexShader, fragmentShader: source.fragmentShader } as Parameters<typeof material.onBeforeCompile>[0]
    material.onBeforeCompile(shader, {} as WebGLRenderer)
    return { name, vertex: expand(counts + defines + shader.vertexShader), fragment: expand(counts + defines + shader.fragmentShader) }
  })
  const grade = (earlier ? earlierGrading : createGrading)(map)
  result.push({ name: 'color grade', vertex: grade.material.vertexShader,
    fragment: expand('#define TONE_MAPPING\n' + ShaderChunk.tonemapping_pars_fragment + '\nvec3 toneMapping(vec3 c) { return ACESFilmicToneMapping(c); }\n' + grade.material.fragmentShader) })
  grade.dispose(); variants.forEach(({ material }) => material.dispose()); map.dispose()
  return result
}

describe('greenhouse shader source', () => {
  for (const [name, vertex, fragment] of [['rain streaks', rainVertexGLSL, rainFragmentGLSL], ['water height field', waterVertexGLSL, waterFragmentGLSL]]) {
    for (const [stage, source] of [['vertex', vertex], ['fragment', fragment]] as const) it(`parses the ${name} ${stage} shader`, () => {
      const environment = '#define RAIN_ENVIRONMENT\n#define ENVMAP_TYPE_CUBE_UV\n#define CUBEUV_MAX_MIP 8.\n#define CUBEUV_TEXEL_WIDTH .001302\n#define CUBEUV_TEXEL_HEIGHT .000976\n'
      expect(() => parse(preprocess(expand(environment + source)), { stage, quiet: true })).not.toThrow()
    })
  }
  for (const program of programs(true, false, true).filter(program => ['leaf', 'leaf shadow', 'stem', 'stem shadow'].includes(program.name))) {
    for (const stage of ['vertex', 'fragment'] as const) it(`parses the canopy breeze ${program.name} ${stage} shader`, () => {
      expect(() => parse(preprocess(program[stage]), { stage, quiet: true })).not.toThrow()
    })
  }
  it('bends the canopy beauty and shadow surfaces identically and transforms normals for blade and branch deformation', () => {
    const shaders = programs(true, false, true)
    const beauty = preprocess(shaders.find(program => program.name === 'leaf')!.vertex)
    const shadow = preprocess(shaders.find(program => program.name === 'leaf shadow')!.vertex)
    for (const source of [beauty, shadow]) {
      expect(source).toContain('transformed = greenhouseBreezeLeaf(transformed)')
      expect(source).toContain('gardenPosition.xyz += greenhouseWind(gardenPosition.xyz)')
      expect(source).toContain('attribute vec4 plantAnchor')
      expect(source).not.toContain('uBranchBend')
    }
    expect(beauty).toContain('objectNormal = greenhouseBreezeLeafNormal(position, objectNormal)')
    expect(beauty).toContain('greenhouseBreezeNormal(gardenPosition.xyz, gardenWorldNormal)')
    expect(shaders.find(program => program.name === 'leaf')!.fragment).toContain('roughnessFactor = clamp(roughnessFactor *')
  })
  it('parses the spring-motion comparison with the Earlier material appearance', () => {
    const leaf = programs(false, true).find(program => program.name === 'leaf')!
    for (const stage of ['vertex', 'fragment'] as const) expect(() => parse(preprocess(leaf[stage]), { stage, quiet: true })).not.toThrow()
  })
  for (const earlier of [false, true]) for (const program of programs(earlier)) {
    for (const stage of ['vertex', 'fragment'] as const) it(`parses the expanded ${earlier ? 'earlier ' : ''}${program.name} ${stage} shader`, () => {
      expect(() => parse(preprocess(program[stage]), { stage, quiet: true, grammarSource: `glass-${program.name}.${stage}` })).not.toThrow()
    })
  }
  it('retains leaf deformation in the depth shader, which omits the normal pipeline', () => {
    const shadow = preprocess(programs().find(program => program.name === 'leaf shadow')!.vertex)
    expect(shadow).toContain('transformed = greenhouseLeafRotation(position.y) * transformed;')
    expect(shadow).toContain('gardenPosition.xyz += greenhouseWind(gardenPosition.xyz)')
    expect(shadow).not.toContain('leafRotation *')
    expect(shadow).toContain('uBranchBend[id]')
    const beauty = preprocess(programs().find(program => program.name === 'leaf')!.vertex)
    expect(beauty).toContain('greenhouseLeafNormal(position, objectNormal)')
    expect(beauty).toContain('greenhouseBranchNormal(gardenWorldNormal, gardenPosition.xyz)')
  })
  it('samples two rough interfaces, resolves embedded wire separately, and leaves grading to the final pass', () => {
    const glass = preprocess(programs()[0].fragment)
    expect(glass).toContain('paneVisibleNormal(-paneIncident, paneFrontNormal')
    expect(glass).toContain('refract(paneIncident, frontMicroNormal, 1. / material.ior)')
    expect(glass).toContain('refract(insideDirection, rearMicroNormal, material.ior)')
    expect(glass).toContain('texture2D(uWireDepthMap, wireUV)')
    expect(glass).toContain('paneDepthResponse(physicalTravel)')
    expect(glass).not.toContain('wireMask')
    expect(glass).not.toContain('paneGrain')
    expect(glass).not.toContain('getIBLVolumeRefraction')
  })
  it('uses one continuous grid-and-pebble height field for the front normal and ray entry', () => {
    const glass = preprocess(programs()[0].fragment)
    expect(glass).toContain('paneFrontShape = paneFrontSurface(paneFrontPoint.xy, paneFrontField)')
    expect(glass).toContain('vec3 paneFrontNormal = paneFrontShape.xyz')
    expect(glass).toContain('paneIncident * (paneFrontShape.a /')
    expect(glass).toContain('latticeGradient * crestModulation + latticeHeight * modulationGradient')
    expect(glass).toContain('if (uEmbeddedMesh > .5) wireSample')
  })
  it('keeps front reflection polish independent of rear transmission scattering', () => {
    const map = new DataTexture(), glass = createGlassMaterial(map, map, map, map, map, map)
    expect(glass.material.roughness).toBe(glass.uniforms.uFrontRoughness.value)
    expect(glass.material.roughness).toBeLessThan(glass.uniforms.uGlassDiffusion.value)
    const shader = preprocess(programs()[0].fragment)
    expect(shader).toContain('uFrontRoughness * uFrontRoughness')
    expect(shader).toContain('uGlassDiffusion * uGlassDiffusion * .82')
    glass.material.dispose(); map.dispose()
  })
})
