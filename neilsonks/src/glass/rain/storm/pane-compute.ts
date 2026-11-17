import { stormBudget as b, stormOffsets as o, paneGridSide as side, paneGridCells as cells, panePoolCount, filmSide, paneArena as arena } from './budget'

// Passes have exclusive ownership of their writes. Neighbor search only proposes
// merges; a subsequent pass resolves disjoint mutual pairs. Track collection uses
// atomic ownership, so two runners cannot collect the same water in one frame.
export const paneComputeWGSL = /* wgsl */`
struct Parameters { p: array<vec4<f32>,32>, }
struct Particle { p: vec4<f32>, v: vec4<f32>, a: vec4<f32>, }
struct Memory { anchor: vec4<f32>, motion: vec4<f32>, previous: vec4<f32>, }
@group(0) @binding(0) var<uniform> params: Parameters;
@group(0) @binding(1) var<storage,read_write> particles: array<Particle>;
@group(0) @binding(2) var<storage,read_write> memory: array<Memory>;
@group(0) @binding(3) var<storage,read_write> paneIndex: array<atomic<u32>>;
@group(0) @binding(6) var<storage,read_write> counters: array<atomic<u32>,16>;
@group(0) @binding(7) var<storage,read_write> landedWater: array<atomic<u32>>;
@group(0) @binding(8) var relief: texture_2d<f32>;
const capVolume: f32 = .942477796;
fn hash(x:u32)->u32 { var n=x; n=(n^(n>>16u))*2146121005u; n=(n^(n>>15u))*2221713035u; return n^(n>>16u); }
fn random(x:u32)->f32 { return f32(hash(x))/4294967295.0; }
fn surfaceNoise(p:vec2<f32>)->f32 {
  let i=floor(p); let t=fract(p); let w=t*t*(3.0-2.0*t);
  let q=vec4<f32>(dot(i,vec2<f32>(127.1,311.7)),dot(i+vec2<f32>(1.0,0.0),vec2<f32>(127.1,311.7)),
    dot(i+vec2<f32>(0.0,1.0),vec2<f32>(127.1,311.7)),dot(i+vec2<f32>(1.0),vec2<f32>(127.1,311.7)));
  let n=fract(sin(q)*43758.5453);
  return mix(mix(n.x,n.y,w.x),mix(n.z,n.w,w.x),w.y);
}
fn radius(volume:f32)->f32 { return pow(max(0.0,volume)/capVolume,1.0/3.0); }
fn volume(p:Particle)->f32 { return capVolume*p.p.w*p.p.w*p.p.w; }
fn inPane(p:vec2<f32>)->bool { let bnd=params.p[3]; return all(p>=bnd.xz) && all(p<=bnd.yw); }
fn deposit(p:vec2<f32>, amount:f32) {
  if (!inPane(p) || amount<1e-13) { return; }
  let bnd=params.p[3]; let uv=clamp((p-bnd.xz)/(bnd.yw-bnd.xz),vec2<f32>(0.0),vec2<f32>(.99999));
  let c=vec2<u32>(uv*${filmSide}.0);
  atomicAdd(&landedWater[c.x+c.y*${filmSide}u],max(1u,u32(round(amount*1e10))));
}
fn cell(p:vec2<f32>)->vec2<i32> {
  let bnd=params.p[3]; return clamp(vec2<i32>(floor((p-bnd.xz)/(bnd.yw-bnd.xz)*${side}.0)),vec2<i32>(0),vec2<i32>(${side-1}));
}
fn key(c:vec2<i32>)->u32 { return u32(c.x+c.y*${side}); }
fn fraction(p:vec2<f32>,a:vec2<f32>,b:vec2<f32>)->f32 { let d=b-a; return clamp(dot(p-a,d)/max(1e-12,dot(d,d)),0.0,1.0); }
fn pointDistance(p:vec2<f32>,a:vec2<f32>,b:vec2<f32>)->f32 { return length(p-mix(a,b,fraction(p,a,b))); }
fn cross(a:vec2<f32>,b:vec2<f32>)->f32 { return a.x*b.y-a.y*b.x; }
fn segmentDistance(a:vec2<f32>,b:vec2<f32>,c:vec2<f32>,d:vec2<f32>)->f32 {
  let u=b-a; let v=d-c; let determinant=cross(u,v);
  if (abs(determinant)>1e-10) {
    let t=cross(c-a,v)/determinant; let s=cross(c-a,u)/determinant;
    if (t>=0.0 && t<=1.0 && s>=0.0 && s<=1.0) { return 0.0; }
  }
  return min(min(pointDistance(a,c,d),pointDistance(b,c,d)),min(pointDistance(c,a,b),pointDistance(d,a,b)));
}
fn trackEnds(p:Particle)->vec4<f32> {
  let halfLength=max(0.0,p.v.y-p.p.w);
  let along=vec2<f32>(-sin(p.v.x),cos(p.v.x))*halfLength;
  return vec4<f32>(p.p.xy-along,p.p.xy+along);
}
// The same filtered rolled-glass relief and embossed grid as the optical shader.
fn height(p:vec2<f32>,r:f32)->f32 {
  let tile=params.p[28].w; let level=i32(clamp(floor(log2(max(.0005,r*.7)*f32(textureDimensions(relief).x)/tile)),0.0,f32(textureNumLevels(relief)-1u)));
  let dimensions=vec2<i32>(textureDimensions(relief,level)); let uv=fract(p/tile)*vec2<f32>(dimensions)-.5;
  let base=vec2<i32>(floor(uv)); let t=fract(uv);
  let a=(base%dimensions+dimensions)%dimensions; let c=(a+vec2<i32>(1))%dimensions;
  let h=mix(mix(textureLoad(relief,a,level).r,textureLoad(relief,vec2<i32>(c.x,a.y),level).r,t.x),
    mix(textureLoad(relief,vec2<i32>(a.x,c.y),level).r,textureLoad(relief,c,level).r,t.x),t.y)*params.p[29].x;
  let grid=params.p[27]; let g=params.p[28];
  let d=(fract((p-grid.xy-sin(p.yx*vec2<f32>(7.1,6.3))*grid.z)/grid.w+.5)-.5)*grid.w;
  let width=length(vec2<f32>(g.y,r*.5)); let crest=exp(-.5*d*d/(width*width));
  return h+g.x*(g.y/width)*(crest.x+crest.y-crest.x*crest.y)*(1.0+g.z*clamp(h/.0008,-.6,.6));
}
fn slope(p:vec2<f32>,r:f32)->vec3<f32> {
  let e=max(.0005,r*.7); let t=vec2<f32>(e,0.0);
  let gradient=vec2<f32>(height(p+t,r)-height(p-t,r),height(p+t.yx,r)-height(p-t.yx,r))/(2.0*e);
  return vec3<f32>(gradient,.7+.65*surfaceNoise(p*85.0)+max(0.0,-gradient.y)*1.5);
}

@compute @workgroup_size(128)
fn movePane(@builtin(global_invocation_id) gid:vec3<u32>) {
  let id=gid.x; if (id>=${panePoolCount}u) { return; }
  if (id>=${b.beads}u) {
    let index=${o.trails}u+id-${b.beads}u; var p=particles[index];
    if (p.v.w<=0.0) { return; }
    let decay=exp(-params.p[0].x*3.0/params.p[24].x);
    p.v.w-=params.p[0].x; p.a.y+=params.p[0].x; p.a.x*=decay; p.v.z*=decay;
    if (p.a.x<1e-13) { p.v.w=0.0; }
    particles[index]=p; return;
  }
  let index=${o.beads}u+id; var p=particles[index]; if (p.v.w<=0.0) { return; }
  var m=memory[id];
  if (m.anchor.w!=p.a.w) {
    m.anchor=vec4<f32>(p.p.xy,0.0,p.a.w); m.motion=vec4<f32>(0.0); m.previous=vec4<f32>(p.p.xy,0.0,1.0);
  }
  let dt=params.p[0].x; m.previous=vec4<f32>(p.p.xy,0.0,m.previous.w);
  p.v.w-=dt; p.a.y+=dt;
  if (p.v.w<=0.0) { deposit(p.p.xy,volume(p)); particles[index]=p; memory[id]=m; return; }
  let profile=p.a.x; let count=max(1u,u32(ceil(dt*120.0))); let h=dt/f32(count);
  for (var step=0u;step<count;step++) {
    let r=p.p.w; let mass=volume(p)*998.0; let terrain=slope(p.p.xy,r);
    let hysteresis=(.55+profile*.5)*(.65+1.4*pow(surfaceNoise(p.p.xy*vec2<f32>(32.0,41.0)),2.0))*terrain.z;
    m.previous.w=hysteresis;
    let pinning=2.0*r*.072*params.p[7].y*hysteresis*params.p[7].w*(1.0-m.motion.y*.22);
    let lateral=clamp(-2.0*r*.072*terrain.x/max(1e-10,mass)+9.81*terrain.x*terrain.y/(1.0+dot(terrain.xy,terrain.xy)),-2.8,2.8);
    let acceleration=vec2<f32>(lateral*params.p[7].x+params.p[1].x*.06+m.motion.x/.1,-9.81*(1.0+terrain.x*terrain.x)/(1.0+dot(terrain.xy,terrain.xy)));
    let staticAcceleration=pinning/max(1e-10,mass);
    if (length(p.v.xy)<.0025 && length(acceleration)<=staticAcceleration) { p.v=vec4<f32>(0.0,0.0,p.v.zw); m.motion.z=1.0; }
    else {
      var v=p.v.xy+acceleration*h;
      let capillaryTime=sqrt(998.0*r*r*r/.072); let arrival=exp(-p.a.y/(.016+capillaryTime*2.5));
      let friction=max(0.0,1.0-staticAcceleration*.84*(1.0-arrival*.65)*h/max(1e-9,length(v)));
      let mobility=exp((profile-.5)*2.5);
      let relaxation=max(.002,(.018+.025*pow(r/.004,1.4))*params.p[7].z*mobility*(1.0+m.motion.y*.7));
      let drag=relaxation+max(0.0,.028+capillaryTime*3.5-relaxation)*arrival;
      v*=friction*exp(-h/drag); v*=min(1.0,(2.5+arrival*7.5)/max(.001,length(v)));
      m.motion.z=select(0.0,1.0,length(v)<.0025 && length(acceleration)<=staticAcceleration);
      p.v=vec4<f32>(select(v,vec2<f32>(0.0),m.motion.z>.5),p.v.zw);
    }
    p.p=vec4<f32>(p.p.xy+p.v.xy*h,p.p.zw);
    m.motion.x*=exp(-h/.14); m.motion.y*=exp(-h/.18);
  }
  p.p.w=radius(max(0.0,volume(p)-3.14159265*p.p.w*p.p.w*1.5e-7*dt));
  for (var brush=0u;brush<u32(params.p[4].z);brush++) {
    let line=params.p[8u+brush*2u]; let force=params.p[9u+brush*2u];
    let delta=p.p.xy-mix(line.xy,line.zw,fraction(p.p.xy,line.xy,line.zw)); let d=length(delta);
    let weight=(1.0-smoothstep(force.x*.2,force.x,d))*force.y;
    p.v=vec4<f32>(p.v.xy+(delta/max(d,.0002)*1.5+force.zw*.8)*weight,p.v.zw);
  }
  if (!inPane(p.p.xy) || volume(p)<1e-12) { p.v.w=0.0; }
  particles[index]=p; memory[id]=m;
}

@compute @workgroup_size(128)
fn indexPane(@builtin(global_invocation_id) gid:vec3<u32>) {
  let id=gid.x; if (id>=${panePoolCount}u) { return; }
  if (id<${b.beads}u) {
    let p=particles[${o.beads}u+id];
    if (p.v.w<=0.0) { let i=atomicAdd(&counters[15],1u); atomicStore(&paneIndex[${arena.free}u+i],id); return; }
    let previous=memory[id].previous.xy; let extent=p.p.w+length(p.p.xy-previous)*.5;
    atomicMax(&counters[7],bitcast<u32>(extent));
    atomicStore(&paneIndex[${arena.links}u+id],atomicExchange(&paneIndex[key(cell((previous+p.p.xy)*.5))],id+1u));
  } else {
    let i=id-${b.beads}u; let p=particles[${o.trails}u+i];
    if (p.v.w<=0.0) { atomicStore(&paneIndex[${arena.links}u+id],0xffffffffu); let n=atomicAdd(&counters[12],1u); atomicStore(&paneIndex[${arena.free+b.beads}u+n],i); return; }
    // At capacity recycle closed tracks, never a runner's attached segment.
    // Return any remaining water to the film before that slot is reused.
    let owner=u32(p.a.z); var attached=false;
    if (owner>0u && owner<=${b.beads}u) {
      let m=memory[owner-1u];
      attached=m.anchor.z==f32(i+1u) && m.anchor.w==p.a.w && particles[${o.beads}u+owner-1u].v.w>0.0;
    }
    if (!attached && p.a.y>.5) {
      let n=atomicAdd(&counters[5],1u); atomicStore(&paneIndex[${arena.free+b.beads+b.trails}u+n],i);
    }
    atomicMax(&counters[8],bitcast<u32>(max(p.p.w,p.v.y)));
    atomicStore(&paneIndex[${arena.links}u+id],atomicExchange(&paneIndex[${cells}u+key(cell(p.p.xy))],i+1u));
  }
}

@compute @workgroup_size(128)
fn claimTracks(@builtin(global_invocation_id) gid:vec3<u32>) {
  let id=gid.x; if (id>=${b.beads}u) { return; }
  let p=particles[${o.beads}u+id]; if (p.v.w<=0.0) { return; }
  let a=memory[id].previous.xy; let reach=p.p.w+bitcast<f32>(atomicLoad(&counters[8]));
  let lo=cell(min(a,p.p.xy)-vec2<f32>(reach)); let hi=cell(max(a,p.p.xy)+vec2<f32>(reach));
  for (var y=lo.y;y<=hi.y;y++) { for (var x=lo.x;x<=hi.x;x++) {
    var cursor=atomicLoad(&paneIndex[${cells}u+key(vec2<i32>(x,y))]); var visits=0u;
    loop {
      if (cursor==0u || visits>=64u) { break; } visits++; let i=cursor-1u; cursor=atomicLoad(&paneIndex[${arena.links+b.beads}u+i]); let t=particles[${o.trails}u+i];
      if (t.a.y<.08 || (t.a.z==f32(id+1u) && t.a.w==p.a.w)) { continue; }
      let ends=trackEnds(t);
      if (segmentDistance(a,p.p.xy,ends.xy,ends.zw)<=p.p.w+t.p.w) { atomicMax(&paneIndex[${arena.claims}u+i],${b.beads}u-id); }
    }
  } }
}

@compute @workgroup_size(128)
fn absorbTracks(@builtin(global_invocation_id) gid:vec3<u32>) {
  let id=gid.x; if (id>=${b.beads}u) { return; }
  let index=${o.beads}u+id; var p=particles[index]; if (p.v.w<=0.0) { return; }
  var m=memory[id]; let a=m.previous.xy; let reach=p.p.w+bitcast<f32>(atomicLoad(&counters[8]));
  let lo=cell(min(a,p.p.xy)-vec2<f32>(reach)); let hi=cell(max(a,p.p.xy)+vec2<f32>(reach));
  var amount=volume(p); var steering=0.0; var wet=0.0;
  for (var y=lo.y;y<=hi.y;y++) { for (var x=lo.x;x<=hi.x;x++) {
    var cursor=atomicLoad(&paneIndex[${cells}u+key(vec2<i32>(x,y))]); var visits=0u;
    loop {
      if (cursor==0u || visits>=64u) { break; } visits++; let i=cursor-1u; cursor=atomicLoad(&paneIndex[${arena.links+b.beads}u+i]);
      if (atomicLoad(&paneIndex[${arena.claims}u+i])!=${b.beads}u-id) { continue; }
      var t=particles[${o.trails}u+i]; let taken=t.a.x*(1.0-exp(-params.p[0].x*45.0));
      let ends=trackEnds(t); let nearest=mix(ends.xy,ends.zw,fraction(p.p.xy,ends.xy,ends.zw));
      let trackSlope=(ends.z-ends.x)/max(.005,abs(ends.w-ends.y));
      steering+=((nearest.x-p.p.x)*45.0+trackSlope*abs(p.v.y)-p.v.x)*(1.0-exp(-params.p[0].x*10.0))*params.p[7].x;
      wet=1.0; amount+=taken; t.a.x-=taken; t.v.z*=exp(-params.p[0].x*45.0);
      if (t.a.x<1e-13) { t.v.w=0.0; } particles[${o.trails}u+i]=t;
    }
  } }
  p.p.w=radius(amount); p.v.x+=clamp(steering,-.5,.5); m.motion.y=max(m.motion.y,wet);
  atomicMax(&counters[7],bitcast<u32>(p.p.w+length(p.p.xy-m.previous.xy)*.5));
  particles[index]=p; memory[id]=m;
}

@compute @workgroup_size(128)
fn proposeMerges(@builtin(global_invocation_id) gid:vec3<u32>) {
  let id=gid.x; if (id>=${b.beads}u) { return; }
  let p=particles[${o.beads}u+id]; if (p.v.w<=0.0) { memory[id].previous.z=0.0; return; }
  let a=memory[id].previous.xy; let reach=p.p.w+bitcast<f32>(atomicLoad(&counters[7]));
  let lo=cell(min(a,p.p.xy)-vec2<f32>(reach)); let hi=cell(max(a,p.p.xy)+vec2<f32>(reach));
  var closest=1e10; var partner=0u;
  for (var y=lo.y;y<=hi.y;y++) { for (var x=lo.x;x<=hi.x;x++) {
    var cursor=atomicLoad(&paneIndex[key(vec2<i32>(x,y))]); var visits=0u;
    loop {
      if (cursor==0u || visits>=128u) { break; } visits++; let i=cursor-1u; cursor=atomicLoad(&paneIndex[${arena.links}u+i]); if (i==id) { continue; }
      let other=particles[${o.beads}u+i]; let start=a-memory[i].previous.xy; let end=p.p.xy-other.p.xy;
      let distance=pointDistance(vec2<f32>(0.0),start,end); let contact=(p.p.w+other.p.w)*.95;
      let score=distance/max(.000001,contact);
      if (distance<=contact && (score<closest || (score==closest && i+1u<partner))) { closest=score; partner=i+1u; }
    }
  } }
  memory[id].previous.z=f32(partner);
}

@compute @workgroup_size(128)
fn mergeBeads(@builtin(global_invocation_id) gid:vec3<u32>) {
  let id=gid.x; if (id>=${b.beads}u) { return; }
  let partner=u32(memory[id].previous.z); if (partner==0u) { return; } let otherId=partner-1u;
  if (u32(memory[otherId].previous.z)!=id+1u) { return; }
  // The lower id owns both writes, so only one invocation ever reads/writes a
  // given pair. Choose the moving/larger head independently of that ownership.
  if (id>otherId) { return; }
  let a=particles[${o.beads}u+id]; let b=particles[${o.beads}u+otherId];
  let scoreA=volume(a)*(1.0+min(25.0,dot(a.v.xy,a.v.xy)*20000.0));
  let scoreB=volume(b)*(1.0+min(25.0,dot(b.v.xy,b.v.xy)*20000.0));
  let winner=select(otherId,id,scoreA>=scoreB); let loser=select(id,otherId,scoreA>=scoreB);
  var p=particles[${o.beads}u+winner]; var q=particles[${o.beads}u+loser]; var m=memory[winner];
  let amount=volume(p)+volume(q); let share=volume(q)/max(1e-15,amount); let dx=q.p.x-p.p.x;
  let sliding=length(p.v.xy)>.0025;
  p.p.x+=dx*share*select(1.0,.85,sliding); if (!sliding) { p.p.y+=(q.p.y-p.p.y)*share; }
  p.v=vec4<f32>(mix(p.v.xy,q.v.xy,share),max(.3,max(p.v.z,q.v.z)),p.v.w);
  p.p.w=radius(amount); p.a.y=0.0;
  atomicMax(&counters[7],bitcast<u32>(p.p.w+length(p.p.xy-m.previous.xy)));
  m.motion.x+=clamp(dx*share*35.0,-.28,.28)*params.p[7].x; m.motion.y=max(m.motion.y,memory[loser].motion.y); m.motion.z=0.0; m.motion.w=0.0;
  q.v.w=0.0; q.p.w=0.0;
  particles[${o.beads}u+winner]=p; particles[${o.beads}u+loser]=q; memory[winner]=m;
}

fn shapeTrack(start:vec2<f32>,end:vec2<f32>,width:f32,amount:f32,life:f32,age:f32,id:u32,nonce:f32)->Particle {
  let delta=end-start; let length=length(delta); let height=amount/max(1e-12,2.0*width*length+3.14159265*width*width*.5);
  return Particle(vec4<f32>((start+end)*.5,.002,width),vec4<f32>(atan2(delta.y,delta.x)-1.5707963,length*.5+width,height*2000.0,life),vec4<f32>(amount,age,f32(id+1u),nonce));
}

@compute @workgroup_size(128)
fn finishTracks(@builtin(global_invocation_id) gid:vec3<u32>) {
  let id=gid.x; if (id>=${b.beads}u) { return; }
  let index=${o.beads}u+id; var p=particles[index]; if (p.v.w<=0.0) { return; }
  var m=memory[id]; let distance=length(p.p.xy-m.previous.xy); if (distance<1e-7) { return; }
  let width=max(.0007,p.p.w*.3); let oldIndex=u32(m.anchor.z);
  var trailIndex=0u; var amount=0.0; var age=0.0; var life=params.p[24].x; var start=m.previous.xy;
  if (oldIndex>0u && atomicLoad(&paneIndex[${arena.links+b.beads}u+oldIndex-1u])!=0xffffffffu) {
    let prior=particles[${o.trails}u+oldIndex-1u];
    if (prior.v.w>0.0 && prior.a.z==f32(id+1u) && prior.a.w==p.a.w && length(m.previous.xy-m.anchor.xy)<max(.009,p.p.w*1.4)) {
      trailIndex=oldIndex; amount=prior.a.x; age=prior.a.y; life=prior.v.w; start=m.anchor.xy;
    }
  }
  if (trailIndex==0u) {
    let slot=atomicAdd(&counters[9],1u);
    let freeCount=atomicLoad(&counters[12]);
    if (slot<freeCount) { trailIndex=atomicLoad(&paneIndex[${arena.free+b.beads}u+slot])+1u; }
    else {
      let recycle=slot-freeCount; if (recycle>=atomicLoad(&counters[5])) { return; }
      trailIndex=atomicLoad(&paneIndex[${arena.free+b.beads+b.trails}u+recycle])+1u;
      let prior=particles[${o.trails}u+trailIndex-1u]; deposit(prior.p.xy,prior.a.x);
    }
  }
  let loss=(3.0+p.a.x*6.0+min(2.0,m.previous.w)*3.0)*(1.0-m.motion.y*.65);
  let taken=volume(p)*(1.0-exp(-distance*loss)); amount+=taken; p.p.w=radius(volume(p)-taken);
  // The active segment is extended from its original anchor, even for tiny
  // per-frame motion. Closed segments and their remaining water stay pooled.
  particles[${o.trails}u+trailIndex-1u]=shapeTrack(start,p.p.xy,width,amount,life,age,id,p.a.w);
  m.anchor=vec4<f32>(start,f32(trailIndex),p.a.w);
  if (volume(p)<1e-12) { p.v.w=0.0; }
  memory[id]=m; particles[index]=p;
}

// Rain landing on an existing cap transfers mass and tangential momentum to it;
// it need not create a new bead or replace the running head to contribute.
@compute @workgroup_size(128)
fn collectArrivals(@builtin(global_invocation_id) gid:vec3<u32>) {
  let id=gid.x; if (id>=${b.beads}u) { return; }
  let at=${arena.incoming}u+id*4u; let units=atomicLoad(&paneIndex[at]); if (units==0u) { return; }
  let index=${o.beads}u+id; var p=particles[index]; if (p.v.w<=0.0) { return; }
  let amount=f32(units)*1e-10; let total=volume(p)+amount;
  let momentum=vec2<f32>(f32(bitcast<i32>(atomicLoad(&paneIndex[at+1u]))),f32(bitcast<i32>(atomicLoad(&paneIndex[at+2u]))))*1e-10;
  p.v=vec4<f32>((p.v.xy*volume(p)+momentum)/total,max(p.v.z,bitcast<f32>(atomicLoad(&paneIndex[at+3u]))),p.v.w);
  p.p.w=radius(total); p.a.y=0.0;
  memory[id].motion.y=1.0; memory[id].motion.z=0.0; memory[id].motion.w=0.0;
  particles[index]=p;
}

`
