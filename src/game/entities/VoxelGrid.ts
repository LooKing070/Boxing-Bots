// VoxelGrid — воксели бота, запросы по радиусу, урон (ТЗ 12.3)
import type { Voxel, Vec3, ComponentState } from '../shared/types/bot.types'

export interface DamageResult {
  destroyed: boolean
  /** Компонент, чей HP изменился (для уведомлений) */
  component: ComponentState | null
  /** Порог <60% только что пересечён */
  componentJustDamaged: boolean
  /** Компонент уничтожен (HP ≤ 0) */
  componentJustDestroyed: boolean
}

export class VoxelGrid {
  voxels: Voxel[]
  private byId: Map<number, Voxel> = new Map()
  private childrenOf: Map<number, number[]> = new Map()
  /** Мировые позиции (заполняет аниматор каждый кадр) */
  worldPos: Float32Array
  worldAngle: Float32Array
  worldScale: Float32Array
  /** Кватернионы кубов (x,y,z,w) — заполняет аниматор ТОЛЬКО для кубов рук с
   *  ненулевым 3D-наклоном сегмента; остальные остаются identity (0,0,0,1) —
   *  рендерер тогда использует worldAngle (поведение как раньше) */
  worldQuat: Float32Array
  components: ComponentState[]
  /** Почернение от ударов (0..0.7) */
  blacken: Float32Array

  constructor(voxels: Voxel[], components: ComponentState[]) {
    this.voxels = voxels
    this.components = components
    const n = voxels.length
    this.worldPos = new Float32Array(n * 3)
    this.worldAngle = new Float32Array(n)
    this.worldScale = new Float32Array(n)
    this.worldQuat = new Float32Array(n * 4)
    for (let i = 0; i < n; i++) this.worldQuat[i * 4 + 3] = 1 // identity
    this.blacken = new Float32Array(n)
    for (const v of voxels) {
      this.byId.set(v.id, v)
      if (v.parent >= 0) {
        let list = this.childrenOf.get(v.parent)
        if (!list) {
          list = []
          this.childrenOf.set(v.parent, list)
        }
        list.push(v.id)
      }
    }
  }

  get(id: number): Voxel | undefined {
    return this.byId.get(id)
  }

  /** Живые воксели в сфере (мировые координаты). Возвращает по возрастанию дистанции. */
  querySphere(center: Vec3, radius: number, out: Voxel[] = []): Voxel[] {
    out.length = 0
    const r2 = radius * radius
    const wp = this.worldPos
    for (let i = 0; i < this.voxels.length; i++) {
      const v = this.voxels[i]
      if (v.destroyed) continue
      const dx = wp[i * 3] - center.x
      const dy = wp[i * 3 + 1] - center.y
      const dz = wp[i * 3 + 2] - center.z
      if (dx * dx + dy * dy + dz * dz <= r2) out.push(v)
    }
    out.sort((a, b) => {
      const da = this.dist2(a, center), db = this.dist2(b, center)
      return da - db
    })
    return out
  }

  dist2(v: Voxel, center: Vec3): number {
    const i = v.id
    const dx = this.worldPos[i * 3] - center.x
    const dy = this.worldPos[i * 3 + 1] - center.y
    const dz = this.worldPos[i * 3 + 2] - center.z
    return dx * dx + dy * dy + dz * dz
  }

  worldPositionOf(v: Voxel): Vec3 {
    return { x: this.worldPos[v.id * 3], y: this.worldPos[v.id * 3 + 1], z: this.worldPos[v.id * 3 + 2] }
  }

  centerWorld(): Vec3 {
    // Центр корпуса (грудь, локальный y≈3.5)
    const chest = this.voxels.find(v => v.type === 'armor' && Math.abs(v.y - 3.625) < 0.01 && Math.abs(v.x) < 0.01)
    if (chest) return this.worldPositionOf(chest)
    return { x: this.worldPos[0], y: this.worldPos[1], z: this.worldPos[2] }
  }

  headWorld(): Vec3 {
    const head = this.voxels.find(v => v.type === 'armor' && v.limb === 'head')
    if (head) return this.worldPositionOf(head)
    return { x: this.worldPos[0], y: 4.5, z: this.worldPos[2] }
  }

  /** Центр глаз (между живыми кубами-камерами на лице). null — глаза уничтожены. */
  eyeCenterWorld(): Vec3 | null {
    let cx = 0, cy = 0, cz = 0, n = 0
    for (const v of this.voxels) {
      if (v.type !== 'camera' || v.destroyed) continue
      const p = this.worldPositionOf(v)
      cx += p.x; cy += p.y; cz += p.z; n++
    }
    if (n === 0) return null
    return { x: cx / n, y: cy / n, z: cz / n }
  }

  /** Уменьшение скелета (ТЗ 5.6): scale = 1 − damage/maxHp */
  skeletonScale(v: Voxel): number {
    if (!v.isSkeleton) return 1
    if (v.maxHp <= 0) return 1
    return Math.max(0, 1 - v.damageTaken / v.maxHp)
  }

  /** Применить урон к вокселю. Для компонентных вокселей урон идёт в общий пул компонента. */
  applyDamage(v: Voxel, dmg: number): DamageResult {
    const res: DamageResult = { destroyed: false, component: null, componentJustDamaged: false, componentJustDestroyed: false }
    if (v.destroyed || dmg <= 0) return res
    const isComponent = v.type === 'camera' || v.type === 'motherboard' || v.type === 'gyroscope' || v.type === 'battery'
    if (isComponent) {
      const comp = this.components.find(c => c.voxelIds.includes(v.id))
      if (!comp) return res
      res.component = comp
      const wasHealth = comp.health
      comp.hp -= dmg
      // Синхронизируем hp всех кубов компонента (воксель — часть пула)
      for (const id of comp.voxelIds) {
        const cv = this.byId.get(id)
        if (cv) {
          cv.damageTaken = comp.maxHp - Math.max(0, comp.hp)
          cv.hp = Math.max(0, comp.hp)
        }
      }
      if (comp.hp <= 0) {
        comp.health = 'destroyed'
        for (const id of comp.voxelIds) {
          const cv = this.byId.get(id)
          if (cv) cv.destroyed = true
        }
        res.destroyed = true
        res.componentJustDestroyed = wasHealth !== 'destroyed'
      } else if (comp.hp < comp.maxHp * 0.6) {
        comp.health = 'damaged'
        res.componentJustDamaged = wasHealth === 'intact'
      }
      return res
    }
    v.hp -= dmg
    v.damageTaken += dmg
    if (v.hp <= 0) {
      v.destroyed = true
      res.destroyed = true
    }
    return res
  }

  /** Есть ли рука для удара (не отсечена) */
  hasArm(side: 'left' | 'right'): boolean {
    const limb = side === 'left' ? 'armL' : 'armR'
    return this.voxels.some(v => v.limb === limb && !v.destroyed)
  }

  hasLeg(side: 'left' | 'right'): boolean {
    const limb = side === 'left' ? 'legL' : 'legR'
    return this.voxels.some(v => v.limb === limb && !v.destroyed)
  }

  /** Случайный живой куб руки (для контрудара, ТЗ 6.3) */
  randomArmCube(side: 'left' | 'right', rng: () => number): Voxel | null {
    const limb = side === 'left' ? 'armL' : 'armR'
    const alive = this.voxels.filter(v => v.limb === limb && !v.destroyed)
    if (alive.length === 0) return null
    return alive[Math.floor(rng() * alive.length)]
  }

  aliveCount(): number {
    let n = 0
    for (const v of this.voxels) if (!v.destroyed) n++
    return n
  }

  /** Снять ВСЮ обшивку (падение с крыши): кубы обшивки помечаются разрушенными
   *  (аниматор сам скрывает их — scale 0). Скелет и внутренние компоненты НЕ
   *  затрагиваются: их hp остаётся как на момент падения. Возвращает id снятых
   *  кубов (для мусора/синхронизации). */
  stripArmor(): number[] {
    const ids: number[] = []
    for (const v of this.voxels) {
      if (v.type === 'armor' && !v.destroyed) {
        v.destroyed = true
        v.hp = 0
        v.damageTaken = v.maxHp
        ids.push(v.id)
      }
    }
    return ids
  }
}
