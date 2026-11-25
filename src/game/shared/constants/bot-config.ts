// Константы бота (TZ-UPDATE §8, UPD-10: обшивка 30→20; баланс: скелет 60→50,
// аккумулятор 40→70; цвет обшивки #6a73a1)
import type { VoxelType } from '../types/bot.types'

/** Размер базового куба (юниты) — VOXEL_SIZE */
export const VOXEL_SIZE = 0.25
/** Совместимое имя (используется фабрикой) */
export const CUBE_SIZE = VOXEL_SIZE

/** Лимит кубов на бота — BOT_CUBE_LIMIT; проверяется в BotFactory */
export const MAX_CUBES_PER_BOT = 1000

/** HP слоёв (TZ-UPDATE §8 + баланс): обшивка 20, скелет 50, компоненты 30–70 */
export const LAYER_HP: Record<VoxelType, number> = {
  armor: 20,
  skeleton: 50,
  camera: 30,
  motherboard: 40,
  gyroscope: 40,
  battery: 70,
}

/** Порог повреждения компонента — THRESHOLD_DAMAGE (60%) */
export const COMPONENT_DAMAGED_THRESHOLD = 0.6

/** Цвета слоёв (TZ-UPDATE §7.1: обшивка #6a73a1; скелет/суставы #ab1002) */
export const COLORS = {
  armor: 0x6a73a1,
  skeleton: 0xab1002,
  cameraOwn: 0x3fa9e2,
  cameraEnemy: 0xffac11,
  motherboard: 0x00ff00,
  motherboardTrace: 0x0a5c0a,
  chip: 0x111111,
  gyroscope: 0x000000,
  battery: 0x050c15,
  batteryGlow: 0x1a3a5c,
  joint: 0xab1002,
} as const

/** Материалы (metalness/roughness) */
export const MATERIALS = {
  armor: { metalness: 0.7, roughness: 0.6 },
  skeleton: { metalness: 0.7, roughness: 0.6 },
  camera: { metalness: 0.1, roughness: 0.2 },
  motherboard: { metalness: 0.3, roughness: 0.5 },
  gyroscope: { metalness: 0.9, roughness: 0.2 },
  battery: { metalness: 0.1, roughness: 0.8 },
} as const

export const EMISSIVE = {
  camera: 0.8,
  batteryGlow: 0.9,
} as const

/** Размер суставного акцента — JOINT_SIZE = 0.5 */
export const JOINT_SIZE = 0.5 * CUBE_SIZE // 0.125

/** Анатомическая сетка: 9 колонок × 16 рядов, глубина 3 */
export const ANATOMY = {
  cols: 9,
  rows: 16,
  depth: 3,
  // Ключевые ряды (1 = низ/стопы ... 16 = верх/голова)
  headRows: [14, 15, 16] as const,
  headCols: [3, 4, 5] as const,
  neckRow: 13,
  chestRows: [10, 11, 12] as const,
  chestCols: [2, 3, 4, 5, 6] as const,
  bellyRows: [6, 7, 8] as const,
  bellyCols: [2, 3, 4, 5] as const,
  pelvisRows: [4, 5] as const,
  pelvisCols: [2, 3, 4, 5] as const,
} as const
