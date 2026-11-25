// Игровой цикл: фиксированный шаг физики 60 Гц + rAF-рендер с alpha-интерполяцией (ТЗ 12.1)
import { FIXED_DT, MAX_FRAME_DT } from '../shared/constants/physics'

export class GameLoop {
  private rafId = 0
  private lastTime = 0
  private accumulator = 0
  private running = false
  private alpha = 0
  fps = 0
  private fpsFrames = 0
  private fpsTime = 0

  constructor(
    private update: (dt: number) => void,
    private render: (alpha: number) => void
  ) {}

  start(): void {
    if (this.running) return
    this.running = true
    this.lastTime = performance.now()
    this.accumulator = 0
    const tick = (now: number): void => {
      if (!this.running) return
      this.rafId = requestAnimationFrame(tick)
      let frameDt = (now - this.lastTime) / 1000
      this.lastTime = now
      if (frameDt > MAX_FRAME_DT) frameDt = MAX_FRAME_DT
      this.accumulator += frameDt
      // Фиксированные шаги симуляции
      let steps = 0
      while (this.accumulator >= FIXED_DT && steps < 5) {
        this.update(FIXED_DT)
        this.accumulator -= FIXED_DT
        steps++
      }
      this.alpha = this.accumulator / FIXED_DT
      // FPS
      this.fpsFrames++
      this.fpsTime += frameDt
      if (this.fpsTime >= 0.5) {
        this.fps = Math.round(this.fpsFrames / this.fpsTime)
        this.fpsFrames = 0
        this.fpsTime = 0
      }
      this.render(this.alpha)
    }
    this.rafId = requestAnimationFrame(tick)
  }

  stop(): void {
    this.running = false
    if (this.rafId) cancelAnimationFrame(this.rafId)
    this.rafId = 0
  }

  get isRunning(): boolean {
    return this.running
  }
}
