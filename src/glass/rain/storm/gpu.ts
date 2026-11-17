/// <reference types="@webgpu/types" />
import { CanvasTexture, NearestFilter, NoColorSpace, Vector3 } from 'three'
import type { Vector4, WebGLRenderer } from 'three'
import type { GlassSettings } from '../../settings'
import type { FrameTimings } from '../../performance'
import { panePatterRate } from '../settings'
import type { RainSqualls } from '../squalls'
import { stormBudget as b, stormCount, stormOffsets as o, stormAtlasHeight, filmSide } from './budget'
import { stormComputeWGSL, stormPackWGSL } from './compute'
import { createStormRendering } from './render'
import type { createStormColliders } from './colliders'
import { requestWebGPUAdapter, WebGPUUnavailableError } from '../webgpu'
import { paneComputeWGSL } from './pane-compute'
import { uploadPaneRelief } from './pane-terrain'
import { paneArenaWords, panePoolCount } from './budget'
import type { RainTerrain } from '../terrain'
import { optics } from '../../earlier/settings'

export interface StormFeedback { hit(index:number,point:Vector3,velocity:Vector3,diameter:number,energy:number):void; pressure(energy:number,hits:number):void }
export async function createGpuStorm(renderer:WebGLRenderer,bounds:Vector4,colliders:ReturnType<typeof createStormColliders>,squalls:RainSqualls,feedback:StormFeedback,timings?:FrameTimings,
  options: { adapter?: GPUAdapter; terrain?: Pick<RainTerrain,'texture'|'grid'>; onFailure?: (error: Error) => void } = {}) {
  const adapter=options.adapter ?? await requestWebGPUAdapter()
  const timestamps=Boolean(timings && adapter.features.has('timestamp-query'))
  const device=await adapter.requestDevice({requiredFeatures:timestamps?['timestamp-query']:[]}).catch(()=>{throw new WebGPUUnavailableError()}),canvas=document.createElement('canvas')
  canvas.width=b.atlasWidth;canvas.height=stormAtlasHeight
  const context=canvas.getContext('webgpu');if(!context) { device.destroy();throw new WebGPUUnavailableError() }
  const format=navigator.gpu.getPreferredCanvasFormat(),resources:GPUBuffer[]=[]
  const buffer=(label:string,size:number,usage:GPUBufferUsageFlags)=>{const value=device.createBuffer({label,size,usage});resources.push(value);return value}
  const texture=new CanvasTexture(canvas);texture.colorSpace=NoColorSpace;texture.flipY=false;texture.generateMipmaps=false
  texture.minFilter=texture.magFilter=NearestFilter
  const rendering=createStormRendering(texture,bounds),parameters=new Float32Array(128),commands=new Float32Array(b.commands*12),brushes=new Float32Array(64)
  let disposed=false,lost=false,commandCount=0,dripCount=0,brushHits=0,brushCount=0,quiet=Infinity
  let patterCarry=0,patterTotal=0
  let weatherRevision=-1
  let depositFrame=0
  let timer: { query: GPUQuerySet; resolve: GPUBuffer; readback: GPUBuffer; busy: boolean } | undefined
  let lastTiming = -Infinity
  let reliefTexture: GPUTexture | undefined
  const dispose=()=>{if(disposed)return;disposed=true;timer?.query.destroy();rendering.dispose();texture.dispose();reliefTexture?.destroy();context.unconfigure();for(const value of resources)value.destroy();device.destroy()}
  device.lost.then(()=>{if(!disposed){lost=true;options.onFailure?.(new Error('The WebGPU connection was lost. Please reload the scene.'))}})
  device.addEventListener('uncapturederror',event=>{if(!disposed){lost=true;options.onFailure?.(new Error(event.error.message))}})
  try {
    context.configure({device,format,alphaMode:'opaque',colorSpace:'srgb'})
    device.pushErrorScope('validation')
    const storage=GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST
    const params=buffer('storm controls',512,GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST)
    const particles=buffer('rain spray beads rings and trails',stormCount*48,storage)
    const leaves=buffer('moving leaf and sculpture colliders',colliders.data.byteLength,storage)
    const heads=buffer('leaf spatial hash',colliders.heads.byteLength,storage)
    const hits=buffer('GPU impact queue',b.hits*48,storage)
    const counters=buffer('pooled storm cursors',64,storage|GPUBufferUsage.COPY_SRC)
    const events=buffer('leaf and sculpture impact feedback',b.feedback*48,storage|GPUBufferUsage.COPY_SRC)
    const input=buffer('roof runoff and touch events',commands.byteLength,storage)
    const weather=buffer('shared squall density and alias table',squalls.cells.byteLength,storage)
    const landed=buffer('water retained from every pane impact',filmSide*filmSide*4,storage)
    const paneMemory=buffer('bead path anchors and contact history',b.beads*48,storage)
    const paneIndex=buffer('pane neighbors, free slots and arriving water',paneArenaWords*4,storage)
    reliefTexture=uploadPaneRelief(device,options.terrain?.texture)
    const readbacks=Array.from({length:3},(_,i)=>({buffer:buffer(`storm feedback ${i}`,64+b.feedback*48,GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ),busy:false}))
    const module=device.createShaderModule({label:'GPU storm physics',code:stormComputeWGSL})
    const packModule=device.createShaderModule({label:'storm vertex texture bridge',code:stormPackWGSL})
    const paneModule=device.createShaderModule({label:'continuous beads and collecting tracks',code:paneComputeWGSL})
    for (const shader of [module,packModule,paneModule]) {
      const info=await shader.getCompilationInfo()
      const errors=info.messages.filter(message=>message.type==='error')
      if(errors.length)throw new Error(errors.map(message=>`${shader.label}:${message.lineNum}:${message.linePos}: ${message.message}`).join('\n'))
    }
    const [advance,impacts,pack]=await Promise.all([
      device.createComputePipelineAsync({layout:'auto',compute:{module,entryPoint:'advance'}}),
      device.createComputePipelineAsync({layout:'auto',compute:{module,entryPoint:'impacts'}}),
      device.createRenderPipelineAsync({layout:'auto',vertex:{module:packModule,entryPoint:'vertex'},fragment:{module:packModule,entryPoint:'fragment',targets:[{format}]}}),
    ])
    const buffers=[params,particles,leaves,heads,hits,counters,events,input,weather,landed,paneIndex]
    const group=(pipeline:GPUComputePipeline|GPURenderPipeline,bindings:number[])=>device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:bindings.map(binding=>({binding,resource:{buffer:buffers[binding]}}))})
    const advanceGroup=group(advance,[0,1,2,3,4,5,6,8,9]),impactGroup=group(impacts,[0,1,4,5,7,8,9,10]),packGroup=group(pack,[1,9])
    const paneBuffers=[{binding:0,value:params},{binding:1,value:particles},{binding:2,value:paneMemory},
      {binding:3,value:paneIndex},{binding:6,value:counters},{binding:7,value:landed}]
    const paneLayout=device.createBindGroupLayout({entries:[
      ...paneBuffers.map(({binding})=>({binding,visibility:GPUShaderStage.COMPUTE,buffer:{type:binding===0?'uniform' as const:'storage' as const}})),
      {binding:8,visibility:GPUShaderStage.COMPUTE,texture:{sampleType:'unfilterable-float'}},
    ]})
    const panePipelineLayout=device.createPipelineLayout({bindGroupLayouts:[paneLayout]})
    const panePasses=await Promise.all(['movePane','indexPane','claimTracks','absorbTracks','proposeMerges','mergeBeads','finishTracks']
      .map(entryPoint=>device.createComputePipelineAsync({label:entryPoint,layout:panePipelineLayout,compute:{module:paneModule,entryPoint}})))
    const arrivals=await device.createComputePipelineAsync({label:'collect incoming rain on existing beads',layout:panePipelineLayout,compute:{module:paneModule,entryPoint:'collectArrivals'}})
    const paneGroup=device.createBindGroup({layout:paneLayout,entries:[
      ...paneBuffers.map(({value,binding})=>({binding,resource:{buffer:value}})),
      {binding:8,resource:reliefTexture.createView()},
    ]})
    const validation=await device.popErrorScope();if(validation)throw new Error(validation.message)
    const point=new Vector3(),velocity=new Vector3()
    function read(slot:typeof readbacks[number],patter:number,submittedAt:number) {
      slot.busy=true
      void slot.buffer.mapAsync(GPUMapMode.READ).then(()=>{
        if(disposed)return
        const start=timings?.expanded?performance.now():0
        const mapped=slot.buffer.getMappedRange(),counts=new Uint32Array(mapped,0,16),data=new Float32Array(mapped,64)
        if(submittedAt>=0)timings?.paneTotals(counts[14],patter,submittedAt)
        feedback.pressure(counts[10]/100,counts[11])
        for(let i=0;i<Math.min(b.feedback,counts[1]);i++) {
          const at=i*12
          point.set(data[at],data[at+1],data[at+2]);velocity.set(data[at+4],data[at+5],data[at+6])
          feedback.hit(Math.round(data[at+7]),point,velocity,data[at+3],data[at+11])
        }
        if(timings?.expanded)timings.addFeedbackTime(performance.now()-start)
      }).catch(error=>{if(!disposed){lost=true;options.onFailure?.(error instanceof Error ? error : new Error(String(error)))}})
        .finally(()=>{if(!disposed && slot.buffer.mapState==='mapped')slot.buffer.unmap();slot.busy=false})
    }
    return { ...rendering,get lost(){return lost}, depositAtlas:texture, get depositFrame(){return depositFrame},
      stroke(ax:number,ay:number,bx:number,by:number,radius:number,pressure:number,dt:number) {
        const i=Math.min(brushCount,7),at=i*8
        if(brushCount<8){brushes[at]=ax;brushes[at+1]=ay;brushCount++}
        brushes[at+2]=bx;brushes[at+3]=by;brushes[at+4]=radius;brushes[at+5]=pressure
        brushes[at+6]=Math.max(-4,Math.min(4,(bx-ax)/Math.max(.008,dt)));brushes[at+7]=Math.max(-4,Math.min(4,(by-ay)/Math.max(.008,dt)))
      },
      drip(point:Vector3,velocity:Vector3,diameter:number) {
        if(dripCount>=b.commands-b.brushCommands)return
        dripCount++
        const at=commandCount++*12;commands[at]=point.x;commands[at+1]=point.y;commands[at+2]=point.z;commands[at+3]=diameter
        commands[at+4]=velocity.x;commands[at+5]=velocity.y;commands[at+6]=velocity.z;commands[at+7]=-2
        commands[at+8]=0;commands[at+9]=1;commands[at+10]=0;commands[at+11]=.5
      },
      paneHit(point:Vector3,velocity:Vector3,diameter:number) {
        if(brushHits>=b.brushCommands)return
        brushHits++
        const at=commandCount++*12
        commands[at]=point.x;commands[at+1]=point.y;commands[at+2]=0;commands[at+3]=diameter
        commands[at+4]=velocity.x;commands[at+5]=velocity.y;commands[at+6]=velocity.z;commands[at+7]=-3
        commands[at+8]=0;commands[at+9]=0;commands[at+10]=1
        commands[at+11]=Math.min(1.5,Math.sqrt(998*diameter*velocity.z*velocity.z/.072)/35)
      },
      update(dt:number,time:number,strength:number,s:GlassSettings) {
        if(lost||disposed)return
        quiet=s.rain||commandCount||brushCount?0:quiet+dt
        if((dt<=0&&!brushCount&&!commandCount)||quiet>Math.max(45,s.rainBeadLifetime+s.rainDrying+5))return
        const active=strength<.0001 ? 0 : Math.round(b.rain*Math.min(1,(.004+.996*strength**1.8)*s.rainParticles))
        rendering.uniforms.uStormActive.value=active;rendering.uniforms.uRainShutter.value=s.rainShutter/1000;rendering.uniforms.uRainVisibility.value=s.rainVisibility
        rendering.uniforms.uPaneImpact.value.set(s.rainImpactDuration,s.rainImpactScale,s.rainBeadVelocity)
        colliders.update()
        parameters.set([Math.min(.05,dt),time,strength,active,s.rainWind,s.rainWindStrength,s.rainTurbulence,s.rainSpeed,
          s.rainDropSize,s.rainGlass,Number(s.glass),s.rainIncidence,
          bounds.x,bounds.x+bounds.z,bounds.y,bounds.y+bounds.w,
          colliders.count,commandCount,brushCount,s.rainSpray,
          colliders.minimum.x,colliders.minimum.y,colliders.minimum.z,colliders.largest,
          colliders.maximum.x,colliders.maximum.y,colliders.maximum.z,0,
          s.rainWander,s.rainSurfaceTension,s.rainFlow,s.rainFriction])
        patterCarry = s.rain && s.glass ? patterCarry + (panePatterRate(strength,s,bounds.z*bounds.w)*squalls.flux)*Math.min(.05,dt) : 0
        const patterCount = Math.floor(patterCarry)
        patterCarry -= patterCount
        parameters.set([s.rainDrying,colliders.leafCount,patterCount,patterTotal % 16777216],96)
        parameters[100]=squalls.phase; parameters[101]=1.25/s.rainSquallSize
        parameters[102]=s.rainBeadChance; parameters[103]=s.rainBeadVelocity
        parameters[104]=s.rainImpactDuration
        parameters[105]=s.rainBeadLifetime
        const grid=options.terrain?.grid
        parameters.set([grid?.origin.x ?? 0,grid?.origin.y ?? 0,grid?.warp.value ?? 0,s.wireSpacing,
          s.gridRelief,s.gridWidth,s.gridPebbling,optics.textureSize*s.textureScale,s.relief],108)
        patterTotal += patterCount
        parameters.set(brushes,32)
        if(weatherRevision!==squalls.revision) { device.queue.writeBuffer(weather,0,squalls.cells); weatherRevision=squalls.revision }
        device.queue.writeBuffer(params,0,parameters);device.queue.writeBuffer(leaves,0,colliders.data);device.queue.writeBuffer(heads,0,colliders.heads)
        if(commandCount)device.queue.writeBuffer(input,0,commands.buffer,0,commandCount*48)
        const encoder=device.createCommandEncoder({label:'advance storm particles'})
        encoder.clearBuffer(landed)
        // Leave airborne/rim cursors and lifetime pane-hit count intact.
        encoder.clearBuffer(counters,0,8);encoder.clearBuffer(counters,24,32)
        encoder.clearBuffer(counters,20,4)
        encoder.clearBuffer(counters,60,4);encoder.clearBuffer(paneIndex)
        const timingClock = dt>0 && timestamps && timings?.expanded ? performance.now() : -Infinity
        const sample = Number.isFinite(timingClock) && !timer?.busy && timingClock - lastTiming >= 250
        if (sample && !timer) timer = {
          query: device.createQuerySet({type:'timestamp',count:2}),
          resolve: buffer('storm elapsed time',16,GPUBufferUsage.QUERY_RESOLVE|GPUBufferUsage.COPY_SRC),
          readback: buffer('storm elapsed readback',16,GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ), busy: false,
        }
        const dispatch=(pipeline:GPUComputePipeline,bind:GPUBindGroup,n:number,writes?:GPUComputePassTimestampWrites)=>{
          const pass=encoder.beginComputePass(writes?{timestampWrites:writes}:undefined)
          pass.setPipeline(pipeline);pass.setBindGroup(0,bind);pass.dispatchWorkgroups(n);pass.end()
        }
        const timing = sample ? timer : undefined
        if (dt>0) {
          dispatch(advance,advanceGroup,Math.ceil(o.trails/128),timing?{querySet:timing.query,beginningOfPassWriteIndex:0}:undefined)
        }
        for(let i=0;i<panePasses.length;i++)dispatch(panePasses[i],paneGroup,Math.ceil((i<2?panePoolCount:b.beads)/128))
        dispatch(impacts,impactGroup,Math.ceil((b.hits+commandCount+patterCount)/64))
        dispatch(arrivals,paneGroup,Math.ceil(b.beads/128),timing?{querySet:timing.query,endOfPassWriteIndex:1}:undefined)
        if (timing) {
          encoder.resolveQuerySet(timing.query,0,2,timing.resolve,0)
          encoder.copyBufferToBuffer(timing.resolve,0,timing.readback,0,16)
        }
        const output=encoder.beginRenderPass({colorAttachments:[{view:context.getCurrentTexture().createView(),clearValue:[0,0,0,1],loadOp:'clear',storeOp:'store'}]})
        output.setPipeline(pack);output.setBindGroup(0,packGroup);output.draw(3);output.end()
        const slot=readbacks.find(value=>!value.busy)
        if(slot){encoder.copyBufferToBuffer(counters,0,slot.buffer,0,64);encoder.copyBufferToBuffer(events,0,slot.buffer,64,b.feedback*48)}
        device.queue.submit([encoder.finish()]);texture.needsUpdate=true;renderer.initTexture(texture);depositFrame++
        if (timing) {
          timing.busy=true; lastTiming=timingClock
          void timing.readback.mapAsync(GPUMapMode.READ).then(()=>{
            if(disposed || !timings?.expanded)return
            const pair=new BigUint64Array(timing.readback.getMappedRange())
            if(pair[1]>=pair[0])timings.stormGpu=Number(pair[1]-pair[0])/1e6
          }).catch(()=>{}).finally(()=>{
            if(!disposed && timing.readback.mapState==='mapped')timing.readback.unmap()
            timing.busy=false
          })
        }
        if(slot)read(slot,patterTotal,timings?.expanded?performance.now():-1)
        commandCount=dripCount=brushHits=brushCount=0
      },dispose,
    }
  } catch(error){dispose();throw error}
}
