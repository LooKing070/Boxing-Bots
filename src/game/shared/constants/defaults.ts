// Конфигурация слотов по умолчанию — «Сбросить всё» (TZ-UPDATE §4, §8 «Дефолты редактора»).
// Модель «движение» (кадров нет): одна конечная точка + скорость + отталкивание + кривая.
// Дефолты: A=удар левой, B=удар левой, C=блок обе руки «Усиление»,
// D=удар обе руки с отталкиванием 8.
// Координаты — смещения ОТ СТОЙКИ (x вперёд, y вверх, z вбок).
import type { SlotsConfig, StrikeData, BlockData } from '../types/strike.types'
import { sanitizeSlots } from '../utils/serialization'

export const DEFAULT_LEFT_STRIKE: StrikeData = {
  kind: 'strike',
  hand: 'left',
  target: { x: 0.9, y: 0.0, z: 0.0 }, // прямой выброс левой
  speed: 0.5,
  knockback: 0,
  curve: 0,
}

export const DEFAULT_RIGHT_STRIKE: StrikeData = {
  kind: 'strike',
  hand: 'right',
  target: { x: 0.9, y: 0.0, z: 0.0 }, // быстрый прямой
  speed: 0.35,
  knockback: 0,
  curve: 0,
}

export const DEFAULT_BLOCK: BlockData = {
  kind: 'block',
  hand: 'right',
  buff: 'fortification',
  frame: { x: 0.3, y: 0.2, z: 0.0 },
}

/** Удар обеими руками с сильным отталкиванием (слайдер = 8) */
export const DEFAULT_BOTH_STRIKE: StrikeData = {
  kind: 'strike',
  hand: 'both',
  target: { x: 0.9, y: 0.0, z: 0.0 },
  speed: 0.5,
  knockback: 8,
  curve: 0,
}

/** Конфигурация по умолчанию: A/B — удары левой, C — блок обеими «Усиление»,
 *  D — удар обеими руками с отталкиванием 8 */
export function defaultSlots(): SlotsConfig {
  return sanitizeSlots({
    A: { ...DEFAULT_LEFT_STRIKE, hand: 'left' },
    B: { ...DEFAULT_LEFT_STRIKE, hand: 'left' },
    C: { ...DEFAULT_BLOCK, hand: 'both' },
    D: { ...DEFAULT_BOTH_STRIKE },
  })
}

/** Пресет ИИ-бота: разнообразные удары + блок «Контратака» */
export function aiSlots(): SlotsConfig {
  return sanitizeSlots({
    A: { ...DEFAULT_RIGHT_STRIKE, hand: 'right' },
    B: { ...DEFAULT_BLOCK, buff: 'fortification', hand: 'left' },
    C: { ...DEFAULT_LEFT_STRIKE, hand: 'left' },
    D: { ...DEFAULT_BLOCK, buff: 'counterstrike', hand: 'right' },
  })
}
