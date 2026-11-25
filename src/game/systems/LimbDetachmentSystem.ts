// LimbDetachmentSystem — отсечение частей робота (ТЗ 5.7, 12.4)
// Триггер: уничтожение куба скелета. Отваливается вся часть ниже по иерархии.
// Внутренние компоненты (камеры, платы, гироскоп, аккумулятор) отваливаются
// НАРЯВНЕ с любой другой частью тела — вместе с отсекаемой конечностью.
import type { BotEntity } from '../entities/BotEntity'
import type { Voxel, Vec3 } from '../shared/types/bot.types'

const COMPONENT_TYPES: ReadonlySet<string> = new Set(['camera', 'motherboard', 'gyroscope', 'battery'])

export interface DetachmentResult {
  detachedIds: number[]
  center: Vec3
  clusters: Array<{
    center: Vec3
    items: Array<{ dx: number; dy: number; dz: number; angle: number; size: number; color: number }>
  }>
}

export class LimbDetachmentSystem {
  /**
   * Собрать всех потомков уничтоженного куба, пометить их уничтоженными
   * и подготовить кластеры мусора (по частям тела, ТЗ 18.1).
   * Компоненты в поддереве помечаются уничтоженными (теряются вместе с частью).
   */
  static detach(bot: BotEntity, destroyedCubeId: number, impulse: Vec3): DetachmentResult | null {
    const grid = bot.grid
    const root = grid.get(destroyedCubeId)
    if (!root) return null
    const subtree = bot.graph.subtree(destroyedCubeId)
    const detached: Voxel[] = []
    const inSet = new Set<number>([destroyedCubeId])
    for (const id of subtree) {
      const v = grid.get(id)
      if (!v || v.destroyed || id === destroyedCubeId) continue
      detached.push(v)
      inSet.add(id)
    }
    if (detached.length === 0) return null

    // Компоненты в отвалившейся части считаются уничтоженными (ТЗ 5.7: «камеры теряются»
    // и — по обновлённому решению — любой внутренний компонент теряется вместе с частью).
    // ВСЕ кубы компонента улетают вместе с частью — даже формально привязанные к уцелевшим кубам.
    for (let i = 0; i < detached.length; i++) {
      const v = detached[i]
      if (!COMPONENT_TYPES.has(v.type)) continue
      const comp = grid.components.find(c => c.voxelIds.includes(v.id))
      if (!comp || comp.health === 'destroyed') continue
      comp.hp = 0
      comp.health = 'destroyed'
      for (const vid of comp.voxelIds) {
        const cv = grid.get(vid)
        if (!cv || cv.destroyed || inSet.has(vid)) continue
        detached.push(cv)
        inSet.add(vid)
      }
    }

    // Группируем по частям тела (лимбам) → отдельные кластеры
    const byLimb = new Map<string, Voxel[]>()
    for (const v of detached) {
      let list = byLimb.get(v.limb)
      if (!list) {
        list = []
        byLimb.set(v.limb, list)
      }
      list.push(v)
    }

    const result: DetachmentResult = {
      detachedIds: detached.map(v => v.id),
      center: { x: 0, y: 0, z: 0 },
      clusters: [],
    }

    for (const [, list] of byLimb) {
      // Центр кластера — среднее мировых позиций
      let cx = 0, cy = 0, cz = 0
      for (const v of list) {
        const wp = grid.worldPositionOf(v)
        cx += wp.x; cy += wp.y; cz += wp.z
      }
      cx /= list.length; cy /= list.length; cz /= list.length
      const items = list.map(v => {
        const wp = grid.worldPositionOf(v)
        v.destroyed = true
        return {
          dx: wp.x - cx,
          dy: wp.y - cy,
          dz: wp.z - cz,
          angle: bot.animator.facing === 1 ? 0 : Math.PI,
          size: Math.max(0.08, grid.worldScale[v.id]),
          color: v.color,
        }
      })
      result.clusters.push({
        center: { x: cx, y: cy, z: cz },
        items,
      })
    }
    if (detached.length > 0) {
      result.center = { ...result.clusters[0].center }
    }
    void impulse
    return result
  }

  /** Импульс для кластера: направление удара + подброс */
  static clusterImpulse(impulse: Vec3, scale = 1): { linear: Vec3; angular: Vec3 } {
    return {
      linear: { x: impulse.x * scale, y: Math.abs(impulse.y) * scale + 1.6, z: impulse.z * scale },
      angular: {
        x: (Math.random() - 0.5) * 7,
        y: (Math.random() - 0.5) * 7,
        z: (Math.random() - 0.5) * 7,
      },
    }
  }
}
