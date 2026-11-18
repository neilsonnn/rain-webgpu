import { Vector3 } from 'three'
import type { createRainPlants } from '../plants'
import { stormBudget } from './budget'

export interface StormCollider { center:Vector3; normal:Vector3; across:Vector3; along:Vector3; width:number; height:number }
export function createStormColliders(plants:ReturnType<typeof createRainPlants>, extras:readonly StormCollider[]) {
  const count=plants.blades.length+extras.length
  const data=new Float32Array(Math.max(1,count)*20), heads=new Int32Array(stormBudget.hash)
  const minimum=new Vector3(),maximum=new Vector3(); let largest=0
  function put(i:number,p:Vector3,n:Vector3,across:Vector3,along:Vector3,width:number,height:number) {
    const at=i*20,r=Math.hypot(width,height),x=Math.floor(p.x/.28),y=Math.floor(p.y/.28),z=Math.floor(p.z/.28)
    const key=(Math.imul(x,73856093)^Math.imul(y,19349663)^Math.imul(z,83492791))&(stormBudget.hash-1)
    data[at]=p.x;data[at+1]=p.y;data[at+2]=p.z;data[at+3]=r
    data[at+4]=across.x;data[at+5]=across.y;data[at+6]=across.z;data[at+7]=width
    data[at+8]=along.x;data[at+9]=along.y;data[at+10]=along.z;data[at+11]=height
    data[at+12]=n.x;data[at+13]=n.y;data[at+14]=n.z;data[at+15]=heads[key]
    data[at+16]=x;data[at+17]=y;data[at+18]=z;data[at+19]=i; heads[key]=i
    minimum.x=Math.min(minimum.x,p.x-r);minimum.y=Math.min(minimum.y,p.y-r);minimum.z=Math.min(minimum.z,p.z-r)
    maximum.x=Math.max(maximum.x,p.x+r);maximum.y=Math.max(maximum.y,p.y+r);maximum.z=Math.max(maximum.z,p.z+r);largest=Math.max(largest,r)
  }
  return { data,heads,count,leafCount:plants.blades.length,minimum,maximum,get largest() { return largest },
    update(time: number, breeze: number) {
      plants.colliders(time, breeze, false)
      heads.fill(-1);minimum.set(Infinity,Infinity,Infinity);maximum.set(-Infinity,-Infinity,-Infinity);largest=0
      plants.blades.forEach((b,i)=>put(i,b.center,b.normal,b.across,b.along,b.binding.leaf.length*b.binding.leaf.width*.36,b.binding.leaf.length*.49))
      extras.forEach((e,i)=>put(plants.blades.length+i,e.center,e.normal,e.across,e.along,e.width,e.height))
      if(!count) { minimum.set(0,0,0);maximum.set(0,0,0) }
    },
  }
}
