import { AdditiveBlending, Color, DataTexture, DynamicDrawUsage, FloatType, HalfFloatType, InstancedBufferAttribute,
  InstancedBufferGeometry, LinearFilter, Mesh, NearestFilter, NoColorSpace, OrthographicCamera, PlaneGeometry, RedFormat, Scene,
  ShaderMaterial, UnsignedByteType, WebGLRenderTarget } from 'three'
import { fluidBudget } from './types'
import type { FluidBackend } from './types'
import { depositFragmentGLSL, depositVertexGLSL, opticalGLSL, screenVertex } from './glsl'

export function createWebGLFluid(): FluidBackend {
  const n=fluidBudget.resolution, size=fluidBudget.optical
  const caps=new WebGLRenderTarget(size,size,{ type:HalfFloatType,minFilter:NearestFilter,magFilter:NearestFilter,depthBuffer:false })
  const optical=new WebGLRenderTarget(size,size,{ type:UnsignedByteType,minFilter:LinearFilter,magFilter:LinearFilter,depthBuffer:false })
  const film=new DataTexture(new Float32Array(n*n),n,n,RedFormat,FloatType)
  film.minFilter=film.magFilter=NearestFilter; film.colorSpace=NoColorSpace
  const parameters=new Float32Array(8)
  const uniforms={ uParams:{ value:parameters },uFilm:{ value:film },uCaps:{ value:caps.texture } }
  const pack=new ShaderMaterial({ vertexShader:screenVertex,fragmentShader:opticalGLSL,uniforms,depthTest:false,depthWrite:false,toneMapped:false })
  const scene=new Scene(), camera=new OrthographicCamera(-1,1,1,-1,0,1), quad=new PlaneGeometry(2,2)
  const screen=new Mesh(quad,pack); screen.frustumCulled=false; scene.add(screen)
  const capScene=new Scene(), capQuad=new PlaneGeometry(1,1), geometry=new InstancedBufferGeometry()
  geometry.index=capQuad.index; geometry.attributes=capQuad.attributes
  const shape=new InstancedBufferAttribute(new Float32Array(fluidBudget.beads*4),4).setUsage(DynamicDrawUsage)
  const water=new InstancedBufferAttribute(new Float32Array(fluidBudget.beads*4),4).setUsage(DynamicDrawUsage)
  const detail=new InstancedBufferAttribute(new Float32Array(fluidBudget.beads*4),4).setUsage(DynamicDrawUsage)
  geometry.setAttribute('capShape',shape); geometry.setAttribute('capWater',water); geometry.setAttribute('capDetail',detail)
  const stamp=new ShaderMaterial({ vertexShader:depositVertexGLSL,fragmentShader:depositFragmentGLSL,uniforms,
    depthTest:false,depthWrite:false,transparent:true,blending:AdditiveBlending,premultipliedAlpha:true,toneMapped:false })
  const mesh=new Mesh(geometry,stamp); mesh.frustumCulled=false; capScene.add(mesh)
  const clear=new Color(); let revision=-1
  return {
    kind:'WebGL2',texture:optical.texture,lost:false,
    render(batch,renderer) {
      const previous=renderer.getRenderTarget(), alpha=renderer.getClearAlpha(), autoClear=renderer.autoClear, shadows=renderer.shadowMap.autoUpdate
      renderer.getClearColor(clear); parameters.set(batch.parameters)
      try {
        renderer.autoClear=true; renderer.shadowMap.autoUpdate=false; renderer.setClearColor(0,0)
        if (revision!==batch.revision) { film.image.data=batch.film; film.needsUpdate=true; revision=batch.revision }
        for (let i=0;i<batch.count;i++) {
          const at=i*16,d=batch.shapes
          shape.setXYZW(i,d[at],d[at+1],d[at+2],d[at+3])
          water.setXYZW(i,d[at+4],d[at+5],d[at+6],d[at+7])
          detail.setXYZW(i,d[at+8],d[at+9],d[at+10],d[at+11])
        }
        geometry.instanceCount=batch.count
        if (batch.count) shape.needsUpdate=water.needsUpdate=detail.needsUpdate=true
        renderer.setRenderTarget(caps); renderer.render(capScene,camera)
        renderer.setRenderTarget(optical); renderer.render(scene,camera)
      } finally {
        renderer.setRenderTarget(previous); renderer.setClearColor(clear,alpha)
        renderer.autoClear=autoClear; renderer.shadowMap.autoUpdate=shadows
      }
    },
    dispose() { caps.dispose(); optical.dispose(); film.dispose(); pack.dispose(); stamp.dispose(); geometry.dispose(); capQuad.dispose(); quad.dispose() },
  }
}
