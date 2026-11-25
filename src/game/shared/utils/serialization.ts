// Сериализация пресетов — редакция «движение» (кадры упразднены).
// Формат v2: strike=[0, hand, [x,y,z], speed, knockback, curve] — одна конечная точка;
// block=[1, hand, buff, [x,y,z]] — поза. Значения баффов НЕ передаются (фиксированы
// в общих константах); ≤200 байт.
// Совместимость: старый формат v1 strike=[0, hand, [[x,y,z,d]…]] (полилиния кадров)
// мигрирует автоматически: цель = последняя точка полилинии (конечная точка),
// speed = Σd (клэмп 0.2–1.0), knockback = 0, curve = 0.
import type { SlotsConfig, SlotId, SlotConfig, StrikeData, BlockData, HandId, BlockBuff } from '../types/strike.types'
import { SLOT_IDS } from '../types/strike.types'
import { STRIKE } from '../constants/physics'
import { round3, clamp } from './math'

// Хранилище (§8, без пробелов в значениях)
const PRESETS_KEY = 'bb_presets_v1'
const SETTINGS_KEY = 'bb_settings_v1'
const PROFILE_KEY = 'bb_profile_v1'

const clampAxis = (v: number): number => clamp(v, -STRIKE.editorRange, STRIKE.editorRange)

function sanitizeHand(h: unknown): HandId {
  return h === 'left' || h === 'right' || h === 'both' ? h : 'right'
}

function sanitizeBuff(b: unknown): BlockBuff {
  return b === 'counterstrike' ? 'counterstrike' : 'fortification'
}

export function sanitizeStrike(s: StrikeData): StrikeData {
  return {
    kind: 'strike',
    hand: sanitizeHand(s.hand),
    target: {
      x: clampAxis(Number(s.target?.x) || 0),
      y: clampAxis(Number(s.target?.y) || 0),
      z: clampAxis(Number(s.target?.z) || 0),
    },
    speed: clamp(Number(s.speed) || STRIKE.speedMax, STRIKE.speedMin, STRIKE.speedMax),
    knockback: clamp(Number(s.knockback) || 0, 0, STRIKE.knockbackMax),
    curve: clamp(Number(s.curve) || 0, -STRIKE.curveMax, STRIKE.curveMax),
  }
}

export function sanitizeBlock(b: BlockData): BlockData {
  return {
    kind: 'block',
    hand: sanitizeHand(b.hand),
    buff: sanitizeBuff(b.buff),
    frame: {
      x: clampAxis(Number(b.frame?.x) || 0),
      y: clampAxis(Number(b.frame?.y) || 0),
      z: clampAxis(Number(b.frame?.z) || 0),
    },
  }
}

export function sanitizeSlot(c: SlotConfig): SlotConfig {
  return c.kind === 'strike' ? sanitizeStrike(c) : sanitizeBlock(c)
}

export function sanitizeSlots(slots: SlotsConfig): SlotsConfig {
  const out = {} as SlotsConfig
  for (const id of SLOT_IDS) out[id] = sanitizeSlot(slots[id])
  return out
}

/** Компактная сериализация (~30–40 байт на слот; весь конфиг ≤200 байт) */
export function serializeSlots(slots: SlotsConfig): string {
  const compact: Record<string, unknown> = {}
  for (const id of SLOT_IDS) {
    const c = slots[id]
    if (c.kind === 'strike') {
      compact[id] = [
        0,
        c.hand === 'left' ? 0 : c.hand === 'right' ? 1 : 2,
        [round3(c.target.x), round3(c.target.y), round3(c.target.z)],
        round3(c.speed),
        round3(c.knockback),
        round3(c.curve),
      ]
    } else {
      compact[id] = [
        1,
        c.hand === 'left' ? 0 : c.hand === 'right' ? 1 : 2,
        c.buff === 'fortification' ? 0 : 1,
        [round3(c.frame.x), round3(c.frame.y), round3(c.frame.z)],
      ]
    }
  }
  return JSON.stringify(compact)
}

/** Старый формат v1 (полилиния кадров) → модель «движение» */
function migrateFramesV1(fr: unknown[][]): { target: { x: number; y: number; z: number }; speed: number } | null {
  const pts = fr.filter((k) => Array.isArray(k) && k.length >= 4)
  if (pts.length === 0) return null
  const last = pts[pts.length - 1] as number[]
  const total = pts.reduce((s, k) => s + (Number((k as number[])[3]) || 0), 0)
  return {
    target: { x: last[0], y: last[1], z: last[2] },
    speed: clamp(total || STRIKE.speedMax, STRIKE.speedMin, STRIKE.speedMax),
  }
}

export function deserializeSlots(json: string): SlotsConfig | null {
  try {
    const raw = JSON.parse(json) as Record<string, unknown[]>
    const out = {} as SlotsConfig
    for (const id of SLOT_IDS) {
      const arr = raw[id]
      if (!Array.isArray(arr)) return null
      if (arr[0] === 0) {
        let s: StrikeData | null = null
        const p2 = arr[2]
        if (Array.isArray(p2) && Array.isArray(p2[0])) {
          // v1: полилиния кадров → миграция в «движение»
          const m = migrateFramesV1(p2 as unknown[][])
          if (m) s = { kind: 'strike', hand: sanitizeHand(arr[1]), target: m.target, speed: m.speed, knockback: 0, curve: 0 }
        } else if (Array.isArray(p2) && p2.length >= 3 && typeof p2[0] === 'number') {
          // v2: одна конечная точка + скорость + отталкивание + кривая
          s = {
            kind: 'strike',
            hand: sanitizeHand(arr[1]),
            target: { x: p2[0], y: p2[1], z: p2[2] },
            speed: Number(arr[3]) || STRIKE.speedMax,
            knockback: Number(arr[4]) || 0,
            curve: Number(arr[5]) || 0,
          }
        }
        if (!s) return null
        out[id] = sanitizeStrike(s)
      } else if (arr[0] === 1) {
        const f = arr[3] as number[]
        if (!Array.isArray(f) || f.length < 3) return null
        const b: BlockData = {
          kind: 'block',
          hand: arr[1] === 0 ? 'left' : arr[1] === 1 ? 'right' : 'both',
          buff: arr[2] === 0 ? 'fortification' : 'counterstrike',
          frame: { x: f[0], y: f[1], z: f[2] },
        }
        out[id] = sanitizeBlock(b)
      } else {
        return null
      }
    }
    return out
  } catch {
    return null
  }
}

// ---- localStorage ----

export function loadPresetsLocal(): SlotsConfig | null {
  try {
    const raw = localStorage.getItem(PRESETS_KEY)
    return raw ? deserializeSlots(raw) : null
  } catch {
    return null
  }
}

export function savePresetsLocal(slots: SlotsConfig): void {
  try {
    localStorage.setItem(PRESETS_KEY, serializeSlots(slots))
  } catch {
    /* graceful degradation */
  }
}

export interface BbSettings {
  shadows: 'pcf' | 'basic' | 'off'
  particleLimit: number // 50 | 100 | 150
  pixelRatio: number
  volume: number // 0..1 (общая)
  /** Канал боевых/UI звуков (удары, гром, стингеры) */
  sfxVolume: number // 0..1
  /** Канал музыки и эмбиентов (фоновые подложки + дождь) */
  musicVolume: number // 0..1
  muted: boolean
  touchSensitivity: number // 0.8..1.3 радиусы притяжения
  pingVisible: boolean
  region: string
  /** Сложность PvE ИИ (§3.7): easy | normal | hard, дефолт normal */
  aiDifficulty: 'easy' | 'normal' | 'hard'
}

export const DEFAULT_SETTINGS: BbSettings = {
  shadows: 'pcf',
  particleLimit: 150,
  pixelRatio: 1.5,
  volume: 0.8,
  sfxVolume: 0.8,
  musicVolume: 0.8,
  muted: false,
  touchSensitivity: 1.0,
  pingVisible: true,
  region: 'RU-MSK',
  aiDifficulty: 'normal',
}

export function loadSettingsLocal(): BbSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    if (!raw) return { ...DEFAULT_SETTINGS }
    return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<BbSettings>) }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

export function saveSettingsLocal(s: BbSettings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s))
  } catch {
    /* graceful degradation */
  }
}

export function loadPlayerName(): string {
  try {
    const raw = localStorage.getItem(PROFILE_KEY)
    if (raw) {
      const p = JSON.parse(raw) as { name?: string }
      if (p.name) return p.name
    }
    return 'Боец'
  } catch {
    return 'Боец'
  }
}

export function savePlayerName(n: string): void {
  try {
    localStorage.setItem(PROFILE_KEY, JSON.stringify({ name: n }))
  } catch {
    /* graceful degradation */
  }
}
