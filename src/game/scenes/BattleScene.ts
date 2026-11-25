// BattleScene — бой (TZ-UPDATE §3, §5, UPD-05/06/07/12):
// PvE + PvP (хост-авторитет / гость с предсказанием), countdown 3с, снапшоты 30 Гц,
// автотурн при смене сторон, кувырок, нокдаун, реванш по голосам, heartbeat 1 Гц.
import * as THREE from 'three'
import type { Scene, SceneCtx, SceneParams } from './Scene'
import { buildEnvironment, type EnvironmentHandles } from '../rendering/Environment'
import { buildBot } from '../entities/BotFactory'
import { BotEntity, type ControlInput } from '../entities/BotEntity'
import { BotVoxelRenderer } from '../rendering/VoxelRenderer'
import { CameraController } from '../rendering/CameraController'
import type { PhysicsWorld } from '../physics/PhysicsWorld'
import { DebrisPool } from '../physics/DebrisPool'
import { BattleFx, COMPONENT_COLORS } from '../systems/BattleFx'
import { StrikeSystem, type CombatEvents } from '../systems/StrikeSystem'
import { DebuffManager } from '../systems/DebuffManager'
import { AISystem } from '../systems/AISystem'
import type { InputManager } from '../core/InputManager'
import { audioManager } from '../core/AudioManager'
import { useGameStore } from '@/components/game/store'
import { networkManager } from '../network/NetworkManager'
import type { BotSnapshot, HostStateUpdate, NetGameEvent, ClientInput, InputAction } from '../shared/types/network.types'
import type { SlotId } from '../shared/types/strike.types'
import { isStrike, isBlock } from '../shared/types/strike.types'
import { BOT_MOVE, MATCH, NET, ENVIRONMENT, VICTORY, ARENA } from '../shared/constants/physics'
import { COMPONENT_NOTIFY, COMPONENT_DESTROYED_NOTIFY } from '../shared/types/damage.types'
import { clamp } from '../shared/utils/math'
import { aiSlots } from '../shared/constants/defaults'
import type { MatchEnd as MatchEndData } from '../shared/types/damage.types'

const EYE_OWN = 0x3fa9e2
const EYE_ENEMY = 0xffac11

export class BattleScene implements Scene {
  readonly threeScene: THREE.Scene
  private ctx: SceneCtx
  mode: 'pve' | 'pvp-host' | 'pvp-guest'
  private env: EnvironmentHandles
  private bots!: [BotEntity, BotEntity]
  private botData: [ReturnType<typeof buildBot>, ReturnType<typeof buildBot>]
  private renderers!: [BotVoxelRenderer, BotVoxelRenderer]
  private eyeLights!: [THREE.PointLight, THREE.PointLight]
  private camCtl: CameraController
  private physics: PhysicsWorld
  private debris!: DebrisPool
  private fx!: BattleFx
  private strikes!: StrikeSystem
  private ai: AISystem | null = null
  private input: InputManager
  private net = networkManager

  private tick = 0
  private timeLeft: number = MATCH.duration
  /** Отсчёт до боя (MATCH_COUNTDOWN_S=3) — действия заблокированы */
  private countdown: number = MATCH.countdown
  private ended = false
  private endedShown = false
  private endPendingT = -1
  private pendingEnd: MatchEndData | null = null
  private eventsOut: NetGameEvent[] = []
  private netAccum = 0
  private inputAccum = 0
  private hudAccum = 0
  private inputSeq = 1
  private graceT = -1
  private eyeSparkT = 0
  private prevRelX = 0
  /** Heartbeat (UPD-12): 1 Гц, таймаут 3с (игровое время — устойчиво к троттлингу вкладки);
   *  контроль стартует после первого обмена */
  private heartbeatT = 0
  private beatAge = 0
  private beatStarted = false
  /** Экран победы: боты замерли на подиуме и крутятся 360° для осмотра итогового состояния */
  private victory: { t: number; spin: number } | null = null
  private victorySelfWon: boolean | null = null
  private victoryLook = new THREE.Vector3(0, VICTORY.lookY, 0)
  dbg = { sent: 0, gotBeat: 0 }
  fpsRef: (() => number) | null = null

  /** Постэффекты от дебаффов локального бота — читает SceneManager */
  post = { vignette: 0.14, glitch: 0, noise: 0 }

  // PvP-хост: уровни управления гостя — держатся до следующего пакета (30 Гц);
  // сброс каждый кадр давал «мигание» (уровень живёт лишь 1 кадр из 2 между пакетами).
  // Прыжок — edge: применяется ровно один кадр после прибытия пакета
  private guestLevel: ControlInput = { move: 'none', jump: false, crouch: false }
  private guestJumpEdge = false
  private guestActions: InputAction[] = []
  // PvP-гость: предсказание
  private guestPendingActions: InputAction[] = []
  /** Прыжок накоплен с прошлой отправки (edge не теряется между 30 Гц-пакетами) */
  private guestJumpPending = false
  private guestBlockHold: Partial<Record<SlotId, number>> = {}
  private lastGuestMove: 'left' | 'right' | 'none' = 'none'
  private lastGuestCtrl: ControlInput = { move: 'none', jump: false, crouch: false }
  /** Отложенные раскаты грома (сек до звука; локально, синхронно с вспышками молний) */
  private thunderDelays: number[] = []

  /** Случайное событие грозы: вспышка молнии → гром через 0.25–0.95 с
   *  (иногда двойной перекат). Только локальный звук — сети не касается.
   *  Вместе с громом взлетает громкость дождя (шторм звучит цельно). */
  private queueThunder(): void {
    this.thunderDelays.push(0.25 + Math.random() * 0.7)
    if (Math.random() < 0.35) this.thunderDelays.push(1.1 + Math.random() * 0.9)
    audioManager.burstRain()
  }

  private tickThunder(dt: number): void {
    for (let i = this.thunderDelays.length - 1; i >= 0; i--) {
      this.thunderDelays[i] -= dt
      if (this.thunderDelays[i] <= 0) {
        this.thunderDelays.splice(i, 1)
        audioManager.play('thunder', { volume: 0.5 + Math.random() * 0.35, rate: 0.85 + Math.random() * 0.3 })
      }
    }
  }

  constructor(ctx: SceneCtx, params: SceneParams, input: InputManager, physics: PhysicsWorld) {
    this.ctx = ctx
    this.input = input
    this.physics = physics
    this.mode = params.mode ?? 'pve'
    this.threeScene = new THREE.Scene()
    // Гроза: при вспышке молнии — отложенный локальный гром (в PvP — у каждого
    // клиента свой, на сервер/сеть не влияет)
    this.env = buildEnvironment(this.threeScene, ctx.engine.renderer, () => this.queueThunder())
    this.botData = [buildBot(EYE_OWN), buildBot(EYE_ENEMY)]
    this.camCtl = new CameraController(ctx.engine.camera)

    this.buildCombatants()

    if (this.mode === 'pve') {
      const store = useGameStore.getState()
      this.ai = new AISystem(this.bots[1], this.bots[0], store.settings.aiDifficulty)
    } else {
      this.net.onGuestInput((ci) => this.onGuestInput(ci))
      this.net.onHostState((hs) => this.onHostState(hs))
      this.net.onMatchEnd((me) => this.onRemoteMatchEnd(me))
      this.net.onPeerDisconnected((role) => this.onPeerDisconnected(role))
      this.net.onPeerHeartbeat(() => { this.beatAge = 0; this.beatStarted = true; this.dbg.gotBeat++ })
      this.net.onSocketReconnected(() => {
        // Свой транспорт восстановился: паузим контроль heartbeat до нового обмена,
        // иначе гость отменит матч раньше, чем успеет вернуться в комнату
        this.beatAge = 0
        this.beatStarted = false
      })
      this.net.onPeerRematch((v) => {
        useGameStore.getState().setRematch({ peer: v.ready })
      })
      this.net.onMatchRestart(() => this.restartMatch())
      // Реконнект соперника: переизданный match:start → сброс ожидания реконнекта;
      // контроль heartbeat перезапускается с первого нового обмена
      this.net.onMatchStart(() => {
        this.beatAge = 0
        this.beatStarted = false
        if (this.graceT > 0) {
          this.graceT = -1
          useGameStore.getState().pushToast('Соперник вернулся в бой!', 'success')
        }
      })
    }
    this.updateBattleHook()

    const store = useGameStore.getState()
    audioManager.init({ volume: store.settings.volume, muted: store.settings.muted, sfxVolume: store.settings.sfxVolume, musicVolume: store.settings.musicVolume })
    store.setHud({
      timeLeft: MATCH.duration,
      damageMe: 0,
      damageFoe: 0,
      ping: this.mode === 'pve' ? null : this.net.latency,
      countdown: Math.ceil(this.countdown),
    })
  }

  /** Создать бойцов/рендереры/эффекты (конструктор + реванш) */
  private buildCombatants(): void {
    const store = useGameStore.getState()
    const selfId = this.mode === 'pve' ? 'self' : (this.net.selfId ?? 'self')
    const foeId = this.mode === 'pve' ? 'ai' : (this.net.peerId ?? 'peer')
    const selfSlots = store.slots
    const foeSlots = this.mode === 'pve' ? aiSlots() : (this.net.peerPresets ?? selfSlots)
    const self = new BotEntity(selfId, store.playerName, this.botData[0], selfSlots)
    const foeName = this.mode === 'pve' ? 'ИИ-Бот' : (this.net.peerName ?? 'Соперник')
    const foe = new BotEntity(foeId, foeName, this.botData[1], foeSlots)
    self.x = -3.2
    foe.x = 3.2
    self.facing = 1
    foe.facing = -1
    this.bots = [self, foe]
    this.prevRelX = foe.x - self.x
    // Отладочный хук аудио (dev-QA): подмена play() в тестах браузера
    ;(window as unknown as { __bbAudio?: unknown }).__bbAudio = audioManager
    this.renderers = [
      new BotVoxelRenderer(this.botData[0], self.grid, this.threeScene),
      new BotVoxelRenderer(this.botData[1], foe.grid, this.threeScene),
    ]

    this.eyeLights = [
      new THREE.PointLight(EYE_OWN, 0.5, 3),
      new THREE.PointLight(EYE_ENEMY, 0.5, 3),
    ]
    this.threeScene.add(this.eyeLights[0], this.eyeLights[1])

    this.debris = new DebrisPool(this.physics, this.threeScene, this.ctx.isMobile)
    this.fx = new BattleFx(this.threeScene, store.settings.particleLimit, this.ctx.isMobile)

    const events: CombatEvents = {
      onDamage: (p) => {
        this.eventsOut.push({ type: 'damage', data: {
          tick: this.tick,
          targetBotId: p.targetId,
          hitPoint: p.hitPoint,
          voxelId: p.voxelId,
          damage: p.damage,
          forceVector: p.impulse,
          destroyedVoxelIds: p.destroyedVoxelIds,
          damagedComponent: (p.damagedComponent as 'camera' | 'motherboard' | 'gyroscope' | 'battery' | null) ?? null,
        } })
        if (p.detachedIds.length > 0) {
          this.eventsOut.push({ type: 'limb', data: {
            tick: this.tick,
            destroyedCubeId: p.voxelId,
            detachedCubeIds: p.detachedIds,
            center: p.hitPoint,
            impulse: p.impulse,
          } })
        }
      },
      onComponentNotify: (text) => {
        if (text) store.pushToast(text, 'info')
      },
      onHitSound: (layer, volumeMul) => {
        audioManager.play(layer, volumeMul !== undefined && volumeMul !== 1 ? { volume: volumeMul } : undefined)
      },
    }
    this.strikes = new StrikeSystem(
      { fx: this.fx, debris: this.debris, events, rng: Math.random },
      (loser) => this.checkKnockout(loser)
    )
  }

  /** Отладочный хук боя (dev-QA): вызывается после создания ботов и ИИ */
  private updateBattleHook(): void {
    ;(window as unknown as { __bbBattle?: unknown }).__bbBattle = { bots: this.bots, ai: this.ai, strikes: this.strikes }
  }

  // ================= Авторитетная симуляция (PvE + хост) =================

  private applyLocalInput(bot: BotEntity, dt: number): ControlInput {
    const sample = this.input.sample(dt)
    for (const slot of sample.slotDown) {
      const cfg = bot.slots[slot]
      if (!cfg) continue
      if (isStrike(cfg)) bot.tryStrike(slot)
      else if (isBlock(cfg)) bot.activateBlock(slot)
    }
    for (const slot of sample.slotUp) {
      const cfg = bot.slots[slot]
      if (cfg && isBlock(cfg) && bot.block.active && bot.block.slot === slot) {
        const tap = (sample.holdDurations.get(slot) ?? bot.block.holdT) < 1.0
        bot.deactivateBlock(tap)
      }
    }
    return { move: sample.move, jump: sample.jumpPressed, crouch: sample.crouchHeld }
  }

  private authoritativeUpdate(dt: number, now: number): void {
    let ctrl0: ControlInput = { move: 'none', jump: false, crouch: false }
    let ctrl1: ControlInput = { move: 'none', jump: false, crouch: false }

    if (this.countdown > 0) {
      // Countdown 3с: действия и таймер матча заблокированы
      this.countdown -= dt
      if (this.countdown <= 0) {
        this.countdown = 0
        useGameStore.getState().setHud({ countdown: 0 })
        audioManager.play('ui')
      } else {
        useGameStore.getState().setHud({ countdown: Math.ceil(this.countdown) })
      }
    } else {
      ctrl0 = this.applyLocalInput(this.bots[0], dt)
      if (this.ai) {
        ctrl1 = this.ai.update(dt, now)
      } else {
        // Уровни гостя — стабильны между пакетами; прыжок расходуется одним кадром
        ctrl1 = {
          move: this.guestLevel.move,
          jump: this.guestJumpEdge,
          crouch: this.guestLevel.crouch,
        }
        this.guestJumpEdge = false
        this.consumeGuestActions(this.bots[1])
      }
    }

    this.bots[0].update(dt, ctrl0, this.bots[1].x, false)
    this.bots[1].update(dt, ctrl1, this.bots[0].x, false)
    this.separate()
    this.checkSideSwap()
    // Падение с крыши (за канатным забором) → респаун в центре без обшивки
    this.checkFellOff(false)

    this.strikes.resolve(this.bots[0], this.bots[1])
    this.strikes.resolve(this.bots[1], this.bots[0])

    if (this.countdown <= 0 && !this.ended && !this.pendingEnd) {
      this.timeLeft -= dt
      if (this.timeLeft <= 0) {
        this.timeLeft = 0
        const d0 = this.bots[0].totalDamage, d1 = this.bots[1].totalDamage
        // По истечении времени побеждает нанёсший больший урон; равенство — ничья
        this.finishMatch(
          d0 === d1
            ? { reason: 'draw', winnerId: null }
            : { reason: 'timeout', winnerId: d0 > d1 ? this.bots[0].id : this.bots[1].id },
        )
      }
    }
    if (this.endPendingT > 0) {
      this.endPendingT -= dt
      if (this.endPendingT <= 0 && this.pendingEnd) {
        const pe = this.pendingEnd
        this.pendingEnd = null
        this.finishMatch(pe)
      }
    }
  }

  /** Автотурн (UPD-06): смена сторон → оба разворачиваются МГНОВЕННО (анимация
   *  поворота убрана, управление не блокируется).
   *  Пока кто-то в воздухе/кувырке/нокдауне — смена сторон НЕ фиксируется:
   *  кувырок через противника не прерывается разворотом; разворот сработает
   *  после приземления (prevRelX не обновляется — знак смены обнаружится
   *  на земле). */
  private checkSideSwap(): void {
    const [a, b] = this.bots
    if (a.dead || b.dead) return
    if (a.airborne || b.airborne || a.flip.active || b.flip.active || a.knockdown.active || b.knockdown.active) return
    const rel = b.x - a.x
    if (Math.abs(rel) < 0.08 || Math.abs(this.prevRelX) < 0.08) {
      this.prevRelX = rel
      return
    }
    if (Math.sign(rel) !== Math.sign(this.prevRelX)) {
      a.startTurn()
      b.startTurn()
    }
    this.prevRelX = rel
  }

  /** Квадратные коллайдеры ботов (AABB в плане, half = BOT_MOVE.botColliderHalf по X и Z,
   *  динамическая высота — collisionSpan). Сталкиваются ТОЛЬКО друг с другом: арена,
   *  мусор и удары коллайдеры не затрагивают. Расталкивание вдоль боевой оси X с учётом
   *  стен арены (у стены сдвигается только свободный бота — протиснуться сквозь нельзя).
   *  Перепрыгивание: кувырок группируется в компактный «шар» и проходит НАД противником,
   *  когда его низ выше верха коллайдера противника (обычный прыжок НЕ проходит). */
  private separate(): void {
    const [a, b] = this.bots
    const sa = a.collisionSpan()
    const sb = b.collisionSpan()
    if (!sa || !sb) return // мёртвые не создают препятствия
    if (sa.bottom >= sb.top || sb.bottom >= sa.top) return // разнесены по высоте — не толкаем
    const min = BOT_MOVE.botColliderHalf * 2
    const bound = BOT_MOVE.boundX
    const dx = b.x - a.x
    const dist = Math.abs(dx)
    if (dist >= min) return
    const overlap = min - dist
    const s: 1 | -1 = dist > 1e-4 ? (dx > 0 ? 1 : -1) : 1 // детерминированный тай-брейк
    // Сколько каждый может сдвинуться в свою сторону (возле стены — только свободный)
    const roomA = s === 1 ? a.x + bound : bound - a.x
    const roomB = s === 1 ? bound - b.x : b.x + bound
    let pa = Math.min(overlap / 2, roomA)
    const pb = Math.min(overlap - pa, roomB)
    pa = Math.min(overlap - pb, roomA) // остаток — если b у стены
    a.x = clamp(a.x - s * pa, -bound, bound)
    b.x = clamp(b.x + s * pb, -bound, bound)
  }

  /** Гость (PvP): коллизия предсказанного своего бота с удалённым (хост-авторитарным).
   *  Сдвигаем ТОЛЬКО своего бота — позиция соперника приходит из снапшотов, поэтому
   *  сквозь него визуально пройти нельзя (раньше на стороне гостя расталкивания не было). */
  private separateGuest(): void {
    const [a, b] = this.bots
    const sa = a.collisionSpan()
    const sb = b.collisionSpan()
    if (!sa || !sb) return
    if (sa.bottom >= sb.top || sb.bottom >= sa.top) return
    const min = BOT_MOVE.botColliderHalf * 2
    const bound = BOT_MOVE.boundX
    const dx = a.x - b.x // направление от чужого к своему
    const dist = Math.abs(dx)
    if (dist >= min) return
    const s: 1 | -1 = dist > 1e-4 ? (dx > 0 ? 1 : -1) : (a.x <= b.x ? -1 : 1)
    a.x = clamp(b.x + s * min, -bound, bound)
  }

  // ================= PvP-хост: приём инпутов гостя =================

  private onGuestInput(ci: ClientInput): void {
    if (this.mode !== 'pvp-host') return
    this.guestActions.push(...ci.actions)
    this.guestLevel.move = ci.move
    // Прыжок (edge) и присед (level) гостя — раньше терялись: хост не видел их
    if (ci.jump) this.guestJumpEdge = true
    this.guestLevel.crouch = ci.crouch ?? false
  }

  private consumeGuestActions(bot: BotEntity): void {
    for (const a of this.guestActions) {
      if (!a.slot) continue
      const cfg = bot.slots[a.slot]
      if (!cfg) continue
      if (a.kind === 'strike' && isStrike(cfg)) bot.tryStrike(a.slot)
      else if (a.kind === 'block_down' && isBlock(cfg)) bot.activateBlock(a.slot)
      else if (a.kind === 'block_up' && isBlock(cfg)) bot.deactivateBlock((a.holdTime ?? 0) < 1.0)
    }
    this.guestActions = []
  }

  // ================= PvP-гость: предсказание + отправка =================

  private applyLocalInputGuest(dt: number): void {
    const bot = this.bots[0]
    const sample = this.input.sample(dt)
    if (this.countdown <= 0) {
      for (const slot of sample.slotDown) {
        const cfg = bot.slots[slot]
        if (!cfg) continue
        if (isStrike(cfg)) {
          if (bot.tryStrike(slot)) {
            this.guestPendingActions.push({ kind: 'strike', slot, timestamp: Date.now() })
          }
        } else if (isBlock(cfg)) {
          if (bot.activateBlock(slot)) {
            this.guestBlockHold[slot] = performance.now()
            this.guestPendingActions.push({ kind: 'block_down', slot, timestamp: Date.now() })
          }
        }
      }
      for (const slot of sample.slotUp) {
        const cfg = bot.slots[slot]
        if (cfg && isBlock(cfg) && bot.block.active && bot.block.slot === slot) {
          const held = (performance.now() - (this.guestBlockHold[slot] ?? performance.now())) / 1000
          bot.deactivateBlock(held < 1.0)
          this.guestPendingActions.push({ kind: 'block_up', slot, timestamp: Date.now(), holdTime: held })
        }
      }
    }
    this.lastGuestMove = sample.move
    this.lastGuestCtrl = { move: sample.move, jump: sample.jumpPressed, crouch: sample.crouchHeld }
    // Edge прыжка копим до отправки (хост применит уровнем — действие 'jump' без слота им игнорировалось)
    if (sample.jumpPressed) this.guestJumpPending = true
  }

  private sendInput(): void {
    const actions = this.guestPendingActions
    const jump = this.guestJumpPending
    this.guestPendingActions = []
    this.guestJumpPending = false
    // Транспорт лежит: инпуты устареют к реконнекту — сбрасываем, не копим буфер
    if (!this.net.connected) return
    const ci: ClientInput = {
      seq: this.inputSeq++,
      timestamp: Date.now(),
      actions,
      move: this.lastGuestMove,
      jump,
      crouch: this.lastGuestCtrl.crouch,
    }
    this.net.sendInput(ci)
  }

  private onHostState(hs: HostStateUpdate): void {
    for (const snap of hs.bots) {
      const bot = snap.id === this.bots[0].id ? this.bots[0] : snap.id === this.bots[1].id ? this.bots[1] : null
      if (!bot) continue
      if (bot === this.bots[1]) {
        // Удалённый бот: интерполяция позиции + снапшот-анимация (координаты округлены до 3 знаков)
        this.remoteTarget = { x: snap.x, y: snap.y, has: true }
        this.remoteSnap = snap
      } else {
        // Свой бот: реконсиляция при рассинхроне (мягкая коррекция)
        if (Math.abs(snap.x - bot.x) > 0.5 && !bot.dead) {
          bot.x += (snap.x - bot.x) * 0.5
        }
        if (snap.deathK !== undefined && snap.deathK > 0.5 && !bot.dead) {
          bot.dead = true
        }
      }
    }
    for (const ev of hs.events) this.applyRemoteEvent(ev)
    // Таймер и урон хоста — в состояние сцены; HUD пишет ТОЛЬКО троттлинг 4 Гц.
    // Прямая запись в HUD отсюда конфликтовала с локальным тиком HUD (где лежал
    // нескользящий локальный timeLeft) — цифры таймера у гостя постоянно прыгали.
    this.timeLeft = Math.max(0, hs.timeLeft)
    const dSelf = hs.damage[this.bots[0].id]
    const dFoe = hs.damage[this.bots[1].id]
    if (dSelf !== undefined) this.bots[0].totalDamage = dSelf
    if (dFoe !== undefined) this.bots[1].totalDamage = dFoe
  }

  private remoteTarget: { x: number; y: number; has: boolean } = { x: 3.2, y: 0, has: false }
  private remoteSnap: BotSnapshot | null = null
  private remoteLerpX = 3.2
  private remoteLerpY = 0

  /** Детерминированное применение событий урона/отсечения на госте (§5.4) */
  private applyRemoteEvent(ev: NetGameEvent): void {
    if (ev.type === 'damage') {
      const d = ev.data
      const bot = d.targetBotId === this.bots[0].id ? this.bots[0] : d.targetBotId === this.bots[1].id ? this.bots[1] : null
      if (!bot) return
      const voxel = bot.grid.get(d.voxelId)
      if (!voxel || voxel.destroyed) return
      const res = bot.grid.applyDamage(voxel, d.damage)
      bot.grid.blacken[voxel.id] = Math.min(0.7, bot.grid.blacken[voxel.id] + 0.38)
      const dealer = bot === this.bots[0] ? this.bots[1] : this.bots[0]
      dealer.totalDamage += d.damage
      const wp = bot.grid.worldPositionOf(voxel)
      const isComp = voxel.type === 'camera' || voxel.type === 'motherboard' || voxel.type === 'gyroscope' || voxel.type === 'battery'
      if (isComp) this.fx.hitComponent(wp, COMPONENT_COLORS[voxel.type] ?? 0xffffff, res.componentJustDestroyed)
      else if (voxel.type === 'armor') this.fx.hitArmor(wp)
      else this.fx.hitSkeleton(wp)
      audioManager.play(voxel.type === 'armor' ? 'armor' : voxel.isSkeleton ? 'skeleton' : voxel.type)
      for (const id of d.destroyedVoxelIds) {
        const cv = bot.grid.get(id)
        if (cv && !cv.destroyed) {
          cv.destroyed = true
          const cwp = bot.grid.worldPositionOf(cv)
          this.debris.spawnSingle(cwp, Math.max(0.1, bot.grid.worldScale[id] || cv.size), cv.color, { x: (Math.random() - 0.5) * 2, y: 2, z: (Math.random() - 0.5) * 2 })
        }
      }
      if (res.componentJustDamaged) {
        this.fx.notify(COMPONENT_NOTIFY[voxel.type] ?? '', wp.x, wp.y + 0.8, wp.z)
        DebuffManager.update(bot)
      }
      if (res.componentJustDestroyed) {
        this.fx.notify(COMPONENT_DESTROYED_NOTIFY[voxel.type] ?? '', wp.x, wp.y + 0.8, wp.z)
        audioManager.play('destroy')
        const comp = res.component
        if (comp) {
          const items: Array<{ dx: number; dy: number; dz: number; angle: number; size: number; color: number }> = []
          let cx = 0, cy = 0, cz = 0, n = 0
          for (const id of comp.voxelIds) {
            const cv = bot.grid.get(id)
            if (!cv) continue
            const cwp = bot.grid.worldPositionOf(cv)
            cx += cwp.x; cy += cwp.y; cz += cwp.z; n++
            items.push({ dx: 0, dy: 0, dz: 0, angle: 0, size: Math.max(0.08, bot.grid.worldScale[id] || cv.size), color: cv.color })
          }
          if (n > 0 && items.length === n) {
            cx /= n; cy /= n; cz /= n
            for (let i = 0; i < comp.voxelIds.length; i++) {
              const cv = bot.grid.get(comp.voxelIds[i])
              if (!cv) continue
              const cwp = bot.grid.worldPositionOf(cv)
              items[i].dx = cwp.x - cx
              items[i].dy = cwp.y - cy
              items[i].dz = cwp.z - cz
            }
            this.debris.spawnCluster(
              { x: cx, y: cy, z: cz }, 0, items,
              { x: dealer.facing * 2.0, y: 2.4, z: 0 },
              { x: (Math.random() - 0.5) * 6, y: (Math.random() - 0.5) * 6, z: (Math.random() - 0.5) * 6 },
            )
          }
        }
        DebuffManager.update(bot)
      }
    } else if (ev.type === 'limb') {
      const d = ev.data
      const bot = this.bots.find(b => b.grid.get(d.destroyedCubeId))
      if (!bot) return
      const ids = d.detachedCubeIds?.length ? d.detachedCubeIds : bot.graph.subtree(d.destroyedCubeId)
      const items: Array<{ dx: number; dy: number; dz: number; angle: number; size: number; color: number }> = []
      let cx = 0, cy = 0, cz = 0, n = 0
      for (const id of ids) {
        const v = bot.grid.get(id)
        if (!v || v.destroyed || id === d.destroyedCubeId) continue
        const wp = bot.grid.worldPositionOf(v)
        cx += wp.x; cy += wp.y; cz += wp.z; n++
      }
      if (n === 0) return
      cx /= n; cy /= n; cz /= n
      const COMPONENT_TYPES = new Set(['camera', 'motherboard', 'gyroscope', 'battery'])
      for (const id of ids) {
        const v = bot.grid.get(id)
        if (!v || v.destroyed || id === d.destroyedCubeId) continue
        const wp = bot.grid.worldPositionOf(v)
        v.destroyed = true
        // Отсечённый компонент = уничтожен (UPD-01)
        if (COMPONENT_TYPES.has(v.type)) {
          const comp = bot.grid.components.find(c => c.voxelIds.includes(v.id))
          if (comp && comp.health !== 'destroyed') {
            comp.hp = 0
            comp.health = 'destroyed'
          }
        }
        items.push({ dx: wp.x - cx, dy: wp.y - cy, dz: wp.z - cz, angle: 0, size: Math.max(0.08, bot.grid.worldScale[id] || v.size), color: v.color })
      }
      if (items.length > 0) {
        this.debris.spawnCluster(
          { x: cx, y: cy, z: cz }, 0, items,
          { x: d.impulse.x, y: Math.abs(d.impulse.y) + 1.6, z: 0 },
          { x: (Math.random() - 0.5) * 7, y: (Math.random() - 0.5) * 7, z: (Math.random() - 0.5) * 7 }
        )
      }
      audioManager.play('destroy')
      DebuffManager.update(bot)
    } else if (ev.type === 'respawn') {
      // Хост подтверждает респаун после падения с крыши (или респаунит удалённого бота):
      // снимаем обшивку и ставим бота в центр (идемпотентно с предсказанием гостя)
      const bot = this.bots.find(b => b.id === ev.data.botId)
      if (!bot) return
      bot.respawnAfterFall()
      bot.grid.stripArmor()
      const other = bot === this.bots[0] ? this.bots[1] : this.bots[0]
      bot.facing = other.x >= 0 ? 1 : -1
    } else if (ev.type === 'end') {
      this.onRemoteMatchEnd(ev.data)
    }
  }

  private onRemoteMatchEnd(me: MatchEndData): void {
    if (this.endedShown) return
    this.showResult(me)
  }

  private onPeerDisconnected(role: 'host' | 'guest'): void {
    const store = useGameStore.getState()
    if (role === 'host' && this.mode === 'pvp-guest') {
      // Дисконнект хоста → матч немедленно отменён, победитель не определяется (§5.5)
      store.pushToast('Матч отменён: хост отключился', 'error')
      this.finishMatch({ reason: 'host_left', winnerId: null })
    } else if (role === 'guest' && this.mode === 'pvp-host') {
      // Дисконнект гостя → ожидание реконнекта (§5.5, окно NET.reconnectS)
      store.pushToast(`Потеряно соединение… ожидание ${NET.reconnectS} с`, 'error')
      this.graceT = NET.reconnectS
      // Гость на паузе: не держим устаревшие уровни управления
      this.guestLevel = { move: 'none', jump: false, crouch: false }
      this.guestJumpEdge = false
    }
  }

  // ================= Падение с крыши: респаун в центре без обшивки =================

  /** Боты ниже крыши (перелетели канатный забор) → респаун. Хост обрабатывает
   *  обоих и рассылает событие respawn; гость предсказывает только своего. */
  private checkFellOff(ownOnly: boolean): void {
    for (let i = 0; i < 2; i++) {
      if (ownOnly && i !== 0) continue
      const bot = this.bots[i]
      if (bot.dead || bot.y > ARENA.fallResetY) continue
      this.respawnFellBot(bot, !ownOnly)
    }
  }

  /** Респаун упавшего: центр арены, БЕЗ обшивки; hp кубов скелета/компонентов
   *  остаётся как на момент падения (grid не сбрасывается, снимается только
   *  обшивка). emit — рассылать событие respawn (хост). */
  private respawnFellBot(bot: BotEntity, emit: boolean): void {
    bot.respawnAfterFall()
    bot.grid.stripArmor()
    const other = bot === this.bots[0] ? this.bots[1] : this.bots[0]
    bot.facing = other.x >= 0 ? 1 : -1
    // Обратная связь: пыль в точке возврата + надпись + тост
    this.fx.particles.spawnBurst(0, 1.4, 0, 12, 0x9aa3ad, 2.4, 1.0)
    this.fx.notify('БЕЗ ОБШИВКИ', 0, 5.7, 0)
    useGameStore.getState().pushToast(`«${bot.name}» упал с крыши — возврат в центр без обшивки`, 'info')
    if (emit) this.eventsOut.push({ type: 'respawn', data: { botId: bot.id } })
  }

  // ================= Реванш (UPD-12): голоса обоих → перезапуск =================

  setRematchReady(ready: boolean): void {
    const store = useGameStore.getState()
    store.setRematch({ me: ready })
    if (this.mode === 'pvp-host') {
      this.net.sendRematch({ playerId: this.bots[0].id, ready })
      if (ready && store.rematch.peer) this.hostRestart()
    } else if (this.mode === 'pvp-guest') {
      this.net.sendRematch({ playerId: this.bots[0].id, ready })
    } else {
      // PvE: сразу перезапуск
      if (ready) this.restartMatch()
    }
  }

  private hostRestart(): void {
    this.net.sendRestart()
    this.restartMatch()
  }

  /** Перезапуск матча (реванш): сброс состояния, те же пресеты, countdown 3с */
  private restartMatch(): void {
    // Полный пересбор бойцов (чистые гриды/состояния)
    this.renderers[0].dispose(this.threeScene)
    this.renderers[1].dispose(this.threeScene)
    this.fx.dispose()
    this.debris.dispose()
    this.threeScene.remove(this.eyeLights[0], this.eyeLights[1])
    this.buildCombatants()
    if (this.mode === 'pve') {
      const store = useGameStore.getState()
      this.ai = new AISystem(this.bots[1], this.bots[0], store.settings.aiDifficulty)
    }
    this.updateBattleHook()
    this.tick = 0
    this.timeLeft = MATCH.duration
    this.countdown = MATCH.countdown
    this.ended = false
    this.endedShown = false
    this.endPendingT = -1
    this.pendingEnd = null
    this.eventsOut = []
    this.graceT = -1
    this.heartbeatT = 0
    this.beatAge = 0
    this.beatStarted = false
    this.guestLevel = { move: 'none', jump: false, crouch: false }
    this.guestJumpEdge = false
    this.guestActions = []
    this.victory = null
    this.victorySelfWon = null
    this.prevRelX = this.bots[1].x - this.bots[0].x
    const store = useGameStore.getState()
    store.setBattleResult(null)
    store.setRematch({ me: false, peer: false })
    store.setHud({ timeLeft: MATCH.duration, damageMe: 0, damageFoe: 0, countdown: Math.ceil(this.countdown) })
    store.pushToast('Реванш! Приготовьтесь…', 'success')
  }

  // ================= Завершение матча =================

  private checkKnockout(defender: BotEntity): void {
    if (this.ended || this.pendingEnd) return
    const ko = defender.grid.components.find(c => (c.type === 'motherboard' || c.type === 'battery') && c.health === 'destroyed')
    if (!ko) return
    defender.dead = true
    const winner = defender === this.bots[0] ? this.bots[1].id : this.bots[0].id
    audioManager.play('destroy')
    this.pendingEnd = { reason: 'knockout', winnerId: winner }
    this.endPendingT = 1.6
  }

  private finishMatch(me: MatchEndData): void {
    if (this.ended) return
    this.ended = true
    // Суммарный урон обоих (§5.6: damage[])
    me.damage = this.bots.map(b => ({ playerId: b.id, total: Math.round(b.totalDamage) }))
    if (this.mode === 'pvp-host') {
      this.net.sendMatchEnd(me)
    }
    this.showResult(me)
  }

  private showResult(me: MatchEndData): void {
    if (this.endedShown) return
    this.endedShown = true
    const store = useGameStore.getState()
    const selfWon = me.winnerId === null ? null : me.winnerId === this.bots[0].id
    store.setBattleResult({ ...me, selfWon })
    if (selfWon === true) audioManager.play('victory')
    else if (selfWon === false) audioManager.play('defeat')
    // Экран победы: боты замирают на подиуме и крутятся для осмотра состояния
    this.startVictory(selfWon)
  }

  // ================= Экран победы =================

  /** Вход в экран победы: симуляция остановлена, дебафф-эффекты сняты,
   *  позиции — игрок слева, противник справа. Урон/разрушения сохранены. */
  private startVictory(selfWon: boolean | null): void {
    this.victory = { t: 0, spin: 0 }
    this.victorySelfWon = selfWon
    this.input.setInputDelay(false)
    for (const bot of this.bots) {
      bot.fx = { vignette: 0, glitch: 0, noise: 0, eyesDim: 0 }
      // Страховка: бот, падающий с крыши в момент конца матча, возвращается на ринг
      if (bot.y < 0) {
        bot.y = BOT_MOVE.groundY
        bot.airborne = false
        bot.vy = 0
      }
    }
  }

  /** Кадр экрана победы: боты стоят (плавно съезжаются на места), медленно крутятся
   *  вокруг своей оси на 360°, у победителя поднимается правая рука; камера —
   *  статичный план обоих ботов (плавный переезд от боевой камеры). */
  private victoryUpdate(dt: number): void {
    const v = this.victory
    if (!v) return
    v.t += dt
    v.spin += dt * ((Math.PI * 2) / VICTORY.revolutionS)
    const armK = clamp(v.t / VICTORY.armRaiseS, 0, 1)
    for (let i = 0; i < 2; i++) {
      const bot = this.bots[i]
      const targetX = i === 0 ? -VICTORY.standX : VICTORY.standX
      bot.x += (targetX - bot.x) * Math.min(1, dt * 3)
      const isWinner = this.victorySelfWon !== null && (i === 0 ? this.victorySelfWon === true : this.victorySelfWon === false)
      bot.updateVictory(dt, v.spin, isWinner ? armK : 0)
    }
    // Статичная камера: оба бота в кадре (запас по ширине под узкие экраны)
    const cam = this.ctx.engine.camera
    const tanV = Math.tan((cam.fov * Math.PI) / 360)
    const aspect = cam.aspect || 1
    const dist = Math.max(VICTORY.minDist, VICTORY.halfWidth / (tanV * aspect))
    const k = 1 - Math.pow(1 - ENVIRONMENT.camera.lerp, dt * 60)
    cam.position.x += (0 - cam.position.x) * k
    cam.position.y += (VICTORY.camY - cam.position.y) * k
    cam.position.z += (dist - cam.position.z) * k
    this.victoryLook.x += (0 - this.victoryLook.x) * k
    this.victoryLook.y += (VICTORY.lookY - this.victoryLook.y) * k
    this.victoryLook.z += (0 - this.victoryLook.z) * k
    cam.lookAt(this.victoryLook)
    cam.fov += (ENVIRONMENT.camera.fov - cam.fov) * k
    cam.updateProjectionMatrix()
  }

  // ================= Кадр =================

  update(dt: number, alpha: number): void {
    void alpha
    const now = performance.now() / 1000
    const store = useGameStore.getState()

    // Дебафф материнки (UPD-11): задержка 500 мс ТОЛЬКО действий A–D локального игрока.
    // Единственные допустимые паузы слотов — анимация удара и этот дебафф (UPD-13-DELAY).
    this.input.setInputDelay(
      this.bots[0].grid.components.find(c => c.type === 'motherboard')?.health === 'damaged',
    )

    // Экран победы: обычная симуляция остановлена, боты крутятся на подиуме
    if (this.victory) {
      this.victoryUpdate(dt)
    } else if (this.mode === 'pvp-guest') {
      if (this.countdown > 0) {
        // Локальный отсчёт гостя (старт синхронен по match:start)
        this.countdown -= dt
        if (this.countdown <= 0) {
          this.countdown = 0
          useGameStore.getState().setHud({ countdown: 0 })
        } else {
          useGameStore.getState().setHud({ countdown: Math.ceil(this.countdown) })
        }
      }
      this.applyLocalInputGuest(dt)
      const bot0 = this.bots[0]
      // Во время отсчёта хост держит бойцов замороженными — предсказание гостя
      // не должно убегать (иначе гость мог ходить/прыгать до старта боя)
      const selfCtrl: ControlInput = this.countdown > 0
        ? { move: 'none', jump: false, crouch: false }
        : this.lastGuestCtrl
      bot0.update(dt, selfCtrl, this.remoteTarget.has ? this.remoteTarget.x : this.bots[1].x, false)
      // Предсказание собственного падения с крыши (хост подтвердит событием respawn)
      this.checkFellOff(true)
      const bot1 = this.bots[1]
      // Плавная интерполяция позиции удалённого бота
      if (this.remoteTarget.has) {
        const k = Math.min(1, dt * 12)
        this.remoteLerpX += (this.remoteTarget.x - this.remoteLerpX) * k
        this.remoteLerpY += (this.remoteTarget.y - this.remoteLerpY) * k
      }
      const snap = this.remoteSnap
      if (snap) {
        bot1.updateRemote(dt, {
          x: this.remoteLerpX,
          y: this.remoteLerpY,
          facing: snap.facing,
          speed01: snap.speed01 ?? 0,
          phase: snap.walkPhase,
          crouch: snap.crouch,
          strikeSlot: snap.strikeSlot,
          strikeT: snap.strikeT,
          blockActive: snap.blockActive,
          stamina: snap.stamina,
          turnT: snap.turnT,
          knockdownK: snap.knockdownK,
          flipK: snap.flipK,
          flipDir: snap.flipDir,
          deathK: snap.deathK,
        })
        // Поза блока удалённого бота — конфиг из его слотов
        if (snap.blockActive) {
          const slotId = (['A', 'B', 'C', 'D'] as SlotId[]).find(s => isBlock(bot1.slots[s]))
          bot1.block.config = slotId ? (bot1.slots[slotId] as never) : null
          bot1.block.slot = slotId ?? null
        }
      } else {
        bot1.update(dt, { move: 'none', jump: false, crouch: false }, bot0.x, false)
      }
      // Коллизия своего бота с удалённым (раньше гость визуально проходил сквозь)
      this.separateGuest()
      this.inputAccum += dt
      if (this.inputAccum >= 1 / 30) {
        this.inputAccum = 0
        this.sendInput()
      }
      if (this.graceT > 0) {
        this.graceT -= dt
        if (this.graceT <= 0) {
          this.graceT = -1
          // Гость не вернулся за окно реконнекта → победа хоста (§5.5)
          this.finishMatch({ reason: 'guest_timeout', winnerId: this.bots[1].id })
        }
      }
      // Heartbeat гость → хост и контроль таймаута хоста (UPD-12).
      // Пока свой транспорт лежит — таймаут на паузе: иначе гость отменит матч
      // раньше, чем успеет переподключиться и вернуться в комнату
      this.heartbeatT += dt
      this.beatAge += dt
      if (this.heartbeatT >= 1 / NET.heartbeatHz) {
        this.heartbeatT = 0
        if (this.net.connected) {
          this.dbg.sent++
          this.net.sendHeartbeat(Date.now())
        }
      }
      if (this.beatStarted && this.beatAge > NET.timeoutS && this.net.connected && !this.ended) {
        store.pushToast('Матч отменён: хост отключился', 'error')
        this.finishMatch({ reason: 'host_left', winnerId: null })
      }
    } else {
      this.authoritativeUpdate(dt, now)
      if (this.mode === 'pvp-host') {
        // Снапшоты строго 30 Гц (UPD-12)
        this.netAccum += dt
        if (this.netAccum >= 1 / NET.snapshotHz) {
          this.netAccum = 0
          this.sendState()
        }
        this.heartbeatT += dt
        this.beatAge += dt
        if (this.heartbeatT >= 1 / NET.heartbeatHz) {
          this.heartbeatT = 0
          if (this.net.connected) {
            this.dbg.sent++
            this.net.sendHeartbeat(Date.now())
          }
        }
        if (this.beatStarted && this.beatAge > NET.timeoutS && this.graceT <= 0 && !this.ended && !this.pendingEnd) {
          store.pushToast(`Потеряно соединение… ожидание ${NET.reconnectS} с`, 'error')
          this.graceT = NET.reconnectS
        }
        if (this.graceT > 0) {
          this.graceT -= dt
          if (this.graceT <= 0) {
            this.graceT = -1
            this.finishMatch({ reason: 'guest_timeout', winnerId: this.bots[0].id })
          }
        }
      }
    }

    // Физика мусора (обломки/отсечения)
    this.debris.update(dt)

    // Рендеры/эффекты/свет глаз
    for (let i = 0; i < 2; i++) {
      const bot = this.bots[i]
      // Неоновые глаза: приглушение при дебаффе аккумулятора (fx.eyesDim), как и точечный свет
      this.renderers[i].update(bot.grid, 1 - bot.fx.eyesDim * 0.7)
      // Свет глаз: точка между живыми кубами-камерами (глазами), чуть впереди лица.
      // Раньше свет брался от углового куба обшивки головы — светил не из глаз.
      const eye = bot.grid.eyeCenterWorld()
      if (eye) {
        this.eyeLights[i].position.set(eye.x + bot.facing * 0.18, eye.y, eye.z)
        this.eyeLights[i].intensity = ENVIRONMENT.eyeLight.intensity * (1 - bot.fx.eyesDim * 0.7)
      } else {
        this.eyeLights[i].intensity = 0 // глаза уничтожены — света нет
      }
      // Полоска стамины — только при активном блоке (§3.5.8)
      this.fx.setStamina(i, bot.block.active, bot.block.stamina, bot.x, bot.topWorld(), bot.facing)
      // Искры из глаз при повреждённых камерах
      if (bot.grid.components.find(c => c.type === 'camera')?.health === 'damaged') {
        const spark = eye ?? bot.headWorld()
        this.eyeSparkT -= dt
        if (this.eyeSparkT <= 0) {
          this.eyeSparkT = 0.25 + Math.random() * 0.4
          this.fx.particles.spawnBurst(spark.x + bot.facing * 0.2, spark.y, spark.z, 2, 0x3fa9e2, 1.4, 0.6)
        }
      }
    }

    // Камера: следование, адаптивный зум и динамический ракурс 3/4
    // (игрок ближе к краю арены — камера сильнее поворачивается к его ракурсу);
    // на экране победы камера ставится статично в victoryUpdate
    const p0 = new THREE.Vector3(this.bots[0].x, this.bots[0].y + 3, 0)
    const p1 = new THREE.Vector3(this.bots[1].x, this.bots[1].y + 3, 0)
    if (!this.victory) this.camCtl.update(dt, p0, p1, this.bots[0].x)

    this.fx.update(dt)
    this.env.updateStorm(dt)
    // Гром: локальные раскаты по событиям грозы (и в PvE, и в PvP — у каждого клиента свои)
    this.tickThunder(dt)

    // Постэффекты от дебаффов локального игрока
    const me = this.bots[0]
    this.post.vignette = 0.14 + Math.max(me.fx.vignette, this.bots[1].fx.vignette * 0.25)
    this.post.glitch = 0 // глитч материнки — только на модели бота (UPD-11)
    this.post.noise = me.fx.noise

    // HUD (троттлинг 4 Гц)
    this.hudAccum += dt
    if (this.hudAccum >= 0.25) {
      this.hudAccum = 0
      store.setHud({
        timeLeft: Math.max(0, Math.ceil(this.timeLeft)),
        damageMe: Math.round(this.bots[0].totalDamage),
        damageFoe: Math.round(this.bots[1].totalDamage),
        ping: this.mode === 'pve' ? null : this.net.latency,
        fps: this.fpsRef?.() ?? 0,
        countdown: this.countdown > 0 ? Math.ceil(this.countdown) : 0,
      })
    }
  }

  private sendState(): void {
    // Транспорт лежит: события остаются в eventsOut и уйдут первым же снапшотом
    // после восстановления (не теряем бой/отсечения, не копим буфер инпутов)
    if (!this.net.connected) return
    const bots: BotSnapshot[] = this.bots.map(b => {
      let strikeSlot: SlotId | undefined
      if (b.activeStrike) {
        strikeSlot = (['A', 'B', 'C', 'D'] as SlotId[]).find(s => b.slots[s] === b.activeStrike?.data)
      }
      return {
        id: b.id,
        x: Math.round(b.x * 1000) / 1000,
        y: Math.round(b.y * 1000) / 1000,
        facing: b.facing,
        anim: b.activeStrike ? 'strike' : b.block.active ? 'block' : b.knockdown.active ? 'knockdown' : b.flip.active ? 'flip' : b.turn.active ? 'turn' : b.moveSpeed01 > 0.05 ? 'walk' : 'idle',
        strikeSlot,
        // Прогресс ПОЛНОГО цикла удара (кадры + возврат руки): при срезе попаданием
        // totalDur = hitT + 100 мс → гость видит короткий возврат и освобождение слотов
        strikeT: b.activeStrike && b.activeStrike.totalDur > 0
          ? Math.round(Math.min(1, b.activeStrike.elapsed / b.activeStrike.totalDur) * 1000) / 1000
          : undefined,
        blockActive: b.block.active,
        stamina: Math.round(b.block.stamina),
        crouch: b.crouchK > 0.5,
        walkPhase: Math.round(b.walkPhase * 1000) / 1000,
        deathK: Math.round(b.deathK * 1000) / 1000,
        speed01: Math.round(b.moveSpeed01 * 1000) / 1000,
        turnT: b.turn.active ? Math.round(b.animator.turnK * 1000) / 1000 : undefined,
        knockdownK: b.knockdown.active ? Math.round(b.animator.knockdownK * 1000) / 1000 : undefined,
        flipK: b.flip.active ? Math.round(b.animator.flipK * 1000) / 1000 : undefined,
        flipDir: b.flip.active ? b.flip.dir : undefined,
      }
    })
    const damage: Record<string, number> = {
      [this.bots[0].id]: Math.round(this.bots[0].totalDamage),
      [this.bots[1].id]: Math.round(this.bots[1].totalDamage),
    }
    const hs: HostStateUpdate = {
      tick: this.tick++,
      bots,
      events: this.eventsOut,
      timeLeft: Math.max(0, Math.round(this.timeLeft * 1000) / 1000),
      damage,
    }
    this.eventsOut = []
    this.net.sendState(hs)
  }

  dispose(): void {
    this.renderers[0].dispose(this.threeScene)
    this.renderers[1].dispose(this.threeScene)
    this.fx.dispose()
    this.debris.dispose()
    this.env.dispose()
    this.threeScene.remove(this.eyeLights[0], this.eyeLights[1])
    this.input.setInputDelay(false)
    if (this.mode !== 'pve') {
      this.net.leave()
    }
  }
}
