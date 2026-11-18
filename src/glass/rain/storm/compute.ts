import { stormBudget as b, stormOffsets as o, filmSide, filmPixels, particlePixels, paneArena as arena, paneGridSide as side } from './budget'
import { squallSide } from '../squalls'

export const stormComputeWGSL = /* wgsl */`
struct Parameters { p: array<vec4<f32>,32>, }
struct Particle { p: vec4<f32>, v: vec4<f32>, a: vec4<f32>, }
struct Leaf { center: vec4<f32>, across: vec4<f32>, along: vec4<f32>, normal: vec4<f32>, cell: vec4<f32>, }
struct Hit { p: vec4<f32>, v: vec4<f32>, n: vec4<f32>, }
@group(0) @binding(0) var<uniform> params: Parameters;
@group(0) @binding(1) var<storage,read_write> particles: array<Particle>;
@group(0) @binding(2) var<storage,read> leaves: array<Leaf>;
@group(0) @binding(3) var<storage,read> heads: array<i32>;
@group(0) @binding(4) var<storage,read_write> hits: array<Hit>;
@group(0) @binding(5) var<storage,read_write> counters: array<atomic<u32>,16>;
@group(0) @binding(6) var<storage,read_write> feedback: array<Hit>;
@group(0) @binding(7) var<storage,read> commands: array<Hit>;
@group(0) @binding(8) var<storage,read> weather: array<vec4<f32>>;
@group(0) @binding(9) var<storage,read_write> landedWater: array<atomic<u32>>;
@group(0) @binding(10) var<storage,read_write> paneIndex: array<atomic<u32>>;
fn hash(x: u32) -> u32 { var n=x; n=(n^(n>>16u))*2146121005u; n=(n^(n>>15u))*2221713035u; return n^(n>>16u); }
fn random(seed: ptr<function,u32>) -> f32 { *seed=hash(*seed+2654435769u); return f32(*seed)/4294967295.0; }
fn noise(p: vec3<f32>) -> f32 {
  // Several incommensurate travelling fronts, shared by the whole shower.
  return sin(p.x*1.13+p.y*.71+sin(p.z*.61))* .58 + sin(p.x*2.71-p.y*.47+p.z*1.37)*.27 + sin(p.x*.43+p.y*1.89-p.z*2.13)*.15;
}
fn squallAt(pos: vec3<f32>) -> f32 {
  let bounds=params.p[3];
  let xy=pos.xy+pos.z*vec2<f32>(params.p[1].x*params.p[1].y*.32,-.22);
  let uv=clamp((xy-bounds.xz)/(bounds.yw-bounds.xz),vec2<f32>(0.0),vec2<f32>(.99999));
  let cell=vec2<u32>(uv*${squallSide}.0);
  return weather[cell.x+cell.y*${squallSide}u].x;
}
fn air(p: vec3<f32>) -> vec3<f32> {
  let t=params.p[25].x; let s=params.p[1]; let q=p*params.p[25].y;
  let gust=noise(vec3<f32>(q.x*.6-t*s.x*.5,q.y*.3,q.z*.8+t*.9));
  let eddy=noise(vec3<f32>(q.x*2.0-t*.9,q.y*.8+t*1.2,q.z*1.7));
  let gustGain=.76+.56*squallAt(p);
  return vec3<f32>((s.x*(4.0+params.p[0].z*3.0)*(1.0+gust*.65)+eddy*s.z*1.5)*s.y*gustGain,
    eddy*s.z*.35*s.y,-(.3+params.p[2].w*(2.0+s.y*2.0))*(1.0+gust*.45)*gustGain)*s.w;
}
fn diameter(quantile: f32) -> f32 {
  let tail=-log(max(.000001,1.0-quantile));
  let size=(.00065+.00115*pow(params.p[0].z,1.3))*min(2.0,params.p[2].x)*pow(tail,1.3);
  return (.00045+.00675*(1.0-exp(-size/.00675)))*max(1.0,params.p[2].x/2.0);
}
fn velocity(p: vec3<f32>, size: f32, seed: f32) -> vec3<f32> {
  return air(p)-vec3<f32>(0.0,max(.6,9.65-10.3*exp(-600.0*size))*params.p[1].w*(.82+seed*.36),0.0);
}
fn rainCover(pos: vec3<f32>) -> f32 {
  let t=params.p[25].x; let wind=params.p[1]; let q=pos*params.p[25].y;
  return (.84+noise(vec3<f32>(q.x*.8-t*wind.x*wind.y,q.y*.35,t*.7+q.z))*.15)*squallAt(pos);
}
fn frontSlot(id: u32) -> bool {
  return id%89u!=0u && id%5u<3u;
}
fn spawnRain(id: u32, old: Particle) -> Particle {
  var seed=hash(id+u32(params.p[0].y*2903.0));
  let front=frontSlot(id); let z0=select(-3.8,.015,front); let z1=select(-.04,1.2,front);
  let w=select(7.0,params.p[3].y-params.p[3].x+.8,front);
  let y0=select(-.5,params.p[3].z,front); let y1=select(5.0,params.p[3].w+.6,front);
  var pos=vec3<f32>((random(&seed)-.5)*w,mix(y0,y1,random(&seed)),mix(z0,z1,random(&seed)));
  let sample=random(&seed);
  var size=diameter(random(&seed)); var v=velocity(pos,size,sample);
  // Reserve some of the airborne population for the last stretch above leaves.
  let leafCount=u32(params.p[24].y);
  if (id%89u==0u && leafCount>0u && random(&seed)<smoothstep(.55,1.0,params.p[0].z)) {
    var leaf=leaves[min(u32(random(&seed)*f32(leafCount)),leafCount-1u)];
    let other=leaves[min(u32(random(&seed)*f32(leafCount)),leafCount-1u)];
    if (other.center.z-abs(other.center.x)*.25>leaf.center.z-abs(leaf.center.x)*.25) { leaf=other; }
    let angle=6.2831853*random(&seed); let r=.85*sqrt(random(&seed));
    let landing=leaf.center.xyz+r*(cos(angle)*leaf.across.xyz*leaf.across.w+sin(angle)*leaf.along.xyz*leaf.along.w);
    if (landing.z< -.004 && random(&seed)<.16+.84*squallAt(landing)) {
      size=diameter(.32+.68*random(&seed)); v=velocity(landing,size,sample);
      var flight=.045+.11*random(&seed);
      if (v.z<0.0) { flight=min(flight,(-.002-landing.z)/(-v.z)); }
      return Particle(vec4<f32>(landing-v*flight,size),vec4<f32>(v,8.0),vec4<f32>(sample,0.0,0.0,2.0));
    }
  }
  // New slots fill the volume; recycled drops enter an actual upstream face.
  if (old.a.w>.5) {
    let top=abs(v.y)*w*(z1-z0); let face=abs(v.z)*w*(y1-y0); let side=abs(v.x)*(y1-y0)*(z1-z0);
    let choice=random(&seed)*(top+face+side);
    if (choice<top) { pos.y=y1; } else if (choice<top+face) { pos.z=select(z0,z1,v.z<0.0); }
    else { pos.x=select(-w*.5,w*.5,v.x<0.0); }
  }
  // A shared broken density envelope leaves holes between pounding gusts.
  let coverage=rainCover(pos);
  var out: Particle;
  out.p=vec4<f32>(pos,size); out.v=vec4<f32>(v,select(-random(&seed)*.12,8.0,random(&seed)<coverage));
  out.a=vec4<f32>(sample,0.0,0.0,1.0); return out;
}
fn bucket(cell: vec3<i32>) -> u32 { return ((u32(cell.x)*73856093u) ^ (u32(cell.y)*19349663u) ^ (u32(cell.z)*83492791u))&${b.hash-1}u; }
fn leafHit(start: vec3<f32>, end: vec3<f32>, radius: f32) -> vec2<f32> {
  if (any(max(start,end)+vec3<f32>(radius)<params.p[5].xyz) || any(min(start,end)-vec3<f32>(radius)>params.p[6].xyz)) { return vec2<f32>(-1.0,2.0); }
  let margin=vec3<f32>(params.p[5].w+radius);
  let lo=vec3<i32>(floor((min(start,end)-margin)/.28)); let hi=vec3<i32>(floor((max(start,end)+margin)/.28));
  let direction=end-start; var closest=2.0; var hit=-1.0;
  for (var z=lo.z;z<=hi.z;z++) { for (var y=lo.y;y<=hi.y;y++) { for (var x=lo.x;x<=hi.x;x++) {
    let cell=vec3<i32>(x,y,z); var i=heads[bucket(cell)]; var visits=0;
    loop {
      if (i<0 || visits>=64) { break; } visits++;
      let leaf=leaves[u32(i)]; i=i32(leaf.normal.w);
      if (any(vec3<i32>(leaf.cell.xyz)!=cell)) { continue; }
      let denominator=dot(direction,leaf.normal.xyz); if (abs(denominator)<.000001) { continue; }
      let t=dot(leaf.center.xyz-start,leaf.normal.xyz)/denominator;
      if (t<0.0 || t>1.0 || t>=closest) { continue; }
      let p=start+direction*t-leaf.center.xyz;
      let q=vec2<f32>(dot(p,leaf.across.xyz)/(leaf.across.w+radius),dot(p,leaf.along.xyz)/(leaf.along.w+radius));
      if (dot(q,q)<1.0) { hit=leaf.cell.w; closest=t; }
    }
  } } }
  return vec2<f32>(hit,closest);
}
fn retainWater(point: vec2<f32>, size: f32, fraction: f32) {
  let bnd=params.p[3]; let uv=(point-bnd.xz)/(bnd.yw-bnd.xz);
  if (any(uv<vec2<f32>(0.0)) || any(uv>vec2<f32>(1.0))) { return; }
  let grid=min(uv*${filmSide}.0,vec2<f32>(${filmSide}.0-.0001));
  let cell=vec2<u32>(grid); let i=cell.y*${filmSide}u+cell.x;
  let volume=max(1u,u32(round(5.23598776e9*size*size*size*fraction)));
  atomicAdd(&landedWater[i],volume);
}
fn recordHit(p: vec3<f32>, size: f32, v: vec3<f32>, leafId: f32, n: vec3<f32>) {
  let speed=abs(dot(v,n)); let energy=clamp(sqrt(998.0*size*speed*speed/.072)/35.0,0.0,1.5);
  let hit=Hit(vec4<f32>(p,size),vec4<f32>(v,leafId),vec4<f32>(n,energy));
  let i=atomicAdd(&counters[0],1u); if (i<${b.hits}u) { hits[i]=hit; }
  if (leafId>=0.0) {
    let j=atomicAdd(&counters[1],1u); if (j<${b.feedback}u) { feedback[j]=hit; }
  } else {
    atomicAdd(&counters[10],u32(energy*100.0)); atomicAdd(&counters[11],1u);
    atomicAdd(&counters[14],1u);
    if (i>=${b.hits}u) { retainWater(p.xy,size,1.0); }
  }
}
// The bead index was built before births. Existing live caps are read-only
// during this dispatch; all arriving mass/momentum uses atomic accumulators.
fn catchBead(point:vec2<f32>,r:f32)->u32 {
  let bnd=params.p[3]; let reach=r+bitcast<f32>(atomicLoad(&counters[7]));
  let lo=clamp(vec2<i32>(floor((point-vec2<f32>(reach)-bnd.xz)/(bnd.yw-bnd.xz)*${side}.0)),vec2<i32>(0),vec2<i32>(${side-1}));
  let hi=clamp(vec2<i32>(floor((point+vec2<f32>(reach)-bnd.xz)/(bnd.yw-bnd.xz)*${side}.0)),vec2<i32>(0),vec2<i32>(${side-1}));
  var nearest=1e10; var found=0u;
  for (var y=lo.y;y<=hi.y;y++) { for (var x=lo.x;x<=hi.x;x++) {
    var cursor=atomicLoad(&paneIndex[u32(x+y*${side})]); var visits=0u;
    loop {
      if(cursor==0u || visits>=64u) { break; } visits++; let id=cursor-1u;
      cursor=atomicLoad(&paneIndex[${arena.links}u+id]); let p=particles[${o.beads}u+id];
      if(p.v.w<=0.0) { continue; } let distance=length(point-p.p.xy);
      if(distance<p.p.w+r && distance<nearest) { nearest=distance; found=id+1u; }
    }
  } }
  return found;
}
fn panePoint(seed: ptr<function,u32>) -> vec3<f32> {
  let bounds=params.p[3];
  var i=min(${squallSide*squallSide-1}u,u32(random(seed)*${squallSide*squallSide}.0));
  let entry=weather[i];
  if (random(seed)>=entry.y) { i=u32(entry.z); }
  let uv=(vec2<f32>(f32(i%${squallSide}u),f32(i/${squallSide}u))+vec2<f32>(random(seed),random(seed)))/${squallSide}.0;
  return vec3<f32>(mix(bounds.x,bounds.y,uv.x),mix(bounds.z,bounds.w,uv.y),0.0);
}
fn fineImpact(seed: ptr<function,u32>) -> Hit {
  let point=panePoint(seed);
  let size=diameter(.12+.86*random(seed));
  let v=velocity(point,size,random(seed));
  let energy=min(1.5,sqrt(998.0*size/.072)*abs(v.z)/35.0);
  return Hit(vec4<f32>(point,size),vec4<f32>(v,-4.0),vec4<f32>(0.0,0.0,1.0,energy));
}
@compute @workgroup_size(128)
fn advance(@builtin(global_invocation_id) gid: vec3<u32>) {
  let airEnd=u32(params.p[29].y); let dripEnd=u32(params.p[29].z);
  var id=gid.x;
  if (id>=dripEnd) { id=${o.rings}u+id-dripEnd; }
  else if (id>=airEnd) { id=${o.spray}u+id-airEnd; }
  var p=particles[id]; let dt=params.p[0].x;
  if (id<${b.rain}u) {
    let panePopulation=frontSlot(id);
    if (f32(id)>=params.p[0].w || (panePopulation && f32(hash(id))/4294967295.0>params.p[2].y*.25)) { p.v.w=0.0; particles[id]=p; return; }
    if (p.v.w<=0.0) { p.v.w+=dt; if (p.v.w>=0.0 || p.v.w==0.0) { p=spawnRain(id,p); } else { particles[id]=p; return; } }
    if (p.v.w<=0.0) { particles[id]=p; return; }
    let old=p.p.xyz; let desired=velocity(old,p.p.w,p.a.x);
    p.v=vec4<f32>(mix(p.v.xyz,desired,1.0-exp(-dt/(.035+p.p.w*35.0))),p.v.w-dt);
    let end=old+p.v.xyz*dt;
    var hit=vec2<f32>(-1.0,2.0); var normal=vec3<f32>(0.0,0.0,1.0);
    if (params.p[2].z>.5 && old.z>0.0 && end.z<=0.0) {
      let t=old.z/(old.z-end.z); let point=mix(old,end,t);
      if (point.x>=params.p[3].x && point.x<=params.p[3].y && point.y>=params.p[3].z && point.y<=params.p[3].w) { hit=vec2<f32>(-1.0,t); }
    }
    if (hit.y>1.0 && end.z<0.0) { hit=leafHit(old,end,p.p.w*.5); if (hit.x>=0.0) { normal=leaves[u32(hit.x)].normal.xyz; } }
    if (hit.y<=1.0) {
      recordHit(mix(old,end,hit.y),p.p.w,p.v.xyz,hit.x,normal);
      p.v.w=select(0.0,-(.25+p.a.x*.45),p.a.w>1.5);
    } else if (end.y< -1.0 || abs(end.x)>5.5 || end.z< -5.5 || end.z>2.0) { p.v.w=0.0; }
    p.p=vec4<f32>(end,p.p.w); p.a.y+=dt;
  } else if (id<${o.beads}u) {
    if (p.v.w<=0.0) { return; }
    let old=p.p.xyz; let drag=exp(-dt*.001/ max(.0002,p.p.w));
    p.v=vec4<f32>(p.v.xyz*drag+vec3<f32>(0.0,-9.81*dt,0.0),p.v.w-dt);
    p.p=vec4<f32>(old+p.v.xyz*dt,p.p.w); p.a.y+=dt;
    if (old.z>.003 && p.p.z<=.003 && params.p[2].z>.5) {
      let contact=mix(old,p.p.xyz,(old.z-.003)/(old.z-p.p.z));
      retainWater(contact.xy,p.p.w,1.0); p.v.w=0.0;
    }
    // Runoff shed by a roof chain or leaf is an arriving drop, not a splash
    // fragment. It can strike another leaf and initiate another local burst.
    if (p.a.w>.5 && p.a.y>.05 && p.p.z<0.0) {
      let hit=leafHit(old,p.p.xyz,p.p.w*.5);
      if (hit.x>=0.0) {
        recordHit(mix(old,p.p.xyz,hit.y),p.p.w,p.v.xyz,hit.x,leaves[u32(hit.x)].normal.xyz); p.v.w=0.0;
      }
    }
  } else if (id<${o.rings}u) {
    // Pane beads have their own spatial collection and continuous-track passes.
    return;
  } else {
    p.v.w-=dt; p.a.y+=dt;
  }
  particles[id]=p;
}
@compute @workgroup_size(64)
fn impacts(@builtin(global_invocation_id) gid: vec3<u32>) {
  let count=min(atomicLoad(&counters[0]),${b.hits}u); let id=gid.x;
  let patterStart=count+u32(params.p[4].y);
  if (id>=patterStart+u32(params.p[24].z)) { return; }
  var seed=hash(id+u32(params.p[0].y*19937.0));
  let fine=id>=patterStart;
  var hit: Hit;
  if (fine) {
    seed=hash((u32(params.p[24].w)+id-patterStart)^0x47ba913du); hit=fineImpact(&seed);
  } else if (id<count) { hit=hits[id]; } else { hit=commands[id-count]; }
  if (hit.v.w== -2.0) {
    let index=${o.spray}u+atomicAdd(&counters[2],1u)%${b.spray}u; var p: Particle;
    p.p=hit.p; p.v=vec4<f32>(hit.v.xyz,.5+random(&seed)); p.a=vec4<f32>(random(&seed),0.0,0.0,1.0); particles[index]=p; return;
  }
  let pane=hit.v.w<0.0; let brush=hit.v.w== -3.0;
  if (pane) {
    if (brush) { atomicAdd(&counters[10],u32(hit.n.w*100.0)); atomicAdd(&counters[11],1u); }
    var p: Particle;
    if (atomicAdd(&counters[13],1u)<${b.rings}u) {
      let ring=${o.rings}u+atomicAdd(&counters[4],1u)%${b.rings}u;
      p.p=vec4<f32>(hit.p.xyz,hit.p.w); p.v=vec4<f32>(hit.v.xy,hit.n.w,max(.16,params.p[26].x)); p.a=vec4<f32>(random(&seed),0.0,0.0,0.0); particles[ring]=p;
    }
    let retained=1.0;
    var filmShare=retained;
    let inheritance=params.p[25].w*random(&seed);
    let caught=catchBead(hit.p.xy,hit.p.w*.822);
    if (caught>0u) {
      filmShare=retained*.35;
      let units=max(1u,u32(round(5.23598776e9*hit.p.w*hit.p.w*hit.p.w*(retained-filmShare))));
      let at=${arena.incoming}u+(caught-1u)*4u;
      atomicAdd(&paneIndex[at],units);
      atomicAdd(&paneIndex[at+1u],bitcast<u32>(i32(round(f32(units)*clamp(hit.v.x*inheritance,-12.0,12.0)))));
      atomicAdd(&paneIndex[at+2u],bitcast<u32>(i32(round(f32(units)*clamp(hit.v.y*inheritance,-12.0,12.0)))));
      atomicMax(&paneIndex[at+3u],bitcast<u32>(hit.n.w));
    } else if (random(&seed)<params.p[25].z) {
      let slot=atomicAdd(&counters[6],1u);
      if (slot<atomicLoad(&counters[15])) {
        let bead=${o.beads}u+atomicLoad(&paneIndex[${arena.free}u+slot]);
        filmShare=retained*.35;
        p.p=vec4<f32>(hit.p.xy,.003,hit.p.w*.822*pow(retained-filmShare,1.0/3.0));
        let lifetime=params.p[26].y*(.2+.8*random(&seed));
        p.v=vec4<f32>(hit.v.xy*inheritance,hit.n.w,lifetime);
        // A birth identity invalidates the previous occupant's track anchor.
        p.a=vec4<f32>(random(&seed),0.0,0.0,1.0+random(&seed)); particles[bead]=p;
      }
    }
    retainWater(hit.p.xy,hit.p.w,filmShare);
  }

}
`

export const stormCompactWGSL = /* wgsl */`
struct Particle { p: vec4<f32>, v: vec4<f32>, a: vec4<f32>, }
@group(0) @binding(0) var<uniform> params: array<vec4<f32>,32>;
@group(0) @binding(1) var<storage,read> particles: array<Particle>;
@group(0) @binding(2) var<storage,read_write> visible: array<atomic<u32>>;
var<workgroup> groupCount: atomic<u32>;
var<workgroup> groupStart: u32;
@compute @workgroup_size(128)
fn compact(@builtin(workgroup_id) group: vec3<u32>, @builtin(local_invocation_index) lane: u32) {
  let base = group.x * 128u + ${o.spray}u;
  let kind = select(select(0u, 1u, base >= ${o.beads}u), select(2u, 3u, base >= ${o.trails}u), base >= ${o.rings}u);
  if (params[31][kind] == 0.0) { return; }
  let id = base + lane;
  let starts = vec4<u32>(${o.spray}u, ${o.beads}u, ${o.rings}u, ${o.trails}u);
  let alive = particles[id].v.w > 0.0;
  var rank = 0u;
  if (alive) { rank = atomicAdd(&groupCount, 1u); }
  workgroupBarrier();
  if (lane == 0u && atomicLoad(&groupCount) > 0u) { groupStart = atomicAdd(&visible[kind], atomicLoad(&groupCount)); }
  workgroupBarrier();
  if (alive) { atomicStore(&visible[4u + starts[kind] - ${o.spray}u + groupStart + rank], id); }
}
`

export const stormPackWGSL = /* wgsl */`
struct Particle { p: vec4<f32>, v: vec4<f32>, a: vec4<f32>, }
@group(0) @binding(0) var<uniform> params: array<vec4<f32>,32>;
@group(0) @binding(1) var<storage,read> particles: array<Particle>;
@group(0) @binding(2) var<storage,read> visible: array<u32>;
@group(0) @binding(9) var<storage,read> landedWater: array<u32>;
fn scalar(value: f32, lo: f32, span: f32) -> vec4<f32> {
  let q=u32(round(clamp((value-lo)/span,0.0,1.0)*65535.0));
  return vec4<f32>(f32(q>>8u)/255.0,f32(q&255u)/255.0,0.0,1.0);
}
@vertex fn vertex(@builtin(vertex_index) v:u32) -> @builtin(position) vec4<f32> {
  let p=vec2<f32>(f32((v<<1u)&2u),f32(v&2u)); return vec4<f32>(p*2.0-vec2<f32>(1.0),0.0,1.0);
}
@fragment fn fragment(@builtin(position) at:vec4<f32>) -> @location(0) vec4<f32> {
  let pixel=u32(at.y)*${b.atlasWidth}u+u32(at.x);
  if (pixel < ${filmPixels}u) { return scalar(log2(1.0+f32(landedWater[pixel])),0.0,32.0); }
  let packed = pixel - ${filmPixels}u;
  let slot = packed / ${particlePixels}u;
  let ends = vec4<u32>(params[30]);
  var id = slot;
  if (slot >= ends.x) {
    let kind = select(select(0u, 1u, slot >= ends.y), select(2u, 3u, slot >= ends.w), slot >= ends.z);
    let rank = slot - ends[kind];
    if (rank >= visible[kind]) { return vec4<f32>(0.0,0.0,0.0,1.0); }
    let starts = vec4<u32>(${o.spray}u, ${o.beads}u, ${o.rings}u, ${o.trails}u);
    id = visible[4u + starts[kind] - ${o.spray}u + rank];
  }
  let p=particles[id]; let channel=packed%${particlePixels}u;
  if (channel==0u) { return scalar(p.p.x,-6.0,12.0); }
  if (channel==1u) { return scalar(p.p.y,-2.0,10.0); }
  if (channel==2u) { return scalar(p.p.z,-6.0,8.0); }
  if (channel==3u) { return scalar(p.p.w,0.0,.08); }
  if (channel<7u) { return scalar(p.v[channel-4u],-32.0,64.0); }
  if (channel==7u) { return scalar(max(0.0,p.v.w),0.0,600.0); }
  if (channel==8u) { return scalar(p.a.x,0.0,1.0); }
  return scalar(p.a.y,0.0,40.0);
}
`
