// VoxelRenderer — один InstancedMesh на группу материалов бота (ТЗ 12.2)
// Разрушенный куб скрывается обнулением матрицы (scale 0).
// Глаза (камеры) светятся как неоновые детали (новое требование): аддитивный
// неоновый ореол-спрайт у каждого живого куба-камеры + пульс яркости.
import * as THREE from 'three'
import type { Voxel, BotData } from '../shared/types/bot.types'
import type { VoxelGrid } from '../entities/VoxelGrid'

/** Неоновая текстура (радиальный градиент), кэш на модуль */
let NEON_TEX: THREE.CanvasTexture | null = null
function neonTexture(): THREE.CanvasTexture {
  if (NEON_TEX) return NEON_TEX
  const c = document.createElement('canvas')
  c.width = 128
  c.height = 128
  const g = c.getContext('2d')!
  const grad = g.createRadialGradient(64, 64, 2, 64, 64, 64)
  grad.addColorStop(0, 'rgba(255,255,255,1)')
  grad.addColorStop(0.22, 'rgba(255,255,255,0.5)')
  grad.addColorStop(0.55, 'rgba(255,255,255,0.14)')
  grad.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = grad
  g.fillRect(0, 0, 128, 128)
  NEON_TEX = new THREE.CanvasTexture(c)
  return NEON_TEX
}

interface EyeHalo {
  sprite: THREE.Sprite
  mat: THREE.SpriteMaterial
  voxelId: number
  phase: number
  baseScale: number
}

export class BotVoxelRenderer {
  private metal: THREE.InstancedMesh
  private glow: THREE.InstancedMesh
  private pcb: THREE.InstancedMesh
  private dummy = new THREE.Object3D()
  private color = new THREE.Color()
  private indices: number[][] = [[], [], []] // [metal, glow, pcb] → voxel ids
  private meshes: THREE.InstancedMesh[]
  private group: THREE.Group
  private lastColors: Float32Array
  /** Неоновые ореолы глаз (камер) */
  private eyeHalos: EyeHalo[] = []

  constructor(data: BotData, grid: VoxelGrid, scene: THREE.Scene) {
    const n = data.voxels.length
    const box = new THREE.BoxGeometry(1, 1, 1)
    const metalMat = new THREE.MeshStandardMaterial({ roughness: 0.6, metalness: 0.7 })
    const glowMat = new THREE.MeshBasicMaterial({ toneMapped: false })
    const pcbMat = new THREE.MeshStandardMaterial({ color: 0x00ff00, roughness: 0.5, metalness: 0.3, emissive: 0x0a3a0a, emissiveIntensity: 0.6 })

    const counts = [0, 0, 0]
    for (const v of data.voxels) {
      const gi = v.glow ? 1 : v.type === 'motherboard' ? 2 : 0
      this.indices[gi].push(v.id)
      counts[gi]++
    }
    this.meshes = []
    this.metal = new THREE.InstancedMesh(box, metalMat, Math.max(1, counts[0]))
    this.glow = new THREE.InstancedMesh(box, glowMat, Math.max(1, counts[1]))
    this.pcb = new THREE.InstancedMesh(box, pcbMat, Math.max(1, counts[2]))
    for (const [i, m] of [this.metal, this.glow, this.pcb].entries()) {
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
      m.castShadow = i === 0
      m.receiveShadow = i === 0
      m.frustumCulled = false
      m.count = counts[i]
      this.meshes.push(m)
      scene.add(m)
    }
    this.group = new THREE.Group()
    scene.add(this.group)
    this.buildEyeHalos(data, scene)

    // Начальные цвета + сокрытие «пустых» слотов
    this.lastColors = new Float32Array(n * 3)
    this.updateColors(grid, data)
    for (const m of this.meshes) this.hideAll(m)
  }

  /** Неоновые ореолы глаз: по одному аддитивному спрайту на куб-камеру (глаз) */
  private buildEyeHalos(data: BotData, scene: THREE.Scene): void {
    const tex = neonTexture()
    for (const v of data.voxels) {
      if (v.type !== 'camera') continue
      const mat = new THREE.SpriteMaterial({
        map: tex,
        color: v.color,
        transparent: true,
        opacity: 0.9,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      })
      const sprite = new THREE.Sprite(mat)
      sprite.scale.setScalar(0.68)
      sprite.visible = false
      sprite.renderOrder = 5
      scene.add(sprite)
      this.eyeHalos.push({ sprite, mat, voxelId: v.id, phase: Math.random() * Math.PI * 2, baseScale: 0.68 })
    }
  }

  /** Пульс/позиция/видимость неоновых ореолов (eyeGlow 0..1 — приглушение дебаффом) */
  private updateEyeHalos(grid: VoxelGrid, eyeGlow: number): void {
    const t = performance.now() / 1000
    for (const h of this.eyeHalos) {
      const v = grid.voxels[h.voxelId]
      const alive = !!v && !v.destroyed && grid.worldScale[h.voxelId] > 0.0001
      if (!alive || eyeGlow <= 0.01) {
        h.sprite.visible = false
        continue
      }
      h.sprite.visible = true
      h.sprite.position.set(grid.worldPos[h.voxelId * 3], grid.worldPos[h.voxelId * 3 + 1], grid.worldPos[h.voxelId * 3 + 2])
      const pulse = 0.8 + 0.2 * Math.sin(t * 3.2 + h.phase)
      h.mat.opacity = Math.min(1, 0.95 * eyeGlow) * pulse
      h.sprite.scale.setScalar(h.baseScale * (0.92 + 0.08 * pulse))
    }
  }

  private hideAll(m: THREE.InstancedMesh): void {
    this.dummy.position.set(0, -999, 0)
    this.dummy.scale.set(0.0001, 0.0001, 0.0001)
    this.dummy.rotation.set(0, 0, 0)
    this.dummy.updateMatrix()
    for (let i = 0; i < m.count; i++) m.setMatrixAt(i, this.dummy.matrix)
    m.instanceMatrix.needsUpdate = true
  }

  updateColors(grid: VoxelGrid, _data: BotData): void {
    for (let gi = 0; gi < 3; gi++) {
      const mesh = this.meshes[gi]
      for (let i = 0; i < this.indices[gi].length; i++) {
        const id = this.indices[gi][i]
        const v = grid.voxels[id]
        const bl = grid.blacken[id]
        this.color.setHex(v.color)
        if (bl > 0.001) this.color.multiplyScalar(1 - Math.min(0.7, bl) * 0.75)
        if (v.destroyed) this.color.multiplyScalar(0.25)
        this.lastColors[id * 3] = this.color.r
        this.lastColors[id * 3 + 1] = this.color.g
        this.lastColors[id * 3 + 2] = this.color.b
        mesh.setColorAt(i, this.color)
      }
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    }
  }

  /** Обновить матрицы инстансов из grid.world* (eyeGlow — яркость неона глаз 0..1) */
  update(grid: VoxelGrid, eyeGlow = 1): void {
    for (let gi = 0; gi < 3; gi++) {
      const mesh = this.meshes[gi]
      const list = this.indices[gi]
      for (let i = 0; i < list.length; i++) {
        const id = list[i]
        const scale = grid.worldScale[id]
        if (scale <= 0.0001) {
          this.dummy.position.set(0, -999, 0)
          this.dummy.scale.set(0.0001, 0.0001, 0.0001)
          this.dummy.rotation.set(0, 0, 0)
        } else {
          this.dummy.position.set(grid.worldPos[id * 3], grid.worldPos[id * 3 + 1], grid.worldPos[id * 3 + 2])
          const q = grid.worldQuat
          if (q && q[id * 4 + 3] !== 1) {
            // Куб руки с 3D-наклоном сегмента (жёсткий изгиб в суставах)
            this.dummy.quaternion.set(q[id * 4], q[id * 4 + 1], q[id * 4 + 2], q[id * 4 + 3])
          } else {
            this.dummy.rotation.set(0, 0, grid.worldAngle[id])
          }
          this.dummy.scale.set(scale, scale, scale)
        }
        this.dummy.updateMatrix()
        mesh.setMatrixAt(i, this.dummy.matrix)
        // Цвет: обновляем при почернении/разрушении
        const v = grid.voxels[id]
        const bl = grid.blacken[id] + (v.destroyed ? 1 : 0)
        const last = this.lastColors[id * 3]
        if (Math.abs(bl - (v.destroyed ? 1 : 0)) > 0.001 || v.destroyed) {
          this.color.setHex(v.color)
          if (v.destroyed) this.color.multiplyScalar(0.25)
          else this.color.multiplyScalar(1 - Math.min(0.7, bl) * 0.75)
          mesh.setColorAt(i, this.color)
          this.lastColors[id * 3] = this.color.r
          this.lastColors[id * 3 + 1] = this.color.g
          this.lastColors[id * 3 + 2] = this.color.b
          if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
        }
      }
      mesh.instanceMatrix.needsUpdate = true
    }
    this.updateEyeHalos(grid, eyeGlow)
  }

  /** Принудительное обновление всех цветов (после массовых изменений) */
  refreshAllColors(grid: VoxelGrid): void {
    for (let gi = 0; gi < 3; gi++) {
      const mesh = this.meshes[gi]
      for (let i = 0; i < this.indices[gi].length; i++) {
        const id = this.indices[gi][i]
        const v = grid.voxels[id]
        this.color.setHex(v.color)
        if (v.destroyed) this.color.multiplyScalar(0.25)
        else this.color.multiplyScalar(1 - Math.min(0.7, grid.blacken[id]) * 0.75)
        mesh.setColorAt(i, this.color)
      }
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    }
  }

  markColorDirty(id: number): void {
    void id
  }

  dispose(scene: THREE.Scene): void {
    for (const m of this.meshes) {
      scene.remove(m)
      m.geometry.dispose()
      ;(m.material as THREE.Material).dispose()
      m.dispose()
    }
    for (const h of this.eyeHalos) {
      scene.remove(h.sprite)
      h.mat.dispose()
    }
    this.eyeHalos = []
    scene.remove(this.group)
  }
}

export type { Voxel }
