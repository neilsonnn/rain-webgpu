import { AdditiveBlending, BufferAttribute, BufferGeometry, DataTexture, DynamicDrawUsage, FloatType, LinearFilter, Mesh, NearestFilter, NoBlending, OrthographicCamera, PlaneGeometry, Points, RedFormat, Scene, ShaderMaterial, Vector2, Vector3, Vector4, WebGLRenderTarget } from 'three'
import type { Texture, WebGLRenderer } from 'three'
import { random } from '../settings'
import type { RainSettings } from './settings'
import { rainDiameter } from './settings'
import type { PaneImpact } from './surface'
import { rainVelocity } from './weather'
import { impactMotionGLSL, impactShapeGLSL } from './impact'
import type { RainSqualls } from './squalls'
import { filmSide, stormBudget } from './storm/budget'

const quadVertex = `varying vec2 vUv;
void main(){ vUv=uv; gl_Position=vec4(position.xy,0.,1.); }`
const advance = /* glsl */`
uniform sampler2D uState, uDeposits, uAtlas;
uniform bool uNative, uLocal;
uniform vec4 uMotion;
uniform float uVolumeToDepth;
float heightAt(ivec2 p) { return texelFetch(uState,clamp(p,ivec2(0),ivec2(${filmSide-1})),0).r; }
float rough(ivec2 p) { return fract(sin(dot(vec2(p),vec2(27.19,91.37)))*14531.13); }
float spill(float h, ivec2 p) {
  float hold=(.055+.40*rough(p))*uMotion.z;
  return max(0.,h-hold)*(1.-exp(-uMotion.x*uMotion.y*(4.+min(h,20.)*3.)));
}
float turn(ivec2 p) { return .32*sin(float(p.y)*.14+sin(float(p.x)*.12)*2.)+.19*(rough(p)-.5); }
void main(){
  ivec2 c=ivec2(gl_FragCoord.xy), up=c+ivec2(0,1);
  float h=heightAt(c), water=h-spill(h,c);
  if(up.y<${filmSide}){
    for(int dx=-1;dx<=1;dx++){
      ivec2 p=up+ivec2(dx,0);
      if(p.x<0 || p.x>=${filmSide}) continue;
      float side=turn(p);
      if((p.x==0 && side<0.)||(p.x==${filmSide-1} && side>0.)) side=0.;
      float share=dx==0 ? 1.-abs(side) : max(0.,-float(dx)*side);
      water+=spill(heightAt(p),p)*share;
    }
  }
  water*=exp(-uMotion.x*3./uMotion.w);
  if(uLocal) water+=texelFetch(uDeposits,c,0).r;
  if(uNative){
    int i=c.y*${filmSide}+c.x;
    vec2 rg=texelFetch(uAtlas,ivec2(i%${stormBudget.atlasWidth},i/${stormBudget.atlasWidth}),0).rg;
    water+=(exp2(dot(rg,vec2(256.,1.))*(255./65535.)*32.)-1.)*1e-10*uVolumeToDepth;
  }
  gl_FragColor=vec4(water,0.,0.,1.);
}`
const optics = /* glsl */`
varying vec2 vUv;
uniform sampler2D uState;
uniform vec4 uBounds,uOpticalBounds;
float surfaceHeight(vec2 uv) {
  return .65*log(1.+texture2D(uState,clamp(uv,0.,1.)).r/.65);
}
void main(){
  vec2 uv=(uOpticalBounds.xy+vUv*uOpticalBounds.zw-uBounds.xy)/uBounds.zw;
  if(any(lessThan(uv,vec2(0.)))||any(greaterThan(uv,vec2(1.)))) discard;
  vec2 t=vec2(1./${filmSide}.,0.);
  float h=surfaceHeight(uv);
  vec2 slope=vec2(surfaceHeight(uv+t)-surfaceHeight(uv-t),surfaceHeight(uv+t.yx)-surfaceHeight(uv-t.yx))*${filmSide}.0*.0005/uBounds.zw;
  gl_FragColor=vec4(slope,h,1.-exp(-h/.095));
}`
const dragWater = /* glsl */`
uniform sampler2D uState;
uniform vec4 uBounds,uStroke;
uniform vec2 uBrush;
float weight(ivec2 cell) {
  vec2 pos=uBounds.xy+(vec2(cell)+.5)*uBounds.zw/${filmSide}.;
  vec2 d=uStroke.zw-uStroke.xy;
  float t=clamp(dot(pos-uStroke.xy,d)/max(.000001,dot(d,d)),0.,1.);
  return (1.-smoothstep(uBrush.x*.2,uBrush.x,length(pos-uStroke.xy-t*d)))*uBrush.y;
}
void main(){
  ivec2 cell=ivec2(gl_FragCoord.xy);
  float h=texelFetch(uState,cell,0).r*(1.-weight(cell));
  vec2 source=vec2(cell)-(uStroke.zw-uStroke.xy)*.65*${filmSide}./uBounds.zw;
  ivec2 base=ivec2(floor(source)); vec2 f=fract(source);
  for(int y=0;y<2;y++)for(int x=0;x<2;x++){
    ivec2 p=base+ivec2(x,y);
    if(any(lessThan(p,ivec2(0)))||any(greaterThanEqual(p,ivec2(${filmSide}))))continue;
    h+=texelFetch(uState,p,0).r*weight(p)*(x==0?1.-f.x:f.x)*(y==0?1.-f.y:f.y);
  }
  gl_FragColor=vec4(h,0.,0.,1.);
}`
const maxContacts = 262144
const impactVertex = impactMotionGLSL + /* glsl */`
attribute vec4 landing;
attribute vec2 landingVelocity;
uniform vec4 uOpticalBounds;
uniform float uTime,uResolution;
varying vec4 vImpact;
varying vec2 vImpactAxis;
varying float vImpactExtent;
void main() {
  float age=max(0.,uTime-landing.w);
  vImpact=impactDimensions(landing.z,age,landingVelocity);
  if(vImpact.w>=1.){gl_Position=vec4(2.,2.,2.,1.);return;}
  vec2 travel=impactTravel(landingVelocity,landing.z,age);
  float angle=atan(travel.y,travel.x+.000001)-1.5707963;
  vImpactAxis=vec2(cos(angle),sin(angle));
  vImpactExtent=max(vImpact.x,vImpact.z)+vImpact.y*.5;
  vec2 center=landing.xy+travel*.5;
  gl_Position=vec4((center-uOpticalBounds.xy)/uOpticalBounds.zw*2.-1.,0.,1.);
  gl_PointSize=max(1.,2.*vImpactExtent*uResolution/uOpticalBounds.z);
}`
const impactFragment = impactShapeGLSL + /* glsl */`
varying vec4 vImpact;
varying vec2 vImpactAxis;
varying float vImpactExtent;
void main() {
  vec2 q=(gl_PointCoord-.5)*vec2(2.,-2.)*vImpactExtent;
  vec2 local=vec2(vImpactAxis.x*q.x+vImpactAxis.y*q.y,-vImpactAxis.y*q.x+vImpactAxis.x*q.y);
  vec4 field=impactWater(local,vImpact);
  field.xy=vec2(vImpactAxis.x*field.x-vImpactAxis.y*field.y,vImpactAxis.y*field.x+vImpactAxis.x*field.y);
  gl_FragColor=field;
}`

export function createPaneFilm(bounds: Vector4, formBead?: (x: number,y: number,diameter: number,vx: number,vy: number,speed: number) => PaneImpact | undefined) {
  const toDepth = 1000 * filmSide * filmSide / (bounds.z * bounds.w)
  const depths = new Float32Array(filmSide * filmSide), deposits = new DataTexture(depths,filmSide,filmSide,RedFormat,FloatType)
  deposits.minFilter=deposits.magFilter=NearestFilter; deposits.needsUpdate=true
  const target = () => new WebGLRenderTarget(filmSide,filmSide,{format:RedFormat,type:FloatType,minFilter:LinearFilter,magFilter:LinearFilter,depthBuffer:false})
  let front=target(), back=target(), initialized=false, dirty=false, lastNative=-1, elapsed=0
  const uniforms={ uState:{value:front.texture},uDeposits:{value:deposits},uAtlas:{value:deposits as Texture},uLocal:{value:false},uNative:{value:false},
    uMotion:{value:new Vector4()},uPaneImpact:{value:new Vector3(.12,1.4,.14)},uVolumeToDepth:{value:toDepth},uBounds:{value:bounds},uOpticalBounds:{value:bounds},uTime:{value:0},uResolution:{value:1536} }
  const camera=new OrthographicCamera(-1,1,1,-1,0,1), quad=new PlaneGeometry(2,2), flow=new Scene(), optical=new Scene()
  const strokes=Array.from({length:8},()=>({line:new Vector4(),radius:0,pressure:0}))
  let strokeCount=0
  const flowMaterial=new ShaderMaterial({uniforms,vertexShader:quadVertex,fragmentShader:advance,depthWrite:false,depthTest:false,blending:NoBlending,toneMapped:false})
  const dragUniforms={...uniforms,uStroke:{value:new Vector4()},uBrush:{value:new Vector2()}}
  const dragMaterial=new ShaderMaterial({uniforms:dragUniforms,vertexShader:quadVertex,fragmentShader:dragWater,depthWrite:false,depthTest:false,blending:NoBlending,toneMapped:false})
  const opticalMaterial=new ShaderMaterial({uniforms,vertexShader:quadVertex,fragmentShader:optics,depthWrite:false,depthTest:false,transparent:true,premultipliedAlpha:true,blending:AdditiveBlending,toneMapped:false})
  const flowMesh=new Mesh(quad,flowMaterial), opticalMesh=new Mesh(quad,opticalMaterial)
  flowMesh.frustumCulled=opticalMesh.frustumCulled=false; flow.add(flowMesh); optical.add(opticalMesh)
  let contacts: ReturnType<typeof createContacts> | undefined
  function createContacts(){
    const data=new Float32Array(maxContacts*4), indices=new Uint32Array(maxContacts*2)
    for(let i=0;i<indices.length;i++) indices[i]=i%maxContacts
    const geometry=new BufferGeometry(), attribute=new BufferAttribute(data,4).setUsage(DynamicDrawUsage)
    const velocity=new BufferAttribute(new Float32Array(maxContacts*2),2).setUsage(DynamicDrawUsage)
    geometry.setIndex(new BufferAttribute(indices,1)); geometry.setAttribute('landing',attribute); geometry.setAttribute('landingVelocity',velocity); geometry.setDrawRange(0,0)
    const material=new ShaderMaterial({uniforms,vertexShader:impactVertex,fragmentShader:impactFragment,transparent:true,premultipliedAlpha:true,blending:AdditiveBlending,depthWrite:false,depthTest:false,toneMapped:false})
    const mesh=new Points(geometry,material); mesh.frustumCulled=false; mesh.renderOrder=1; optical.add(mesh)
    return { data,attribute,velocity,geometry,material,head:0,tail:0,live:0,written:0 }
  }
  function deposit(x:number,y:number,diameter:number,share=1){
    const u=(x-bounds.x)/bounds.z,v=(y-bounds.y)/bounds.w
    if(u<0||u>1||v<0||v>1)return
    const gx=Math.min(filmSide-.0001,u*filmSide),gy=Math.min(filmSide-.0001,v*filmSide)
    const cx=Math.floor(gx),cy=Math.floor(gy),i=cy*filmSide+cx
    const amount=Math.PI/6*diameter**3*share*toDepth
    depths[i]+=amount
    dirty=true
  }
  const incident = new Vector3()
  function contact(x:number,y:number,diameter:number,time:number){
    const variation = .65 + .7 * Math.random()
    const hit = formBead?.(x,y,diameter,incident.x*variation,incident.y*variation,Math.abs(incident.z))
    const volume = Math.PI/6*diameter**3
    deposit(x,y,diameter,Math.max(0,1-((hit?.beadVolume ?? 0)+(hit?.sprayVolume ?? 0))/volume))
    const c=contacts??=createContacts(),at=c.head*4
    c.data[at]=x;c.data[at+1]=y;c.data[at+2]=diameter;c.data[at+3]=time
    c.velocity.setXY(c.head,incident.x*variation,incident.y*variation)
    if(c.live===maxContacts)c.tail=(c.tail+1)%maxContacts
    else c.live++
    c.head=(c.head+1)%maxContacts;c.written++
  }
  const rng=random(813197), point=new Vector3(), sizes=new Float32Array(256)
  let sizeScale=0,sizeStrength=-1,carry=0
  function swapTargets() {
    const swap=front;front=back;back=swap;uniforms.uState.value=front.texture
  }
  return { deposit,contact,
    stroke(ax:number,ay:number,bx:number,by:number,radius:number,pressure:number) {
      if(strokeCount>=strokes.length || (ax===bx && ay===by))return
      const stroke=strokes[strokeCount++];stroke.line.set(ax,ay,bx,by);stroke.radius=radius;stroke.pressure=Math.min(.9,pressure)
    },
    update(dt:number,time:number,rate:number,strength:number,s:RainSettings,squalls:RainSqualls) {
      elapsed=Math.min(.05,elapsed+dt); uniforms.uTime.value=time
      rainVelocity(incident,point.set(0,bounds.y+bounds.w*.5,0),time,s,strength,.003,squalls.phase)
      if(!rate)carry=0
      else carry+=dt*rate
      const n=Math.floor(carry);carry-=n
      if(n && (sizeScale!==s.rainDropSize || Math.abs(sizeStrength-strength)>.005)){
        sizeScale=s.rainDropSize;sizeStrength=strength
        for(let i=0;i<sizes.length;i++)sizes[i]=rainDiameter(.12+.86*(i+.5)/sizes.length,strength,sizeScale)
      }
      for(let i=0;i<n;i++){
        squalls.sample(point,rng)
        contact(point.x,point.y,sizes[Math.min(255,Math.floor(rng()*256))],time-dt+(i+.5)*dt/n)
      }
      uniforms.uPaneImpact.value.set(s.rainImpactDuration,s.rainImpactScale,s.rainBeadVelocity)
      if(contacts){
        const c=contacts
        while(c.live && time-c.data[c.tail*4+3]>=Math.max(.035,s.rainImpactDuration)){c.tail=(c.tail+1)%maxContacts;c.live--}
        c.geometry.setDrawRange(c.tail,c.live)
      }
      uniforms.uMotion.value.set(elapsed,s.rainFlow,s.rainFriction*Math.sqrt(s.rainSurfaceTension),s.rainDrying)
      return n
    },
    step(renderer:WebGLRenderer,native?:{depositAtlas:Texture;depositFrame:number} | null) {
      const incoming=Boolean(native && native.depositFrame!==lastNative)
      if(!initialized && !dirty && !incoming){strokeCount=0;return}
      if(!elapsed && !dirty && !incoming && !strokeCount)return
      const previous=renderer.getRenderTarget(),auto=renderer.autoClear
      try {
        // A freshly allocated texture has zero-initialized texels in WebGL.
        renderer.initRenderTarget(front)
        if(dirty)deposits.needsUpdate=true
        uniforms.uLocal.value=dirty; uniforms.uNative.value=incoming
        if(native){uniforms.uAtlas.value=native.depositAtlas;lastNative=native.depositFrame}
        else uniforms.uAtlas.value=deposits
        uniforms.uState.value=front.texture
        flowMesh.material=flowMaterial
        renderer.autoClear=false
        renderer.setRenderTarget(back);renderer.render(flow,camera);swapTargets()
        flowMesh.material=dragMaterial
        for(let i=0;i<strokeCount;i++){
          const stroke=strokes[i]
          dragUniforms.uStroke.value.copy(stroke.line);dragUniforms.uBrush.value.set(stroke.radius,stroke.pressure)
          renderer.setRenderTarget(back);renderer.render(flow,camera);swapTargets()
        }
        strokeCount=0
        if(dirty){depths.fill(0);dirty=false}
        initialized=true;elapsed=0
      } finally {renderer.setRenderTarget(previous);renderer.autoClear=auto}
    },
    draw(renderer:WebGLRenderer,opticalBounds:Vector4) {
      if(!initialized)return
      uniforms.uOpticalBounds.value=opticalBounds
      if(contacts?.written){
        const c=contacts,n=Math.min(maxContacts,c.written),start=(c.head-n+maxContacts)%maxContacts,first=Math.min(n,maxContacts-start)
        c.attribute.addUpdateRange(start*4,first*4);c.velocity.addUpdateRange(start*2,first*2)
        if(n>first){c.attribute.addUpdateRange(0,(n-first)*4);c.velocity.addUpdateRange(0,(n-first)*2)}
        c.attribute.needsUpdate=c.velocity.needsUpdate=true;c.written=0
      }
      const auto=renderer.autoClear;renderer.autoClear=false
      try{renderer.render(optical,camera)}finally{renderer.autoClear=auto}
    },
    dispose(){front.dispose();back.dispose();deposits.dispose();quad.dispose();flowMaterial.dispose();dragMaterial.dispose();opticalMaterial.dispose();contacts?.geometry.dispose();contacts?.material.dispose()},
  }
}
