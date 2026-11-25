// DebuffManager — применение дебаффов по состоянию компонентов (TZ-UPDATE §3.3, UPD-11)
import type { BotEntity } from '../entities/BotEntity'
import { DEBUFFS } from '../shared/constants/debuffs'
import { POSTFX } from '../shared/constants/physics'

export interface DebuffSnapshot {
  inputDelay: boolean
  forceMult: number
  speedMult: number
  vignette: number
  noise: number
  eyesDim: number
  /** Базовый wobble гироскопа (градусы) */
  gyroWobbleDeg: number
  headLost: boolean
}

export class DebuffManager {
  /** Пересчитать дебаффы бота по состоянию компонентов (вызывается после урона) */
  static update(bot: BotEntity): DebuffSnapshot {
    const g = bot.grid
    const comp = (t: string): 'intact' | 'damaged' | 'destroyed' | null =>
      g.components.find(c => c.type === t)?.health ?? null

    const bat = comp('battery')
    const gyro = comp('gyroscope')
    const cam = comp('camera')
    // Голова отсечена → камеры потеряны (отсечённый компонент = уничтожен, UPD-01)
    const headLost = !g.voxels.some(v => v.limb === 'head' && !v.destroyed)
    const camLost = cam === 'destroyed' || headLost

    const snap: DebuffSnapshot = {
      inputDelay: comp('motherboard') === 'damaged',
      forceMult: bat === 'damaged' ? DEBUFFS.batteryForceMult : 1,
      speedMult: gyro === 'damaged' ? DEBUFFS.gyroSpeedMult : gyro === 'destroyed' ? DEBUFFS.gyroSpeedMultDestroyed : 1,
      vignette: cam === 'damaged' ? POSTFX.vignetteDamaged : camLost ? POSTFX.vignetteDestroyed : 0,
      noise: camLost ? POSTFX.noiseDestroyed : 0,
      eyesDim: bat === 'damaged' ? 1 : 0,
      gyroWobbleDeg: gyro === 'damaged' ? DEBUFFS.gyroWobbleDeg : gyro === 'destroyed' ? DEBUFFS.gyroDestWobbleDeg : 0,
      headLost,
    }

    bot.speedMult = snap.speedMult
    bot.forceMult = snap.forceMult
    bot.fx.vignette = snap.vignette
    // Глитч материнки — ТОЛЬКО на модели бота (UPD-11); экранный глитч не используется
    bot.fx.glitch = 0
    bot.fx.noise = snap.noise
    bot.fx.eyesDim = snap.eyesDim
    // Шатания гироскопа (±3° повреждён / ±6° уничтожен)
    bot.animator.gyroWobbleDeg = snap.gyroWobbleDeg
    bot.animator.gyroWobblePeriod = DEBUFFS.gyroDestWobblePeriodS
    // Глитч модели при повреждённой материнке
    bot.animator.glitchOn = comp('motherboard') === 'damaged'
    return snap
  }
}
