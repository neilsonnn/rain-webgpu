export const wetLeafParsGLSL = /* glsl */`
varying vec2 vRainLeaf;
uniform float uRainSheen;
`

// Pane water is a height field composed with the air-water-glass interfaces.
export const rainGlassParsGLSL = /* glsl */`
uniform sampler2D uRainWater;
uniform vec4 uRainBounds;
uniform float uRainWetness;
uniform float uRainTexel;
uniform float uRainDirectField;
float paneWaterHeightAt(vec2 uv) {
  vec2 encoded = texture2D(uRainWater, clamp(uv, vec2(0.), vec2(1.))).rg;
  return dot(encoded, vec2(256.,1.)) * (255. / 65535.) * .064;
}
vec4 paneRainField(vec2 point) {
  if (uRainWetness < .0001 || uPaneSide < 0.) return vec4(0.);
  vec2 uv = (point - uRainBounds.xy) / uRainBounds.zw;
  vec2 tap = max(vec2(uRainTexel), fwidth(uv));
  if (any(lessThan(uv, vec2(0.))) || any(greaterThan(uv, vec2(1.)))) return vec4(0.);
  if (uRainDirectField > .5) return texture2D(uRainWater, uv);
  float h = paneWaterHeightAt(uv);
  // Derive optics from the connected liquid surface, not independent circular
  // bead normals. Wider footprints filter distant water at oblique angles.
  vec2 slope = vec2(paneWaterHeightAt(uv+vec2(tap.x,0.))-paneWaterHeightAt(uv-vec2(tap.x,0.)),
    paneWaterHeightAt(uv+vec2(0.,tap.y))-paneWaterHeightAt(uv-vec2(0.,tap.y))) / (2.*tap*uRainBounds.zw);
  return vec4(slope,h*1000.,smoothstep(.000003,.000045,h));
}
`

// Back-project only the live part of this flight. A drop passing the lens
// otherwise makes a very long streak even when its actual travel is short.
export const rainExposureGLSL = /* glsl */`
float rainTrailLength(vec3 center, vec3 velocity, vec2 projected, float shutter, float pixel, vec2 resolution) {
  float previousDepth=max(.075,-center.z+velocity.z*shutter);
  float travel=length(projected)*shutter*(-center.z)/previousDepth;
  return min(travel, pixel * min(resolution.x,resolution.y) * .055);
}
`

// The inexpensive airborne material uses an exposure along the recent curved
// trajectory. Contact tails survive briefly at their exact collision point.
export const rainBillboardGLSL = rainExposureGLSL + /* glsl */`
uniform vec2 uRainResolution;
uniform float uRainShutter;
uniform float uRainSide;
varying vec2 vRainPoint;
varying vec4 vRainShape;
varying vec4 vRainDetail;
varying vec3 vRainLight;
void projectRain(vec4 rainPosition, vec4 rainVelocity, vec4 rainCurve, vec4 rainDetail) {
  vec4 center=modelViewMatrix*vec4(rainPosition.xyz,1.);
  if (center.z>=-.075 || rainPosition.z*uRainSide<0.) { gl_Position=vec4(2.,2.,2.,1.); return; }
  vec3 velocity=(modelViewMatrix*vec4(rainVelocity.xyz,0.)).xyz;
  vec3 acceleration=(modelViewMatrix*vec4(rainCurve.xyz,0.)).xyz;
  vec2 projected=velocity.xy-center.xy*velocity.z/min(-.05,center.z);
  vec2 along=normalize(projected+vec2(.00001,0.)), across=vec2(along.y,-along.x);
  float pixel=2.*max(.05,-center.z)/(projectionMatrix[1][1]*uRainResolution.y);
  float radius=rainPosition.w*.5;
  float blur=pixel*(.4+min(1.6,abs(center.z+2.3)*.45));
  float filteredRadius=sqrt(radius*radius+blur*blur);
  float axial=max(radius,pixel*.5);
  float contact=max(0.,rainDetail.x);
  float exposure=max(0.,min(uRainShutter,rainDetail.z)-contact);
  float tail=rainTrailLength(center.xyz,velocity,projected,exposure,pixel,uRainResolution);
  float halfLength=tail*.5+axial;
  vRainPoint=vec2(position.x*2.*filteredRadius*1.12,position.y*2.*halfLength);
  vRainShape=vec4(radius,filteredRadius,axial,tail);
  vRainDetail=vec4(rainVelocity.w*smoothstep(.075,.24,-center.z),rainPosition.z,rainCurve.w,contact);
  float longitudinal=vRainPoint.y-tail*.5;
  float history=clamp(-longitudinal/max(.01,length(projected)),0.,exposure);
  vec2 bend=clamp(.5*acceleration.xy*history*history,vec2(-tail*.2),vec2(tail*.2));
  center.xy+=across*vRainPoint.x+along*longitudinal+bend;
  // A small lighting/exposure variation preserves the translucent character;
  // long fast streaks no longer get a free increase in total brightness.
  float facing=.65+.35*abs(dot(normalize(velocity+vec3(.001)),normalize(vec3(-.35,-.8,-.5))));
  float exposureWeight=sqrt(.012/max(.006,uRainShutter));
  vRainLight=vec3(facing*exposureWeight,.55+rainCurve.w*.7,rainDetail.y);
  gl_Position=projectionMatrix*center;
}
`
export const rainVertexGLSL = rainBillboardGLSL + /* glsl */`
attribute vec4 rainPosition;
attribute vec4 rainVelocity;
attribute vec4 rainCurve;
attribute vec4 rainDetail;
void main() { projectRain(rainPosition,rainVelocity,rainCurve,rainDetail); }
`
export const rainFragmentGLSL = /* glsl */`
uniform float uRainSide;
uniform float uRainVisibility;
varying vec2 vRainPoint;
varying vec4 vRainShape;
varying vec4 vRainDetail;
varying vec3 vRainLight;
void main() {
  if (vRainDetail.y*uRainSide<0.) discard;
  float radius=vRainShape.x, filteredRadius=vRainShape.y, axial=vRainShape.z;
  float h=vRainPoint.y-vRainShape.w*.5, tailLength=vRainShape.w+axial;
  float q=clamp(1.+h/max(.00001,tailLength),0.,1.);
  // Rounded liquid head, narrow soft exposure, uneven illumination. These are
  // low-opacity sprites; only water actually ON the glass traces refraction.
  float profile=sqrt(max(0.,sin(q*1.5707963)))*(.62+.38*q);
  if (h>0.) profile=sqrt(max(0.,1.-(h/axial)*(h/axial)));
  float x=vRainPoint.x/filteredRadius;
  float field=profile*profile-x*x, aa=max(.001,fwidth(field));
  float coverage=smoothstep(-aa,aa,field);
  if (coverage<.001 || h>axial || h< -tailLength) discard;
  float subpixel=min(1.,radius/filteredRadius);
  float softness=exp(-x*x*2.6/max(.08,profile*profile));
  float ripple=.62+.38*pow(.5+.5*sin(q*(12.+vRainDetail.z*19.)+vRainDetail.z*53.),2.);
  float contactFade=1.-smoothstep(.005,.035,vRainDetail.w)*smoothstep(.72,1.,q);
  float opacity=mix(.032,.085,vRainLight.z)*min(2.5,uRainVisibility)*vRainLight.x*vRainLight.y;
  gl_FragColor=vec4(vec3(1.),coverage*softness*subpixel*vRainDetail.x*opacity*ripple*contactFade);
}
`
