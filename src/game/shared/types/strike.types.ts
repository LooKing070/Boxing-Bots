// Типы ударов и блоков — редакция «движение» (кадры упразднены).
// У удара ОДНА конечная точка (x,y,z) + скорость + отталкивание + кривая;
// у блока — одна поза-кадр (как и раньше). Параметра «сила» НЕТ:
// урон = квадратичная функция скорости движения (2–10) минус цена отталкивания.
import type { Vec3 } from './bot.types'
import { STRIKE } from '../constants/physics'
import { clamp } from '../utils/math'

export type SlotId = 'A' | 'B' | 'C' | 'D'
export const SLOT_IDS: SlotId[] = ['A', 'B', 'C', 'D']

export type HandId = 'left' | 'right' | 'both'
export type BlockBuff = 'fortification' | 'counterstrike'

/** Удар = одно движение кисти: от стойки к конечной точке target
 *  (смещение ОТ СТОЙКИ: x вперёд, y вверх, z вбок, ±EDITOR_RANGE) за время speed
 *  (0.2–1.0 с, медленнее = сильнее) по траектории с изгибом curve (−5..+5, 0 = прямая).
 *  Отталкивание knockback 0–10 (дефолт 0): +1 ед → −0.5 ед урона, сильнее отбрасывает. */
export interface StrikeData {
  kind: 'strike'
  hand: HandId
  /** Конечная точка кисти (смещение от стойки) */
  target: Vec3
  /** Время движения к цели, с (speedMin–speedMax) */
  speed: number
  /** Отталкивание, 0–10 (дефолт 0) */
  knockback: number
  /** Кривизна траектории, −5..+5 (0 = прямая) */
  curve: number
}

/** Блок: одна поза-кадр (принимается за BLOCK_POSE_S=0.5с) + фиксированный бафф комбобоксом */
export interface BlockData {
  kind: 'block'
  hand: HandId
  buff: BlockBuff
  frame: Vec3
}

export type SlotConfig = StrikeData | BlockData
export type SlotsConfig = Record<SlotId, SlotConfig>

export function isStrike(c: SlotConfig): c is StrikeData {
  return c.kind === 'strike'
}
export function isBlock(c: SlotConfig): c is BlockData {
  return c.kind === 'block'
}

/** Базовый урон: q = ((speed−0.2)/0.8)²; base = 2 + 8·q → 2–10 (медленнее = сильнее);
 *  вычет за отталкивание: −0.5·knockback; пол — STRIKE.dmgFloor (удар не безвреден). */
export function strikeDamage(sd: StrikeData): number {
  const q = Math.pow(Math.max(0, sd.speed - STRIKE.speedMin) / (STRIKE.speedMax - STRIKE.speedMin), 2)
  const base = STRIKE.strDmgMin + (STRIKE.strDmgMax - STRIKE.strDmgMin) * q
  return Math.max(STRIKE.dmgFloor, Math.min(STRIKE.strDmgMax, base - sd.knockback * STRIKE.damageCostPerKnockback))
}

/** Импульс отбрасывания: KNOCKBACK_BASE + knockbackPerUnit·knockback (слайдер 0–10) */
export function strikeKnockbackPower(sd: StrikeData): number {
  return STRIKE.knockbackBase + sd.knockback * STRIKE.knockbackPerUnit
}

/** Точка на траектории удара: квадратичная Безье rest→target.
 *  Контрольная точка = середина + перпендикуляр (в плоскости XY) · curve·curveScale:
 *  curve > 0 — дуга вверх (хук/апперкот), curve < 0 — дуга вниз (удар сверху),
 *  curve = 0 — прямая. t01 — прогресс 0..1. */
export function curveTrajectoryPoint(rest: Vec3, target: Vec3, curve: number, t01: number): Vec3 {
  const k = clamp(t01, 0, 1)
  const u = 1 - k
  const mx = (rest.x + target.x) / 2
  const my = (rest.y + target.y) / 2
  const mz = (rest.z + target.z) / 2
  let cx = mx, cy = my
  const dx = target.x - rest.x
  const dy = target.y - rest.y
  const len = Math.hypot(dx, dy)
  if (len > 1e-4 && curve !== 0) {
    const off = curve * STRIKE.curveScale
    cx += (-dy / len) * off
    cy += (dx / len) * off
  }
  return {
    x: u * u * rest.x + 2 * u * k * cx + k * k * target.x,
    y: u * u * rest.y + 2 * u * k * cy + k * k * target.y,
    z: u * u * rest.z + 2 * u * k * mz + k * k * target.z,
  }
}

/** Активный удар во время боя (рантайм) */
export interface StrikeRuntime {
  slot: SlotId
  data: StrikeData
  /** Прошедшее время, сек */
  elapsed: number
  /** speed — длительность фазы движения */
  strikeDur: number
  /** speed + ACTION_GAP — полный цикл анимации удара (фаза возврата руки);
   *  после totalDur любой слот удара/блока доступен немедленно */
  totalDur: number
  /** Урон (пересчитан при старте, с учётом дебаффа аккумулятора) */
  damage: number
  /** Кулак (по сторонам) уже нанёс урон / остановлен первым контактом */
  hitDone: { left: boolean; right: boolean }
  /** Точка остановки кулака первым контактом (замораживает траекторию) */
  stopPoint: { left: Vec3 | null; right: Vec3 | null }
  /** Удар культёй (рука отсечена) — хитбокс VOXEL_SIZE у края остатка */
  stump: { left: boolean; right: boolean }
}
