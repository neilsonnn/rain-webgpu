import { Color, MeshDepthMaterial, MeshStandardMaterial, RGBADepthPacking, Vector2, Vector4 } from 'three'
import type { DataTexture } from 'three'
import type { CityData } from './data'
import { CHESS_MATERIALS } from '../chess/render/appearance'
import { defaults } from './types'

const declarations = /* glsl */ `
attribute vec2 cityUV;
// Three binds Uint32 attributes with vertexAttribIPointer, so this input must
// stay unsigned integer in both the visible and shadow vertex programs.
attribute uint cityID;
uniform sampler2D uCityData;
uniform sampler2D uGround;
uniform sampler2D uLocalOrigins;
uniform vec2 uLocalSize;
uniform vec2 uDataSize;
uniform vec4 uBounds;
uniform vec4 uGridBounds;
uniform float uMorph, uMode, uHeight, uRiseEase, uTerrain, uSwell, uWave, uGap, uGuard, uLocal, uUnmatched;
varying float cityParity;
float cityEase(float x) { float t = clamp(x, 0., 1.); if (t < .000001) return 0.; if (t > .999999) return 1.; return clamp(t*t*t*(t*(t*6.-15.)+10.), 0., 1.); }
vec4 cityRecord(int id, int slot) {
  int index = id * 4 + slot;
  return texelFetch(uCityData, ivec2(index % int(uDataSize.x), index / int(uDataSize.x)), 0);
}
float cityGround(vec2 xz) {
  ivec2 dimensions = textureSize(uGround, 0);
  vec2 grid = clamp((xz - uBounds.xz) / (uBounds.yw - uBounds.xz), 0., 1.) * vec2(dimensions - 1);
  ivec2 a = ivec2(floor(grid)), b = min(a + 1, dimensions - 1);
  vec2 f = fract(grid);
  return mix(mix(texelFetch(uGround, a, 0).r, texelFetch(uGround, ivec2(b.x, a.y), 0).r, f.x),
    mix(texelFetch(uGround, ivec2(a.x, b.y), 0).r, texelFetch(uGround, b, 0).r, f.x), f.y);
}
vec3 cityPosition(vec3 vertex) {
  vec4 a = cityRecord(int(cityID), 0);
  vec4 box = cityRecord(int(cityID), 1);
  vec4 b = cityRecord(int(cityID), 2);
  vec4 c = cityRecord(int(cityID), 3);
  cityParity = a.z;
  float t = clamp(uMorph, 0., 1.);
  float localT = uMode > .5 && uMode < 1.5 ? clamp(t - c.x*uWave*sin(3.14159265*t), 0., 1.) : t;
  bool flow = uMode > 1.5;
  float rise = flow ? pow(t, uRiseEase) : cityEase((localT - .58) / .42);
  vec2 target = vec2(mix(uBounds.x, uBounds.y, vertex.x), mix(uBounds.z, uBounds.w, vertex.z));
  if (vertex.y > .25 && vertex.y < .75) target = b.xy;
  vec2 original = a.xy + cityUV * c.z;
  if (uLocal > .5) {
    int id = int(cityID);
    vec4 source = texelFetch(uLocalOrigins, ivec2(id % int(uLocalSize.x), id / int(uLocalSize.x)), 0);
    original = source.xy + cityUV * source.z;
    cityParity = source.w;
    // A zero-width source has no grid tile. In strict mode all its vertices
    // stay at one point, including shadow vertices: no extra building appears.
    if (source.z == 0. && uUnmatched < .5) return vec3(source.x, 0., source.y);
  }
  vec2 xz;
  if (flow) {
    // Every vertex goes straight from its square to the actual footprint.
    // No fitted miniature footprint, parcel transfer, or late scale release.
    xz = mix(original, target, t);
  } else {
    float layoutProgress = cityEase(t / .52);
    float shape = cityEase((t - .25) / .45);
    float release = cityEase((t - .74) / .26);
    vec2 safe = b.xy + (target - b.xy) * b.w;
    vec2 safeUV = clamp((safe - box.xz) / max(vec2(.000001), box.yw - box.xz), 0., 1.);
    vec4 startBox = vec4(a.x, a.x + c.z, a.y, a.y + c.z);
    vec4 movingBox = mix(startBox, box, layoutProgress);
    vec2 uv = mix(cityUV, safeUV, shape);
    uv = mix(uv, vec2(.5), uGap * sin(3.14159265 * t));
    vec2 protectedXZ = mix(movingBox.xz, movingBox.yw, uv);
    protectedXZ = mix(protectedXZ, target, release);
    xz = mix(mix(original, target, cityEase(t)), protectedXZ, uGuard);
  }
  // The field is evaluated in source space, shared by every tile; no random
  // offsets or per-building animation clocks can tear the moving partitions.
  vec2 middle = vec2((uGridBounds.x + uGridBounds.y) * .5, (uGridBounds.z + uGridBounds.w) * .5);
  float size = max(uGridBounds.y - uGridBounds.x, uGridBounds.w - uGridBounds.z);
  float radius = length(original - middle) / size;
  float dome = max(0., 1. - radius * radius * 3.);
  float swell = sin(3.14159265 * t) * dome * uSwell;
  if (uMode > .5 && uMode < 1.5) swell *= .65 + .35 * cos(radius * 12. - t * 6.);
  float terrain = b.z;
  if (uTerrain > 0. && t > .000001 && rise < .999999) terrain = mix(cityGround(xz), b.z, rise);
  terrain *= uTerrain * cityEase(t);
  float height = step(.25, vertex.y) * a.w * uHeight * rise;
  // Blank padding squares collapse to a point without leaving phantom towers.
  if (c.y < .5) xz = flow ? mix(original, b.xy, t) : mix(xz, b.xy, cityEase(t));
  return vec3(xz.x, terrain + swell + height, xz.y);
}
`
export function tileFragment(source: string) {
  return 'varying float cityParity; uniform vec3 uDarkTile;\n' + source
    .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= mix(vec3(1.), uDarkTile, cityParity);')
    .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = mix(.04, .06, cityParity);')
}
export function cityMaterials(data: CityData, bounds: number[], ground: DataTexture) {
  const uniforms = {
    uCityData: { value: data.texture }, uDataSize: { value: new Vector2(...data.textureSize) },
    uGround: { value: ground },
    uLocalOrigins: { value: data.texture }, uLocalSize: { value: new Vector2(1, 1) }, uLocal: { value: 0 }, uUnmatched: { value: Number(defaults.unmatched === 'grow') },
    uBounds: { value: new Vector4(...bounds as [number, number, number, number]) },
    uGridBounds: { value: new Vector4(...data.gridBounds) },
    uMorph: { value: 0 }, uMode: { value: 2 }, uHeight: { value: defaults.height }, uRiseEase: { value: defaults.riseEase }, uTerrain: { value: defaults.terrain },
    uSwell: { value: defaults.swell }, uWave: { value: defaults.wave }, uGap: { value: defaults.gap }, uGuard: { value: Number(defaults.guard) },
    uDarkTile: { value: new Color(CHESS_MATERIALS[1].color) },
  }
  const material = new MeshStandardMaterial({ ...CHESS_MATERIALS[0], flatShading: true })
  material.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, uniforms)
    shader.vertexShader = declarations + shader.vertexShader.replace('#include <begin_vertex>', 'vec3 transformed = cityPosition(position);')
    shader.fragmentShader = tileFragment(shader.fragmentShader)
  }
  material.customProgramCacheKey = () => 'city-local-v9'
  const depth = new MeshDepthMaterial({ depthPacking: RGBADepthPacking })
  depth.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, uniforms)
    shader.vertexShader = declarations + shader.vertexShader.replace('#include <begin_vertex>', 'vec3 transformed = cityPosition(position);')
  }
  depth.customProgramCacheKey = () => 'city-local-depth-v9'
  return { material, depth, uniforms }
}
