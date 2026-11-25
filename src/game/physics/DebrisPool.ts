// DebrisPool — пул обломков и отсечённых частей (ТЗ 5.7, 12.2, 18.1)
// Лимиты тел: 200 десктоп / 100 мобильные; сон 0.5 с; удаление 5 с; урона не наносят.
import * as THREE from 'three'
import type { PhysicsWorld } from './PhysicsWorld'
import { LIMITS } from '../shared/constants/physics'

interface DebrisItem {
  bodyHandle: number
  /** Матрица локального смещения внутри кластера */
  local: THREE.Matrix4
  size: number
  color: number
}

interface DebrisCluster {
  items: DebrisItem[]
  spawnTime: number
  sleepAt: number
  removeAt: number
  bodyHandle: number
  half: { x: number; y: number; z: number }
}

export class DebrisPool {
  private physics: PhysicsWorld
  private mesh: THREE.InstancedMesh
  private dummy = new THREE.Object3D()
  private color = new THREE.Color()
  private clusters: DebrisCluster[] = []
  private slots: (DebrisCluster | null)[] = []
  private capacity: number
  private scene: THREE.Scene
  private time = 0
  private colorCursor = 0

  constructor(physics: PhysicsWorld, scene: THREE.Scene, isMobile: boolean) {
    this.physics = physics
    this.scene = scene
    this.capacity = isMobile ? LIMITS.debrisMobile : LIMITS.debrisDesktop
    this.slots = new Array(this.capacity).fill(null)
    const geo = new THREE.BoxGeometry(1, 1, 1)
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.6, metalness: 0.7 })
    this.mesh = new THREE.InstancedMesh(geo, mat, this.capacity)
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    this.mesh.castShadow = false
    this.mesh.frustumCulled = false
    // Изначально скрыть
    this.dummy.position.set(0, -999, 0)
    this.dummy.scale.setScalar(0.0001)
    this.dummy.updateMatrix()
    for (let i = 0; i < this.capacity; i++) {
      this.mesh.setMatrixAt(i, this.dummy.matrix)
      this.mesh.setColorAt(i, this.color.setHex(0xffffff))
    }
    scene.add(this.mesh)
  }

  get activeBodies(): number {
    return this.clusters.length
  }

  /** Одиночный куб-обломок (разрушение обшивки) */
  spawnSingle(pos: { x: number; y: number; z: number }, size: number, color: number, vel: { x: number; y: number; z: number }): void {
    const h = size * 0.55
    this.spawnCluster(pos, 0, [{ dx: 0, dy: 0, dz: 0, angle: Math.random() * 0.6, size, color }], vel, { x: (Math.random() - 0.5) * 6, y: (Math.random() - 0.5) * 6, z: (Math.random() - 0.5) * 6 }, { x: h, y: h, z: h })
  }

  /** Кластер кубов (отсечённая часть). items — смещения относительно центра кластера. */
  spawnCluster(
    center: { x: number; y: number; z: number },
    centerAngle: number,
    items: Array<{ dx: number; dy: number; dz: number; angle: number; size: number; color: number }>,
    impulse: { x: number; y: number; z: number },
    angvel: { x: number; y: number; z: number },
    halfExtent?: { x: number; y: number; z: number }
  ): void {
    if (this.clusters.length >= this.capacity * 0.8) {
      // Вытесняем самый старый (грейсфул деградация)
      const oldest = this.clusters.shift()
      if (oldest) this.freeCluster(oldest)
    }
    const half = halfExtent ?? { x: 0.3, y: 0.3, z: 0.3 }
    const handle = this.physics.addBox(
      { x: center.x, y: Math.max(center.y, half.y + 0.02), z: center.z },
      half,
      impulse,
      angvel
    )
    if (handle < 0) return
    const cluster: DebrisCluster = {
      bodyHandle: handle,
      spawnTime: this.time,
      sleepAt: this.time + LIMITS.debrisSleepSec,
      removeAt: this.time + LIMITS.debrisRemoveSec,
      half,
      items: items.map(it => {
        const m = new THREE.Matrix4()
        const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), it.angle - centerAngle)
        m.compose(
          new THREE.Vector3(
            it.dx * Math.cos(centerAngle) - it.dy * Math.sin(centerAngle),
            it.dx * Math.sin(centerAngle) + it.dy * Math.cos(centerAngle),
            it.dz
          ),
          q,
          new THREE.Vector3(it.size, it.size, it.size)
        )
        return { bodyHandle: handle, local: m, size: it.size, color: it.color }
      }),
    }
    // Назначаем слоты инстансов
    const need = cluster.items.length
    let assigned = 0
    for (let i = 0; i < this.capacity && assigned < need; i++) {
      if (this.slots[i] === null) {
        this.slots[i] = cluster
        cluster.items[assigned].bodyHandle = handle
        // слот хранится через items (local matrix), индекс запоминаем в map ниже
        ;(cluster.items[assigned] as DebrisItem & { slot?: number }).slot = i
        assigned++
      }
    }
    if (assigned < need) {
      // Не хватило слотов — обрезаем
      cluster.items = cluster.items.slice(0, assigned)
    }
    for (const it of cluster.items) {
      this.color.setHex(it.color)
      this.mesh.setColorAt((it as DebrisItem & { slot: number }).slot, this.color)
    }
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true
    this.clusters.push(cluster)
  }

  private freeCluster(c: DebrisCluster): void {
    this.physics.remove(c.bodyHandle)
    for (const it of c.items) {
      const slot = (it as DebrisItem & { slot?: number }).slot
      if (slot !== undefined) {
        this.slots[slot] = null
        this.dummy.position.set(0, -999, 0)
        this.dummy.scale.setScalar(0.0001)
        this.dummy.updateMatrix()
        this.mesh.setMatrixAt(slot, this.dummy.matrix)
      }
    }
  }

  update(dt: number): void {
    this.time += dt
    this.physics.step(dt)
    const bodyM = new THREE.Matrix4()
    const finalM = new THREE.Matrix4()
    for (let ci = this.clusters.length - 1; ci >= 0; ci--) {
      const c = this.clusters[ci]
      const st = this.physics.get(c.bodyHandle)
      if (!st) {
        this.clusters.splice(ci, 1)
        continue
      }
      if (this.time >= c.sleepAt && !st.asleep) this.physics.sleep(c.bodyHandle)
      if (this.time >= c.removeAt) {
        this.freeCluster(c)
        this.clusters.splice(ci, 1)
        continue
      }
      bodyM.compose(
        new THREE.Vector3(st.x, st.y, st.z),
        new THREE.Quaternion(st.qx, st.qy, st.qz, st.qw),
        new THREE.Vector3(1, 1, 1)
      )
      for (const it of c.items) {
        const slot = (it as DebrisItem & { slot?: number }).slot
        if (slot === undefined) continue
        finalM.multiplyMatrices(bodyM, it.local)
        this.mesh.setMatrixAt(slot, finalM)
      }
    }
    this.mesh.instanceMatrix.needsUpdate = true
  }

  clear(): void {
    for (const c of [...this.clusters]) this.freeCluster(c)
    this.clusters = []
    this.slots.fill(null)
  }

  dispose(): void {
    this.clear()
    this.scene.remove(this.mesh)
    this.mesh.geometry.dispose()
    ;(this.mesh.material as THREE.Material).dispose()
    this.mesh.dispose()
  }
}
