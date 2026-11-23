import { Matrix4, MeshPhysicalMaterial, Vector2, Vector4 } from 'three'
import type { Texture } from 'three'
import { defaults, optics } from './settings'
import { rainGlassParsGLSL } from '../rain/shaders'
import { defaultQuality, fillGlassDisks, maxGlassRays } from '../quality'
import type { GpuQuality } from '../quality'

export const GLASS_SAMPLES = defaultQuality.rays

export const glassParsGLSL = /* glsl */`
uniform sampler2D uGardenColor;
uniform sampler2D uGardenDepth;
uniform sampler2D uWireColor;
uniform sampler2D uWireDepthMap;
uniform sampler2D uGlassTexture;
uniform sampler2D uRearTexture;
uniform vec2 uGlassResolution;
uniform vec2 uCameraClip;
uniform mat4 uGlassViewProjection;
uniform mat4 uGardenViewProjection;
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
uniform float uWireDepth;
uniform float uDepthStrength;
uniform float uDepthScale;
uniform float uDepthCurve;
uniform float uClearDepth;
${rainGlassParsGLSL}
varying vec3 vPanePosition;
vec4 paneEntryField(vec2 point) {
  vec2 uv = point / (${optics.textureSize.toFixed(3)} * uTextureScale);
  return texture2D(uGlassTexture, uv);
}
vec4 paneExitField(vec2 point) {
  vec2 uv = point / (${optics.textureSize.toFixed(3)} * uTextureScale);
  return texture2D(uRearTexture, uv);
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
  if (latticeRelief == 0.) return vec4(normalize(vec3(-rolledGradient, 1.)), rolledHeight);
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
  float heightRatio = rolledHeight / .0008;
  float crestModulation = 1. + uGridPebbling * clamp(heightRatio, -.6, .6);
  vec2 modulationGradient = abs(heightRatio) < .6 ? uGridPebbling * rolledGradient / .0008 : vec2(0.);
  float height = rolledHeight + latticeRelief * latticeHeight * crestModulation;
  vec2 gradient = rolledGradient + latticeRelief * (latticeGradient * crestModulation + latticeHeight * modulationGradient);
  return vec4(normalize(vec3(-gradient, 1.)), height);
}
vec4 paneFrontSurface(vec2 point, vec4 field) {
  return panePatternedSurface(point, field, uGlassRelief, uGridRelief);
}
vec4 paneRearSurface(vec4 field) {
  return vec4(paneSurfaceNormal(field, uRearRelief), paneHeight(field, uRearRelief));
}
vec2 paneProject(vec3 worldPosition) {
  vec4 clipPosition = uGlassViewProjection * vec4(worldPosition, 1.);
  return clipPosition.xy / max(.001, clipPosition.w) * .5 + .5;
}
vec2 paneGardenProject(vec3 worldPosition) {
  vec4 clipPosition = uGardenViewProjection * vec4(worldPosition, 1.);
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
mat3 paneSamplingFrame(vec3 towardViewer, mat3 frame, float alpha) {
  vec3 localView = transpose(frame) * towardViewer;
  vec3 stretched = normalize(vec3(localView.xy * alpha, max(.0001, localView.z)));
  float lengthSquared = dot(stretched.xy, stretched.xy);
  vec3 first = lengthSquared > .00001 ? vec3(-stretched.y, stretched.x, 0.) / sqrt(lengthSquared) : vec3(1., 0., 0.);
  vec3 second = cross(stretched, first);
  return mat3(first, second, stretched);
}
vec3 paneVisibleNormal(mat3 frame, mat3 sampleFrame, float alpha, vec2 disk) {
  vec3 first = sampleFrame[0], second = sampleFrame[1], stretched = sampleFrame[2];
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
uniform int uScatterRays, uDepthSteps, uEntrySteps;
uniform bool uInternalReflection;
uniform vec4 uPaneDisks[${maxGlassRays}];
`

export const glassFunctionsGLSL = /* glsl */`
vec3 paneEnvironment(vec3 direction, float surfaceRoughness) {
  #ifdef ENVMAP_TYPE_CUBE_UV
    return textureCubeUV(envMap, envMapRotation * direction, surfaceRoughness).rgb * envMapIntensity;
  #else
    return vec3(0.);
  #endif
}
vec3 paneTraceGarden(vec3 startPoint, vec3 direction, out float travel) {
  vec3 viewStart = (uGlassView * vec4(startPoint, 1.)).xyz;
  vec3 viewDirection = (uGlassView * vec4(direction, 0.)).xyz;
  vec4 clipStart = uGardenProjection * vec4(viewStart, 1.);
  vec4 clipDirection = uGardenProjection * vec4(viewDirection, 0.);
  vec4 clip = clipStart;
  float depthRate = max(.08, -viewDirection.z);
  // Reproject against actual depth, including refracted leaf silhouettes.
  for (int refinement = 0; refinement < uDepthSteps; refinement++) {
    vec2 sampleUV = clamp(clip.xy / max(.001, clip.w) * .5 + .5, vec2(.001), vec2(.999));
    float sceneDepth = -perspectiveDepthToViewZ(texture2D(uGardenDepth, sampleUV).r, uCameraClip.x, uCameraClip.y);
    travel = clamp((sceneDepth + viewStart.z) / depthRate, .0005, 14.);
    clip = clipStart + clipDirection * travel;
  }
  return startPoint + direction * travel;
}
`

export const glassNormalGLSL = /* glsl */`
vec3 paneEntryPoint = vPanePosition;
vec3 paneIncident = normalize(paneEntryPoint - cameraPosition);
vec3 paneFrontPoint = paneEntryPoint;
vec4 paneFrontField;
vec4 paneFrontShape;
// Intersect the height surface along the camera ray, including at oblique views.
for (int frontRefinement = 0; frontRefinement < uEntrySteps; frontRefinement++) {
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
normal = normalize((uGlassView * vec4(paneReflectionNormal, 0.)).xyz);
roughnessFactor = mix(roughnessFactor, .045, paneWaterCoverage);
`

export const glassTransmissionGLSL = /* glsl */`
// Front polish and rear scattering belong to distinct physical interfaces.
float paneAlpha = max(.0001, uFrontRoughness * uFrontRoughness);
float paneRearAlpha = max(.0001, uGlassDiffusion * uGlassDiffusion * .82);
vec3 paneCentralInside = refract(paneLayerIncident, paneFrontNormal, paneEntryEta / material.ior);
vec3 paneCentralRear = paneFrontPoint + paneCentralInside * ((-uPaneThickness - paneFrontPoint.z) / min(-.08, paneCentralInside.z));
vec4 paneCentralRearField = paneExitField(paneCentralRear.xy);
vec3 paneCentralRearNormal = paneSurfaceNormal(paneCentralRearField, uRearRelief);
vec3 paneCentralExit = refract(paneCentralInside, paneCentralRearNormal, material.ior);
if (dot(paneCentralExit, paneCentralExit) < .001 || paneCentralExit.z > -.02) paneCentralExit = paneIncident;
float paneCentralTravel;
vec3 paneCentralHit = paneTraceGarden(paneCentralRear, paneCentralExit, paneCentralTravel);
// PMREM integrates the environment lobe of the first internal reflection.
vec3 paneInternalEnvironment = vec3(0.);
if (uInternalReflection) {
  vec3 paneCentralReturn = refract(reflect(paneCentralInside, paneCentralRearNormal), -paneFrontNormal, material.ior);
  if (dot(paneCentralReturn, paneCentralReturn) < .001) paneCentralReturn = -paneIncident;
  paneInternalEnvironment = paneEnvironment(paneCentralReturn, min(1., uGlassDiffusion * 1.3));
}
vec3 paneRadiance = vec3(0.);
mat3 paneFrontFrame = paneFrame(paneFrontNormal);
mat3 paneFrontSampling = paneSamplingFrame(-paneLayerIncident, paneFrontFrame, paneAlpha);
float paneFootprint = abs(uGardenProjection[1][1]) * sqrt(paneAlpha * paneAlpha + paneRearAlpha * paneRearAlpha) * (material.ior - 1.) * 2.2 * .5 * uGlassResolution.y;
float paneMaxMip = max(0., floor(log2(max(uGlassResolution.x, uGlassResolution.y))) - 2.);
// The wire is embedded before the scattering exit face. Resolve its coverage
// once along the refracted central ray, including any deflection by water.
vec4 paneWire = vec4(0.);
if (uEmbeddedMesh > .5) {
  float wireTravel = max(0., (-uWireDepth - paneFrontPoint.z) / min(-.08, paneCentralInside.z));
  vec3 wirePoint = paneFrontPoint + paneCentralInside * wireTravel;
  vec2 wireUV = clamp(paneProject(wirePoint), vec2(.001), vec2(.999));
  // Refraction can stretch one output pixel across several wire-buffer texels.
  // Filter that footprint rather than point-sampling the finest level forever.
  vec2 wireDx = dFdx(wireUV), wireDy = dFdy(wireUV);
  paneWire = textureGrad(uWireColor, wireUV, wireDx, wireDy);
  if (paneWire.a > .001) {
    float wireViewDepth = -perspectiveDepthToViewZ(textureLod(uWireDepthMap, wireUV, 0.).r, uCameraClip.x, uCameraClip.y);
    float frontViewZ = (uGlassView * vec4(paneFrontPoint, 1.)).z;
    float insideViewZ = (uGlassView * vec4(paneCentralInside, 0.)).z;
    float resolvedTravel = (wireViewDepth + frontViewZ) / max(.08, -insideViewZ);
    // The resolved depth must belong to the embedded volume, not clear pixels.
    if (resolvedTravel >= 0. && resolvedTravel < uPaneThickness * 3.) {
      wireTravel = resolvedTravel;
      wirePoint = paneFrontPoint + paneCentralInside * wireTravel;
      paneWire = textureGrad(uWireColor, clamp(paneProject(wirePoint), vec2(.001), vec2(.999)), wireDx, wireDy);
    }
  }
  // MSAA resolve premultiplies coverage into RGB; do not apply alpha twice.
  float wireTransmission = paneWaterTransmission * (1. - paneFresnel(dot(-paneLayerIncident, paneFrontNormal), paneEntryEta, material.ior))
    * paneMaskingWeight(paneLayerIncident, paneCentralInside, paneFrontNormal, paneAlpha);
  paneWire.rgb *= paneAbsorption(wireTravel) * wireTransmission;
}
for (int paneRay = 0; paneRay < uScatterRays; paneRay++) {
  vec4 disks = uPaneDisks[paneRay];
  vec3 frontMicroNormal = paneVisibleNormal(paneFrontFrame, paneFrontSampling, paneAlpha, disks.xy);
  vec3 insideDirection = refract(paneLayerIncident, frontMicroNormal, paneEntryEta / material.ior);
  float frontFresnel = paneFresnel(dot(-paneLayerIncident, frontMicroNormal), paneEntryEta, material.ior);
  float frontWeight = paneWaterTransmission * (1. - frontFresnel) * paneMaskingWeight(paneLayerIncident, insideDirection, paneFrontNormal, paneAlpha);
  float insideTravel = max(.0001, (-uPaneThickness - paneFrontPoint.z) / min(-.08, insideDirection.z));
  vec3 rearPoint = paneFrontPoint + insideDirection * insideTravel;
  vec4 rearField = paneExitField(rearPoint.xy);
  vec4 rearShape = paneRearSurface(rearField);
  insideTravel = max(.0001, (-uPaneThickness + rearShape.a - paneFrontPoint.z) / min(-.08, insideDirection.z));
  rearPoint = paneFrontPoint + insideDirection * insideTravel;
  vec3 rearNormal = rearShape.xyz;
  mat3 rearFrame = paneFrame(rearNormal);
  vec3 rearMicroNormal = paneVisibleNormal(rearFrame, paneSamplingFrame(-insideDirection, rearFrame, paneRearAlpha), paneRearAlpha, disks.zw);
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
    float viewDepth = max(.1, -(uGlassView * vec4(physicalHit, 1.)).z);
    float footprintPixels = paneFootprint * effectiveTravel / viewDepth;
    // Each importance sample covers a finite solid angle. Mip filtering removes
    // undersampling at large footprints without imposing the previous blur cap.
    float footprintMip = clamp(log2(max(1., footprintPixels / sqrt(float(uScatterRays)))), 0., paneMaxMip);
    float rearWeight = (1. - rearFresnel) * paneMaskingWeight(insideDirection, exitDirection, rearNormal, paneRearAlpha);
    gardenRadiance = textureLod(uGardenColor, gardenUV, footprintMip).rgb * rearWeight * paneAbsorption(insideTravel);
  }
  // First internal reflection, including total internal reflection. Further
  // interreflection remains a bounded real-time approximation.
  vec3 internalRadiance = vec3(0.);
  if (uInternalReflection) {
    vec3 backReflection = reflect(insideDirection, rearMicroNormal);
    vec3 returnToAir = refract(backReflection, -frontMicroNormal, material.ior);
    if (dot(returnToAir, returnToAir) > .001 && returnToAir.z > 0.) {
      float returnFresnel = paneFresnel(dot(backReflection, frontMicroNormal), material.ior, 1.);
      internalRadiance = paneInternalEnvironment
        * rearFresnel * (1. - returnFresnel) * paneAbsorption(insideTravel * 2.);
    }
  }
  paneRadiance += frontWeight * (gardenRadiance + internalRadiance);
}
// Front GGX reflection is already in totalSpecular. Transmission never adds
// diffuse glass paint or an opacity overlay to the surface.
totalDiffuse = paneWire.rgb + (1. - paneWire.a) * paneRadiance / float(uScatterRays);
`

export function createGlassMaterial(color: Texture, depth: Texture, front: Texture, rear: Texture, wire: Texture, wireDepth: Texture,
  grid?: { origin: Vector2; warp: { value: number } }) {
  const material = new MeshPhysicalMaterial({ color: '#ffffff', metalness: 0, roughness: defaults.surfaceRoughness, ior: optics.ior, envMapIntensity: .7 })
  const uniforms = {
    uScatterRays: { value: GLASS_SAMPLES }, uDepthSteps: { value: defaultQuality.depthSteps }, uEntrySteps: { value: defaultQuality.entrySteps },
    uInternalReflection: { value: Boolean(defaultQuality.bounces) },
    uPaneDisks: { value: fillGlassDisks(new Float32Array(maxGlassRays * 4), GLASS_SAMPLES) },
    uGardenColor: { value: color }, uGardenDepth: { value: depth }, uWireColor: { value: wire }, uWireDepthMap: { value: wireDepth },
    uGlassTexture: { value: front }, uRearTexture: { value: rear },
    uRainWater: { value: front }, uRainBounds: { value: new Vector4(-2.4, -.6, 4.8, 4.8) },
    uRainWetness: { value: 0 }, uRainTexel: { value: 1 / 1024 }, uRainDirectField: { value: 0 },
    uGlassResolution: { value: new Vector2(1, 1) }, uCameraClip: { value: new Vector2(.05, 60) },
    uGlassViewProjection: { value: new Matrix4() }, uGardenViewProjection: { value: new Matrix4() },
    uGardenProjection: { value: new Matrix4() }, uGlassView: { value: new Matrix4() },
    uGlassRelief: { value: defaults.relief }, uRearRelief: { value: defaults.rearRelief },
    uTextureScale: { value: defaults.textureScale },
    uGlassDiffusion: { value: defaults.diffusion }, uPaneThickness: { value: optics.thickness as number },
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
  material.customProgramCacheKey = () => 'front-pane-central-wire-v9'
  return { material, uniforms, setQuality(q: GpuQuality) {
    if (uniforms.uScatterRays.value !== q.rays) fillGlassDisks(uniforms.uPaneDisks.value, q.rays)
    uniforms.uScatterRays.value = q.rays
    uniforms.uInternalReflection.value = Boolean(q.bounces)
    uniforms.uDepthSteps.value = q.depthSteps; uniforms.uEntrySteps.value = q.entrySteps
  } }
}
