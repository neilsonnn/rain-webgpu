import { Matrix4, MeshPhysicalMaterial, Vector2 } from 'three'
import type { Texture } from 'three'
import { defaults, optics } from './settings'

export const GLASS_SAMPLES = 12

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
varying vec3 vPanePosition;
vec3 paneSurfaceNormal(vec4 field, float relief) {
  vec3 encoded = field.xyz * 2. - 1.;
  return normalize(vec3(encoded.xy * relief / uTextureScale, max(.05, encoded.z)));
}
float paneHeight(vec4 field, float relief) { return (field.a - .5) * .0016 * relief; }
// A single height surface covers the rounded lattice and each pebbled cell.
// Its analytic gradient drives BOTH Fresnel reflection and Snell refraction.
vec4 paneFrontSurface(vec2 point, vec4 rolledField) {
  vec3 rolledNormal = paneSurfaceNormal(rolledField, uGlassRelief);
  vec2 rolledGradient = -rolledNormal.xy / max(.05, rolledNormal.z);
  float rolledHeight = paneHeight(rolledField, uGlassRelief);
  vec2 warp = vec2(sin(point.y * 7.1), sin(point.x * 6.3)) * .00008;
  vec2 distanceToCrest = (fract((point + warp) / uGridPitch + .5) - .5) * uGridPitch;
  vec2 crests = exp(-.5 * distanceToCrest * distanceToCrest / (uGridWidth * uGridWidth));
  vec2 crestSlopes = -distanceToCrest * crests / (uGridWidth * uGridWidth);
  // A smooth union avoids doubling the height at a grid crossing.
  float latticeHeight = crests.x + crests.y - crests.x * crests.y;
  vec2 latticeGradient = vec2(
    (1. - crests.y) * crestSlopes.x + (1. - crests.x) * crestSlopes.y * cos(point.x * 6.3) * .00008 * 6.3,
    (1. - crests.x) * crestSlopes.y + (1. - crests.y) * crestSlopes.x * cos(point.y * 7.1) * .00008 * 7.1
  );
  float heightRatio = rolledHeight / .0008;
  float crestModulation = 1. + uGridPebbling * clamp(heightRatio, -.6, .6);
  vec2 modulationGradient = abs(heightRatio) < .6 ? uGridPebbling * rolledGradient / .0008 : vec2(0.);
  float height = rolledHeight + uGridRelief * latticeHeight * crestModulation;
  vec2 gradient = rolledGradient + uGridRelief * (latticeGradient * crestModulation + latticeHeight * modulationGradient);
  return vec4(normalize(vec3(-gradient, 1.)), height);
}
vec2 paneProject(vec3 worldPosition) {
  vec4 clipPosition = uGlassProjection * uGlassView * vec4(worldPosition, 1.);
  return clipPosition.xy / max(.001, clipPosition.w) * .5 + .5;
}
vec2 paneGardenProject(vec3 worldPosition) {
  vec4 clipPosition = uGardenProjection * uGlassView * vec4(worldPosition, 1.);
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
    return textureCubeUV(envMap, envMapRotation * direction, surfaceRoughness).rgb * envMapIntensity;
  #else
    return vec3(0.);
  #endif
}
vec3 paneTraceGarden(vec3 startPoint, vec3 direction, out float travel) {
  vec3 viewStart = (uGlassView * vec4(startPoint, 1.)).xyz;
  vec3 viewDirection = (uGlassView * vec4(direction, 0.)).xyz;
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
vec3 paneIncident = normalize(vPanePosition - cameraPosition);
vec3 paneFrontPoint = vPanePosition;
vec4 paneFrontField;
vec4 paneFrontShape;
// Intersect the height surface along the camera ray, including at oblique views.
for (int frontRefinement = 0; frontRefinement < 3; frontRefinement++) {
  paneFrontField = texture2D(uGlassTexture, paneFrontPoint.xy / (${optics.textureSize.toFixed(3)} * uTextureScale));
  paneFrontShape = paneFrontSurface(paneFrontPoint.xy, paneFrontField);
  paneFrontPoint = vPanePosition + paneIncident * (paneFrontShape.a / min(-.08, paneIncident.z));
}
vec3 paneFrontNormal = paneFrontShape.xyz;
// Surface gradients stay in world space as the camera orbits.
normal = normalize((uGlassView * vec4(paneFrontNormal, 0.)).xyz);
`

export const glassTransmissionGLSL = /* glsl */`
// Front polish and rear scattering belong to distinct physical interfaces.
float paneAlpha = max(.0001, uFrontRoughness * uFrontRoughness);
float paneRearAlpha = max(.0001, uGlassDiffusion * uGlassDiffusion * .82);
vec3 paneCentralInside = refract(paneIncident, paneFrontNormal, 1. / material.ior);
vec3 paneCentralRear = paneFrontPoint + paneCentralInside * ((-uPaneThickness - paneFrontPoint.z) / min(-.08, paneCentralInside.z));
vec4 paneCentralRearField = texture2D(uRearTexture, paneCentralRear.xy / (${optics.textureSize.toFixed(3)} * uTextureScale));
vec3 paneCentralRearNormal = paneSurfaceNormal(paneCentralRearField, uRearRelief);
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
  vec3 frontMicroNormal = paneVisibleNormal(-paneIncident, paneFrontNormal, paneAlpha, xi);
  vec3 insideDirection = refract(paneIncident, frontMicroNormal, 1. / material.ior);
  float frontFresnel = paneFresnel(dot(-paneIncident, frontMicroNormal), 1., material.ior);
  float frontWeight = (1. - frontFresnel) * paneMaskingWeight(paneIncident, insideDirection, paneFrontNormal, paneAlpha);
  // Sample wire radiance at its embedded depth inside the slab.
  float wireTravel = max(0., (-uWireDepth - paneFrontPoint.z) / min(-.08, insideDirection.z));
  vec3 wirePoint = paneFrontPoint + insideDirection * wireTravel;
  vec2 wireUV = clamp(paneProject(wirePoint), vec2(.001), vec2(.999));
  vec4 wireSample = vec4(0.);
  if (uEmbeddedMesh > .5) wireSample = textureLod(uWireColor, wireUV, 0.);
  if (uEmbeddedMesh > .5 && wireSample.a > .001) {
    float wireViewDepth = -perspectiveDepthToViewZ(texture2D(uWireDepthMap, wireUV).r, uCameraClip.x, uCameraClip.y);
    vec3 frontViewPoint = (uGlassView * vec4(paneFrontPoint, 1.)).xyz;
    vec3 insideViewDirection = (uGlassView * vec4(insideDirection, 0.)).xyz;
    float resolvedTravel = (wireViewDepth + frontViewPoint.z) / max(.08, -insideViewDirection.z);
    // The resolved depth must belong to the embedded volume, not clear pixels.
    if (resolvedTravel >= 0. && resolvedTravel < uPaneThickness * 3.) {
      wireTravel = resolvedTravel;
      wirePoint = paneFrontPoint + insideDirection * wireTravel;
      wireSample = textureLod(uWireColor, clamp(paneProject(wirePoint), vec2(.001), vec2(.999)), 0.);
    }
  }
  // MSAA resolve premultiplies coverage into RGB; do not apply alpha twice.
  vec3 wireRadiance = wireSample.rgb * paneAbsorption(wireTravel);
  float insideTravel = max(.0001, (-uPaneThickness - paneFrontPoint.z) / min(-.08, insideDirection.z));
  vec3 rearPoint = paneFrontPoint + insideDirection * insideTravel;
  vec4 rearField = texture2D(uRearTexture, rearPoint.xy / (${optics.textureSize.toFixed(3)} * uTextureScale));
  insideTravel = max(.0001, (-uPaneThickness + paneHeight(rearField, uRearRelief) - paneFrontPoint.z) / min(-.08, insideDirection.z));
  rearPoint = paneFrontPoint + insideDirection * insideTravel;
  vec3 rearNormal = paneSurfaceNormal(rearField, uRearRelief);
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
    float viewDepth = max(.1, -(uGlassView * vec4(physicalHit, 1.)).z);
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

export function createGlassMaterial(color: Texture, depth: Texture, front: Texture, rear: Texture, wire: Texture, wireDepth: Texture) {
  const material = new MeshPhysicalMaterial({ color: '#ffffff', metalness: 0, roughness: defaults.surfaceRoughness, ior: optics.ior, envMapIntensity: defaults.reflectionStrength })
  const uniforms = {
    uGardenColor: { value: color }, uGardenDepth: { value: depth }, uWireColor: { value: wire }, uWireDepthMap: { value: wireDepth },
    uGlassTexture: { value: front }, uRearTexture: { value: rear },
    uGlassResolution: { value: new Vector2(1, 1) }, uCameraClip: { value: new Vector2(.05, 60) },
    uGlassProjection: { value: new Matrix4() }, uGardenProjection: { value: new Matrix4() }, uGlassView: { value: new Matrix4() },
    uGlassRelief: { value: defaults.relief }, uRearRelief: { value: defaults.rearRelief },
    uTextureScale: { value: defaults.textureScale },
    uGlassDiffusion: { value: defaults.diffusion }, uPaneThickness: { value: optics.thickness as number },
    uFrontRoughness: { value: defaults.surfaceRoughness }, uGridPitch: { value: defaults.wireSpacing },
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
      .replace('#include <transmission_fragment>', glassTransmissionGLSL)
  }
  material.customProgramCacheKey = () => 'continuous-patterned-glass-v4-scaled'
  return { material, uniforms }
}
