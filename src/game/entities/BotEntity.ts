// BotEntity — сущность бойца (TZ-UPDATE §3.2–3.6, UPD-01/05/06/07/08):
// удары без силы (кадры); пауза между действиями = ТОЛЬКО время анимации удара
// (фаза возврата руки ACTION_GAP) и дебаффы (задержка материнки — в InputManager);
// блок с рукой/баффом, нокдаун, кувырок в прыжке, автотурн, стамина.
import type { BotData, Vec3 } from '../shared/types/bot.types'
import type { SlotsConfig, SlotId, StrikeData, BlockData, StrikeRuntime } from '../shared/types/strike.types'
import { isStrike, isBlock, strikeDamage } from '../shared/types/strike.types'
import { VoxelGrid } from './VoxelGrid'
import { LimbGraph } from './LimbGraph'
import { BotAnimator } from './BotAnimator'
import { BOT_MOVE, STRIKE, STAMINA, KNOCKDOWN, AIRFLIP, TURN, ARENA } from '../shared/constants/physics'
import { DEBUFFS } from '../shared/constants/debuffs'
import { clamp } from '../shared/utils/math'

export interface BlockRuntimeState {
  slot: SlotId | null
  config: BlockData | null
  active: boolean
  stamina: number
  holdT: number
  secondAccum: number
  regenAccum: number
  /** 0..1 прогресс принятия позы (BLOCK_POSE_S) */
  blend: number
}

export interface ControlInput {
  move: 'left' | 'right' | 'none'
  jump: boolean
  crouch: boolean
}

export interface BotFxState {
  vignette: number
  glitch: number
  noise: number
  eyesDim: number
}

interface TurnState {
  active: boolean
  t: number
  duration: number
}

interface KnockdownState {
  active: boolean
  t: number
}

interface FlipState {
  active: boolean
  t: number
  dur: number
  dir: -1 | 1
  /** Использован кувырок в текущем прыжке */
  used: boolean
}

export class BotEntity {
  id: string
  name: string
  slots: SlotsConfig
  data: BotData
  grid: VoxelGrid
  graph: LimbGraph
  animator: BotAnimator

  // Физическое состояние
  x = 0
  y = 0
  vx = 0
  vy = 0
  facing: 1 | -1 = 1
  airborne = false
  walkPhase = 0
  crouchK = 0
  moveSpeed01 = 0

  // Боевое состояние
  activeStrike: StrikeRuntime | null = null
  block: BlockRuntimeState = {
    slot: null, config: null, active: false,
    stamina: STAMINA.max, holdT: 0, secondAccum: 0, regenAccum: 0, blend: 0,
  }
  /** Автотурн (UPD-06): разворот при смене сторон теперь МГНОВЕННЫЙ (анимация
   *  поворота убрана) — состояние оставлено только для сетевой совместимости
   *  (updateRemote/snapshot), локально никогда не активируется */
  turn: TurnState = { active: false, t: 0, duration: TURN.base }
  /** Нокдаун (UPD-07) */
  knockdown: KnockdownState = { active: false, t: 0 }
  /** Кувырок (UPD-05) */
  flip: FlipState = { active: false, t: 0, dur: 0, dir: 1, used: false }
  /** Окно кувырка после старта прыжка */
  airT = 0
  wobble = 0
  deathK = 0
  dead = false
  totalDamage = 0

  // Дебаффы (обновляет DebuffManager)
  speedMult = 1
  forceMult = 1
  legFactor = 1
  fx: BotFxState = { vignette: 0, glitch: 0, noise: 0, eyesDim: 0 }

  /** Импульс прыжка (кг·м/с): при полной массе даёт BOT_MOVE.jumpVelocity.
   *  Масса = число живых кубов (1 куб = 1 кг) → повреждённый бот прыгает выше. */
  private jumpImpulse: number

  /** Удалённое управление анимацией (PvP-гость для бота хоста) */
  remoteAnim: { speed01: number; phase: number } | null = null

  constructor(id: string, name: string, data: BotData, slots: SlotsConfig) {
    this.id = id
    this.name = name
    this.data = data
    this.slots = slots
    this.grid = new VoxelGrid(data.voxels, data.components)
    this.graph = new LimbGraph(data.voxels.map(v => v.parent))
    this.animator = new BotAnimator(data, {
      worldPos: this.grid.worldPos,
      worldAngle: this.grid.worldAngle,
      worldScale: this.grid.worldScale,
      worldQuat: this.grid.worldQuat,
    })
    this.animator.breath = true
    this.jumpImpulse = BOT_MOVE.jumpVelocity * Math.max(1, data.voxels.length)
  }

  /** Масса бота, кг: 1 живой куб = 1 кг (BOT_MOVE.kgPerCube) */
  get mass(): number {
    return Math.max(1, this.grid.aliveCount())
  }

  /** Управление заблокировано (нокдаун/турн/кувырок) */
  get controlLocked(): boolean {
    return this.dead || this.knockdown.active || this.turn.active || this.flip.active
  }

  /** Центр корпуса в мире */
  centerWorld(): Vec3 {
    return this.grid.centerWorld()
  }

  headWorld(): Vec3 {
    return this.grid.headWorld()
  }

  /** Высота глаз для полоски стамины */
  topWorld(): number {
    return this.y + this.data.height * (1 - Math.max(this.deathK, this.knockdownPhase) * 0.35) + 0.4
  }

  /** Вертикальный коллизионный диапазон бота (для расталкивания в BattleScene).
   *  null — мёртвый бот препятствия не создаёт. Позы учитываются:
   *  кувырок — группировка в компактный «шар» (проход НАД противником),
   *  нокдаун — лежит (низкий), присед — рост ниже, обычный прыжок — ноги подобраны.
   *  Механика массы (1 куб = 1 кг) не затрагивается. */
  collisionSpan(): { bottom: number; top: number } | null {
    if (this.dead) return null
    if (this.flip.active) {
      // Группировка сальто: тело свёрнуто вокруг центра вращения (FLIP_CY≈2.2)
      const tuck = Math.min(1, this.animator.flipK * 4)
      return {
        bottom: this.y + 0.55 + 0.95 * tuck, // 0.55 → 1.5 над землёй
        top: this.y + 4.9 - 2.0 * tuck,      // 4.9 → 2.9 (компактный шар)
      }
    }
    if (this.knockdown.active) return { bottom: this.y, top: this.y + 1.2 }
    const crouchTop = 1 - 0.3 * this.crouchK
    return {
      bottom: this.y + (this.airborne ? 0.55 : 0),
      top: this.y + 4.9 * crouchTop,
    }
  }

  /** 0..1 прогресс нокдауна (для стамины/анимации) */
  get knockdownPhase(): number {
    if (!this.knockdown.active) return 0
    return clamp(this.knockdown.t / KNOCKDOWN.s, 0, 1)
  }

  /** Есть ли хотя бы одна нога */
  get hasAnyLeg(): boolean {
    return this.grid.hasLeg('left') || this.grid.hasLeg('right')
  }

  /** Автотурн (UPD-06): смена сторон — разворот МГНОВЕННЫЙ (анимация поворота
   *  убрана): facing меняется сразу, оба бота моментально стоят лицом друг к
   *  другу, управление не блокируется. Удар/блок прерываются, как и раньше. */
  startTurn(): void {
    if (this.dead) return
    this.facing = (this.facing === 1 ? -1 : 1) as 1 | -1
    this.activeStrike = null
    this.deactivateBlock(false)
  }

  /** Стартовать нокдаун (отсечённая нога + попадание по компоненту) */
  startKnockdown(): void {
    if (this.dead || this.knockdown.active) return
    this.knockdown = { active: true, t: 0 }
    this.activeStrike = null
    this.deactivateBlock(false)
    this.flip.active = false
  }

  /** Стартовать кувырок в направлении dir (окно 0.25с после прыжка, один за прыжок).
   *  Баллистика (гравитация + масса): вертикальная скорость выводит на апекс AIRFLIP.apex,
   *  горизонтальная — доводит до AIRFLIP.dist; приземление — чистая интеграция гравитации. */
  startFlip(dir: -1 | 1): boolean {
    if (this.dead || !this.airborne || this.flip.used || this.flip.active) return false
    if (this.airT > AIRFLIP.window) return false
    const g = Math.abs(BOT_MOVE.gravity)
    // Вертикально: из текущей высоты — ровно до апекса 4.5 (TZ-UPDATE §8)
    const vyUp = Math.sqrt(2 * g * Math.max(0, AIRFLIP.apex - this.y))
    const peakY = this.y + (vyUp * vyUp) / (2 * g)
    // Полное время полёта: подъём + падение с пика до земли
    const T = vyUp / g + Math.sqrt(2 * Math.max(peakY, 0.2) / g)
    // Горизонтально: приземлиться на dist дальше (клэмп по границам арены)
    const endX = clamp(this.x + AIRFLIP.dist * dir, -BOT_MOVE.boundX, BOT_MOVE.boundX)
    this.flip = { active: true, t: 0, dur: Math.max(0.2, T), dir, used: true }
    this.vy = vyUp
    this.vx = (endX - this.x) / Math.max(0.05, T)
    this.activeStrike = null
    this.deactivateBlock(false)
    return true
  }

  tryStrike(slot: SlotId): boolean {
    if (this.controlLocked) return false
    const cfg = this.slots[slot]
    if (!cfg || !isStrike(cfg)) return false
    if (this.activeStrike) return false // анимация удара ещё играет (вкл. возврат руки)
    if (this.block.active) return false // удары любыми слотами запрещены при удержании блока
    const sd = cfg as StrikeData
    // Удар культёй разрешён (UPD-08); «обе» требует хотя бы одну руку
    if (sd.hand === 'both' && !this.grid.hasArm('left') && !this.grid.hasArm('right')) return false
    const dmgBase = strikeDamage(sd) * this.forceMult
    this.activeStrike = {
      slot,
      data: sd,
      elapsed: 0,
      strikeDur: sd.speed,
      totalDur: sd.speed + STRIKE.actionGapMs / 1000,
      damage: dmgBase,
      hitDone: { left: false, right: false },
      stopPoint: { left: null, right: null },
      stump: { left: !this.grid.hasArm('left'), right: !this.grid.hasArm('right') },
    }
    this.deactivateBlock(false)
    return true
  }

  activateBlock(slot: SlotId): boolean {
    if (this.controlLocked) return false
    if (this.airborne) return false // блок в воздухе ЗАПРЕЩЁН
    const cfg = this.slots[slot]
    if (!cfg || !isBlock(cfg)) return false
    const b = this.block
    if (b.active || b.stamina <= 0) return false
    if (this.activeStrike) return false // анимация удара ещё играет (вкл. возврат руки)
    b.slot = slot
    b.config = cfg as BlockData
    b.active = true
    b.holdT = 0
    b.secondAccum = 0
    return true
  }

  /** Отпустить блок; tap=true если удержание < 1 сек (−10 сразу). Без stagger/кулдауна. */
  deactivateBlock(tap: boolean): void {
    const b = this.block
    if (!b.active) {
      b.slot = null
      b.config = null
      return
    }
    if (tap) b.stamina = Math.max(0, b.stamina - STAMINA.tapCost)
    b.active = false
    b.slot = null
    b.config = null
  }

  updateBlockSystem(dt: number): void {
    const b = this.block
    // Плавное принятие позы (BLOCK_POSE_S=0.5с)
    const target = b.active ? 1 : 0
    const rate = dt / STAMINA.blockPoseSec
    b.blend += (target - b.blend) * Math.min(1, rate * 2.2)
    if (b.blend < 0.005) b.blend = target
    if (b.active) {
      b.holdT += dt
      b.secondAccum += dt
      // Удержание: −10 за полную секунду
      while (b.secondAccum >= 1.0) {
        b.secondAccum -= 1.0
        b.stamina = Math.max(0, b.stamina - STAMINA.holdCostPerSec)
        if (b.stamina <= 0) {
          // 0 → принудительное прерывание БЕЗ stagger/кулдауна
          b.active = false
          b.slot = null
          b.config = null
          break
        }
      }
    } else {
      // Реген +2 за 2 с вне блока
      b.regenAccum += dt
      while (b.regenAccum >= STAMINA.regenEverySec) {
        b.regenAccum -= STAMINA.regenEverySec
        b.stamina = Math.min(STAMINA.max, b.stamina + STAMINA.regenAmount)
      }
    }
  }

  updateStrike(dt: number): void {
    const st = this.activeStrike
    if (!st) return
    st.elapsed += dt
    // Анимация закончилась (вкл. возврат руки) → слоты A–D доступны немедленно
    if (st.elapsed >= st.totalDur) {
      this.activeStrike = null
    }
  }

  /** Кулак стороны участвует в ударе и ещё не нанёс урон */
  fistActive(side: 'left' | 'right'): boolean {
    const st = this.activeStrike
    if (!st) return false
    if (st.elapsed >= st.strikeDur) return false // путь кадров закончился
    if (st.data.hand === 'both') return !st.hitDone[side]
    const want = st.data.hand === 'left' ? 'left' : 'right'
    return want === side && !st.hitDone[side]
  }

  /** Мировой центр хитбокса кулака стороны (фактическая поза / культя) */
  fistCenter(side: 'left' | 'right'): Vec3 | null {
    const st = this.activeStrike
    if (!st) return null
    const stump = st.stump[side]
    const hand = side === 'right' ? this.animator.handWorld.right : this.animator.handWorld.left
    if (!stump) return { ...hand }
    // Культя: хитбокс = куб скелета у края остатка (аниматор ставит handWorld у края)
    return { ...hand }
  }

  applyKnockback(dirX: number, power: number): void {
    if (this.dead) return
    this.vx += dirX * power
  }

  /** Мировая точка → локальные координаты бота (позиция + зеркалирование фасинга).
   *  Нужна для точек удара: локальная цель не «уезжает» при движении/развороте. */
  worldToLocalPoint(p: Vec3): Vec3 {
    const dx = p.x - this.x
    const dy = p.y - this.y
    return {
      x: this.facing * dx,
      y: dy,
      z: this.facing === 1 ? p.z : -p.z,
    }
  }

  /** Гравитация/посадка — вызывается в состояниях, где обычный апдейт пропускается
   *  (смерть/турн/нокдаун), иначе бот зависает в воздухе после прыжка.
   *  РИНГ = КРЫША: посадка возможна только НАД зданием (|x| ≤ roofHalfX);
   *  перелетевший канатный забор бот падает вниз за край. */
  private applyAirPhysics(dt: number): void {
    if (!this.airborne) {
      // Инвариант: на земле y строго 0 (страховка от «ходьбы по воздуху»)
      if (this.y !== BOT_MOVE.groundY && this.onRoof(this.x)) {
        this.y = BOT_MOVE.groundY
        this.vy = 0
      }
      return
    }
    this.vy += BOT_MOVE.gravity * dt
    this.y += this.vy * dt
    // Посадка — только над крышей; за краем (|x| > roofHalfX) — падение продолжается
    if (this.y <= BOT_MOVE.groundY && this.onRoof(this.x)) {
      this.y = BOT_MOVE.groundY
      this.vy = 0
      this.airborne = false
    }
  }

  /** Есть ли земля под ботом (ринг — крыша здания, земля только над фасадом) */
  private onRoof(x: number): boolean {
    return Math.abs(x) <= ARENA.roofHalfX
  }

  /** Клэмп X: на земле действует канатный забор (boundX), в воздухе клэмп шире
   *  (airBoundX) — прыжок/кувырок/отброс могут перелететь тросы и упасть за край. */
  private clampX(): void {
    const lim = this.airborne ? ARENA.airBoundX : BOT_MOVE.boundX
    this.x = clamp(this.x, -lim, lim)
  }

  update(dt: number, ctrl: ControlInput, faceTargetX: number, isMenuBreath: boolean): void {
    // Смерть: анимация падения
    if (this.dead) {
      this.deathK = Math.min(1, this.deathK + dt / 0.9)
      this.vx *= Math.max(0, 1 - dt * 6)
      this.x += this.vx * dt
      this.clampX()
      // Сбитый в воздухе бот падает, а не зависает
      this.applyAirPhysics(dt)
      this.animator.deathK = this.deathK
      this.animator.strikePose = null
      this.animator.blockPose = null
      this.animator.knockdownK = 0
      this.animator.turnK = 0
      this.animator.flipK = 0
      this.animator.facing = this.facing
      this.animator.botX = this.x
      this.animator.botY = this.y
      this.animator.update(dt, (v) => this.grid.skeletonScale(v))
      return
    }

    this.updateBlockSystem(dt)
    this.updateStrike(dt)

    // Автотурн (UPD-06): разворот теперь мгновенный (см. startTurn) — ветка
    // локально не активируется, оставлена для совместимости удалённой анимации
    if (this.turn.active) {
      this.turn.t += dt
      const k = clamp(this.turn.t / this.turn.duration, 0, 1)
      this.animator.turnK = k
      this.animator.knockdownK = 0
      this.animator.flipK = 0
      this.animator.strikePose = null
      this.animator.blockPose = null
      if (k >= 1) {
        // Разворот завершён: локальные координаты повернулись на 180° —
        // меняем facing и сбрасываем поворот (позы совпадают непрерывно)
        this.facing = (this.facing === 1 ? -1 : 1) as 1 | -1
        this.turn.active = false
        this.animator.turnK = 0
      }
      // Турн в воздухе (смену сторон ловили в прыжке) — падаем, не зависаем
      this.applyAirPhysics(dt)
      this.animator.facing = this.facing
      this.animator.botX = this.x
      this.animator.botY = this.y
      this.animator.hasArmLeft = this.grid.hasArm('left')
      this.animator.hasArmRight = this.grid.hasArm('right')
      this.animator.update(dt, (v) => this.grid.skeletonScale(v))
      return
    }
    this.animator.turnK = 0

    // Нокдаун (UPD-07): падение 1.5с → подъём 0.4с; управление недоступно
    if (this.knockdown.active) {
      this.knockdown.t += dt
      const total = KNOCKDOWN.s + KNOCKDOWN.recover
      const t = this.knockdown.t
      // Кривая: падение (0..fall) 0→1, лежание 1, подъём (последние recover) 1→0
      let k: number
      if (t < KNOCKDOWN.fall) k = t / KNOCKDOWN.fall
      else if (t < KNOCKDOWN.s) k = 1
      else k = Math.max(0, 1 - (t - KNOCKDOWN.s) / KNOCKDOWN.recover)
      this.animator.knockdownK = k
      this.animator.flipK = 0
      this.animator.strikePose = null
      this.animator.blockPose = null
      if (t >= total) {
        this.knockdown.active = false
        this.animator.knockdownK = 0
      }
      this.vx *= Math.max(0, 1 - dt * 6)
      this.x += this.vx * dt
      this.clampX()
      // Нокдаун в воздухе — падаем на землю, не зависаем
      this.applyAirPhysics(dt)
      this.animator.facing = this.facing
      this.animator.botX = this.x
      this.animator.botY = this.y
      this.animator.hasArmLeft = this.grid.hasArm('left')
      this.animator.hasArmRight = this.grid.hasArm('right')
      this.animator.update(dt, (v) => this.grid.skeletonScale(v))
      return
    }
    this.animator.knockdownK = 0

    // Кувырок (UPD-05): чистая баллистика (гравитация + горизонтальная скорость),
    // всё управление заблокировано, коллизия включена
    if (this.flip.active) {
      this.flip.t += dt
      const p = clamp(this.flip.t / this.flip.dur, 0, 1)
      this.animator.flipK = p
      this.animator.flipDir = this.flip.dir
      this.animator.strikePose = null
      this.animator.blockPose = null
      // Полёт: гравитация интегрирует y, горизонтальная скорость ведёт x
      this.applyAirPhysics(dt)
      this.x += this.vx * dt
      this.clampX()
      if (!this.airborne || p >= 1) {
        // Приземление (или ротация завершена) — кувырок закончен
        this.flip.active = false
        this.animator.flipK = 0
        if (!this.airborne) {
          this.y = BOT_MOVE.groundY
          this.vy = 0
        }
      }
      this.animator.facing = this.facing
      this.animator.botX = this.x
      this.animator.botY = this.y
      this.animator.hasArmLeft = this.grid.hasArm('left')
      this.animator.hasArmRight = this.grid.hasArm('right')
      this.animator.update(dt, (v) => this.grid.skeletonScale(v))
      return
    }
    this.animator.flipK = 0

    // Направление — всегда к противнику (турн обрабатывает смену сторон извне)
    const dx = faceTargetX - this.x
    if (Math.abs(dx) > 0.08) this.facing = dx > 0 ? 1 : -1

    // Движение
    let moveDir = 0
    if (ctrl.move === 'left') moveDir = -1
    else if (ctrl.move === 'right') moveDir = 1
    const hasLegs = this.grid.hasLeg('left') && this.grid.hasLeg('right')
    const oneLeg = !hasLegs && this.hasAnyLeg
    this.legFactor = hasLegs ? 1 : oneLeg ? DEBUFFS.nolegMult : 0
    const canWalk = this.legFactor > 0 && !this.activeStrike
    let speed = BOT_MOVE.walkSpeed * this.speedMult * this.legFactor
    if (ctrl.crouch) speed *= BOT_MOVE.crouchSpeed / BOT_MOVE.walkSpeed
    if (this.block.active) speed *= BOT_MOVE.blockWalkMult // удержание блока: ×0.5
    if (!canWalk) speed = 0
    const moving = moveDir !== 0 && canWalk && !this.airborne
    if (moving) {
      this.x += moveDir * speed * dt
      this.walkPhase += dt * Math.PI * 2 * BOT_MOVE.walkSpeed / 1.7 * (speed / BOT_MOVE.walkSpeed) * 1.15
    } else if (this.airborne && moveDir !== 0 && canWalk) {
      // Управление в воздухе (ослабленный руль): можно перелететь канатный забор
      this.x += moveDir * speed * BOT_MOVE.airControl * dt
    } else {
      this.walkPhase += dt * 1.5
    }
    this.moveSpeed01 = moving ? speed / BOT_MOVE.walkSpeed : 0

    // Инерция отбрасывания
    if (Math.abs(this.vx) > 0.001) {
      this.x += this.vx * dt
      this.vx *= Math.max(0, 1 - dt * STRIKE.knockbackDecay)
    }
    this.clampX()

    // Прыжок (импульс/масса: 1 куб = 1 кг; у целого бота vy = JUMP_FORCE=8.0)
    if (ctrl.jump && !this.airborne && hasLegs) {
      this.vy = Math.min(this.jumpImpulse / this.mass, BOT_MOVE.jumpVelMax)
      this.airborne = true
      this.airT = 0
      this.flip.used = false
    }

    // Кувырок: ←/→ в окне 0.25с после старта прыжка (UPD-05)
    if (this.airborne) {
      this.airT += dt
      if (!this.flip.used && this.airT <= AIRFLIP.window && moveDir !== 0) {
        this.startFlip(moveDir > 0 ? 1 : -1)
      }
    }

    this.applyAirPhysics(dt)

    // Присед (плавно)
    const targetCrouch = ctrl.crouch && !this.airborne ? 1 : 0
    this.crouchK += (targetCrouch - this.crouchK) * Math.min(1, dt * 10)

    // Шатание затухает (импульсная часть)
    this.wobble = Math.max(0, this.wobble - dt * 0.25)

    // Удалённая анимация (бот хоста на госте)
    if (this.remoteAnim) {
      this.moveSpeed01 = this.remoteAnim.speed01
      this.walkPhase = this.remoteAnim.phase
      this.remoteAnim = null
    }

    // Аниматор
    const an = this.animator
    an.facing = this.facing
    an.botX = this.x
    an.botY = this.y
    an.walkAmp = this.moveSpeed01
    an.walkPhase = this.walkPhase
    an.crouchK = this.crouchK
    an.airborne = this.airborne
    an.wobble = this.wobble
    an.breath = isMenuBreath
    an.strikePose = this.activeStrike
      ? {
          data: this.activeStrike.data,
          elapsed: this.activeStrike.elapsed,
          strikeDur: this.activeStrike.strikeDur,
          totalDur: this.activeStrike.totalDur,
          stopPoint: this.activeStrike.stopPoint,
          stump: this.activeStrike.stump,
        }
      : null
    an.blockPose = this.block.active && this.block.config
      ? { data: this.block.config, blend: this.block.blend }
      : null
    an.hasArmLeft = this.grid.hasArm('left')
    an.hasArmRight = this.grid.hasArm('right')
    an.update(dt, (v) => this.grid.skeletonScale(v))
  }

  /** Анимация удалённого бота из снапшота хоста (PvP-гость) */
  updateRemote(
    dt: number,
    p: {
      x: number; y: number; facing: 1 | -1
      speed01: number; phase: number; crouch: boolean
      strikeT?: number; strikeSlot?: SlotId
      blockActive: boolean; stamina: number
      turnT?: number; knockdownK?: number; flipK?: number; flipDir?: -1 | 1
      deathK?: number
    },
  ): void {
    this.x = p.x
    this.y = p.y
    this.facing = p.facing
    this.moveSpeed01 = p.speed01
    this.walkPhase = p.phase
    this.crouchK = p.crouch ? 1 : 0
    this.airborne = p.y > 0.05
    this.block.active = p.blockActive
    this.block.stamina = p.stamina
    this.dead = (p.deathK ?? 0) > 0.5
    if (this.dead) this.deathK = p.deathK ?? 0
    // Удалённые составные состояния
    this.knockdown.active = (p.knockdownK ?? 0) > 0.01
    this.knockdown.t = this.knockdown.active ? KNOCKDOWN.s * (p.knockdownK ?? 0) : 0
    this.turn.active = (p.turnT ?? 0) > 0.01
    this.turn.t = (p.turnT ?? 0) * this.turn.duration
    this.flip.active = (p.flipK ?? 0) > 0.01
    if (p.flipDir) this.flip.dir = p.flipDir

    const an = this.animator
    an.facing = this.facing
    an.botX = this.x
    an.botY = this.y
    an.walkAmp = p.speed01
    an.walkPhase = p.phase
    an.crouchK = this.crouchK
    an.airborne = this.airborne
    an.breath = false
    an.deathK = this.dead ? this.deathK : 0
    an.turnK = p.turnT ?? 0
    an.knockdownK = p.knockdownK ?? 0
    an.flipK = p.flipK ?? 0
    if (p.flipDir) an.flipDir = p.flipDir
    an.strikePose = null
    if (p.strikeSlot && p.strikeT !== undefined && p.strikeT < 1) {
      const cfg = this.slots[p.strikeSlot]
      if (cfg && isStrike(cfg)) {
        const strikeDur = cfg.speed
        an.strikePose = {
          data: cfg,
          // strikeT — прогресс полного цикла (elapsed/totalDur хоста); при срезе попаданием
          // полный цикл хоста короче — гость доигрывает возврат по своей полной длительности
          elapsed: p.strikeT * (strikeDur + STRIKE.actionGapMs / 1000),
          strikeDur,
          totalDur: strikeDur + STRIKE.actionGapMs / 1000,
          stopPoint: { left: null, right: null },
          stump: { left: !this.grid.hasArm('left'), right: !this.grid.hasArm('right') },
        }
      }
    }
    an.blockPose = p.blockActive && this.block.config
      ? { data: this.block.config, blend: 1 }
      : null
    an.hasArmLeft = this.grid.hasArm('left')
    an.hasArmRight = this.grid.hasArm('right')
    an.update(dt, (v) => this.grid.skeletonScale(v))
  }

  /** Экран победы: бот стоит на месте в исходной позе и медленно вращается вокруг
   *  своей вертикальной оси (spinAngle — накопленный угол, радианы). Победитель
   *  держит правую руку поднятой (armK 0..1, при отсечённой правой — левую).
   *  Урон и разрушенные кубы НЕ сбрасываются — видно итоговое состояние после боя. */
  updateVictory(dt: number, spinAngle: number, armK: number): void {
    // Полная остановка: на земле, без действий и составных состояний
    this.airborne = false
    this.vx = 0
    this.vy = 0
    this.y = BOT_MOVE.groundY
    this.moveSpeed01 = 0
    this.activeStrike = null
    this.block.active = false
    this.block.config = null
    this.turn.active = false
    this.knockdown.active = false
    this.flip.active = false
    this.wobble = 0
    this.crouchK += (0 - this.crouchK) * Math.min(1, dt * 8)
    // Нокаут снят: проигравший стоит в исходной позе (упав, плавно поднимается)
    this.dead = false
    if (this.deathK > 0) this.deathK = Math.max(0, this.deathK - dt * 2)
    const an = this.animator
    an.deathK = this.deathK
    an.knockdownK = 0
    an.turnK = 0
    an.flipK = 0
    an.strikePose = null
    an.blockPose = null
    an.gyroWobbleDeg = 0
    an.glitchOn = false
    an.breath = false
    an.victorySpin = spinAngle
    an.victoryArm = armK
    an.facing = this.facing
    an.botX = this.x
    an.botY = this.y
    an.hasArmLeft = this.grid.hasArm('left')
    an.hasArmRight = this.grid.hasArm('right')
    an.update(dt, (v) => this.grid.skeletonScale(v))
  }

  /** Респаун после падения с крыши: центр арены, чистая стойка на земле.
   *  Обшивку снимает снаружи (VoxelGrid.stripArmor), здоровье скелета/компонентов
   *  сохраняется как на момент падения. Facing задаёт вызывающий (к противнику). */
  respawnAfterFall(): void {
    this.x = 0
    this.y = BOT_MOVE.groundY
    this.vx = 0
    this.vy = 0
    this.airborne = false
    this.airT = 0
    this.activeStrike = null
    this.block.active = false
    this.block.config = null
    this.block.blend = 0
    this.turn.active = false
    this.knockdown.active = false
    this.knockdown.t = 0
    this.flip.active = false
    this.flip.used = false
    this.wobble = 0
    this.crouchK = 0
    this.moveSpeed01 = 0
    this.walkPhase = 0
    const an = this.animator
    an.knockdownK = 0
    an.turnK = 0
    an.flipK = 0
    an.strikePose = null
    an.blockPose = null
    an.deathK = 0
  }

  /** Перезапуск боевого состояния (реванш) — структура бота пересоздаётся снаружи */
  resetCombatState(): void {
    this.activeStrike = null
    this.block = { slot: null, config: null, active: false, stamina: STAMINA.max, holdT: 0, secondAccum: 0, regenAccum: 0, blend: 0 }
    this.turn = { active: false, t: 0, duration: TURN.base }
    this.knockdown = { active: false, t: 0 }
    this.flip = { active: false, t: 0, dur: 0, dir: 1, used: false }
    this.airT = 0
    this.wobble = 0
    this.deathK = 0
    this.dead = false
    this.totalDamage = 0
    this.speedMult = 1
    this.forceMult = 1
    this.legFactor = 1
    this.fx = { vignette: 0, glitch: 0, noise: 0, eyesDim: 0 }
    this.x = 0
    this.y = 0
    this.vx = 0
    this.vy = 0
    this.crouchK = 0
    this.moveSpeed01 = 0
  }
}
