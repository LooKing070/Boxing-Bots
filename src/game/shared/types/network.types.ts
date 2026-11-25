// Сетевые контракты — целевая редакция (TZ-UPDATE §5, UPD-12) + лобби (socket.io вместо Colyseus по ограничениям среды).
import type { DamageEvent, LimbDetachmentEvent, MatchEnd } from './damage.types'
import type { SlotsConfig, SlotId, BlockBuff } from './strike.types'
import type { Vec3 } from './bot.types'

export type InputActionKind = 'strike' | 'block_down' | 'block_up' | 'jump' | 'crouch' | 'flip'
export type MoveDir = 'left' | 'right' | 'none'

export interface InputAction {
  kind: InputActionKind
  slot?: SlotId
  move?: MoveDir
  timestamp: number
  /** Длительность удержания для block_up (сек) */
  holdTime?: number
}

/** Клиент → Хост */
export interface ClientInput {
  seq: number
  timestamp: number
  actions: InputAction[]
  move: MoveDir
  /** Прыжок накоплен с прошлой отправки (edge-события аккумулируются на госте) */
  jump: boolean
  /** Присед удерживается на момент отправки (level) */
  crouch: boolean
}

export interface ClientAction {
  presetId: string
  slot: SlotId
  kind: 'strike' | 'block'
  timestamp: number
}

/** Реванш: оба клиента голосуют; хост перезапускает матч только при ready обоих (§5.2) */
export interface RematchVote {
  playerId: string
  ready: boolean
}

/** Снимок состояния бота (координаты округлены до 3 знаков — NET_ROUND_DECIMALS) */
export interface BotSnapshot {
  id: string
  x: number
  y: number
  facing: 1 | -1
  /** idle/walk/jump/crouch/strike/block/knockdown/flip/turn */
  anim: string
  strikeSlot?: SlotId
  strikeT?: number
  blockActive: boolean
  stamina: number
  crouch: boolean
  walkPhase: number
  deathK?: number
  speed01?: number
  /** Прогресс автотурна 0..1 */
  turnT?: number
  /** Прогресс нокдауна 0..1 */
  knockdownK?: number
  /** Прогресс кувырка 0..1 (dir: −1/1) */
  flipK?: number
  flipDir?: -1 | 1
}

/** Хост → Клиент */
export interface HostStateUpdate {
  tick: number
  bots: BotSnapshot[]
  events: NetGameEvent[]
  timeLeft: number
  damage: Record<string, number>
}

export type NetGameEvent =
  | { type: 'damage'; data: DamageEvent }
  | { type: 'limb'; data: LimbDetachmentEvent }
  | { type: 'block'; data: { playerId: string; stamina: number; active: boolean; buff: BlockBuff | null } }
  | { type: 'end'; data: MatchEnd }
  | { type: 'respawn'; data: { botId: string } }

/** Пресеты, которыми обмениваются игроки в pre-match: полилиния кадров с длительностями;
 *  значения баффов НЕ передаются (фиксированы в общих константах); ≤200 байт (§5.4) */
export interface PlayerPresetPayload {
  playerId: string
  name: string
  slots: SlotsConfig
}

// ---- Лобби (socket.io) ----

export interface LobbyRoomInfo {
  roomId: string
  hostName: string
  guests: number
  status: 'waiting' | 'battle'
}

export interface RoomJoinedPayload {
  roomId: string
  role: 'host' | 'guest'
  selfId: string
  peerName: string
  peerPresets?: SlotsConfig
}

export interface MatchStartPayload {
  roomId: string
  players: PlayerPresetPayload[]
}

export type ServerToClientEvents = {
  'lobby:rooms': (rooms: LobbyRoomInfo[]) => void
  'room:joined': (p: RoomJoinedPayload) => void
  'room:error': (msg: string) => void
  'match:start': (p: MatchStartPayload) => void
  'match:input': (p: ClientInput) => void
  'match:state': (p: HostStateUpdate) => void
  'match:end': (p: MatchEnd) => void
  'peer:disconnected': (p: { role: 'host' | 'guest' }) => void
  'pong:latency': (sentAt: number) => void
  /** UPD-12: реванш — голос соперника */
  'peer:rematch': (p: RematchVote) => void
  /** UPD-12: хост перезапускает матч (оба ready) */
  'match:restart': () => void
  /** UPD-12: heartbeat 1 Гц (эхо-релей) */
  'peer:heartbeat': (t: number) => void
}

export type ClientToServerEvents = {
  'lobby:list': () => void
  'room:create': (p: { name: string; presets: SlotsConfig }) => void
  'room:join': (p: { roomId: string; name: string; presets: SlotsConfig }) => void
  'queue:join': (p: { name: string; presets: SlotsConfig }) => void
  'queue:cancel': () => void
  'room:leave': () => void
  'match:input': (p: ClientInput) => void
  'match:state': (p: HostStateUpdate) => void
  'match:end': (p: MatchEnd) => void
  'match:rematch': (p: RematchVote) => void
  'match:restart': () => void
  'match:heartbeat': (t: number) => void
  'ping:latency': (sentAt: number) => void
}

export function round3(v: number): number {
  return Math.round(v * 1000) / 1000
}

export function roundVec3(v: Vec3): Vec3 {
  return { x: round3(v.x), y: round3(v.y), z: round3(v.z) }
}
