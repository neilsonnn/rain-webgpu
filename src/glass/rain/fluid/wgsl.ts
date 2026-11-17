// Fine analytic caps + persistent reservoir, joined before deriving refraction.
// No grid-velocity limiter can change a bead's momentum in this reconstruction.
export const fluidWGSL = /* wgsl */`
@group(0) @binding(1) var film: texture_2d<f32>;
@group(0) @binding(2) var caps: texture_2d<f32>;
@group(0) @binding(3) var output: texture_storage_2d<rgba8unorm,write>;
fn filmAt(uv: vec2<f32>) -> f32 {
  let size=vec2<i32>(textureDimensions(film)); let p=uv*vec2<f32>(size)-.5;
  let c=vec2<i32>(floor(p)); let f=fract(p); let lo=vec2<i32>(0); let hi=size-1;
  return mix(mix(textureLoad(film,clamp(c,lo,hi),0).r,textureLoad(film,clamp(c+vec2<i32>(1,0),lo,hi),0).r,f.x),
    mix(textureLoad(film,clamp(c+vec2<i32>(0,1),lo,hi),0).r,textureLoad(film,clamp(c+vec2<i32>(1,1),lo,hi),0).r,f.x),f.y);
}
fn cap(c: vec2<i32>) -> f32 { return textureLoad(caps,clamp(c,vec2<i32>(0),vec2<i32>(textureDimensions(caps))-1),0).r; }
@compute @workgroup_size(8,8)
fn reconstruct(@builtin(global_invocation_id) gid: vec3<u32>) {
  let c=vec2<i32>(gid.xy); let size=vec2<i32>(textureDimensions(output));
  if (any(c>=size)) { return; }
  let uv=(vec2<f32>(c)+.5)/vec2<f32>(size);
  // Only a small spatial reconstruction filter, never a repeated temporal
  // blur that would dissolve stationary caps and their connecting necks.
  let neighbors=(cap(c+vec2<i32>(1,0))+cap(c-vec2<i32>(1,0))+cap(c+vec2<i32>(0,1))+cap(c-vec2<i32>(0,1)))*.25;
  let height=filmAt(uv)+mix(cap(c),neighbors,.12);
  let h=round(clamp(height/.064,0.0,1.0)*65535.0);
  textureStore(output,c,vec4<f32>(floor(h/256.0)/255.0,(h%256.0)/255.0,smoothstep(.000003,.000045,height),1.0));
}
`
export const presentWGSL = /* wgsl */`
@group(0) @binding(0) var optical: texture_2d<f32>;
@vertex fn vertex(@builtin(vertex_index) v: u32) -> @builtin(position) vec4<f32> {
  let uv=vec2<f32>(f32((v<<1u)&2u),f32(v&2u)); return vec4<f32>(uv*2.0-1.0,0.0,1.0);
}
@fragment fn fragment(@builtin(position) p: vec4<f32>) -> @location(0) vec4<f32> { return textureLoad(optical,vec2<i32>(p.xy),0); }
`
export const depositWGSL = /* wgsl */`
struct Parameters { p: array<vec4<f32>,2>, }
struct Bead { shape: vec4<f32>, water: vec4<f32>, detail: vec4<f32>, motion: vec4<f32>, }
@group(0) @binding(0) var<uniform> params: Parameters;
@group(0) @binding(1) var<storage,read> beads: array<Bead>;
struct Out { @builtin(position) position: vec4<f32>, @location(0) q: vec2<f32>, @location(1) @interpolate(flat) id: u32, }
@vertex fn vertex(@builtin(vertex_index) v: u32,@builtin(instance_index) id: u32) -> Out {
  let corners=array<vec2<f32>,6>(vec2<f32>(-1,-1),vec2<f32>(1,-1),vec2<f32>(1,1),vec2<f32>(-1,-1),vec2<f32>(1,1),vec2<f32>(-1,1));
  let d=beads[id]; let q=corners[v]*1.8; let p=q*d.shape.zw;
  let cs=cos(d.water.y); let sn=sin(d.water.y);
  let world=d.shape.xy+vec2<f32>(cs*p.x-sn*p.y,sn*p.x+cs*p.y);
  let uv=(world-params.p[0].zw)/params.p[0].xy;
  var out: Out; out.position=vec4<f32>(uv.x*2.0-1.0,1.0-uv.y*2.0,0.0,1.0); out.q=q; out.id=id; return out;
}
fn kernel(q: vec2<f32>, seed: f32, irregular: f32) -> f32 {
  let a=atan2(q.y,q.x+.0000001);
  let edge=1.0+irregular*sin(a*3.0+seed)+irregular*.55*sin(a*5.0-seed*1.7);
  let profile=max(0.0,1.0-dot(q,q)/(edge*edge));
  return profile*profile/(1.0+irregular*irregular*.65125);
}
@fragment fn fragment(in: Out) -> @location(0) vec4<f32> {
  let d=beads[in.id]; let lobe=d.detail.z;
  // A retained secondary lobe records where a merger/finger pull occurred.
  // Shapes relax toward a compact cap; pinned puddles retain asymmetry longer.
  let shape=(1.0-lobe)*kernel(in.q,d.water.z,d.detail.w)
    +lobe*kernel((in.q-d.detail.xy)/.55,d.water.z+8.0,d.detail.w)/(.55*.55);
  let height=d.water.x*3.0/(3.141592654*d.shape.z*d.shape.w)*shape;
  if (height<.00000001) { discard; }
  return vec4<f32>(height,0.0,0.0,0.0);
}
`
