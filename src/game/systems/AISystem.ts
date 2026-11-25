// AISystem — конечный автомат PvE (TZ-UPDATE §3.7): Подход → Атака → Отступление/Блок
// (вероятностно по сложности Лёгкая/Средняя/Сложная) → Пауза.
// ИИ использует ту же математику стамины и условия баффов, что и игрок.
import type { BotEntity, ControlInput } from '../entities/BotEntity'
import type { SlotId } from '../shared/types/strike.types'
import { isStrike, isBlock } from '../shared/types/strike.types'
import { STAMINA } from '../shared/constants/physics'

export type AiDifficulty = 'easy' | 'normal' | 'hard'

interface DiffTuning {
  blockChance: number
  decisionMin: number
  decisionMax: number
  aggression: number
  retreatBias: number
}

const TUNING: Record<AiDifficulty, DiffTuning> = {
  easy: { blockChance: 0.18, decisionMin: 0.4, decisionMax: 0.7, aggression: 0.55, retreatBias: 0.35 },
  normal: { blockChance: 0.42, decisionMin: 0.25, decisionMax: 0.55, aggression: 0.8, retreatBias: 0.2 },
  hard: { blockChance: 0.65, decisionMin: 0.12, decisionMax: 0.35, aggression: 1.0, retreatBias: 0.1 },
}

type AIState = 'approach' | 'attack' | 'defend' | 'retreat' | 'idle'

export class AISystem {
  private bot: BotEntity
  private target: BotEntity
  private diff: DiffTuning
  private state: AIState = 'approach'
  private decisionT = 0
  private blockT = 0
  private retreatT = 0
  /** Очередь задержки ввода (дебафф материнки — только действия A–D, UPD-11) */
  private pending: Array<{ action: () => void; at: number }> = []
  private jumpCd = 2
  private strikeCd = 0.6
  /** QA-пауза (dev-тесты браузера): ИИ пропускает ход — ввод не подаётся */
  paused = false

  constructor(bot: BotEntity, target: BotEntity, difficulty: AiDifficulty = 'normal') {
    this.bot = bot
    this.target = target
    this.diff = TUNING[difficulty] ?? TUNING.normal
  }

  /** Возвращает управление движением + выполняет действия */
  update(dt: number, now: number): ControlInput {
    const ctrl: ControlInput = { move: 'none', jump: false, crouch: false }
    if (this.paused) return ctrl
    if (this.bot.dead || this.target.dead) {
      this.releaseBlock()
      return ctrl
    }

    // Отложенные действия (дебафф материнки ИИ — только A–D)
    while (this.pending.length > 0 && now >= this.pending[0].at) {
      const item = this.pending.shift()
      item?.action()
    }
    const delay = this.bot.grid.components.find(c => c.type === 'motherboard')?.health === 'damaged' ? 0.5 : 0
    const schedule = (fn: () => void): void => {
      if (delay > 0) this.pending.push({ action: fn, at: now + delay })
      else fn()
    }

    this.decisionT -= dt
    this.strikeCd = Math.max(0, this.strikeCd - dt)
    this.jumpCd = Math.max(0, this.jumpCd - dt)

    const me = this.bot
    const foe = this.target
    const dist = Math.abs(me.x - foe.x)
    const reach = 1.6

    // Реакция на удар противника: шанс блока по сложности
    if (
      foe.activeStrike && foe.fistActive(foe.activeStrike.data.hand === 'right' ? 'right' : 'left') &&
      !me.block.active && me.block.stamina > STAMINA.tapCost * 2 && this.blockT <= 0 &&
      !me.airborne && Math.random() < this.diff.blockChance
    ) {
      const blockSlots = (['A', 'B', 'C', 'D'] as SlotId[]).filter(s => isBlock(me.slots[s]))
      if (blockSlots.length > 0) {
        const slot = blockSlots[Math.floor(Math.random() * blockSlots.length)]
        this.blockT = 0.5 + Math.random() * 0.7
        schedule(() => me.activateBlock(slot))
      }
    }

    if (this.blockT > 0) {
      this.blockT -= dt
      if (this.blockT <= 0) {
        this.releaseBlock()
      }
      // В блоке можно слегка подходить (×0.5 к скорости — внутри BotEntity)
      if (dist > reach + 0.5) ctrl.move = me.x < foe.x ? 'right' : 'left'
      return ctrl
    }

    if (this.decisionT <= 0) {
      this.decisionT = this.diff.decisionMin + Math.random() * (this.diff.decisionMax - this.diff.decisionMin)
      if (me.block.stamina < STAMINA.tapCost * 2 && Math.random() < this.diff.retreatBias + 0.3) {
        this.state = 'retreat'
        this.retreatT = 0.8
      } else if (dist > reach + 0.6) {
        this.state = 'approach'
      } else if (this.strikeCd <= 0 && Math.random() < this.diff.aggression) {
        this.state = 'attack'
      } else {
        this.state = Math.random() < 0.5 ? 'idle' : 'approach'
      }
    }

    switch (this.state) {
      case 'approach':
        ctrl.move = me.x < foe.x ? 'right' : 'left'
        if (Math.random() < dt * 0.25 && this.jumpCd <= 0) {
          ctrl.jump = true
          this.jumpCd = 3
        }
        break
      case 'attack': {
        const strikeSlots = (['A', 'B', 'C', 'D'] as SlotId[]).filter(s => isStrike(me.slots[s]))
        if (strikeSlots.length > 0 && this.strikeCd <= 0) {
          const slot = strikeSlots[Math.floor(Math.random() * strikeSlots.length)]
          const cfg = me.slots[slot]
          const hand = cfg.kind === 'strike' ? cfg.hand : 'right'
          const armOk =
            hand === 'both'
              ? me.grid.hasArm('left') || me.grid.hasArm('right')
              : me.grid.hasArm(hand === 'left' ? 'left' : 'right') || true // культя бьёт (UPD-08)
          if (armOk) {
            schedule(() => me.tryStrike(slot))
            this.strikeCd = (cfg.kind === 'strike' ? cfg.speed + 0.4 : 0.8) + Math.random() * 0.4
          }
        }
        this.state = 'idle'
        break
      }
      case 'retreat':
        ctrl.move = me.x < foe.x ? 'left' : 'right'
        this.retreatT -= dt
        if (this.retreatT <= 0) this.state = 'approach'
        break
      default:
        break
    }

    // Не отходить за границы
    if (ctrl.move === 'left' && me.x < -8.5) ctrl.move = 'none'
    if (ctrl.move === 'right' && me.x > 8.5) ctrl.move = 'none'
    // Не отходить слишком далеко
    if (dist > 5.5) ctrl.move = me.x < foe.x ? 'right' : 'left'

    return ctrl
  }

  private releaseBlock(): void {
    if (this.bot.block.active) {
      const tap = this.bot.block.holdT < STAMINA.tapThresholdSec
      this.bot.deactivateBlock(tap)
    }
  }
}
