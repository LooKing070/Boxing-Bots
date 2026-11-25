// LimbGraph — граф связей для отсечения конечностей (ТЗ 5.7, 12.3)
// Строится на этапе генерации бота; направленный: от корня (грудь) к конечностям.

export class LimbGraph {
  /** parent voxel id → список дочерних */
  private children = new Map<number, number[]>()

  constructor(parents: ArrayLike<number>) {
    for (let id = 0; id < parents.length; id++) {
      const p = parents[id]
      if (p >= 0) {
        let list = this.children.get(p)
        if (!list) {
          list = []
          this.children.set(p, list)
        }
        list.push(id)
      }
    }
  }

  /** Все потомки voxel id (включая его самого — вызывающий решает). */
  subtree(rootId: number, out: number[] = []): number[] {
    const stack = [rootId]
    while (stack.length > 0) {
      const cur = stack.pop() as number
      out.push(cur)
      const kids = this.children.get(cur)
      if (kids) for (const k of kids) stack.push(k)
    }
    return out
  }
}
