// Фасад сетевого состояния для боевой сцены (ТЗ 9.2: хост-авторитет, гость шлёт инпуты).
// Тонкий слой над lobbyClient: хранит роль/идентификаторы/пресеты соперника, проксирует
// события в колбэки, опрашивает задержку. Деградация без сети: методы no-op + onError.
import { lobbyClient } from './LobbyClient'
import type {
  ClientInput,
  HostStateUpdate,
  MatchStartPayload,
  RematchVote,
} from '@/game/shared/types/network.types'
import type { SlotsConfig } from '@/game/shared/types/strike.types'
import type { MatchEnd } from '@/game/shared/types/damage.types'

export type NetRole = 'host' | 'guest'
export type LatencyHandler = (rtt: number) => void

const LATENCY_INTERVAL_MS = 2000

export class NetworkManager {
  // Состояние (обновляется событиями 'room:joined' / 'match:start')
  role: NetRole | null = null
  selfId: string | null = null
  peerName: string | null = null
  peerId: string | null = null
  peerPresets: SlotsConfig | null = null
  roomId: string | null = null

  // Авто-реконнект гостя: транспорт восстановлен → тихо возвращаемся в комнату
  // (сервер держит слот и переиздаёт match:start — бой продолжается в окне NET.reconnectS)
  private inRoom = false
  private rejoining = false
  private selfName: string | null = null
  private selfPresets: SlotsConfig | null = null

  private latestRtt = 0
  private wired = false
  private latencyTimer: ReturnType<typeof setInterval> | null = null

  // Колбэки (один слот на событие — последняя регистрация выигрывает)
  private matchStartCb: ((p: MatchStartPayload) => void) | null = null
  private roomJoinedCb: ((p: { roomId: string; role: NetRole; peerName: string | null }) => void) | null = null
  private guestInputCb: ((input: ClientInput) => void) | null = null
  private hostStateCb: ((state: HostStateUpdate) => void) | null = null
  private peerDisconnectedCb: ((role: NetRole) => void) | null = null
  private matchEndCb: ((end: MatchEnd) => void) | null = null
  private errorCb: ((msg: string) => void) | null = null
  private latencyCb: LatencyHandler | null = null
  private peerRematchCb: ((v: RematchVote) => void) | null = null
  private matchRestartCb: (() => void) | null = null
  private peerHeartbeatCb: ((t: number) => void) | null = null
  private socketReconnectedCb: (() => void) | null = null

  // ---- Регистрация колбэков ----

  onMatchStart(cb: (p: MatchStartPayload) => void): void {
    this.matchStartCb = cb
  }

  /** Комната создана/покинута (для отображения кода в UI). */
  onRoomJoined(cb: (p: { roomId: string; role: NetRole; peerName: string | null }) => void): void {
    this.roomJoinedCb = cb
  }

  /** Только хост: инпуты гостя. */
  onGuestInput(cb: (input: ClientInput) => void): void {
    this.guestInputCb = cb
  }

  /** Только гость: снапшоты состояния хоста. */
  onHostState(cb: (state: HostStateUpdate) => void): void {
    this.hostStateCb = cb
  }

  onPeerDisconnected(cb: (role: NetRole) => void): void {
    this.peerDisconnectedCb = cb
  }

  /** Только гость: итог матча от хоста. */
  onMatchEnd(cb: (end: MatchEnd) => void): void {
    this.matchEndCb = cb
  }

  /** Реванш: голос соперника (UPD-12). */
  onPeerRematch(cb: (v: RematchVote) => void): void {
    this.peerRematchCb = cb
  }

  /** Хост перезапустил матч (оба ready). */
  onMatchRestart(cb: () => void): void {
    this.matchRestartCb = cb
  }

  /** Heartbeat от соперника (UPD-12). */
  onPeerHeartbeat(cb: (t: number) => void): void {
    this.peerHeartbeatCb = cb
  }

  /** Транспорт сокета восстановлен после обрыва (авто-реконнект socket.io). */
  onSocketReconnected(cb: () => void): void {
    this.socketReconnectedCb = cb
  }

  onError(cb: (msg: string) => void): void {
    this.errorCb = cb
  }

  /** Последняя измеренная задержка (мс). */
  get latency(): number {
    return this.latestRtt
  }

  /** Подключён ли транспорт сокета (для паузы таймаутов во время реконнекта). */
  get connected(): boolean {
    return lobbyClient.connected
  }

  // ---- Релей боя (прокси) ----

  /** Гость → хост: инпуты. */
  sendInput(input: ClientInput): void {
    lobbyClient.sendInput(input)
  }

  /** Хост → гость: снапшоты. */
  sendState(state: HostStateUpdate): void {
    lobbyClient.sendState(state)
  }

  /** Хост → гость: итог матча. */
  sendMatchEnd(end: MatchEnd): void {
    lobbyClient.sendMatchEnd(end)
  }

  /** Реванш: голос готовности (UPD-12). */
  sendRematch(vote: RematchVote): void {
    lobbyClient.sendRematch(vote)
  }

  /** Хост → гость: перезапуск матча. */
  sendRestart(): void {
    lobbyClient.sendRestart()
  }

  /** Heartbeat 1 Гц (UPD-12). */
  sendHeartbeat(t: number): void {
    lobbyClient.sendHeartbeat(t)
  }

  onLatency(cb: LatencyHandler): void {
    this.latencyCb = cb
    if (this.latestRtt > 0) cb(this.latestRtt)
  }

  // ---- Действия ----

  /** Быстрый матч (очередь FIFO). */
  async startQuick(name: string, presets: SlotsConfig): Promise<void> {
    this.selfName = name
    this.selfPresets = presets
    this.wireOnce()
    if (!(await this.ensureConnected())) return
    this.startLatencyPolling()
    lobbyClient.quickJoin(name, presets)
  }

  /** Создать комнату и стать хостом. */
  async createRoom(name: string, presets: SlotsConfig): Promise<void> {
    this.selfName = name
    this.selfPresets = presets
    this.wireOnce()
    if (!(await this.ensureConnected())) return
    this.startLatencyPolling()
    lobbyClient.createRoom(name, presets)
  }

  /** Войти в комнату по коду (или реконнект гостя). */
  async joinRoom(roomId: string, name: string, presets: SlotsConfig): Promise<void> {
    this.selfName = name
    this.selfPresets = presets
    this.wireOnce()
    if (!(await this.ensureConnected())) return
    this.startLatencyPolling()
    lobbyClient.joinRoom(roomId, name, presets)
  }

  /** Отменить поиск матча. */
  cancel(): void {
    lobbyClient.cancelQueue()
  }

  /** Покинуть комнату и сбросить сетевое состояние (сокет остаётся подключённым). */
  leave(): void {
    lobbyClient.leaveRoom()
    this.resetState()
  }

  /** Полная очистка: остановка пинга и закрытие сокета. */
  destroy(): void {
    this.stopLatencyPolling()
    lobbyClient.disconnect()
    this.resetState()
  }

  // ---- Внутреннее ----

  private resetState(): void {
    this.role = null
    this.selfId = null
    this.peerName = null
    this.peerId = null
    this.peerPresets = null
    this.roomId = null
    this.inRoom = false
    this.rejoining = false
    this.selfName = null
    this.selfPresets = null
  }

  private async ensureConnected(): Promise<boolean> {
    if (lobbyClient.connected) return true
    try {
      await lobbyClient.connect()
      return true
    } catch (err) {
      this.errorCb?.(err instanceof Error ? err.message : 'Нет соединения с сервером')
      return false
    }
  }

  private wireOnce(): void {
    if (this.wired) return
    this.wired = true

    // Комната: роль/идентификаторы; хост получает второе 'room:joined', когда гость подключится
    lobbyClient.on('room:joined', (p) => {
      this.role = p.role
      this.selfId = p.selfId
      this.roomId = p.roomId
      this.peerName = p.peerName || null
      if (p.peerPresets) this.peerPresets = p.peerPresets
      this.inRoom = true
      const wasRejoin = this.rejoining
      this.rejoining = false
      // Повторное room:joined при реконнекте гостя — UI лобби не переключаем
      if (!wasRejoin) {
        this.roomJoinedCb?.({ roomId: p.roomId, role: p.role, peerName: p.peerName || null })
      }
    })

    // Старт матча: пресеты соперника из списка players + колбэк сцене
    lobbyClient.on('match:start', (p) => {
      const peer = p.players.find((pl) => pl.playerId !== this.selfId)
      if (peer) {
        this.peerName = peer.name
        this.peerId = peer.playerId
        this.peerPresets = peer.slots
      }
      this.matchStartCb?.(p)
    })

    lobbyClient.on('peer:disconnected', (p) => {
      this.peerDisconnectedCb?.(p.role)
    })

    // Релей: инпуты — только хосту, снапшоты — только гостю
    lobbyClient.on('match:input', (input) => {
      if (this.role === 'host') this.guestInputCb?.(input)
    })
    lobbyClient.on('match:state', (state) => {
      if (this.role === 'guest') this.hostStateCb?.(state)
    })
    lobbyClient.on('match:end', (end) => {
      if (this.role === 'guest') this.matchEndCb?.(end)
    })
    lobbyClient.on('peer:rematch', (v) => {
      this.peerRematchCb?.(v)
    })
    lobbyClient.on('match:restart', () => {
      this.matchRestartCb?.()
    })
    lobbyClient.on('peer:heartbeat', (t) => {
      this.peerHeartbeatCb?.(t)
    })

    lobbyClient.on('room:error', (msg) => {
      this.rejoining = false
      this.errorCb?.(msg)
    })

    // Авто-реконнект гостя: транспорт восстановлен → тихо возвращаемся в комнату.
    // Сервер переиздаст match:start обоим — хост снимет ожидание реконнекта.
    lobbyClient.onConnected(() => {
      if (!this.inRoom || this.role !== 'guest' || !this.roomId || !this.selfName || !this.selfPresets) return
      this.rejoining = true
      lobbyClient.joinRoom(this.roomId, this.selfName, this.selfPresets)
      this.socketReconnectedCb?.()
    })

    lobbyClient.onLatency((rtt) => {
      this.latestRtt = rtt
      this.latencyCb?.(rtt)
    })
  }

  private startLatencyPolling(): void {
    if (this.latencyTimer) return
    lobbyClient.measurePing() // первое измерение сразу
    this.latencyTimer = setInterval(() => lobbyClient.measurePing(), LATENCY_INTERVAL_MS)
  }

  private stopLatencyPolling(): void {
    if (this.latencyTimer) {
      clearInterval(this.latencyTimer)
      this.latencyTimer = null
    }
  }
}

/** Синглтон фасада для боевой сцены и UI. */
export const networkManager = new NetworkManager()
