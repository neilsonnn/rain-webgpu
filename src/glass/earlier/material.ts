import { Matrix4, MeshPhysicalMaterial, Vector2, Vector4 } from 'three'
import type { Texture } from 'three'
import { defaults, optics } from './settings'
import { rainGlassParsGLSL } from '../rain/shaders'

export const GLASS_SAMPLES = 24

export const glassParsGLSL = /* glsl */`
uniform sampler2D uGardenColor;
uniform sampler2D uGardenDepth;
uniform sampler2D uWireColor;
uniform sampler2D uWireDepthMap;
uniform sampler2D uGlassTexture;
uniform sampler2D uRearTexture;
uniform vec2 uGlassResolution;
uniform vec2 uCameraClip;
uniform mat4 uGlassProjection;
uniform mat4 uGardenProjection;
uniform mat4 uGlassView;
uniform float uGlassRelief;
uniform float uTextureScale;
uniform float uRearRelief;
uniform float uGlassDiffusion;
uniform float uFrontRoughness;
uniform float uGridPitch;
uniform vec2 uGridOrigin;
uniform float uGridWarp;
uniform float uGridRelief;
uniform float uGridWidth;
uniform float uGridPebbling;
uniform float uEmbeddedMesh;
uniform float uPaneThickness;
uniform float uPaneSide;
uniform float uWireDepth;
uniform float uDepthStrength;
uniform float uDepthScale;
uniform float uDepthCurve;
uniform float uClearDepth;
${rainGlassParsGLSL}
varying vec3 vPanePosition;
// Canonical space always looks through an entry face at z = 0 toward a rear
// face at -thickness. This reflection is its own inverse, so both sides retain
// the same physical ray solver while projections stay in world coordinates.
vec3 paneCoordinates(vec3 point) {
  return uPaneSide > 0. ? point : vec3(point.xy, -point.z - uPaneThickness);
}
vec3 paneDirection(vec3 direction) { return vec3(direction.xy, direction.z * uPaneSide); }
vec4 paneReverseField(vec4 field) { return vec4(1. - field.xy, field.z, 1. - field.a); }
vec4 paneEntryField(vec2 point) {
  vec2 uv = point / (${optics.textureSize.toFixed(3)} * uTextureScale);
  return uPaneSide > 0. ? texture2D(uGlassTexture, uv) : paneReverseField(texture2D(uRearTexture, uv));
}
vec4 paneExitField(vec2 point) {
  vec2 uv = point / (${optics.textureSize.toFixed(3)} * uTextureScale);
  return uPaneSide > 0. ? texture2D(uRearTexture, uv) : paneReverseField(texture2D(uGlassTexture, uv));
}
vec3 paneSurfaceNormal(vec4 field, float relief) {
  vec3 encoded = field.xyz * 2. - 1.;
  // Enlarging a fixed-height pebble field reduces its physical slope. The
  // same scale is used for ray entry, both interfaces, and reflected light.
  return normalize(vec3(encoded.xy * relief / uTextureScale, max(.05, encoded.z)));
}
float paneHeight(vec4 field, float relief) { return (field.a - .5) * .0016 * relief; }
// A single height surface covers the rounded lattice and each pebbled cell.
// Its analytic gradient drives BOTH Fresnel reflection and Snell refraction.
vec4 panePatternedSurface(vec2 point, vec4 rolledField, float relief, float latticeRelief) {
  vec3 rolledNormal = paneSurfaceNormal(rolledField, relief);
  vec2 rolledGradient = -rolledNormal.xy / max(.05, rolledNormal.z);
  float rolledHeight = paneHeight(rolledField, relief);
  vec2 warp = vec2(sin(point.y * 7.1), sin(point.x * 6.3)) * uGridWarp;
  vec2 distanceToCrest = (fract((point - uGridOrigin - warp) / uGridPitch + .5) - .5) * uGridPitch;
  vec2 crests = exp(-.5 * distanceToCrest * distanceToCrest / (uGridWidth * uGridWidth));
  vec2 crestSlopes = -distanceToCrest * crests / (uGridWidth * uGridWidth);
  // A smooth union avoids doubling the height at a grid crossing.
  float latticeHeight = crests.x + crests.y - crests.x * crests.y;
  vec2 latticeGradient = vec2(
    (1. - crests.y) * crestSlopes.x - (1. - crests.x) * crestSlopes.y * cos(point.x * 6.3) * uGridWarp * 6.3,
    (1. - crests.x) * crestSlopes.y - (1. - crests.y) * crestSlopes.x * cos(point.y * 7.1) * uGridWarp * 7.1
  );
  float modulationSign = latticeRelief < 0. ? -1. : 1.;
  float heightRatio = rolledHeight / .0008 * modulationSign;
  float crestModulation = 1. + uGridPebbling * clamp(heightRatio, -.6, .6);
  vec2 modulationGradient = abs(heightRatio) < .6 ? uGridPebbling * rolledGradient / .0008 * modulationSign : vec2(0.);
  float height = rolledHeight + latticeRelief * latticeHeight * crestModulation;
  vec2 gradient = rolledGradient + latticeRelief * (latticeGradient * crestModulation + latticeHeight * modulationGradient);
  return vec4(normalize(vec3(-gradient, 1.)), height);
}
vec4 paneFrontSurface(vec2 point, vec4 field) {
  return panePatternedSurface(point, field, uPaneSide > 0. ? uGlassRelief : uRearRelief, uPaneSide > 0. ? uGridRelief : 0.);
}
vec4 paneRearSurface(vec2 point, vec4 field) {
  float relief = uPaneSide > 0. ? uRearRelief : uGlassRelief;
  if (uPaneSide > 0. || uGridRelief <= 0.) return vec4(paneSurfaceNormal(field, relief), paneHeight(field, relief));
  return panePatternedSurface(point, field, relief, -uGridRelief);
}
vec2 paneProject(vec3 worldPosition) {
  vec4 clipPosition = uGlassProjection * uGlassView * vec4(paneCoordinates(worldPosition), 1.);
  return clipPosition.xy / max(.001, clipPosition.w) * .5 + .5;
}
vec2 paneGardenProject(vec3 worldPosition) {
  vec4 clipPosition = uGardenProjection * uGlassView * vec4(paneCoordinates(worldPosition), 1.);
  return clipPosition.xy / max(.001, clipPosition.w) * .5 + .5;
}
float paneFresnel(float cosine, float etaIncident, float etaTransmitted) {
  float c = clamp(abs(cosine), 0., 1.);
  float sineSquared = pow(etaIncident / etaTransmitted, 2.) * (1. - c * c);
  if (sineSquared >= 1.) return 1.;
  float ct = sqrt(max(0., 1. - sineSquared));
  float rs = (etaIncident * c - etaTransmitted * ct) / max(.00001, etaIncident * c + etaTransmitted * ct);
  float rp = (etaTransmitted * c - etaIncident * ct) / max(.00001, etaTransmitted * c + etaIncident * ct);
  return .5 * (rs * rs + rp * rp);
}
mat3 paneFrame(vec3 n) {
  vec3 tangent = normalize(cross(abs(n.z) < .999 ? vec3(0., 0., 1.) : vec3(0., 1., 0.), n));
  return mat3(tangent, cross(n, tangent), n);
}
// Visible-normal sampling of an isotropic GGX microsurface (Heitz 2018).
vec3 paneVisibleNormal(vec3 towardViewer, vec3 macroNormal, float alpha, vec2 xi) {
  mat3 frame = paneFrame(macroNormal);
  vec3 localView = transpose(frame) * towardViewer;
  vec3 stretched = normalize(vec3(localView.xy * alpha, max(.0001, localView.z)));
  float lengthSquared = dot(stretched.xy, stretched.xy);
  vec3 first = lengthSquared > .00001 ? vec3(-stretched.y, stretched.x, 0.) / sqrt(lengthSquared) : vec3(1., 0., 0.);
  vec3 second = cross(stretched, first);
  float radius = sqrt(xi.x), angle = 6.28318530718 * xi.y;
  vec2 disk = radius * vec2(cos(angle), sin(angle));
  float blend = .5 * (1. + stretched.z);
  disk.y = mix(sqrt(max(0., 1. - disk.x * disk.x)), disk.y, blend);
  vec3 hemisphere = first * disk.x + second * disk.y + stretched * sqrt(max(0., 1. - dot(disk, disk)));
  return normalize(frame * vec3(hemisphere.xy * alpha, max(.0001, hemisphere.z)));
}
float paneLambda(vec3 direction, vec3 n, float alpha) {
  float c = max(.0001, abs(dot(direction, n)));
  return .5 * (sqrt(1. + alpha * alpha * max(0., 1. - c * c) / (c * c)) - 1.);
}
float paneMaskingWeight(vec3 incident, vec3 outgoing, vec3 n, float alpha) {
  float lambdaIn = paneLambda(incident, n, alpha);
  return (1. + lambdaIn) / (1. + lambdaIn + paneLambda(outgoing, n, alpha));
}
float paneDepthResponse(float physicalDistance) {
  return uDepthStrength * uDepthScale * pow(max(0., physicalDistance - uClearDepth) / uDepthScale, uDepthCurve);
}
vec3 paneAbsorption(float distanceThroughGlass) {
  // Absorption depends on travel inside the glass, never garden depth.
  return exp(-vec3(1.8, .42, .85) * distanceThroughGlass);
}
float paneRadicalInverse(float index) {
  float result = 0., significance = .5;
  for (int bit = 0; bit < 6; bit++) {
    result += mod(index, 2.) * significance;
    index = floor(index * .5); significance *= .5;
  }
  return result;
}
`

export const glassFunctionsGLSL = /* glsl */`
vec3 paneEnvironment(vec3 direction, float surfaceRoughness) {
  #ifdef ENVMAP_TYPE_CUBE_UV
    return textureCubeUV(envMap, envMapRotation * paneDirection(direction), surfaceRoughness).rgb * envMapIntensity;
  #else
    return vec3(0.);
  #endif
}
vec3 paneTraceGarden(vec3 startPoint, vec3 direction, out float travel) {
  vec3 viewStart = (uGlassView * vec4(paneCoordinates(startPoint), 1.)).xyz;
  vec3 viewDirection = (uGlassView * vec4(paneDirection(direction), 0.)).xyz;
  vec2 sampleUV = clamp(paneGardenProject(startPoint), vec2(.001), vec2(.999));
  travel = .5;
  // Reproject against actual depth, including refracted leaf silhouettes.
  for (int refinement = 0; refinement < 3; refinement++) {
    float sceneDepth = -perspectiveDepthToViewZ(texture2D(uGardenDepth, sampleUV).r, uCameraClip.x, uCameraClip.y);
    travel = clamp((sceneDepth + viewStart.z) / max(.08, -viewDirection.z), .0005, 14.);
    sampleUV = clamp(paneGardenProject(startPoint + direction * travel), vec2(.001), vec2(.999));
  }
  return startPoint + direction * travel;
}
`

export const glassNormalGLSL = /* glsl */`
vec3 paneEntryPoint = paneCoordinates(vPanePosition);
vec3 paneIncident = normalize(paneEntryPoint - paneCoordinates(cameraPosition));
vec3 paneFrontPoint = paneEntryPoint;
vec4 paneFrontField;
vec4 paneFrontShape;
// Intersect the height surface along the camera ray, including at oblique views.
for (int frontRefinement = 0; frontRefinement < 3; frontRefinement++) {
  paneFrontField = paneEntryField(paneFrontPoint.xy);
  paneFrontShape = paneFrontSurface(paneFrontPoint.xy, paneFrontField);
  paneFrontPoint = paneEntryPoint + paneIncident * (paneFrontShape.a / min(-.08, paneIncident.z));
}
vec3 paneFrontNormal = paneFrontShape.xyz;
// Resolved water caps carry their own gradient and index. A thick bead
// fills the rolled relief; its air/water surface becomes smoother than glass.
vec4 paneWater = paneRainField(paneFrontPoint.xy);
float paneWaterCoverage = smoothstep(.01, .65, paneWater.a);
float paneWaterHeight = paneWater.z * .001;
vec2 paneGlassSlope = -paneFrontNormal.xy / max(.05, paneFrontNormal.z);
vec3 paneWaterNormal = normalize(vec3(-(paneWater.xy + paneGlassSlope * exp(-paneWaterHeight / .00018)), 1.));
vec3 paneWetIncident = refract(paneIncident, paneWaterNormal, 1. / 1.333);
if (paneWetIncident.z > -.02) paneWetIncident = paneIncident;
vec3 paneLayerIncident = normalize(mix(paneIncident, paneWetIncident, paneWaterCoverage));
float paneEntryEta = mix(1., 1.333, paneWaterCoverage);
float paneWaterTransmission = mix(1., 1. - paneFresnel(dot(-paneIncident, paneWaterNormal), 1., 1.333), paneWaterCoverage);
paneFrontPoint.xy += paneLayerIncident.xy * paneWaterHeight * paneWaterCoverage / max(.08, -paneLayerIncident.z);
// Water reflection and glass transmission share the same geometric water field.
vec3 paneReflectionNormal = normalize(mix(paneFrontNormal, paneWaterNormal, paneWaterCoverage));
normal = normalize((uGlassView * vec4(paneDirection(paneReflectionNormal), 0.)).xyz);
roughnessFactor = mix(roughnessFactor, .045, paneWaterCoverage);
`

export const glassTransmissionGLSL = /* glsl */`
// Front polish and rear scattering belong to distinct physical interfaces.
float paneAlpha = max(.0001, uFrontRoughness * uFrontRoughness);
float paneRearAlpha = max(.0001, uGlassDiffusion * uGlassDiffusion * .82);
vec3 paneCentralInside = refract(paneLayerIncident, paneFrontNormal, paneEntryEta / material.ior);
vec3 paneCentralRear = paneFrontPoint + paneCentralInside * ((-uPaneThickness - paneFrontPoint.z) / min(-.08, paneCentralInside.z));
vec4 paneCentralRearField = paneExitField(paneCentralRear.xy);
vec3 paneCentralRearNormal = paneRearSurface(paneCentralRear.xy, paneCentralRearField).xyz;
vec3 paneCentralExit = refract(paneCentralInside, paneCentralRearNormal, material.ior);
if (dot(paneCentralExit, paneCentralExit) < .001 || paneCentralExit.z > -.02) paneCentralExit = paneIncident;
float paneCentralTravel;
vec3 paneCentralHit = paneTraceGarden(paneCentralRear, paneCentralExit, paneCentralTravel);
vec3 paneCentralReturn = refract(reflect(paneCentralInside, paneCentralRearNormal), -paneFrontNormal, material.ior);
if (dot(paneCentralReturn, paneCentralReturn) < .001) paneCentralReturn = -paneIncident;
// PMREM integrates the environment lobe of the first internal reflection.
vec3 paneInternalEnvironment = paneEnvironment(paneCentralReturn, min(1., uGlassDiffusion * 1.3));
vec3 paneRadiance = vec3(0.);
for (int paneRay = 0; paneRay < ${GLASS_SAMPLES}; paneRay++) {
  vec2 xi = vec2((float(paneRay) + .5) / ${GLASS_SAMPLES.toFixed(1)}, paneRadicalInverse(float(paneRay)));
  vec3 frontMicroNormal = paneVisibleNormal(-paneLayerIncident, paneFrontNormal, paneAlpha, xi);
  vec3 insideDirection = refract(paneLayerIncident, frontMicroNormal, paneEntryEta / material.ior);
  float frontFresnel = paneFresnel(dot(-paneLayerIncident, frontMicroNormal), paneEntryEta, material.ior);
  float frontWeight = paneWaterTransmission * (1. - frontFresnel) * paneMaskingWeight(paneLayerIncident, insideDirection, paneFrontNormal, paneAlpha);
  // Sample the actual cylindrical wire at its physical position INSIDE the slab.
  float wireTravel = max(0., (-uWireDepth - paneFrontPoint.z) / min(-.08, insideDirection.z));
  vec3 wirePoint = paneFrontPoint + insideDirection * wireTravel;
  vec2 wireUV = clamp(paneProject(wirePoint), vec2(.001), vec2(.999));
  // Refraction can stretch one output pixel across several wire-buffer texels.
  // Filter that footprint rather than point-sampling the finest level forever.
  vec2 wireDx = dFdx(wireUV), wireDy = dFdy(wireUV);
  vec4 wireSample = vec4(0.);
  if (uEmbeddedMesh > .5) wireSample = textureGrad(uWireColor, wireUV, wireDx, wireDy);
  if (uEmbeddedMesh > .5 && wireSample.a > .001) {
    float wireViewDepth = -perspectiveDepthToViewZ(texture2D(uWireDepthMap, wireUV).r, uCameraClip.x, uCameraClip.y);
    vec3 frontViewPoint = (uGlassView * vec4(paneCoordinates(paneFrontPoint), 1.)).xyz;
    vec3 insideViewDirection = (uGlassView * vec4(paneDirection(insideDirection), 0.)).xyz;
    float resolvedTravel = (wireViewDepth + frontViewPoint.z) / max(.08, -insideViewDirection.z);
    // The resolved depth must belong to the embedded volume, not clear pixels.
    if (resolvedTravel >= 0. && resolvedTravel < uPaneThickness * 3.) {
      wireTravel = resolvedTravel;
      wirePoint = paneFrontPoint + insideDirection * wireTravel;
      wireSample = textureGrad(uWireColor, clamp(paneProject(wirePoint), vec2(.001), vec2(.999)), wireDx, wireDy);
    }
  }
  // MSAA resolve premultiplies coverage into RGB; do not apply alpha twice.
  vec3 wireRadiance = wireSample.rgb * paneAbsorption(wireTravel);
  float insideTravel = max(.0001, (-uPaneThickness - paneFrontPoint.z) / min(-.08, insideDirection.z));
  vec3 rearPoint = paneFrontPoint + insideDirection * insideTravel;
  vec4 rearField = paneExitField(rearPoint.xy);
  vec4 rearShape = paneRearSurface(rearPoint.xy, rearField);
  insideTravel = max(.0001, (-uPaneThickness + rearShape.a - paneFrontPoint.z) / min(-.08, insideDirection.z));
  rearPoint = paneFrontPoint + insideDirection * insideTravel;
  vec3 rearNormal = rearShape.xyz;
  vec3 rearMicroNormal = paneVisibleNormal(-insideDirection, rearNormal, paneRearAlpha, fract(xi.yx + vec2(.381966, .754877)));
  vec3 exitDirection = refract(insideDirection, rearMicroNormal, material.ior);
  float rearFresnel = paneFresnel(dot(-insideDirection, rearMicroNormal), material.ior, 1.);
  vec3 gardenRadiance = vec3(0.);
  if (dot(exitDirection, exitDirection) > .001 && exitDirection.z < -.02) {
    float physicalTravel;
    vec3 physicalHit = paneTraceGarden(rearPoint, exitDirection, physicalTravel);
    float effectiveTravel = paneDepthResponse(physicalTravel);
    // Unit strength/curve and zero clear zone recover physical propagation.
    float depthRemap = effectiveTravel / max(.0005, physicalTravel);
    vec3 remappedHit = paneCentralHit + (physicalHit - paneCentralHit) * depthRemap;
    vec2 gardenUV = clamp(paneGardenProject(remappedHit), vec2(.001), vec2(.999));
    float viewDepth = max(.1, -(uGlassView * vec4(paneCoordinates(physicalHit), 1.)).z);
    float angularWidth = sqrt(paneAlpha * paneAlpha + paneRearAlpha * paneRearAlpha) * (material.ior - 1.) * 2.2;
    float footprintPixels = abs(uGardenProjection[1][1]) * angularWidth * effectiveTravel / viewDepth * .5 * uGlassResolution.y;
    // Each importance sample covers a finite solid angle. Mip filtering removes
    // undersampling at large footprints without imposing the previous blur cap.
    float maxMip = max(0., floor(log2(max(uGlassResolution.x, uGlassResolution.y))) - 2.);
    float footprintMip = clamp(log2(max(1., footprintPixels / sqrt(${GLASS_SAMPLES.toFixed(1)}))), 0., maxMip);
    float rearWeight = (1. - rearFresnel) * paneMaskingWeight(insideDirection, exitDirection, rearNormal, paneRearAlpha);
    gardenRadiance = textureLod(uGardenColor, gardenUV, footprintMip).rgb * rearWeight * paneAbsorption(insideTravel);
  }
  // First internal reflection, including total internal reflection. Further
  // interreflection remains a bounded real-time approximation.
  vec3 backReflection = reflect(insideDirection, rearMicroNormal);
  vec3 returnToAir = refract(backReflection, -frontMicroNormal, material.ior);
  float returnFresnel = paneFresnel(dot(backReflection, frontMicroNormal), material.ior, 1.);
  vec3 internalRadiance = vec3(0.);
  if (dot(returnToAir, returnToAir) > .001 && returnToAir.z > 0.) {
    internalRadiance = paneInternalEnvironment
      * rearFresnel * (1. - returnFresnel) * paneAbsorption(insideTravel * 2.);
  }
  paneRadiance += frontWeight * (wireRadiance + (1. - wireSample.a) * (gardenRadiance + internalRadiance));
}
// Front GGX reflection is already in totalSpecular. Transmission never adds
// diffuse glass paint or an opacity overlay to the surface.
totalDiffuse = paneRadiance / ${GLASS_SAMPLES.toFixed(1)};
`

export function createGlassMaterial(color: Texture, depth: Texture, front: Texture, rear: Texture, wire: Texture, wireDepth: Texture,
  grid?: { origin: Vector2; warp: { value: number } }) {
  const material = new MeshPhysicalMaterial({ color: '#ffffff', metalness: 0, roughness: defaults.surfaceRoughness, ior: optics.ior, envMapIntensity: .7 })
  const uniforms = {
    uGardenColor: { value: color }, uGardenDepth: { value: depth }, uWireColor: { value: wire }, uWireDepthMap: { value: wireDepth },
    uGlassTexture: { value: front }, uRearTexture: { value: rear },
    uRainWater: { value: front }, uRainBounds: { value: new Vector4(-2.4, -.6, 4.8, 4.8) },
    uRainWetness: { value: 0 }, uRainTexel: { value: 1 / 1024 }, uRainDirectField: { value: 0 },
    uGlassResolution: { value: new Vector2(1, 1) }, uCameraClip: { value: new Vector2(.05, 60) },
    uGlassProjection: { value: new Matrix4() }, uGardenProjection: { value: new Matrix4() }, uGlassView: { value: new Matrix4() },
    uGlassRelief: { value: defaults.relief }, uRearRelief: { value: defaults.rearRelief },
    uTextureScale: { value: defaults.textureScale },
    uGlassDiffusion: { value: defaults.diffusion }, uPaneThickness: { value: optics.thickness as number },
    uPaneSide: { value: 1 },
    uFrontRoughness: { value: defaults.surfaceRoughness }, uGridPitch: { value: defaults.wireSpacing },
    uGridOrigin: { value: grid?.origin ?? new Vector2() }, uGridWarp: grid?.warp ?? { value: -.00008 },
    uGridRelief: { value: defaults.gridRelief }, uGridWidth: { value: defaults.gridWidth },
    uGridPebbling: { value: defaults.gridPebbling }, uEmbeddedMesh: { value: Number(defaults.embeddedMesh) },
    uWireDepth: { value: .003 }, uDepthStrength: { value: defaults.depthStrength },
    uDepthScale: { value: defaults.depthScale }, uDepthCurve: { value: defaults.depthCurve }, uClearDepth: { value: defaults.clearDepth },
  }
  material.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, uniforms)
    shader.vertexShader = 'varying vec3 vPanePosition;\n' + shader.vertexShader
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvPanePosition = (modelMatrix * vec4(position, 1.)).xyz;')
    shader.fragmentShader = glassParsGLSL + shader.fragmentShader
      .replace('#include <transmission_pars_fragment>', `#include <transmission_pars_fragment>\n${glassFunctionsGLSL}`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>\n${glassNormalGLSL}`)
      .replace('#include <lights_physical_fragment>', `#include <lights_physical_fragment>\nmaterial.specularColor = mix(material.specularColor, vec3(.02037), paneWaterCoverage);`)
      .replace('#include <transmission_fragment>', glassTransmissionGLSL)
  }
  material.customProgramCacheKey = () => 'continuous-patterned-glass-v8-fluid'
  return { material, uniforms }
}
