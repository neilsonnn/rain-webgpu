import { AdditiveBlending, Color, HalfFloatType, InstancedBufferAttribute, InstancedBufferGeometry,
  LinearFilter, Mesh, OrthographicCamera, PlaneGeometry, Scene, ShaderMaterial, Vector2, Vector3, Vector4, WebGLRenderTarget } from 'three'
import type { Texture, WebGLRenderer } from 'three'
import { rainExposureGLSL, rainFragmentGLSL } from '../shaders'
import { waterFragmentGLSL } from '../surface'
import { impactMotionGLSL } from '../impact'
import { stormBudget as b, stormOffsets as o, stormCount, stormAtlasHeight } from './budget'

const decodeGLSL = /* glsl */`
attribute float stormIndex;
uniform sampler2D uStormParticles;
uniform float uStormActive;
vec4 dataAt(int offset) {
  int at=int(stormIndex)*10+offset;
  return texelFetch(uStormParticles,ivec2(at%${b.atlasWidth},at/${b.atlasWidth}),0);
}
float scalarAt(int i) { return dot(dataAt(i).rg,vec2(256.,1.))*(255./65535.); }
vec2 pairAt(int i) { return vec2(scalarAt(i),scalarAt(i+1)); }
vec4 positionAt() { return vec4(pairAt(0)*vec2(12.,10.)-vec2(6.,2.),pairAt(2)*vec2(8.,.08)-vec2(6.,0.)); }
vec4 velocityAt() { return vec4(pairAt(4)*64.-32.,pairAt(6)*vec2(64.,600.)-vec2(32.,0.)); }
`
const particleVertex = decodeGLSL + rainExposureGLSL + /* glsl */`
uniform vec2 uRainResolution;
uniform float uRainShutter;
uniform float uRainSide;
varying vec2 vRainPoint;
varying vec4 vRainShape;
varying vec4 vRainDetail;
varying vec3 vRainLight;
void main() {
  if (stormIndex<${b.rain}. && stormIndex>=uStormActive) { gl_Position=vec4(2.,2.,2.,1.); return; }
  float life=scalarAt(7)*600.;
  if (life<=.0001) { gl_Position=vec4(2.,2.,2.,1.); return; }
  vec4 p=positionAt();
  if (p.z*uRainSide<0.) { gl_Position=vec4(2.,2.,2.,1.); return; }
  vec2 detail=pairAt(8)*vec2(1.,40.);
  vec3 worldVelocity=vec3(pairAt(4),scalarAt(6))*64.-32.;
  vec4 center=modelViewMatrix*vec4(p.xyz,1.); vec3 velocity=(modelViewMatrix*vec4(worldVelocity,0.)).xyz;
  if (center.z>=-.075) { gl_Position=vec4(2.,2.,2.,1.); return; }
  vec2 projected=velocity.xy-center.xy*velocity.z/min(-.05,center.z);
  vec2 along=normalize(projected+vec2(.00001,0.)), across=vec2(along.y,-along.x);
  float pixel=2.*max(.05,-center.z)/(projectionMatrix[1][1]*uRainResolution.y);
  float radius=p.w*.5, filtered=max(radius,pixel*.5), axial=max(radius,pixel*.5);
  float isSpray=step(${o.spray}.,stormIndex);
  float shutter=min(min(uRainShutter,detail.y),mix(.026,.009,isSpray));
  float tail=rainTrailLength(center.xyz,velocity,projected,shutter,pixel,uRainResolution), halfLength=tail*.5+axial;
  vRainPoint=vec2(position.x*2.*filtered*1.12,position.y*2.*halfLength);
  vRainShape=vec4(radius,filtered,axial,tail);
  float fade=min(1.,life/.045)*min(1.,detail.y/.008)*smoothstep(.075,.24,-center.z);
  vRainDetail=vec4(fade,p.z,detail.x,0.);
  vRainLight=vec3(sqrt(.012/max(.006,shutter)),.6+detail.x*.8,isSpray);
  center.xy+=across*vRainPoint.x+along*(vRainPoint.y-tail*.5);
  gl_Position=projectionMatrix*center;
}
`
const surfaceVertex = decodeGLSL + impactMotionGLSL + /* glsl */`
uniform vec4 uStormBounds;
varying vec2 vWaterPoint;
varying vec2 vWaterRadii;
varying vec4 vWaterShape;
varying vec2 vWaterRotation;
varying vec4 vWaterImpact;
void main() {
  vec4 v=velocityAt();
  if (v.w<=.0001) { gl_Position=vec4(2.,2.,2.,1.); return; }
  vWaterImpact=vec4(0.);
  vec4 p=positionAt(); vec2 detail=pairAt(8)*vec2(1.,40.);
  float r=p.w, age=detail.y, angle=atan(v.y,v.x)-1.5707963;
  float height=r*.65, coverage=min(1.,v.w*.8), kind=0.; vec2 radii=vec2(r);
  if (stormIndex>=${o.trails}.) {
    radii=vec2(r,max(r,v.y)); angle=v.x; height=v.z*.001; kind=1.; coverage*=min(1.,height/.000035);
  } else if (stormIndex>=${o.rings}.) {
    vec2 incoming=v.xy*detail.x;
    vec2 travel=impactTravel(incoming,r,age);
    vWaterImpact=impactDimensions(r,age,incoming);
    if(vWaterImpact.w>=1.){gl_Position=vec4(2.,2.,2.,1.);return;}
    angle=atan(travel.y,travel.x+.000001)-1.5707963;p.xy+=travel*.5;
    float width=max(vWaterImpact.x,vWaterImpact.z);
    radii=vec2(width,width+vWaterImpact.y*.5);
    height=0.;coverage=1.;kind=3.;
  } else {
    float spread=1.+v.z*1.5*sin(min(1.,age/.035)*1.5707963)*exp(-age*18.);
    float stretch=1.+min(2.,length(v.xy)*1.3);
    radii=vec2(r*spread/sqrt(stretch),r*spread*sqrt(stretch)); height/=spread*spread;
  }
  float footprint=uStormBounds.z/1536.*.7; float area=radii.x*radii.y;
  radii=max(radii,vec2(footprint)); float filterWeight=area/(radii.x*radii.y); height*=filterWeight; coverage*=filterWeight;
  vWaterPoint=position.xy*2.; vWaterRadii=radii; vWaterShape=vec4(height,coverage,kind,angle);
  vWaterRotation=vec2(cos(angle),sin(angle)); vec2 q=vWaterPoint*radii;
  vec2 world=p.xy+vec2(vWaterRotation.x*q.x-vWaterRotation.y*q.y,vWaterRotation.y*q.x+vWaterRotation.x*q.y);
  gl_Position=vec4((world-uStormBounds.xy)/uStormBounds.zw*2.-1.,0.,1.);
}
`
export function createStormRendering(texture: Texture, bounds: Vector4) {
  const uniforms={ uStormParticles:{ value:texture },uStormActive:{ value:0 },
    uRainResolution:{ value:new Vector2(1,1) },uPaneImpact:{value:new Vector3(.12,1.4,.14)},uRainShutter:{ value:.009 },uRainVisibility:{ value:1.2 },uStormBounds:{ value:bounds } }
  const quad=new PlaneGeometry(1,1)
  function geometry(start: number, count: number) {
    const g=new InstancedBufferGeometry(); g.index=quad.index; g.attributes={ ...quad.attributes }
    const ids=new Float32Array(count); for(let i=0;i<count;i++) ids[i]=start+i
    g.setAttribute('stormIndex',new InstancedBufferAttribute(ids,1)); g.instanceCount=count; return g
  }
  const rainGeometry=geometry(0,o.beads), surfaceGeometry=geometry(o.beads,stormCount-o.beads)
  const material=(side:number) => new ShaderMaterial({ vertexShader:particleVertex,
    fragmentShader:rainFragmentGLSL,
    uniforms:{ ...uniforms,uRainSide:{ value:side } },transparent:true,depthWrite:false,depthTest:true,toneMapped:false })
  const backMaterial=material(-1), frontMaterial=material(1)
  const mesh=new Mesh(rainGeometry,backMaterial), front=new Mesh(rainGeometry,frontMaterial)
  for(const m of [mesh,front]) { m.frustumCulled=false; m.renderOrder=3 }
  const surfaceMaterial=new ShaderMaterial({ vertexShader:surfaceVertex,fragmentShader:waterFragmentGLSL,uniforms,
    transparent:true,blending:AdditiveBlending,premultipliedAlpha:true,depthWrite:false,depthTest:false,toneMapped:false })
  const surfaceMesh=new Mesh(surfaceGeometry,surfaceMaterial); surfaceMesh.frustumCulled=false
  const scene=new Scene(), camera=new OrthographicCamera(-1,1,1,-1,0,1); scene.add(surfaceMesh)
  const target=new WebGLRenderTarget(1536,1536,{ type:HalfFloatType,minFilter:LinearFilter,magFilter:LinearFilter,depthBuffer:false })
  const clear=new Color()
  return { mesh,front,uniforms,texture:target.texture,atlasHeight:stormAtlasHeight,
    renderWater(renderer:WebGLRenderer,drawDeposits?: (renderer:WebGLRenderer,bounds:Vector4)=>void) {
      const previous=renderer.getRenderTarget(), alpha=renderer.getClearAlpha(), auto=renderer.autoClear, shadows=renderer.shadowMap.autoUpdate
      renderer.getClearColor(clear)
      try { renderer.autoClear=true; renderer.shadowMap.autoUpdate=false; renderer.setClearColor(0,0); renderer.setRenderTarget(target); renderer.render(scene,camera); drawDeposits?.(renderer,bounds) }
      finally { renderer.setRenderTarget(previous); renderer.setClearColor(clear,alpha); renderer.autoClear=auto; renderer.shadowMap.autoUpdate=shadows }
    },
    dispose() { rainGeometry.dispose(); surfaceGeometry.dispose(); quad.dispose(); backMaterial.dispose(); frontMaterial.dispose(); surfaceMaterial.dispose(); target.dispose() },
  }
}
