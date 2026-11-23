import { InstancedBufferAttribute, InstancedBufferGeometry, Mesh, PlaneGeometry, ShaderMaterial, Vector2, Vector3, Vector4 } from 'three'
import { random } from '../settings'
import type { GlassSettings } from '../settings'
import { rainBillboardGLSL, rainFragmentGLSL } from './shaders'
import { rainVelocity } from './weather'
import type { RainSqualls } from './squalls'

// Fine airborne rain above normal density needs only a seed and its exposure.
// Larger drops still travel and collide in the storm simulation.
const maxPerSide = 63000
const vertexShader = rainBillboardGLSL + /* glsl */`
attribute vec4 dropSeed;
uniform vec3 uTravel, uVelocity;
uniform vec4 uVolume;
uniform float uSize;
uniform sampler2D uSqualls;
uniform vec4 uBounds;
void main() {
  vec3 seed=fract(dropSeed.xyz+vec3(.33,.73,.18)*uRainSide);
  vec3 extent=vec3(uVolume.x,uVolume.y,uRainSide>0.?1.1:2.8);
  vec3 factor=vec3(.89+seed.z*.22,.63+.61*dropSeed.w,.86+seed.y*.28);
  vec3 pos=(fract(seed+uTravel*factor/extent)-.5)*extent;
  pos.y+=uVolume.z; pos.z+=uRainSide>0.?.55:-1.4;
  vec2 projected=pos.xy+pos.z*vec2(uVolume.w*.32,-.22);
  float density=texture2D(uSqualls,(projected-uBounds.xy)/uBounds.zw).r;
  float threshold=fract(dot(dropSeed,vec4(7.33,21.77,5.8,35.21)));
  float fade=smoothstep(0.,.035,abs(pos.z))*smoothstep(threshold-.06,threshold+.06,density);
  if (fade<.002) { gl_Position=vec4(2.,2.,2.,1.); return; }
  float diameter=(.0007+.0039*dropSeed.w*dropSeed.w)*uSize;
  projectRain(vec4(pos,diameter),vec4(uVelocity*factor,fade),vec4(0.,0.,0.,seed.x),vec4(0.,0.,1.,0.));
}
`
export function createRainCurtain(bounds: Vector4, resolution: { value: Vector2 }, squalls: RainSqualls) {
  const rng = random(5761), quad = new PlaneGeometry(1, 1)
  const seeds = new Float32Array(maxPerSide * 4)
  for (let i = 0; i < seeds.length; i++) seeds[i] = rng()
  const attribute = new InstancedBufferAttribute(seeds, 4)
  const at = new Vector3(0, bounds.y + bounds.w / 2, 0)
  const uniforms = { uRainResolution: resolution, uRainShutter: { value: .012 }, uRainVisibility: { value: 1 },
    uTravel: { value: new Vector3() }, uVelocity: { value: new Vector3() }, uSize: { value: 1 },
    uVolume: { value: new Vector4(bounds.z + .6, bounds.w + .7, at.y, 0) }, uBounds: { value: bounds }, uSqualls: { value: squalls.texture } }
  function volume(side: number) {
    const geometry = new InstancedBufferGeometry()
    geometry.index = quad.index; geometry.attributes = { ...quad.attributes }; geometry.setAttribute('dropSeed', attribute)
    const material = new ShaderMaterial({ uniforms: { ...uniforms, uRainSide: { value: side } },
      vertexShader, fragmentShader: rainFragmentGLSL, transparent: true, depthWrite: false, toneMapped: false })
    const mesh = new Mesh(geometry, material)
    mesh.frustumCulled = false; mesh.renderOrder = 3; mesh.visible = false
    return mesh
  }
  const front = volume(1), back = volume(-1)
  return { front, back,
    update(dt: number, time: number, s: GlassSettings, strength: number, airFraction = 1) {
      const count = Math.round(airFraction * Math.min(maxPerSide, 9000 * Math.max(0, s.rainParticles - 1) * strength ** 1.8))
      front.geometry.instanceCount = back.geometry.instanceCount = count
      front.visible = back.visible = count > 0
      if (!count) return
      rainVelocity(uniforms.uVelocity.value, at, time, s, strength, .003, squalls.phase)
      uniforms.uTravel.value.addScaledVector(uniforms.uVelocity.value, dt)
      uniforms.uSize.value = Math.max(.4, s.rainDropSize / 2)
      uniforms.uVolume.value.w = s.rainWind * s.rainWindStrength
      uniforms.uRainVisibility.value = s.rainVisibility; uniforms.uRainShutter.value = s.rainShutter / 1000
    },
    dispose() {
      for (const mesh of [front, back]) { mesh.removeFromParent(); mesh.geometry.dispose(); mesh.material.dispose() }
      quad.dispose()
    },
  }
}
