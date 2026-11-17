export const screenVertex = /* glsl */`void main() { gl_Position=vec4(position.xy,0.,1.); }`
export const opticalGLSL = /* glsl */`
uniform sampler2D uFilm;
uniform sampler2D uCaps;
uniform vec4 uParams[2];
float filmAt(vec2 uv) {
  ivec2 size=textureSize(uFilm,0); vec2 p=uv*vec2(size)-.5; ivec2 c=ivec2(floor(p)); vec2 f=fract(p);
  return mix(mix(texelFetch(uFilm,clamp(c,ivec2(0),size-1),0).r,texelFetch(uFilm,clamp(c+ivec2(1,0),ivec2(0),size-1),0).r,f.x),
    mix(texelFetch(uFilm,clamp(c+ivec2(0,1),ivec2(0),size-1),0).r,texelFetch(uFilm,clamp(c+ivec2(1,1),ivec2(0),size-1),0).r,f.x),f.y);
}
float cap(ivec2 c) { return texelFetch(uCaps,clamp(c,ivec2(0),textureSize(uCaps,0)-1),0).r; }
void main() {
  ivec2 c=ivec2(gl_FragCoord.xy); vec2 uv=gl_FragCoord.xy/vec2(textureSize(uCaps,0));
  float neighbors=(cap(c+ivec2(1,0))+cap(c-ivec2(1,0))+cap(c+ivec2(0,1))+cap(c-ivec2(0,1)))*.25;
  float height=filmAt(uv)+mix(cap(c),neighbors,.12), h=floor(clamp(height/.064,0.,1.)*65535.+.5);
  gl_FragColor=vec4(floor(h/256.)/255.,mod(h,256.)/255.,smoothstep(.000003,.000045,height),1.);
}
`
export const depositVertexGLSL = /* glsl */`
attribute vec4 capShape;
attribute vec4 capWater;
attribute vec4 capDetail;
uniform vec4 uParams[2];
varying vec2 vPoint;
varying vec4 vWater;
varying vec4 vShape;
varying vec4 vDetail;
void main() {
  vPoint=position.xy*3.6; vWater=capWater; vShape=capShape; vDetail=capDetail;
  vec2 p=vPoint*capShape.zw; float cs=cos(capWater.y),sn=sin(capWater.y);
  vec2 world=capShape.xy+vec2(cs*p.x-sn*p.y,sn*p.x+cs*p.y);
  gl_Position=vec4((world-uParams[0].zw)/uParams[0].xy*2.-1.,0.,1.);
}
`
export const depositFragmentGLSL = /* glsl */`
varying vec2 vPoint;
varying vec4 vWater;
varying vec4 vShape;
varying vec4 vDetail;
float kernel(vec2 q,float seed,float irregular) {
  float a=atan(q.y,q.x+.0000001);
  float edge=1.+irregular*sin(a*3.+seed)+irregular*.55*sin(a*5.-seed*1.7);
  float profile=max(0.,1.-dot(q,q)/(edge*edge));
  return profile*profile/(1.+irregular*irregular*.65125);
}
void main() {
  float shape=(1.-vDetail.z)*kernel(vPoint,vWater.z,vDetail.w)
    +vDetail.z*kernel((vPoint-vDetail.xy)/.55,vWater.z+8.,vDetail.w)/(.55*.55);
  float height=vWater.x*3./(3.141592654*vShape.z*vShape.w)*shape;
  if (height<.00000001) discard;
  gl_FragColor=vec4(height,0.,0.,0.);
}
`
