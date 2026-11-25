// StrikeSystem + DamageSystem — целевая редакция (TZ-UPDATE §3.2–3.5, §6.2, UPD-01/02/03/07/08):
// урон = 2–10 (квадратично от скорости движения, без параметра силы),
// хитбокс кулака FIST_HITBOX_SIZE=0.75 фиксирован, остановка на первом контакте.
// ПЕРВЫЙ КОНТАКТ — урон НЕ пробивает кубы насквозь: из задетой зоны (хитбокс
// + crushRadius от точки первого контакта) повреждаются ТОЛЬКО кубы на поверхности
// силуэта — перед которыми по направлению удара НЕТ живого куба. Удар попал по
// обшивке → урон по обшивке; по скелету за обшивкой → урон только скелету;
// скрытый за скелетом/обшивкой внутренний компонент не повреждается, пока не
// оголён; частично оголённый компонент, до которого кулак дотягивается первым,
// получает урон первым. Основной (ближайший) куб — полный урон, остальные
// задетые поверхностные — доля STRIKE.splashRatio.
// блок НЕ даёт неуязвимости — баффы только при попадании по уцелевшим кубам
// блокирующей руки, нокдаун (нога отсечена + компонент), культя.
import type { BotEntity } from '../entities/BotEntity'
import type { Voxel, Vec3 } from '../shared/types/bot.types'
import { BLOCK_BUFFS, STRIKE } from '../shared/constants/physics'
import { strikeKnockbackPower } from '../shared/types/strike.types'
import { LimbDetachmentSystem } from './LimbDetachmentSystem'
import { DebuffManager } from './DebuffManager'
import { COMPONENT_NOTIFY, COMPONENT_DESTROYED_NOTIFY } from '../shared/types/damage.types'
import type { BattleFx } from './BattleFx'

export interface CombatEvents {
  onDamage?(payload: {
    targetId: string
    dealerId: string
    voxelId: number
    damage: number
    destroyedVoxelIds: number[]
    damagedComponent: string | null
    hitPoint: Vec3
    detachedIds: number[]
    impulse: Vec3
  }): void
  onKnockout?(loserId: string, winnerId: string): void
  onComponentNotify?(text: string, bot: BotEntity): void
  /** volumeMul — множитель громкости (сплеш-кубы компонентов звучат тише) */
  onHitSound?(layer: 'armor' | 'skeleton' | 'motherboard' | 'battery' | 'gyroscope' | 'camera' | 'destroy', volumeMul?: number): void
}

export interface CombatContext {
  fx: BattleFx
  debris: {
    spawnSingle(pos: { x: number; y: number; z: number }, size: number, color: number, vel: { x: number; y: number; z: number }): void
    spawnCluster(center: { x: number; y: number; z: number }, centerAngle: number, items: Array<{ dx: number; dy: number; dz: number; angle: number; size: number; color: number }>, impulse: { x: number; y: number; z: number }, angvel: { x: number; y: number; z: number }): void
  }
  events: CombatEvents
  rng: () => number
}

const COMPONENT_TEXT: Record<string, string> = COMPONENT_NOTIFY
const COMPONENT_DESTROYED_TEXT: Record<string, string> = COMPONENT_DESTROYED_NOTIFY
const COMPONENT_HEX: Record<string, number> = {
  camera: 0x3fa9e2,
  motherboard: 0x00ff00,
  gyroscope: 0x444444,
  battery: 0x1a3a5c,
}

export class StrikeSystem {
  private ctx: CombatContext
  private checkKO: (bot: BotEntity) => void
  /** Анти-дублирование звука компонента: тип → время последнего проигрывания */
  private compSoundAt: Partial<Record<string, number>> = {}

  constructor(ctx: CombatContext, checkKO: (bot: BotEntity) => void) {
    this.ctx = ctx
    this.checkKO = checkKO
  }

  /** Звук удара по внутреннему компоненту. Сплеш-кубы (silent) тоже звучат, но
   *  тише — иначе при попадании «зоной» (компонент не основной куб) характерный
   *  треск компонентов пропадал вовсе. Дубли одного типа в пределах 90 мс
   *  схлопываются (несколько кубов компонента в одной зоне дробления). */
  private playComponentSound(type: string, silent: boolean): void {
    const now = performance.now()
    if (now - (this.compSoundAt[type] ?? -1e9) < 90) return
    this.compSoundAt[type] = now
    this.ctx.events.onHitSound?.(type as 'motherboard', silent ? 0.55 : 1)
  }

  /** Разрешить удары обеих сторон (авторитетная симуляция, §6.2).
   *  Первое попадание срезает фазу кадров: рука немедленно убирается в стойку
   *  за RETRACT_AFTER_HIT_MS=100 мс, после чего любой слот снова доступен. */
  resolve(attacker: BotEntity, defender: BotEntity): void {
    const st = attacker.activeStrike
    if (!st || attacker.dead || defender.dead) return
    let hit = false
    for (const side of ['left', 'right'] as const) {
      if (this.resolveFist(attacker, defender, side)) hit = true
    }
    if (hit) {
      // Срез фазы кадров точкой контакта + короткий возврат руки (100 мс)
      st.strikeDur = Math.min(st.strikeDur, st.elapsed)
      st.totalDur = Math.min(st.totalDur, st.elapsed + STRIKE.retractAfterHitMs / 1000)
    }
  }

  /** Один кулак: хитбокс движется по фактической позе, первый контакт → урон по
   *  ПОВЕРХНОСТНЫМ кубам задетой зоны (без пробития насквозь): основной куб —
   *  полный урон, остальные задетые — доля splashRatio (§3.4.5).
   *  Возвращает true, если кулак коснулся. */
  private resolveFist(attacker: BotEntity, defender: BotEntity, side: 'left' | 'right'): boolean {
    const st = attacker.activeStrike
    if (!st) return false
    if (!attacker.fistActive(side)) return false
    const isStump = st.stump[side]
    const center = attacker.fistCenter(side)
    if (!center) return false
    const queryR = isStump ? STRIKE.stumpQueryR : STRIKE.fistQueryR

    const candidates = defender.grid.querySphere(center, queryR)
    if (candidates.length === 0) return false

    const primary = candidates[0]
    st.hitDone[side] = true
    // Остановка удара на первом контакте — в ЛОКАЛЬНЫХ координатах атакующего:
    // мировая точка использовалась аниматором как локальная цель IK, из-за чего
    // у левого бота (мир с отрицательным X) рука после контакта «улетала назад».
    st.stopPoint[side] = attacker.worldToLocalPoint(center)

    // --- Направление проникновения удара в точке контакта: от центра хитбокса
    //     кулака к первичному (ближайшему) кубу. Задаёт ось «первого слоя». ---
    const pw = defender.grid.worldPositionOf(primary)
    const dir = this.punchDir(attacker, center, pw)

    // --- Задетая зона: кубы хитбокса кулака + все живые кубы в радиусе
    //     crushRadius от первичного куба (соседи на шаге решётки 0.25). ---
    const zone: Voxel[] = [...candidates]
    for (const c of defender.grid.querySphere(pw, STRIKE.crushRadius)) {
      if (!zone.some((z) => z.id === c.id)) zone.push(c)
    }

    // --- ПЕРВЫЙ КОНТАКТ — урон НЕ пробивает кубы насквозь: из зоны остаются
    //     только кубы НА ПОВЕРХНОСТИ силуэта (перед которыми по направлению
    //     удара НЕТ живого куба). Скрытый за скелетом/обшивкой куб (в т.ч.
    //     внутренний компонент) не повреждается, пока не оголён; частично
    //     оголённый компонент, до которого кулак дотягивается первым, получает
    //     урон первым (обшивка → скелет → компонент — по мере оголения).
    //     Основной куб — полный урон, остальные поверхностные — splashRatio. ---
    const affected: Voxel[] = [primary]
    for (const c of zone) {
      if (c.id === primary.id) continue
      if (this.isSurfaceCube(defender, dir, c)) affected.push(c)
    }

    let dmg = st.damage
    // Контрудар целим в случайный куб бьющей руки атакующего — считаем от исходного урона
    let counterReturn = 0

    // --- Баффы блока: ТОЛЬКО при попадании по уцелевшим кубам блокирующей руки (§3.5.1–2) ---
    const buffApplies =
      defender.block.active &&
      defender.block.config !== null &&
      this.cubeOnBlockingArm(defender, primary)
    if (buffApplies && defender.block.config?.buff === 'fortification') {
      // «Усиление»: урон ×0.65; knockback сохраняется
      dmg *= BLOCK_BUFFS.fortificationMultiplier
    } else if (buffApplies && defender.block.config?.buff === 'counterstrike') {
      // «Контратака»: возврат 8% в случайный куб бьющей руки атакующего; knockback = 0
      counterReturn = dmg * BLOCK_BUFFS.counterstrikeRatio
    }

    // --- Раздача урона: основной куб — полный, остальные задетые — доля splashRatio ---
    let componentHit = false
    for (let i = 0; i < affected.length; i++) {
      const c = affected[i]
      const d = i === 0 ? dmg : dmg * STRIKE.splashRatio
      const wp = defender.grid.worldPositionOf(c)
      const hit = this.applyDamage(defender, attacker, c, d, i === 0 ? center : wp, false, i > 0)
      componentHit = componentHit || hit
      if (defender.dead) break
    }

    // Knockback: KNOCKBACK_BASE + слайдер «отталкивание» (§3.4.8); 0 при сработавшей «Контратаке»
    if (counterReturn <= 0 && !defender.dead) {
      defender.applyKnockback(attacker.facing, strikeKnockbackPower(st.data))
    } else if (counterReturn > 0) {
      // Контратака: случайный куб бьющей руки атакующего (может опускать HP ниже порогов)
      const sides: Array<'left' | 'right'> =
        st.data.hand === 'both' ? ['left', 'right'] : [st.data.hand === 'left' ? 'left' : 'right']
      const pick = sides[Math.floor(this.ctx.rng() * sides.length)]
      const target = attacker.grid.randomArmCube(pick, this.ctx.rng)
      if (target) {
        const wp = attacker.grid.worldPositionOf(target)
        this.applyDamage(attacker, defender, target, counterReturn, wp, true)
      }
    }

    // Нокдаун (UPD-07): нога отсечена И попадание по внутреннему компоненту
    if (componentHit && !defender.dead && (defender.grid.hasLeg('left') === false || defender.grid.hasLeg('right') === false)) {
      defender.startKnockdown()
      // Лёгкие искры из суставов (визуал нокдауна)
      const c = defender.centerWorld()
      this.ctx.fx.particles.spawnBurst(c.x, c.y, c.z, 6, 0xffcc66, 2.2, 0.9)
    }

    // Крены при ударах при повреждённом гироскопе (до 20°, §3.3)
    const gyro = defender.grid.components.find(c => c.type === 'gyroscope')?.health
    if (gyro === 'damaged') {
      defender.wobble = Math.min(0.35, defender.wobble + 0.12 * (0.5 + this.ctx.rng() * 0.5))
    }
    return true
  }

  /** Направление проникновения удара (от хитбокса кулака в тело цели).
   *  Вырожденный случай (кулак вплотную к центру куба) — горизонталь к противнику. */
  private punchDir(attacker: BotEntity, from: Vec3, primaryWorld: Vec3): Vec3 {
    const dx = primaryWorld.x - from.x
    const dy = primaryWorld.y - from.y
    const dz = primaryWorld.z - from.z
    const len = Math.hypot(dx, dy, dz)
    if (len < 1e-4) return { x: attacker.facing, y: 0, z: 0 }
    return { x: dx / len, y: dy / len, z: dz / len }
  }

  /** Куб на ПОВЕРХНОСТИ силуэта цели по направлению удара: ни один живой куб не
   *  лежит ПЕРЕД ним (ближе к кулаку) с перекрытием «колонны» удара. Такой куб
   *  кулак задевает ПЕРВЫМ — только он и получает урон (сквозь кубы урон не
   *  проходит). Проверяются ВСЕ живые кубы цели (не только зона): прикрыть может
   *  и куб за пределами crushRadius. Перекрытие — по двум поперечным осям к
   *  направлению удара: кубы, стоящие вплотную сбоку (шаг решётки = размеру),
   *  колонну НЕ перекрывают (оголение сбоку открывает куб), стоящие впереди
   *  целиком или частично — перекрывают. */
  private isSurfaceCube(defender: BotEntity, dir: Vec3, target: Voxel): boolean {
    const grid = defender.grid
    const tp = grid.worldPositionOf(target)
    // Поперечный ортонормальный базис: lat1 = normalize(dir × a), lat2 = dir × lat1
    const ax: Vec3 = Math.abs(dir.x) < 0.9 ? { x: 1, y: 0, z: 0 } : { x: 0, y: 1, z: 0 }
    let l1x = dir.y * ax.z - dir.z * ax.y
    let l1y = dir.z * ax.x - dir.x * ax.z
    let l1z = dir.x * ax.y - dir.y * ax.x
    const l1 = Math.hypot(l1x, l1y, l1z) || 1
    l1x /= l1; l1y /= l1; l1z /= l1
    const l2x = dir.y * l1z - dir.z * l1y
    const l2y = dir.z * l1x - dir.x * l1z
    const l2z = dir.x * l1y - dir.y * l1x
    for (const v of grid.voxels) {
      if (v.destroyed || v.id === target.id) continue
      const p = grid.worldPositionOf(v)
      const dx = p.x - tp.x
      const dy = p.y - tp.y
      const dz = p.z - tp.z
      // Глубина вдоль удара: v строго ПЕРЕД целью (ближе к кулаку)
      const depth = dx * dir.x + dy * dir.y + dz * dir.z
      if (depth > -0.02) continue
      // Колонна удара перекрыта v: поперечные смещения в пределах полусумм размеров
      const u1 = dx * l1x + dy * l1y + dz * l1z
      const u2 = dx * l2x + dy * l2y + dz * l2z
      const lim = (v.size + target.size) / 2 - 0.02
      if (Math.abs(u1) < lim && Math.abs(u2) < lim) return false
    }
    return true
  }

  /** Попадание по кубу блокирующей руки позы (плечо/предплечье/кисть, вкл. культю) */
  private cubeOnBlockingArm(defender: BotEntity, cube: Voxel): boolean {
    const cfg = defender.block.config
    if (!cfg) return false
    const sides: Array<'armL' | 'armR'> =
      cfg.hand === 'both' ? ['armL', 'armR'] : [cfg.hand === 'left' ? 'armL' : 'armR']
    return sides.includes(cube.limb as 'armL' | 'armR') && !cube.destroyed
  }

  /**
   * Применить урон к кубу: слои обшивка→скелет→компоненты, почернение, отсечения
   * (включая внутренние компоненты — UPD-01), события §3.8.
   * silent — вторичный задетый куб зоны (без звука слоя; эффекты/разрушения остаются).
   * Возвращает true, если поражён внутренний компонент.
   */
  applyDamage(victim: BotEntity, dealer: BotEntity, cube: Voxel, rawDmg: number, hitPoint: Vec3, isCounterstrike: boolean, silent = false): boolean {
    void isCounterstrike
    const grid = victim.grid
    const dmg = Math.max(0.1, rawDmg)

    const res = grid.applyDamage(cube, dmg)

    // Почернение в точке удара
    grid.blacken[cube.id] = Math.min(0.7, grid.blacken[cube.id] + 0.38)

    // Суммарный урон: весь урон по кубикам противника, включая возвращённый «Контратакой» (§3.1)
    dealer.totalDamage += dmg

    // FX по слою (§7.5)
    const wp = grid.worldPositionOf(cube)
    const isComponent = cube.type === 'camera' || cube.type === 'motherboard' || cube.type === 'gyroscope' || cube.type === 'battery'
    if (isComponent) {
      this.ctx.fx.hitComponent(wp, COMPONENT_HEX[cube.type] ?? 0xffffff, res.componentJustDestroyed)
      this.playComponentSound(cube.type, silent)
    } else if (cube.type === 'armor') {
      this.ctx.fx.hitArmor(wp)
      if (!silent) this.ctx.events.onHitSound?.('armor')
    } else {
      this.ctx.fx.hitSkeleton(wp)
      if (!silent) this.ctx.events.onHitSound?.('skeleton')
    }

    // Разрушение куба обшивки → обломок
    const destroyedIds: number[] = []
    if (res.destroyed && cube.type === 'armor') {
      destroyedIds.push(cube.id)
      this.ctx.debris.spawnSingle(wp, grid.worldScale[cube.id] || cube.size, cube.color, {
        x: dealer.facing * 2.2,
        y: 2.0,
        z: (this.ctx.rng() - 0.5) * 1.5,
      })
    }

    // Отсечение (UPD-01): уничтожен куб скелета → дочерние кубы скелета/обшивки/КОМПОНЕНТОВ ниже по графу
    let detachedIds: number[] = []
    let detachedComponent = false
    if (res.destroyed && cube.isSkeleton) {
      this.ctx.debris.spawnSingle(wp, Math.max(0.08, grid.worldScale[cube.id] || cube.size), cube.color, {
        x: dealer.facing * 2.2,
        y: 2.0,
        z: (this.ctx.rng() - 0.5) * 1.5,
      })
      const det = LimbDetachmentSystem.detach(victim, cube.id, { x: dealer.facing * 2, y: 2, z: 0 })
      if (det) {
        detachedIds = det.detachedIds
        for (const cl of det.clusters) {
          const imp = LimbDetachmentSystem.clusterImpulse({ x: dealer.facing * 2.2, y: 2.2, z: 0 }, 1)
          this.ctx.debris.spawnCluster(cl.center, 0, cl.items, imp.linear, imp.angular)
        }
        this.ctx.fx.particles.spawnBurst(det.center.x, det.center.y, det.center.z, 10, 0xff5522, 3, 1.2)
        this.ctx.events.onHitSound?.('destroy')
        // Отсечённые компоненты считаются уничтоженными (все эффекты, включая нокаут)
        detachedComponent = detachedIds.some((id) => {
          const v = grid.get(id)
          return !!v && (v.type === 'camera' || v.type === 'motherboard' || v.type === 'gyroscope' || v.type === 'battery')
        })
      }
    }

    // Компоненты: пороги 60%/0% (§3.2)
    let componentHit = isComponent
    if (res.component) {
      const comp = res.component
      if (res.componentJustDamaged) {
        this.ctx.fx.notify(COMPONENT_TEXT[comp.type] ?? comp.type, wp.x, wp.y + 0.8, wp.z)
        this.ctx.events.onComponentNotify?.(COMPONENT_TEXT[comp.type] ?? '', victim)
        // Звук слоя уже сыгран выше (isComponent-ветка) — здесь не дублируем его
      }
      if (res.componentJustDestroyed) {
        this.ctx.fx.notify(COMPONENT_DESTROYED_TEXT[comp.type] ?? comp.type, wp.x, wp.y + 0.8, wp.z)
        this.ctx.events.onHitSound?.('destroy')
        const items: Array<{ dx: number; dy: number; dz: number; angle: number; size: number; color: number }> = []
        let cx = 0, cy = 0, cz = 0, n = 0
        for (const id of comp.voxelIds) {
          const cv = grid.get(id)
          if (!cv) continue
          const cwp = grid.worldPositionOf(cv)
          cx += cwp.x; cy += cwp.y; cz += cwp.z; n++
          items.push({ dx: 0, dy: 0, dz: 0, angle: 0, size: Math.max(0.08, grid.worldScale[id] || cv.size), color: cv.color })
        }
        if (n > 0 && items.length === n) {
          cx /= n; cy /= n; cz /= n
          for (let i = 0; i < comp.voxelIds.length; i++) {
            const cv = grid.get(comp.voxelIds[i])
            if (!cv) continue
            const cwp = grid.worldPositionOf(cv)
            items[i].dx = cwp.x - cx
            items[i].dy = cwp.y - cy
            items[i].dz = cwp.z - cz
          }
          this.ctx.debris.spawnCluster(
            { x: cx, y: cy, z: cz }, 0, items,
            { x: dealer.facing * 2.0, y: 2.4, z: 0 },
            { x: (this.ctx.rng() - 0.5) * 6, y: (this.ctx.rng() - 0.5) * 6, z: (this.ctx.rng() - 0.5) * 6 },
          )
          this.ctx.fx.particles.spawnBurst(cx, cy, cz, 8, COMPONENT_HEX[comp.type] ?? 0xffffff, 2.4, 1.0)
        }
        destroyedIds.push(...comp.voxelIds)
      }
    }
    if (detachedComponent) componentHit = true

    // Дебаффы пересчитываются после урона
    DebuffManager.update(victim)

    // Сетевое событие (§5.6)
    this.ctx.events.onDamage?.({
      targetId: victim.id,
      dealerId: dealer.id,
      voxelId: cube.id,
      damage: Math.round(dmg * 1000) / 1000,
      destroyedVoxelIds: destroyedIds,
      damagedComponent: res.component ? cube.type : null,
      hitPoint: { x: Math.round(wp.x * 1000) / 1000, y: Math.round(wp.y * 1000) / 1000, z: Math.round(wp.z * 1000) / 1000 },
      detachedIds,
      impulse: { x: dealer.facing * 2.2, y: 2.2, z: 0 },
    })

    // Нокаут: материнская плата или аккумулятор уничтожены — включая отсечение с ними (§3.1)
    this.checkKO(victim)
    return componentHit
  }
}
