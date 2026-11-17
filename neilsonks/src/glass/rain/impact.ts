// Shared by native storm contacts, fallback contacts and fine point splats.
// All distances are in metres, and the incoming velocity is in metres/second.
export const impactMotionGLSL = /* glsl */`
uniform vec3 uPaneImpact;
vec2 impactTravel(vec2 velocity,float diameter,float age) {
  float tau=.014+diameter*2.5;
  return velocity*uPaneImpact.z*tau*(1.-exp(-age/tau))+vec2(0.,-.3*age*age);
}
vec4 impactDimensions(float diameter,float age,vec2 velocity) {
  float duration=max(.035,uPaneImpact.x);
  float phase=clamp(age/duration,0.,1.);
  float radius=diameter*.6;
  float ring=radius*uPaneImpact.y*(1.+1.1*sqrt(phase));
  return vec4(radius,length(impactTravel(velocity,diameter,age)),ring,phase);
}
`
export const impactShapeGLSL = /* glsl */`
vec4 impactWater(vec2 point,vec4 shape) {
  float radius=max(.0001,shape.x),travel=shape.y,ring=max(.0001,shape.z),phase=shape.w;
  // Rim only: no synthetic bead head or connecting neck in the impact effect.
  vec2 fromHit=point+vec2(0.,travel*.5);
  float r=length(fromHit)/ring,k=(r-.67)*7.,crest=exp(-k*k);
  float rimFade=1.-smoothstep(.15,1.,phase);
  float rim=radius*.22*rimFade*crest;
  vec2 gradient=-14.*k*rim*fromHit/(max(.00001,length(fromHit))*ring);
  return vec4(gradient,rim*1000.,crest*rimFade*.82);
}
`
