// PhysicsWorld — Rapier.js (WASM) с graceful fallback на встроенную простую физику (ТЗ 2, 12.2)
// Используется ТОЛЬКО для мусора/обломков (боты кинематические).

export interface BodyState {
  x: number; y: number; z: number
  qx: number; qy: number; qz: number; qw: number
  asleep: boolean
}

interface Backend {
  step(dt: number): void
  addBox(pos: { x: number; y: number; z: number }, half: { x: number; y: number; z: number }, linvel: { x: number; y: number; z: number }, angvel: { x: number; y: number; z: number }): number
  get(handle: number): BodyState | null
  sleep(handle: number): void
  remove(handle: number): void
  count(): number
  dispose(): void
}

/** Простой встроенный бэкенд: гравитация + отскок от пола, сон, без коллизий между телами */
class SimpleBackend implements Backend {
  private bodies = new Map<number, {
    x: number; y: number; z: number
    vx: number; vy: number; vz: number
    ax: number; ay: number; az: number // угловые Эйлера
    wx: number; wy: number; wz: number
    halfY: number
    asleep: boolean
  }>()
  private next = 1

  step(dt: number): void {
    for (const b of this.bodies.values()) {
      if (b.asleep) continue
      b.vy -= 13 * dt
      b.x += b.vx * dt
      b.y += b.vy * dt
      b.z += b.vz * dt
      b.ax += b.wx * dt
      b.ay += b.wy * dt
      b.az += b.wz * dt
      if (b.y < b.halfY) {
        b.y = b.halfY
        b.vy = -b.vy * 0.32
        b.vx *= 0.72
        b.vz *= 0.72
        b.wx *= 0.6
        b.wy *= 0.6
        b.wz *= 0.6
        if (Math.abs(b.vy) < 0.35) {
          b.vy = 0
          b.vx *= 0.5
          b.wz *= 0.5
        }
      }
    }
  }

  addBox(pos: { x: number; y: number; z: number }, half: { x: number; y: number; z: number }, linvel: { x: number; y: number; z: number }, angvel: { x: number; y: number; z: number }): number {
    const h = this.next++
    this.bodies.set(h, {
      x: pos.x, y: pos.y, z: pos.z,
      vx: linvel.x, vy: linvel.y, vz: linvel.z,
      ax: 0, ay: 0, az: 0,
      wx: angvel.x, wy: angvel.y, wz: angvel.z,
      halfY: half.y,
      asleep: false,
    })
    return h
  }

  get(handle: number): BodyState | null {
    const b = this.bodies.get(handle)
    if (!b) return null
    // Эйлер ZXY→кватернион (приближённо, только для визуала мусора)
    const cx = Math.cos(b.ax / 2), sx = Math.sin(b.ax / 2)
    const cy = Math.cos(b.ay / 2), sy = Math.sin(b.ay / 2)
    const cz = Math.cos(b.az / 2), sz = Math.sin(b.az / 2)
    return {
      x: b.x, y: b.y, z: b.z,
      qw: cx * cy * cz + sx * sy * sz,
      qx: sx * cy * cz - cx * sy * sz,
      qy: cx * sy * cz + sx * cy * sz,
      qz: cx * cy * sz - sx * sy * cz,
      asleep: b.asleep,
    }
  }

  sleep(handle: number): void {
    const b = this.bodies.get(handle)
    if (b) {
      b.asleep = true
      b.vx = b.vy = b.vz = 0
      b.wx = b.wy = b.wz = 0
    }
  }

  remove(handle: number): void {
    this.bodies.delete(handle)
  }

  count(): number {
    return this.bodies.size
  }

  dispose(): void {
    this.bodies.clear()
  }
}

/** Rapier-бэкенд */
class RapierBackend implements Backend {
  private RAPIER: typeof import('@dimforge/rapier3d-compat')
  private world: import('@dimforge/rapier3d-compat').World
  private bodies = new Map<number, import('@dimforge/rapier3d-compat').RigidBody>()
  private next = 1

  constructor(RAPIER: typeof import('@dimforge/rapier3d-compat')) {
    this.RAPIER = RAPIER
    this.world = new RAPIER.World({ x: 0, y: -13, z: 0 })
    // Пол (верх платформы y=0)
    const ground = RAPIER.RigidBodyDesc.fixed().setTranslation(0, -0.5, 0)
    const gb = this.world.createRigidBody(ground)
    this.world.createCollider(RAPIER.ColliderDesc.cuboid(30, 0.5, 12), gb)
  }

  step(dt: number): void {
    this.world.timestep = dt
    this.world.step()
  }

  addBox(pos: { x: number; y: number; z: number }, half: { x: number; y: number; z: number }, linvel: { x: number; y: number; z: number }, angvel: { x: number; y: number; z: number }): number {
    const desc = this.RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(pos.x, pos.y, pos.z)
      .setLinvel(linvel.x, linvel.y, linvel.z)
      .setAngvel({ x: angvel.x, y: angvel.y, z: angvel.z })
    const body = this.world.createRigidBody(desc)
    this.world.createCollider(this.RAPIER.ColliderDesc.cuboid(half.x, half.y, half.z).setRestitution(0.3).setFriction(0.8), body)
    const h = this.next++
    this.bodies.set(h, body)
    return h
  }

  get(handle: number): BodyState | null {
    const b = this.bodies.get(handle)
    if (!b) return null
    const t = b.translation()
    const r = b.rotation()
    return { x: t.x, y: t.y, z: t.z, qx: r.x, qy: r.y, qz: r.z, qw: r.w, asleep: b.isSleeping() }
  }

  sleep(handle: number): void {
    const b = this.bodies.get(handle)
    if (b) b.sleep()
  }

  remove(handle: number): void {
    const b = this.bodies.get(handle)
    if (b) {
      this.world.removeRigidBody(b)
      this.bodies.delete(handle)
    }
  }

  count(): number {
    return this.bodies.size
  }

  dispose(): void {
    this.world.free()
    this.bodies.clear()
  }
}

export class PhysicsWorld {
  private backend: Backend | null = null
  usingRapier = false

  async init(): Promise<void> {
    try {
      const RAPIER = await import('@dimforge/rapier3d-compat')
      await RAPIER.init()
      this.backend = new RapierBackend(RAPIER)
      this.usingRapier = true
    } catch (e) {
      console.warn('[PhysicsWorld] Rapier недоступен, используется простая физика обломков', e)
      this.backend = new SimpleBackend()
      this.usingRapier = false
    }
  }

  get ready(): boolean {
    return this.backend !== null
  }

  step(dt: number): void {
    this.backend?.step(dt)
  }

  addBox(pos: { x: number; y: number; z: number }, half: { x: number; y: number; z: number }, linvel: { x: number; y: number; z: number }, angvel: { x: number; y: number; z: number }): number {
    return this.backend ? this.backend.addBox(pos, half, linvel, angvel) : -1
  }

  get(handle: number): BodyState | null {
    return this.backend?.get(handle) ?? null
  }

  sleep(handle: number): void {
    this.backend?.sleep(handle)
  }

  remove(handle: number): void {
    this.backend?.remove(handle)
  }

  count(): number {
    return this.backend?.count() ?? 0
  }

  dispose(): void {
    this.backend?.dispose()
    this.backend = null
  }
}
