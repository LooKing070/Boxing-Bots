// Событийная шина (ТЗ 12.1)
type Handler = (payload?: unknown) => void

export class EventBus {
  private map = new Map<string, Set<Handler>>()

  on(event: string, fn: Handler): () => void {
    let set = this.map.get(event)
    if (!set) {
      set = new Set()
      this.map.set(event, set)
    }
    set.add(fn)
    return () => this.off(event, fn)
  }

  off(event: string, fn: Handler): void {
    this.map.get(event)?.delete(fn)
  }

  emit(event: string, payload?: unknown): void {
    const set = this.map.get(event)
    if (!set) return
    for (const fn of Array.from(set)) {
      try {
        fn(payload)
      } catch (e) {
        // Обработка ошибок без «белых экранов» (ТЗ 19)
        console.error(`[EventBus] ${event}`, e)
      }
    }
  }

  clear(): void {
    this.map.clear()
  }
}

export const eventBus = new EventBus()
