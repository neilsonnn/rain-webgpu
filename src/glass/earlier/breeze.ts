import { Vector3 } from 'three'

// These are amplitude envelopes, not spring limits. The shader saturates its
// response smoothly, so a stronger breeze adds motion without unbounded strain.
export const breezeMax = 5
export const breezeEnvelope = { pitch: .157, twist: .185, tip: .018, branch: .36, depth: .36 * .28 } as const
export const breezeResponse = (strength: number) => {
  const b = Math.max(0, Math.min(breezeMax, strength))
  return b / (.8 + b)
}

export function bladeSweep(radius: number, h: number, scale: number, motion: number) {
  const angle = (breezeEnvelope.pitch + breezeEnvelope.twist) * h * h * motion
  return (2 * radius * Math.sin(angle / 2) + breezeEnvelope.tip * h ** 3 * motion) * scale
}

// CPU sampling is used by nonvisual clearance/normal checks. Both the sampled
// surface and the shader use the constants above; no simulation state is needed.
export function bladeAt(p: Vector3, time: number, strength: number, phase: number, age: number, near: boolean) {
  const response = breezeResponse(strength) * (near ? .2 : 1), slow = .65 + .35 * Math.sin(time * .27 + phase * .31)
  const pitch = response * (.12 * Math.sin(time * .9 + phase) + .025 * Math.sin(time * 3.3 + phase * 2.7) + .012 * Math.sin(time * 6.4 + phase * 1.8) * slow)
  const twist = response * (.16 * Math.sin(time * 1.25 + phase * 1.4) + .025 * Math.sin(time * 4.8 + phase * .75))
  const flutter = response * breezeEnvelope.tip * Math.sin(time * (4.6 + age * 1.1) + phase * 2.1) * slow
  const result = p.clone().applyAxisAngle(new Vector3(0, 1, 0), twist * p.y ** 2)
    .applyAxisAngle(new Vector3(1, 0, 0), pitch * p.y ** 2)
  result.z += flutter * p.y ** 3
  return result
}

export function branchAt(p: Vector3, root: Vector3, height: number, time: number, strength: number, near: boolean, out = new Vector3()) {
  const q = Math.max(0, Math.min(1, (p.y - root.y) / height)), shape = q * q * (3 - 2 * q)
  const phase = root.x * .81 + root.z * .63, speed = .85 + .05 * Math.min(breezeMax, Math.max(0, strength))
  const wave = (Math.sin(time * .43 * speed + phase) + .38 * Math.sin(time * .79 * speed - phase * 1.7)
    + .16 * Math.sin(time * .23 + phase * 2.3)) / 1.54
  const cross = (Math.sin(time * .37 * speed + phase * .7) + .3 * Math.sin(time * .93 + phase)) / 1.3
  const gain = 1 + .16 * Math.min(breezeMax, Math.max(0, strength))
  const amplitude = .16 * Math.min(Math.abs(height) / 2, 1.25) * breezeResponse(strength) * gain
  const gainAt = amplitude * shape
  return out.set(p.x + wave * gainAt, p.y - .035 * Math.abs(wave) * gainAt,
    p.z + cross * .28 * (near ? .06 : 1) * gainAt)
}

export const breezeWindGLSL = /* glsl */`
attribute vec4 plantAnchor;
float greenhouseBreezeResponse() {
  float b = clamp(uBreeze, 0., ${breezeMax}.);
  return b / (.8 + b);
}
vec3 greenhouseBranchOffset() {
  float phase = plantAnchor.x * .81 + plantAnchor.z * .63;
  float speed = .85 + .05 * clamp(uBreeze, 0., ${breezeMax}.);
  float wave = (sin(uPlantTime * .43 * speed + phase) + .38 * sin(uPlantTime * .79 * speed - phase * 1.7)
    + .16 * sin(uPlantTime * .23 + phase * 2.3)) / 1.54;
  float crosswind = (sin(uPlantTime * .37 * speed + phase * .7) + .3 * sin(uPlantTime * .93 + phase)) / 1.3;
  float gain = 1. + .16 * clamp(uBreeze, 0., ${breezeMax}.);
  float amplitude = .16 * min(abs(plantAnchor.w) / 2., 1.25) * greenhouseBreezeResponse() * gain;
  return vec3(wave, -.035 * abs(wave), crosswind * .28 * mix(1., .06, plantNear)) * amplitude;
}
vec3 greenhouseWind(vec3 p) {
  float q = clamp((p.y - plantAnchor.y) / plantAnchor.w, 0., 1.);
  return greenhouseBranchOffset() * q * q * (3. - 2. * q);
}
vec3 greenhouseBreezeNormal(vec3 p, vec3 n) {
  float t = (p.y - plantAnchor.y) / plantAnchor.w, q = clamp(t, 0., 1.);
  float derivative = t > 0. && t < 1. ? 6. * q * (1. - q) / plantAnchor.w : 0.;
  vec3 d = greenhouseBranchOffset() * derivative;
  // Cofactor of the rooted bending Jacobian: normals follow the actual surface.
  return normalize(vec3((1. + d.y) * n.x, n.y - d.x * n.x - d.z * n.z, (1. + d.y) * n.z));
}
`

export const breezeLeafGLSL = /* glsl */`
attribute vec2 leafMotion;
varying vec2 vLeafFinish;
vec3 greenhouseLeafCoefficients() {
  float phase = leafMotion.x, response = greenhouseBreezeResponse() * mix(1., .2, plantNear);
  float slow = .65 + .35 * sin(uPlantTime * .27 + phase * .31);
  float pitch = .12 * sin(uPlantTime * .9 + phase) + .025 * sin(uPlantTime * 3.3 + phase * 2.7)
    + .012 * sin(uPlantTime * 6.4 + phase * 1.8) * slow;
  float twist = .16 * sin(uPlantTime * 1.25 + phase * 1.4) + .025 * sin(uPlantTime * 4.8 + phase * .75);
  float flutter = ${breezeEnvelope.tip} * sin(uPlantTime * (4.6 + leafMotion.y * 1.1) + phase * 2.1) * slow;
  return vec3(pitch, twist, flutter) * response;
}
mat3 greenhouseBreezeLeafRotation(float h) {
  vec3 c = greenhouseLeafCoefficients();
  float pitch = c.x * h * h, twist = c.y * h * h;
  mat3 ry = mat3(cos(twist), 0., -sin(twist), 0., 1., 0., sin(twist), 0., cos(twist));
  mat3 rx = mat3(1., 0., 0., 0., cos(pitch), sin(pitch), 0., -sin(pitch), cos(pitch));
  return rx * ry;
}
vec3 greenhouseBreezeLeaf(vec3 p) {
  vec3 at = greenhouseBreezeLeafRotation(p.y) * p;
  at.z += greenhouseLeafCoefficients().z * p.y * p.y * p.y;
  return at;
}
vec3 greenhouseBreezeLeafNormal(vec3 p, vec3 n) {
  vec3 c = greenhouseLeafCoefficients();
  float h = p.y, pitch = c.x * h * h, twist = c.y * h * h;
  mat3 ry = mat3(cos(twist), 0., -sin(twist), 0., 1., 0., sin(twist), 0., cos(twist));
  mat3 rx = mat3(1., 0., 0., 0., cos(pitch), sin(pitch), 0., -sin(pitch), cos(pitch));
  mat3 rotation = rx * ry;
  vec3 dy = rotation[1] + cross(vec3(1., 0., 0.), rotation * p) * (2. * h * c.x)
    + rx * cross(vec3(0., 1., 0.), ry * p) * (2. * h * c.y) + vec3(0., 0., 3. * h * h * c.z);
  mat3 cofactor = mat3(cross(dy, rotation[2]), cross(rotation[2], rotation[0]), cross(rotation[0], dy));
  return normalize(cofactor * n);
}
`
