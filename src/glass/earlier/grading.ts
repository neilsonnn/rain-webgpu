import { BufferAttribute, BufferGeometry, Mesh, OrthographicCamera, Scene, ShaderMaterial, Vector2 } from 'three'
import type { Texture, WebGLRenderer } from 'three'
import { defaults } from './settings'
import type { GlassSettings } from './settings'

export const gradingVertexGLSL = /* glsl */`
varying vec2 vGradeUV;
void main() {
  vGradeUV = position.xy * .5 + .5;
  gl_Position = vec4(position.xy, 0., 1.);
}
`
export const gradingFragmentGLSL = /* glsl */`
uniform sampler2D uGradeSource;
uniform vec2 uGradeResolution;
uniform float uContrast;
uniform float uSaturation;
uniform float uBlackPoint;
uniform float uWhitePoint;
uniform float uTemperature;
uniform float uTint;
uniform float uGrain;
uniform float uVignette;
varying vec2 vGradeUV;
void main() {
  vec3 color = texture2D(uGradeSource, vGradeUV).rgb;
  // White balance in linear light before the display transform.
  vec3 balance = exp2(vec3(uTemperature * .45 - uTint * .15, uTint * .3, -uTemperature * .45 - uTint * .15));
  color *= balance;
  gl_FragColor = vec4(color, 1.);
  #include <tonemapping_fragment>
  // Contrast around middle gray in perceptual space; luminance-based saturation.
  vec3 perceptual = pow(max(vec3(0.), gl_FragColor.rgb), vec3(1. / 2.2));
  perceptual = (perceptual - .46) * uContrast + .46;
  perceptual = (perceptual - uBlackPoint) / max(.05, uWhitePoint - uBlackPoint);
  perceptual = clamp(perceptual, 0., 1.);
  vec3 displayLinear = pow(perceptual, vec3(2.2));
  float luminance = dot(displayLinear, vec3(.2126, .7152, .0722));
  displayLinear = mix(vec3(luminance), displayLinear, uSaturation);
  float falloff = smoothstep(.22, .8, length((vGradeUV - .5) * vec2(.84, 1.)));
  gl_FragColor.rgb = max(vec3(0.), displayLinear * (1. - falloff * uVignette));
  #include <colorspace_fragment>
  float grain = fract(sin(dot(floor(vGradeUV * uGradeResolution), vec2(12.9898, 78.233))) * 43758.5453) - .5;
  gl_FragColor.rgb = clamp(gl_FragColor.rgb + grain * uGrain, 0., 1.);
}
`

export function createGrading(source: Texture) {
  const uniforms = {
    uGradeSource: { value: source }, uGradeResolution: { value: new Vector2(1, 1) },
    uContrast: { value: defaults.contrast }, uSaturation: { value: defaults.saturation },
    uBlackPoint: { value: defaults.blackPoint }, uWhitePoint: { value: defaults.whitePoint },
    uTemperature: { value: defaults.temperature }, uTint: { value: defaults.tint },
    uGrain: { value: defaults.grain }, uVignette: { value: defaults.vignette },
  }
  const material = new ShaderMaterial({ uniforms, vertexShader: gradingVertexGLSL, fragmentShader: gradingFragmentGLSL, depthTest: false, depthWrite: false })
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3))
  const scene = new Scene(), camera = new OrthographicCamera(), quad = new Mesh(geometry, material)
  quad.frustumCulled = false; scene.add(quad)
  return {
    material, uniforms,
    update(s: GlassSettings) {
      uniforms.uContrast.value = s.contrast; uniforms.uSaturation.value = s.saturation
      uniforms.uBlackPoint.value = s.blackPoint; uniforms.uWhitePoint.value = s.whitePoint
      uniforms.uTemperature.value = s.temperature; uniforms.uTint.value = s.tint
      uniforms.uGrain.value = s.grain; uniforms.uVignette.value = s.vignette
    },
    render(renderer: WebGLRenderer) { renderer.render(scene, camera) },
    dispose() { geometry.dispose(); material.dispose() },
  }
}
