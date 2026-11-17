import type { DataTexture } from 'three'

// Upload once, with a complete filtered height pyramid. Large drops see the
// average relief under their footprint instead of microscopic normal-map noise.
export function uploadPaneRelief(device: GPUDevice, source?: DataTexture) {
  let size=source?.image.width ?? 1
  const bytes=source?.image.data as Uint8Array | undefined
  let values=Float32Array.from({length:size*size},(_,i)=>bytes ? (bytes[i*4+3]/255-.5)*.0016 : 0)
  const texture=device.createTexture({label:'physical glass relief for water contact',size:[size,size],format:'r32float',
    mipLevelCount:Math.floor(Math.log2(size))+1,usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST})
  let level=0
  for (;;) {
    device.queue.writeTexture({texture,mipLevel:level},values,{bytesPerRow:size*4},[size,size])
    if (size===1) break
    const nextSize=Math.max(1,Math.floor(size/2)),next=new Float32Array(nextSize*nextSize)
    for(let y=0;y<nextSize;y++)for(let x=0;x<nextSize;x++) {
      const i=y*2*size+x*2
      next[y*nextSize+x]=(values[i]+values[i+1]+values[i+size]+values[i+size+1])*.25
    }
    values=next;size=nextSize;level++
  }
  return texture
}
