import { Vector3 } from 'three'

export function createStormShake() {
  const offset = new Vector3(), velocity = new Vector3()
  let impulse = 0, roll = 0, rollVelocity = 0
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)')
  return {
    offset, get roll() { return roll },
    pressure(energy: number, hits: number) {
      if (hits) impulse = Math.min(3, impulse + Math.sqrt(energy / hits) * Math.log1p(hits) * .065)
    },
    update(dt: number, time: number, amount: number, strength: number) {
      if (reduced.matches || amount === 0) {
        offset.set(0, 0, 0); velocity.set(0, 0, 0); roll = rollVelocity = impulse = 0; return
      }
      const steps = Math.max(1, Math.ceil(dt * 120)), h = dt / steps
      for (let i = 0; i < steps; i++) {
        const t = time - dt + i * h, force = impulse * amount
        velocity.x += (Math.sin(t * 43 + Math.sin(t * 13)) * force * 12 - offset.x * 340 - velocity.x * 19) * h
        velocity.y += (Math.sin(t * 57 + .7) * force * 8 - offset.y * 420 - velocity.y * 21) * h
        velocity.z += ((Math.sin(t * 41) + .7) * force * 7 - offset.z * 240 - velocity.z * 16) * h
        offset.addScaledVector(velocity, h).clampScalar(-.035, .035)
        rollVelocity += (Math.sin(t * 37) * force * 2.1 - roll * 250 - rollVelocity * 18) * h
        roll = Math.max(-.016, Math.min(.016, roll + rollVelocity * h))
        impulse *= Math.exp(-h * (2.4 + (1 - strength) * 6))
      }
    },
  }
}
