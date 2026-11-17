/// <reference types="@webgpu/types" />
import { CanvasTexture, LinearFilter, NoColorSpace } from 'three'
import { fluidBudget } from './types'
import type { FluidBackend } from './types'
import { depositWGSL, fluidWGSL, presentWGSL } from './wgsl'

// Native compute reconstructs one liquid surface from fine caps and their
// persistent reservoir. The existing Three renderer imports the packed result.
export async function createWebGPUFluid(): Promise<FluidBackend | null> {
  if (!navigator.gpu) return null
  const adapter=await navigator.gpu.requestAdapter({ powerPreference:'high-performance' })
  if (!adapter) return null
  const device=await adapter.requestDevice()
  const canvas=document.createElement('canvas'), n=fluidBudget.resolution, size=fluidBudget.optical
  canvas.width=canvas.height=size
  const context=canvas.getContext('webgpu')
  if (!context) { device.destroy(); return null }
  const format=navigator.gpu.getPreferredCanvasFormat(), resources:(GPUBuffer|GPUTexture)[]=[]
  const buffer=(label:string, bytes:number, usage:GPUBufferUsageFlags) => {
    const b=device.createBuffer({ label,size:bytes,usage }); resources.push(b); return b
  }
  const texture=(descriptor:GPUTextureDescriptor) => { const t=device.createTexture(descriptor); resources.push(t); return t }
  let dead=false, disposed=false
  const optical=new CanvasTexture(canvas)
  optical.colorSpace=NoColorSpace; optical.flipY=false; optical.premultiplyAlpha=false
  optical.minFilter=optical.magFilter=LinearFilter; optical.generateMipmaps=false
  const dispose=() => {
    if (disposed) return
    disposed=true; optical.dispose(); context.unconfigure()
    for (const resource of resources) resource.destroy()
    device.destroy()
  }
  device.lost.then(() => { dead=true })
  device.addEventListener('uncapturederror',event => {
    if (disposed) return
    dead=true; console.warn('WebGPU water failed; switching to the fallback.',event.error.message)
  })
  try {
    context.configure({ device,format,alphaMode:'premultiplied',colorSpace:'srgb' })
    device.pushErrorScope('validation')
    const parameters=buffer('water domain',32,GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST)
    const beads=buffer('pooled water caps',fluidBudget.beads*64,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST)
    const film=texture({ label:'persistent water reservoir',size:[n,n],format:'r32float',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST })
    const caps=texture({ label:'fine water caps',size:[size,size],format:'rgba16float',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.RENDER_ATTACHMENT })
    const resolved=texture({ label:'joined water optical field',size:[size,size],format:'rgba8unorm',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.STORAGE_BINDING })
    const stampModule=device.createShaderModule({ label:'asymmetric cap surfaces',code:depositWGSL })
    const fluidModule=device.createShaderModule({ label:'water surface reconstruction',code:fluidWGSL })
    const presentModule=device.createShaderModule({ label:'water interoperability',code:presentWGSL })
    const computeLayout=device.createBindGroupLayout({ entries:[
      { binding:1,visibility:GPUShaderStage.COMPUTE,texture:{ sampleType:'unfilterable-float' } },
      { binding:2,visibility:GPUShaderStage.COMPUTE,texture:{ sampleType:'unfilterable-float' } },
      { binding:3,visibility:GPUShaderStage.COMPUTE,storageTexture:{ access:'write-only',format:'rgba8unorm' } },
    ] })
    const [stamp,reconstruct,present]=await Promise.all([
      device.createRenderPipelineAsync({ layout:'auto',vertex:{ module:stampModule,entryPoint:'vertex' },fragment:{ module:stampModule,entryPoint:'fragment',targets:[{ format:'rgba16float',blend:{ color:{ srcFactor:'one',dstFactor:'one' },alpha:{ srcFactor:'one',dstFactor:'one' } } }] } }),
      device.createComputePipelineAsync({ layout:device.createPipelineLayout({ bindGroupLayouts:[computeLayout] }),compute:{ module:fluidModule,entryPoint:'reconstruct' } }),
      device.createRenderPipelineAsync({ layout:'auto',vertex:{ module:presentModule,entryPoint:'vertex' },fragment:{ module:presentModule,entryPoint:'fragment',targets:[{ format }] } }),
    ])
    const capView=caps.createView(), filmView=film.createView(), resolvedView=resolved.createView()
    const stampGroup=device.createBindGroup({ layout:stamp.getBindGroupLayout(0),entries:[{ binding:0,resource:{ buffer:parameters } },{ binding:1,resource:{ buffer:beads } }] })
    // Explicit layout keeps r32float usable without float32-filterable support.
    const computeGroup=device.createBindGroup({ layout:reconstruct.getBindGroupLayout(0),entries:[{ binding:1,resource:filmView },{ binding:2,resource:capView },{ binding:3,resource:resolvedView }] })
    const presentGroup=device.createBindGroup({ layout:present.getBindGroupLayout(0),entries:[{ binding:0,resource:resolvedView }] })
    const error=await device.popErrorScope(); if (error) throw new Error(error.message)
    let revision=-1
    return {
      kind:'WebGPU',texture:optical,get lost() { return dead },
      render(batch,renderer) {
        if (dead || disposed) return
        device.queue.writeBuffer(parameters,0,batch.parameters)
        if (batch.count) device.queue.writeBuffer(beads,0,batch.shapes.buffer,batch.shapes.byteOffset,batch.count*64)
        if (revision!==batch.revision) {
          device.queue.writeTexture({ texture:film },batch.film,{ bytesPerRow:n*4 },[n,n]); revision=batch.revision
        }
        const encoder=device.createCommandEncoder({ label:'joined pane water' })
        const capPass=encoder.beginRenderPass({ colorAttachments:[{ view:capView,clearValue:[0,0,0,0],loadOp:'clear',storeOp:'store' }] })
        capPass.setPipeline(stamp); capPass.setBindGroup(0,stampGroup)
        if (batch.count) capPass.draw(6,batch.count)
        capPass.end()
        const compute=encoder.beginComputePass()
        compute.setPipeline(reconstruct); compute.setBindGroup(0,computeGroup); compute.dispatchWorkgroups(size/8,size/8); compute.end()
        const output=encoder.beginRenderPass({ colorAttachments:[{ view:context.getCurrentTexture().createView(),clearValue:[0,0,0,1],loadOp:'clear',storeOp:'store' }] })
        output.setPipeline(present); output.setBindGroup(0,presentGroup); output.draw(3); output.end()
        device.queue.submit([encoder.finish()])
        optical.needsUpdate=true; renderer.initTexture(optical)
      },dispose,
    }
  } catch (error) { dispose(); throw error }
}
