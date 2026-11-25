// Типы повреждений и дебаффов (TZ-UPDATE §3.8, §5.6)
import type { VoxelType } from './bot.types'
import type { SlotId, BlockBuff } from './strike.types'
import type { Vec3 } from './bot.types'

export type ComponentId = 'camera' | 'motherboard' | 'gyroscope' | 'battery'

/** Событие урона по кубу (сетевое, §5.6) */
export interface DamageEvent {
  tick: number
  targetBotId: string
  hitPoint: Vec3
  voxelId: number
  damage: number
  forceVector: Vec3
  destroyedVoxelIds: number[]
  damagedComponent: VoxelType | null
}

/** Событие отсечения (§5.6): detachedCubeIds МОЖЕТ включать кубы внутренних компонентов */
export interface LimbDetachmentEvent {
  tick: number
  destroyedCubeId: number
  detachedCubeIds: number[]
  center: Vec3
  impulse: Vec3
}

/** Плавающий текст о повреждении компонента — 2 с (FLOAT_TEXT_DURATION_S) */
export const COMPONENT_NOTIFY: Record<ComponentId, string> = {
  camera: 'Камеры повреждены',
  motherboard: 'Материнская плата повреждена',
  gyroscope: 'Гироскоп повреждён',
  battery: 'Аккумулятор повреждён',
}

export const COMPONENT_DESTROYED_NOTIFY: Record<ComponentId, string> = {
  camera: 'Камеры уничтожены',
  motherboard: 'Материнская плата уничтожена',
  gyroscope: 'Гироскоп уничтожен',
  battery: 'Аккумулятор уничтожен',
}

/** Активный блок (§5.6) */
export interface BlockState {
  playerId: string
  slot: SlotId | null
  buff: BlockBuff | null
  stamina: number
}

export type MatchEndReason = 'knockout' | 'timeout' | 'host_left' | 'guest_timeout' | 'draw'

export interface MatchEnd {
  reason: MatchEndReason
  winnerId: string | null
  /** Для оверлея */
  winnerLabel?: string
  /** Суммарный урон по игрокам (§5.6: damage[]) */
  damage?: { playerId: string; total: number }[]
}
