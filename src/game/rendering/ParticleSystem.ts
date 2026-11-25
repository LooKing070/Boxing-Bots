// ParticleSystem — искры и частицы через THREE.Points (ТЗ 11)
// Лимиты: десктоп ≤150, мобильные ≤50; жизнь 1.5 с; упрощённая физика без Rapier.
import * as THREE from 'three'
import { LIMITS } from '../shared/constants/physics'

export class ParticleSystem {
  private points: THREE.Points
  private pos: Float32Array
  private vel: Float32Array
  private col: Float32Array
  private baseCol: Float32Array
  private life: Float32Array
  private maxLife: Float32Array
  private cursor = 0
  private capacity: number
  private scene: THREE.Scene

  constructor(scene: THREE.Scene, particleLimit: number, isMobile: boolean) {
    this.capacity = Math.min(particleLimit, isMobile ? LIMITS.particlesMobile : LIMITS.particlesDesktop)
    this.scene = scene
    const n = this.capacity
    this.pos = new Float32Array(n * 3)
    this.vel = new Float32Array(n * 3)
    this.col = new Float32Array(n * 3)
    this.baseCol = new Float32Array(n * 3)
    this.life = new Float32Array(n)
    this.maxLife = new Float32Array(n)
    for (let i = 0; i < n; i++) this.pos[i * 3 + 1] = -100

    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage))
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage))
    const mat = new THREE.PointsMaterial({
      size: 0.055,
      vertexColors: true,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      sizeAttenuation: true,
    })
    this.points = new THREE.Points(geo, mat)
    this.points.frustumCulled = false
    scene.add(this.points)
  }

  spawnBurst(x: number, y: number, z: number, count: number, colorHex: number, speed = 2.2, life: number = LIMITS.particleLifeSec): void {
    const c = new THREE.Color(colorHex)
    for (let k = 0; k < count; k++) {
      const i = this.cursor
      this.cursor = (this.cursor + 1) % this.capacity
      this.pos[i * 3] = x + (Math.random() - 0.5) * 0.12
      this.pos[i * 3 + 1] = y + (Math.random() - 0.5) * 0.12
      this.pos[i * 3 + 2] = z + (Math.random() - 0.5) * 0.12
      const a = Math.random() * Math.PI * 2
      const b = (Math.random() - 0.5) * Math.PI
      const sp = speed * (0.4 + Math.random() * 0.9)
      this.vel[i * 3] = Math.cos(a) * Math.cos(b) * sp
      this.vel[i * 3 + 1] = Math.sin(b) * sp + 0.8
      this.vel[i * 3 + 2] = Math.sin(a) * Math.cos(b) * sp
      this.baseCol[i * 3] = c.r
      this.baseCol[i * 3 + 1] = c.g
      this.baseCol[i * 3 + 2] = c.b
      this.life[i] = life * (0.6 + Math.random() * 0.6)
      this.maxLife[i] = this.life[i]
    }
  }

  update(dt: number): void {
    const n = this.capacity
    for (let i = 0; i < n; i++) {
      if (this.life[i] <= 0) continue
      this.life[i] -= dt
      if (this.life[i] <= 0) {
        this.pos[i * 3 + 1] = -100
        this.col[i * 3] = this.col[i * 3 + 1] = this.col[i * 3 + 2] = 0
        continue
      }
      this.vel[i * 3 + 1] -= 6.5 * dt
      this.pos[i * 3] += this.vel[i * 3] * dt
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt
      if (this.pos[i * 3 + 1] < 0.02) {
        this.pos[i * 3 + 1] = 0.02
        this.vel[i * 3 + 1] *= -0.35
        this.vel[i * 3] *= 0.7
        this.vel[i * 3 + 2] *= 0.7
      }
      const f = this.life[i] / this.maxLife[i]
      this.col[i * 3] = this.baseCol[i * 3] * f
      this.col[i * 3 + 1] = this.baseCol[i * 3 + 1] * f
      this.col[i * 3 + 2] = this.baseCol[i * 3 + 2] * f
    }
    const geo = this.points.geometry
    ;(geo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true
    ;(geo.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true
  }

  dispose(): void {
    this.scene.remove(this.points)
    this.points.geometry.dispose()
    ;(this.points.material as THREE.Material).dispose()
  }
}
