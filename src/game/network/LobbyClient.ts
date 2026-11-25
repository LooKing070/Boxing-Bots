// Сетевой клиент лобби/боя — обёртка над socket.io-client (модуль только для браузера).
// ПРАВИЛО ШЛЮЗА: соединение ВСЕГДА относительное с query XTransformPort=3030.
// Никаких абсолютных URL и портов в URL — Caddy проксирует '/' с этим query на localhost:3030.
import { io, type Socket } from 'socket.io-client'
import type {
  ClientInput,
  ClientToServerEvents,
  HostStateUpdate,
  RematchVote,
  ServerToClientEvents,
} from '@/game/shared/types/network.types'
import type { SlotsConfig } from '@/game/shared/types/strike.types'
import type { MatchEnd } from '@/game/shared/types/damage.types'

// Контракт network.types.ts включает 'match:end' в ServerToClientEvents (релей хост→гость).
type ServerToClientEventsEx = ServerToClientEvents

export type LobbySocket = Socket<ServerToClientEventsEx, ClientToServerEvents>
export type RttHandler = (rtt: number) => void

const CONNECT_URL = '/?XTransformPort=3030'
const CONNECT_TIMEOUT_MS = 10_000
const PING_GUARD_MS = 5_000

export class LobbyClient {
  private socket: LobbySocket
  private connectPromise: Promise<void> | null = null
  private rttHandlers = new Set<RttHandler>()
  private connectHandlers = new Set<() => void>()
  private pingInFlight = false
  private lastPingSent: number | null = null
  private pingGuard: ReturnType<typeof setTimeout> | null = null
  private latestRtt = 0

  constructor() {
    // autoConnect: false — сокет создаётся сразу (on/off работают до connect), открывается вручную.
    // path '/' ОБЯЗАТЕЛЕН: шлюз пересылает только корневой путь с query XTransformPort.
    this.socket = io(CONNECT_URL, {
      autoConnect: false,
      path: '/',
      transports: ['websocket', 'polling'],
      forceNew: true,
      // Реконнект транспорта: экспоненциальный retry, суммарное окно ≥ NET.reconnectS (30 с):
      // 0.5+1+2+3·9 = 30.5 с — гость пытается вернуться всё время ожидания хоста (UPD-12 §5.3)
      reconnection: true,
      reconnectionAttempts: 12,
      reconnectionDelay: 500,
      reconnectionDelayMax: 3000,
      timeout: 10000,
    })
    this.socket.on('connect', this.handleConnect)
    this.socket.on('pong:latency', this.handlePong)
    this.socket.on('disconnect', this.handleDisconnect)
  }

  // ---- Подключение ----

  /** Подключение к лобби-сервису через шлюз. Resolves на 'connect', rejects по таймауту 10 c. */
  connect(): Promise<void> {
    if (this.socket.connected) return Promise.resolve()
    if (this.connectPromise) return this.connectPromise
    const promise = new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timer)
        this.socket.off('connect', onConnect)
        this.socket.off('connect_error', onConnectError)
      }
      const timer = setTimeout(() => {
        cleanup()
        reject(new Error('Не удалось подключиться к лобби-сервису (таймаут 10 c)'))
      }, CONNECT_TIMEOUT_MS)
      const onConnect = () => {
        cleanup()
        resolve()
      }
      const onConnectError = (err: Error) => {
        cleanup()
        reject(err instanceof Error ? err : new Error('Ошибка подключения'))
      }
      this.socket.once('connect', onConnect)
      this.socket.once('connect_error', onConnectError)
      this.socket.connect()
    })
    this.connectPromise = promise
    void promise.catch(() => {}).finally(() => {
      if (this.connectPromise === promise) this.connectPromise = null
    })
    return promise
  }

  disconnect(): void {
    this.connectPromise = null
    this.socket.disconnect()
  }

  get connected(): boolean {
    return this.socket.connected
  }

  /** Подписка на установление соединения (первый коннект и все авто-реконнекты транспорта). */
  onConnected(cb: () => void): void {
    this.connectHandlers.add(cb)
  }

  private handleConnect = (): void => {
    this.pingInFlight = false
    for (const handler of [...this.connectHandlers]) {
      try {
        handler()
      } catch {
        // изолируем падение подписчика от сетевого слоя
      }
    }
  }

  // ---- Лобби: комнаты и очередь ----

  createRoom(name: string, presets: SlotsConfig): void {
    this.socket.emit('room:create', { name, presets })
  }

  joinRoom(roomId: string, name: string, presets: SlotsConfig): void {
    this.socket.emit('room:join', { roomId, name, presets })
  }

  quickJoin(name: string, presets: SlotsConfig): void {
    this.socket.emit('queue:join', { name, presets })
  }

  cancelQueue(): void {
    this.socket.emit('queue:cancel')
  }

  leaveRoom(): void {
    this.socket.emit('room:leave')
  }

  // ---- Релей боя ----

  /** Гость → хост: инпуты. */
  sendInput(input: ClientInput): void {
    this.socket.emit('match:input', input)
  }

  /** Хост → гость: снапшот состояния. */
  sendState(state: HostStateUpdate): void {
    this.socket.emit('match:state', state)
  }

  /** Хост → гость: итог матча. */
  sendMatchEnd(end: MatchEnd): void {
    this.socket.emit('match:end', end)
  }

  /** Реванш: голос готовности (UPD-12). */
  sendRematch(vote: RematchVote): void {
    this.socket.emit('match:rematch', vote)
  }

  /** Хост → гость: перезапуск матча (оба ready). */
  sendRestart(): void {
    this.socket.emit('match:restart')
  }

  /** Heartbeat 1 Гц (UPD-12). */
  sendHeartbeat(t: number): void {
    this.socket.emit('match:heartbeat', t)
  }

  // ---- Пинг ----

  /** Один замер RTT: шлёт 'ping:latency' с Date.now(), ответ 'pong:latency' — эхо timestamp. */
  measurePing(): void {
    const sent = Date.now()
    if (!this.socket.connected || this.pingInFlight) return
    this.pingInFlight = true
    this.lastPingSent = sent
    // Расширение контракта: ClientToServerEvents['ping:latency'] объявлен без аргументов,
    // но сервер-релей эхом возвращает timestamp в 'pong:latency' для расчёта RTT.
    ;(this.socket.emit as unknown as (ev: 'ping:latency', sent: number) => void)('ping:latency', sent)
    if (this.pingGuard) clearTimeout(this.pingGuard)
    this.pingGuard = setTimeout(() => {
      this.pingInFlight = false // страховка: pong потерян
    }, PING_GUARD_MS)
  }

  get rtt(): number {
    return this.latestRtt
  }

  onLatency(cb: RttHandler): void {
    this.rttHandlers.add(cb)
  }

  offLatency(cb: RttHandler): void {
    this.rttHandlers.delete(cb)
  }

  private handlePong = (ms: number): void => {
    this.pingInFlight = false
    if (this.pingGuard) {
      clearTimeout(this.pingGuard)
      this.pingGuard = null
    }
    const sent = typeof ms === 'number' ? ms : this.lastPingSent
    if (typeof sent !== 'number') return
    const rtt = Math.max(0, Date.now() - sent)
    this.latestRtt = rtt
    for (const handler of [...this.rttHandlers]) {
      try {
        handler(rtt)
      } catch {
        // изолируем падение подписчика от сетевого слоя
      }
    }
  }

  private handleDisconnect = (): void => {
    this.pingInFlight = false
  }

  // ---- Подписка на события сервера (типизированные контракты ТЗ 9.3) ----

  on<K extends keyof ServerToClientEventsEx>(event: K, handler: ServerToClientEventsEx[K]): void {
    // cast: socket.io не может разрешить условный тип листенера для generic K
    this.socket.on(event, handler as never)
  }

  off<K extends keyof ServerToClientEventsEx>(event: K, handler: ServerToClientEventsEx[K]): void {
    this.socket.off(event, handler as never)
  }
}

/** Синглтон сетевого клиента. */
export const lobbyClient = new LobbyClient()
