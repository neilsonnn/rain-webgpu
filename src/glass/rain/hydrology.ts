import { Vector3, Vector4 } from 'three'
import type { GlassSettings } from '../settings'
import { random } from '../settings'
import { dropVolume, water } from './settings'
import type { RainTerrain } from './terrain'
import { rainAir, rainNoise } from './weather'
import { fluidBudget } from './fluid/types'

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x))
const capVolume = Math.PI * .6 / 2
const radiusOf = (volume: number) => Math.cbrt(Math.max(0, volume) / capVolume)
const fraction = (x: number, y: number, ax: number, ay: number, bx: number, by: number) =>
  clamp(((x-ax)*(bx-ax)+(y-ay)*(by-ay))/Math.max(1e-12,(bx-ax)**2+(by-ay)**2),0,1)
export interface PaneImpact { sprayVolume: number; energy: number; pieces: number }
interface Bead {
  alive: boolean; x: number; y: number; volume: number; vx: number; vy: number; radius: number
  seed: number; age: number; contactAge: number; energy: number; pinned: boolean
  terrainX: number; terrainY: number; pin: number; sampleX: number; sampleY: number
  lobeX: number; lobeY: number; lobe: number; angle: number; hash: number; next: number; prev: number
}

// One volume ledger. Fine caps move continuously; their residual film is a
// persistent reservoir, sampled and collected by subsequent impacts/heads.
// GPU reconstruction has no separate, drifting copy of the hydrology.
export class PaneHydrology {
  readonly film = new Float32Array(fluidBudget.resolution ** 2)
  readonly shapes = new Float32Array(fluidBudget.beads * 16)
  readonly beads: Bead[] = Array.from({ length: fluidBudget.beads }, () => ({ alive: false,
    x: 0, y: 0, volume: 0, vx: 0, vy: 0, radius: 0, seed: 0, age: 0, contactAge: 0, energy: 0,
    pinned: true, terrainX: 0, terrainY: 0, pin: 1, sampleX: Infinity, sampleY: Infinity,
    lobeX: 0, lobeY: 0, lobe: 0, angle: 0, hash: -1, next: -1, prev: -1 }))
  readonly cell: number
  revision = 0
  count = 0
  time = 12
  deposited = 0
  evaporated = 0
  drained = 0
  ejected = 0
  merges = 0
  private readonly wet = new Float32Array(this.film.length)
  private readonly touched = new Float32Array(this.film.length)
  private readonly active = new Int32Array(this.film.length)
  private readonly slots = new Int32Array(this.film.length).fill(-1)
  private activeCount = 0
  private cursor = 0
  private recycle = 0
  private readonly free = new Int32Array(fluidBudget.beads)
  private freeCount = this.free.length
  private readonly hashCell = .06
  private readonly columns: number
  private readonly heads: Int32Array
  private readonly rng = random(81353)
  private readonly point = new Vector3()
  private readonly air = new Vector3()
  private readonly impact: PaneImpact = { sprayVolume: 0, energy: 0, pieces: 0 }
  private largest = .012
  private settings!: GlassSettings
  private previousSettings?: GlassSettings
  constructor(readonly bounds: Vector4, private pane: Vector4, private terrain: RainTerrain) {
    this.cell = bounds.z / fluidBudget.resolution
    this.columns = Math.ceil(bounds.z / this.hashCell)
    this.heads = new Int32Array(this.columns ** 2).fill(-1)
    for (let i=0;i<this.free.length;i++) this.free[i] = i
  }
  configure(s: GlassSettings) { this.settings = s }
  private inside(x: number, y: number) { return x >= this.pane.x && x <= this.pane.z && y >= this.pane.y && y <= this.pane.w }
  private key(x: number, y: number) {
    return clamp(Math.floor((y-this.bounds.y)/this.hashCell),0,this.columns-1)*this.columns
      + clamp(Math.floor((x-this.bounds.x)/this.hashCell),0,this.columns-1)
  }
  private unlink(index: number) {
    const b = this.beads[index]
    if (b.hash < 0) return
    if (b.prev >= 0) this.beads[b.prev].next = b.next
    else this.heads[b.hash] = b.next
    if (b.next >= 0) this.beads[b.next].prev = b.prev
    b.hash = b.next = b.prev = -1
  }
  private link(index: number) {
    const b = this.beads[index], key = this.key(b.x,b.y)
    if (b.hash === key) return
    this.unlink(index)
    b.hash = key; b.next = this.heads[key]; b.prev = -1
    if (b.next >= 0) this.beads[b.next].prev = index
    this.heads[key] = index
  }
  private retire(index: number) {
    const b = this.beads[index]
    if (!b.alive) return
    this.unlink(index); b.alive = false; b.volume = 0; this.free[this.freeCount++] = index
  }
  private ageCell(i: number) {
    const dt = Math.max(0,this.time-this.touched[i])
    if (dt > 0) {
      const lost = Math.min(this.film[i],.00002/this.settings.rainDrying*dt)
      this.film[i] -= lost; this.evaporated += lost*this.cell*this.cell
      this.wet[i] *= Math.exp(-dt/this.settings.rainDrying)
      this.touched[i] = this.time
      if (lost) this.revision++
    }
  }
  private addCell(i: number, height: number) {
    this.ageCell(i)
    if (this.slots[i] < 0) { this.slots[i] = this.activeCount; this.active[this.activeCount++] = i }
    this.film[i] += height; this.wet[i] = 1; this.revision++
  }
  private filmAt(x: number, y: number) {
    const n=fluidBudget.resolution
    const ix=clamp(Math.floor((x-this.bounds.x)/this.cell),0,n-1), iy=clamp(Math.floor((y-this.bounds.y)/this.cell),0,n-1)
    return iy*n+ix
  }
  private wetAt(x: number, y: number) {
    if (!this.inside(x,y)) return 0
    const i=this.filmAt(x,y)
    return Math.max(this.wet[i]*Math.exp(-(this.time-this.touched[i])/this.settings.rainDrying),Math.min(1,this.film[i]/.000035))
  }
  // Compact normalized splats: no water vanishes when a bead pool is full,
  // and a narrow trail is never evicted to make room for an unrelated trail.
  private depositFilm(x: number, y: number, volume: number, width: number) {
    if (volume <= 0) return
    if (!this.inside(x,y)) { this.drained += volume; return }
    const n=fluidBudget.resolution, r=Math.max(this.cell*.8,width), r2=r*r
    const x0=clamp(Math.floor((x-r-this.bounds.x)/this.cell),0,n-1), x1=clamp(Math.floor((x+r-this.bounds.x)/this.cell),0,n-1)
    const y0=clamp(Math.floor((y-r-this.bounds.y)/this.cell),0,n-1), y1=clamp(Math.floor((y+r-this.bounds.y)/this.cell),0,n-1)
    let sum=0
    for (let iy=y0;iy<=y1;iy++) for (let ix=x0;ix<=x1;ix++) {
      const dx=this.bounds.x+(ix+.5)*this.cell-x, dy=this.bounds.y+(iy+.5)*this.cell-y
      sum += Math.max(0,1-(dx*dx+dy*dy)/r2)**2
    }
    if (sum < 1e-8) { this.addCell(this.filmAt(x,y),volume/(this.cell*this.cell)); return }
    const scale=volume/(sum*this.cell*this.cell)
    for (let iy=y0;iy<=y1;iy++) for (let ix=x0;ix<=x1;ix++) {
      const px=this.bounds.x+(ix+.5)*this.cell, py=this.bounds.y+(iy+.5)*this.cell
      const weight=Math.max(0,1-((px-x)**2+(py-y)**2)/r2)**2
      if (weight <= 0) continue
      if (this.inside(px,py)) this.addCell(iy*n+ix,weight*scale)
      else this.drained += weight*scale*this.cell*this.cell
    }
  }
  private trail(ax: number, ay: number, bx: number, by: number, volume: number, width: number) {
    const steps=Math.min(48,Math.max(1,Math.ceil(Math.hypot(bx-ax,by-ay)/(this.cell*.65))))
    for (let i=0;i<steps;i++) { const t=(i+.5)/steps; this.depositFilm(ax+(bx-ax)*t,ay+(by-ay)*t,volume/steps,width) }
  }
  private collectFilm(x: number, y: number, radius: number, fraction: number) {
    const n=fluidBudget.resolution, r=Math.max(this.cell*.7,radius)
    const x0=clamp(Math.floor((x-r-this.bounds.x)/this.cell),0,n-1), x1=clamp(Math.floor((x+r-this.bounds.x)/this.cell),0,n-1)
    const y0=clamp(Math.floor((y-r-this.bounds.y)/this.cell),0,n-1), y1=clamp(Math.floor((y+r-this.bounds.y)/this.cell),0,n-1)
    let volume=0
    for (let iy=y0;iy<=y1;iy++) for (let ix=x0;ix<=x1;ix++) {
      const i=iy*n+ix
      if (!this.film[i]) continue
      const dx=this.bounds.x+(ix+.5)*this.cell-x, dy=this.bounds.y+(iy+.5)*this.cell-y
      const weight=Math.max(0,1-(dx*dx+dy*dy)/(r*r))
      if (!weight) continue
      this.ageCell(i)
      const take=this.film[i]*fraction*weight
      this.film[i]-=take; volume+=take*this.cell*this.cell; this.revision++
    }
    return volume
  }
  private add(x: number, y: number, volume: number, vx: number, vy: number, energy: number) {
    if (volume < 1e-12) { this.depositFilm(x,y,volume,this.cell*.8); return -1 }
    if (!this.inside(x,y)) { this.drained += volume; return -1 }
    if (this.freeCount === 0) {
      // Fold a small, quiet cap into its OWN reservoir, never delete its water.
      // Bounded amortized selection avoids an O(pool size) scan on every hit.
      let chosen=-1, lowest=Infinity
      for (let j=0;j<48;j++) {
        const i=this.recycle++ % this.beads.length, b=this.beads[i]
        const score=b.volume*(b.pinned ? 1 : 12)*(b.contactAge < .25 ? 30 : 1)
        if (score < lowest) { lowest=score; chosen=i }
      }
      if (chosen >= 0) { const b=this.beads[chosen]; this.depositFilm(b.x,b.y,b.volume,b.radius*1.2); this.retire(chosen) }
    }
    const i=this.free[--this.freeCount], b=this.beads[i]
    b.alive=true; b.x=x; b.y=y; b.volume=volume; b.radius=radiusOf(volume)
    b.vx=vx; b.vy=vy; b.energy=energy; b.seed=this.rng(); b.age=b.contactAge=0
    b.pinned=Math.hypot(vx,vy)<.004; b.sampleX=b.sampleY=Infinity; b.pin=1
    b.lobeX=(this.rng()-.5)*.65; b.lobeY=(this.rng()-.5)*.45; b.lobe=.1+this.rng()*.18
    b.angle=Math.atan2(vy,vx)-Math.PI/2; this.largest=Math.max(this.largest,b.radius)
    this.link(i); return i
  }
  private combine(index: number, x: number, y: number, volume: number, vx: number, vy: number, energy: number) {
    const b=this.beads[index], total=b.volume+volume, share=volume/total, dx=x-b.x, dy=y-b.y
    b.vx+=(vx-b.vx)*share; b.vy+=(vy-b.vy)*share
    // Surface-tension release carries a little of the join direction into the
    // head. The volume-weighted centroid and momentum survive the merger.
    b.vx+=clamp(dx/Math.max(.002,b.radius),-1,1)*share*.09
    b.x+=dx*share*.65; b.y+=dy*share*.65
    b.volume=total; b.radius=radiusOf(total); b.lobeX=clamp(dx/b.radius,-.85,.85); b.lobeY=clamp(dy/b.radius,-.85,.85)
    const remainingImpact=b.energy*Math.exp(-b.contactAge/.12)
    b.lobe=clamp(share,.12,.42); b.energy=Math.max(remainingImpact,energy*Math.sqrt(Math.min(1,share*3)))
    b.contactAge=0; b.sampleX=Infinity
    b.pinned=Math.hypot(b.vx,b.vy)<.004; this.largest=Math.max(this.largest,b.radius); this.link(index)
  }
  strike(x: number, y: number, diameter: number, normalSpeed: number, vx: number, vy: number, allowSpray: boolean): PaneImpact {
    const volume=dropVolume(diameter), r=radiusOf(volume), reach=r+this.largest
    this.deposited+=volume
    let nearest=-1, distance=Infinity
    const x0=clamp(Math.floor((x-reach-this.bounds.x)/this.hashCell),0,this.columns-1), x1=clamp(Math.floor((x+reach-this.bounds.x)/this.hashCell),0,this.columns-1)
    const y0=clamp(Math.floor((y-reach-this.bounds.y)/this.hashCell),0,this.columns-1), y1=clamp(Math.floor((y+reach-this.bounds.y)/this.hashCell),0,this.columns-1)
    for (let cy=y0;cy<=y1;cy++) for (let cx=x0;cx<=x1;cx++) for (let i=this.heads[cy*this.columns+cx];i>=0;i=this.beads[i].next) {
      const b=this.beads[i], d=Math.hypot(b.x-x,b.y-y)
      if (d < r+b.radius && d < distance) { nearest=i; distance=d }
    }
    const wet=Math.max(nearest >= 0 ? 1 : 0,this.wetAt(x,y))
    const streaming=nearest >= 0 && Math.hypot(this.beads[nearest].vx,this.beads[nearest].vy)>.08
    const weber=water.density*diameter*normalSpeed*normalSpeed/water.tension
    const energy=1-Math.exp(-Math.sqrt(weber)*.065)
    const splash=allowSpray && this.rng() < energy*(.18+wet*.5)*(streaming ? .28 : 1)
      ? (.1+energy*.35)*(.35+this.rng()*.65) : 0
    this.impact.sprayVolume=volume*splash; this.impact.energy=energy
    this.impact.pieces=splash ? Math.round(4+energy*19) : 0; this.ejected+=this.impact.sprayVolume
    const retained=volume-this.impact.sprayVolume
    // Retain a short, directional impact glide. Contact drag grows over the
    // inertial-capillary time, making fast arrival -> slow attachment readable.
    const carry=.12+energy*.18+wet*.06
    if (nearest >= 0) {
      this.combine(nearest,x,y,retained,vx*carry,vy*carry,energy)
      this.merges++
    } else {
      const gathered=this.collectFilm(x,y,r*1.6,.55)
      const ratio=retained/Math.max(1e-14,retained+gathered)
      this.add(x,y,retained+gathered,vx*carry*ratio,vy*carry*ratio,energy)
    }
    // A wet energetic hit can release nearby caps. Each receives momentum
    // according to impact mass/distance, so cascades emerge through collection.
    if (wet>.25 && energy>.2) {
      const blast=r*(2+energy*3)
      for (let cy=y0;cy<=y1;cy++) for (let cx=x0;cx<=x1;cx++) for (let i=this.heads[cy*this.columns+cx];i>=0;i=this.beads[i].next) {
        if (i===nearest) continue
        const b=this.beads[i], dx=b.x-x, dy=b.y-y, d=Math.hypot(dx,dy)
        if (d<=r*.25 || d>blast+b.radius) continue
        const weight=Math.max(0,1-d/(blast+b.radius))*energy*Math.min(.6,volume/(volume+b.volume))
        b.vx+=(vx*.15+dx/Math.max(r,d)*.12)*weight; b.vy+=(vy*.15+dy/Math.max(r,d)*.12)*weight
        b.pinned=false; b.contactAge=0; b.energy=Math.max(b.energy,energy*.5)
      }
    }
    return this.impact
  }
  step(dt: number) {
    if (!this.settings || dt<=0) return
    this.time+=dt; const s=this.settings, changed=s!==this.previousSettings
    this.previousSettings=s
    const oldLargest=this.largest; this.largest=.008
    for (let i=0;i<this.beads.length;i++) {
      const b=this.beads[i]; if (!b.alive) continue
      b.age+=dt; b.contactAge+=dt
      const r=b.radius, oldX=b.x, oldY=b.y, mass=Math.max(1e-10,b.volume*water.density)
      const wet=this.wetAt(b.x,b.y)
      if (changed || Math.hypot(b.x-b.sampleX,b.y-b.sampleY)>Math.max(.001,r*.6)) {
        const terrain=this.terrain.sample(b.x,b.y,r)
        b.terrainX=terrain.x; b.terrainY=terrain.y
        b.pin=terrain.pinning*(.35+.85*rainNoise(b.x*31,b.y*37,21.3)**2)
        b.sampleX=b.x; b.sampleY=b.y
      }
      const sx=b.terrainX, sy=b.terrainY
      const pin=2*r*water.tension*s.rainSurfaceTension*s.rainFriction*b.pin*(1-wet*.57)/mass
      const capillaryTime=Math.sqrt(water.density*r**3/water.tension)
      const arrival=b.energy*Math.exp(-b.contactAge/(.025+capillaryTime*1.5))
      let ax=-clamp(2*r*water.tension*sx/mass,-3,3)*s.rainWander + water.gravity*sx*sy/(1+sx*sx+sy*sy)
      let ay=-water.gravity*(1+sx*sx)/(1+sx*sx+sy*sy)
      if (!b.pinned || b.age<.15 || changed) {
        rainAir(this.air,this.point.set(b.x,b.y,0),this.time,s,s.rain ? s.rainIntensity : 0)
        ax+=clamp(this.air.x*Math.abs(this.air.x)*r*r*.035/mass,-2,2)
        ay+=clamp(this.air.y*Math.abs(this.air.y)*r*r*.035/mass,-1,1)
      }
      if (!b.pinned) {
        const look=Math.max(this.cell,r*1.8), below=b.y-Math.max(r,Math.abs(b.vy)*.025)
        const left=this.wetAt(b.x-look,below), right=this.wetAt(b.x+look,below)
        ax+=(right-left)*2.5*s.rainWander
      }
      const drive=Math.hypot(ax,ay)
      if (!(b.pinned && drive<=pin && arrival<.05)) {
        b.vx+=ax*dt; b.vy+=ay*dt
        const speed=Math.hypot(b.vx,b.vy), friction=pin*(.48+(.2*b.seed))*(1-arrival*.7)
        const kinetic=Math.max(0,1-friction*dt/Math.max(1e-8,speed))
        const mobility=(.45+1.7*b.seed*b.seed)*(1+wet*1.8)
        const tau=Math.max(.012,(.02+r*12)*s.rainFlow*mobility+arrival*(.045+capillaryTime))
        const damping=kinetic*Math.exp(-dt/tau)
        b.vx*=damping; b.vy*=damping
        const limit=Math.min(1,(1.8+arrival*3)/Math.max(.001,Math.hypot(b.vx,b.vy)))
        b.vx*=limit; b.vy*=limit
        b.pinned=Math.hypot(b.vx,b.vy)<.004 && drive<=pin
        if (b.pinned) b.vx=b.vy=0
      }
      // The first contact spreads in place before its head detaches into a
      // glide. This preserves a readable hit even with two steps per frame.
      if (!(b.age<.022 && b.energy>.2)) { b.x+=b.vx*dt; b.y+=b.vy*dt }
      if (!this.inside(b.x,b.y)) { this.drained+=b.volume; this.retire(i); continue }
      const distance=Math.hypot(b.x-oldX,b.y-oldY)
      if (distance>.000001) {
        // Sweep continuous trajectories through both caps and the reservoir.
        const reach=r+oldLargest
        const x0=clamp(Math.floor((Math.min(oldX,b.x)-reach-this.bounds.x)/this.hashCell),0,this.columns-1)
        const x1=clamp(Math.floor((Math.max(oldX,b.x)+reach-this.bounds.x)/this.hashCell),0,this.columns-1)
        const y0=clamp(Math.floor((Math.min(oldY,b.y)-reach-this.bounds.y)/this.hashCell),0,this.columns-1)
        const y1=clamp(Math.floor((Math.max(oldY,b.y)+reach-this.bounds.y)/this.hashCell),0,this.columns-1)
        for (let cy=y0;cy<=y1;cy++) for (let cx=x0;cx<=x1;cx++) {
          let j=this.heads[cy*this.columns+cx]
          while (j>=0) {
            const other=this.beads[j], next=other.next
            if (j!==i) {
              const t=fraction(other.x,other.y,oldX,oldY,b.x,b.y)
              if (Math.hypot(other.x-oldX-(b.x-oldX)*t,other.y-oldY-(b.y-oldY)*t)<(b.radius+other.radius)*.94) {
                this.combine(i,other.x,other.y,other.volume,other.vx,other.vy,.18)
                this.retire(j); this.merges++
              }
            }
            j=next
          }
        }
        const samples=Math.min(16,Math.max(1,Math.ceil(distance/Math.max(this.cell,r))))
        let captured=0
        for (let k=0;k<samples;k++) { const t=(k+.5)/samples; captured+=this.collectFilm(oldX+(b.x-oldX)*t,oldY+(b.y-oldY)*t,b.radius,.7) }
        const share=b.volume/Math.max(1e-14,b.volume+captured)
        b.volume+=captured; b.vx*=share; b.vy*=share
        // Narrow, uneven necks keep real volume on the pane. Some thicken at
        // rough patches; that reservoir is available to the next moving head.
        const neck=.12+.2*rainNoise(b.x*95,b.y*95,b.seed*37)
        const width=Math.max(this.cell*.65,b.radius*neck)
        const leave=Math.min(b.volume*.16,distance*width*2*(.000035+.00013*(1-wet))*s.rainSurfaceTension)
        b.volume-=leave; this.trail(oldX,oldY,b.x,b.y,leave,width)
        b.angle=Math.atan2(b.vy,b.vx)-Math.PI/2
      }
      const evaporation=Math.min(b.volume,Math.PI*b.radius*b.radius*.00002/s.rainDrying*dt)
      b.volume-=evaporation; this.evaporated+=evaporation
      if (b.volume<1e-12) { this.evaporated+=b.volume; this.retire(i); continue }
      b.radius=radiusOf(b.volume); this.largest=Math.max(this.largest,b.radius)
      b.lobe*=Math.exp(-dt*(b.pinned ? .025 : 2.5)*s.rainSurfaceTension)
      this.link(i)
    }
    // Sparse, timestamped maintenance. Dormant film doesn't require a full
    // million-cell CPU scan each frame; volume dries locally, never by a timer.
    const visits=Math.min(8192,this.activeCount)
    let releases=0
    for (let k=0;k<visits && this.activeCount;k++) {
      this.cursor%=this.activeCount; const i=this.active[this.cursor]
      this.ageCell(i)
      const h=this.film[i]
      if (h>.0008 && releases<4) {
        const x=this.bounds.x+(i%fluidBudget.resolution+.5)*this.cell
        const y=this.bounds.y+(Math.floor(i/fluidBudget.resolution)+.5)*this.cell
        const volume=this.collectFilm(x,y,this.cell*1.8,.75)
        this.add(x,y,volume,0,-.025,.1); releases++
      }
      if (this.film[i]===0 && this.wet[i]<.002) {
        const last=this.active[--this.activeCount]; this.active[this.cursor]=last; this.slots[last]=this.cursor; this.slots[i]=-1
      } else this.cursor++
    }
  }
  stroke(ax: number, ay: number, bx: number, by: number, radius: number, pressure: number, dt: number) {
    const dx=bx-ax, dy=by-ay, length=Math.hypot(dx,dy), nx=length>.0001 ? -dy/length : 1, ny=length>.0001 ? dx/length : 0
    const vx=clamp(dx/Math.max(.008,dt),-3,3), vy=clamp(dy/Math.max(.008,dt),-3,3)
    // Gather film first, then place its banks; never collect the bank twice
    // during the same gesture or erase water with an alpha mask.
    const n=fluidBudget.resolution
    const x0=clamp(Math.floor((Math.min(ax,bx)-radius-this.bounds.x)/this.cell),0,n-1), x1=clamp(Math.floor((Math.max(ax,bx)+radius-this.bounds.x)/this.cell),0,n-1)
    const y0=clamp(Math.floor((Math.min(ay,by)-radius-this.bounds.y)/this.cell),0,n-1), y1=clamp(Math.floor((Math.max(ay,by)+radius-this.bounds.y)/this.cell),0,n-1)
    let gathered=0
    for (let iy=y0;iy<=y1;iy++) for (let ix=x0;ix<=x1;ix++) {
      const i=iy*n+ix; if (!this.film[i]) continue
      const x=this.bounds.x+(ix+.5)*this.cell,y=this.bounds.y+(iy+.5)*this.cell,t=fraction(x,y,ax,ay,bx,by)
      const weight=Math.max(0,1-Math.hypot(x-ax-dx*t,y-ay-dy*t)/radius)
      if (!weight) continue
      this.ageCell(i); const take=this.film[i]*weight*pressure*.85
      this.film[i]-=take; gathered+=take*this.cell*this.cell; this.revision++
    }
    for (let i=0;i<this.beads.length;i++) {
      const b=this.beads[i]; if (!b.alive) continue
      const t=fraction(b.x,b.y,ax,ay,bx,by), px=b.x-ax-dx*t, py=b.y-ay-dy*t, d=Math.hypot(px,py)
      if (d>radius+b.radius) continue
      const weight=Math.max(0,1-d/(radius+b.radius))*pressure, side=px*nx+py*ny<0 ? -1 : 1
      b.x+=dx*weight*.8+nx*side*radius*weight*.2; b.y+=dy*weight*.8+ny*side*radius*weight*.2
      b.vx+=(vx-b.vx)*weight; b.vy+=(vy-b.vy)*weight
      b.pinned=false; b.contactAge=0; b.energy=.5; b.sampleX=Infinity
      b.lobeX=nx*side*.7; b.lobeY=ny*side*.7; b.lobe=.35
      if (!this.inside(b.x,b.y)) { this.drained+=b.volume; this.retire(i) } else this.link(i)
    }
    if (gathered>0) {
      this.trail(ax+nx*radius*.8,ay+ny*radius*.8,bx+nx*radius*.8,by+ny*radius*.8,gathered*.3,this.cell)
      this.trail(ax-nx*radius*.8,ay-ny*radius*.8,bx-nx*radius*.8,by-ny*radius*.8,gathered*.3,this.cell)
      this.add(bx,by,gathered*.4,vx*.35,vy*.35,.45)
    }
  }
  pack() {
    let count=0
    for (const b of this.beads) {
      if (!b.alive) continue
      const at=count++*16, d=this.shapes, speed=Math.hypot(b.vx,b.vy)
      const capillary=Math.sqrt(water.density*b.radius**3/water.tension)
      const phase=b.contactAge/Math.max(.028,capillary*2.2)
      const spread=1+b.energy*(1.7*Math.exp(-phase*1.6)+.18*Math.sin(phase*9)*Math.exp(-phase*2))
      const stretch=1+Math.min(1.8,speed*.7)+b.energy*Math.exp(-phase)*.3
      const base=Math.max(b.radius,this.bounds.z/fluidBudget.optical*.8)
      d[at]=b.x; d[at+1]=b.y; d[at+2]=base*spread/Math.sqrt(stretch); d[at+3]=base*spread*Math.sqrt(stretch)
      d[at+4]=b.volume; d[at+5]=b.angle; d[at+6]=b.seed*31; d[at+7]=Math.min(1,speed*.7)
      // Rotate the remembered merge offset into the cap's local frame.
      const cs=Math.cos(b.angle), sn=Math.sin(b.angle)
      d[at+8]=cs*b.lobeX+sn*b.lobeY; d[at+9]=-sn*b.lobeX+cs*b.lobeY
      d[at+10]=b.lobe; d[at+11]=b.pinned ? .14 : .06
      d[at+12]=b.energy*Math.exp(-phase*1.5); d[at+13]=phase; d[at+14]=0; d[at+15]=0
    }
    this.count=count
  }
}
