// BotAnimator — процедурная анимация (TZ-UPDATE §3.4.9, §7.4, UPD-05/06/07/09):
// дыхание грудью (грудь/плечи — ведущая фаза; живот тянется следом ЧУТЬ
// медленнее, руки — медленнее груди, голова — вслед за шеей ещё медленнее
// рук; части тела жёсткие — расслоения на кольца нет), ходьба, удары по кривой
// Безье (модель «движение»: одна конечная точка, изгиб curve), блок-поза,
// изгиб тела за бьющей рукой, автотурн (мгновенная смена сторон — анимация
// поворота не используется), кувырок (сальто), нокдаун/подъём, шатания
// гироскопа (±3°/±6°), глитч материнки (1–2 куба на 1–2 кадра), удар культей.
import type { BotData, Voxel, Vec3 } from '../shared/types/bot.types'
import type { StrikeData, StrikeRuntime, BlockData } from '../shared/types/strike.types'
import { curveTrajectoryPoint } from '../shared/types/strike.types'
import { clamp, solveIK2 } from '../shared/utils/math'
import { ANIM, STRIKE } from '../shared/constants/physics'
import { DEBUFFS } from '../shared/constants/debuffs'

interface ChainNode { pivot: number; k: number }

/** Жёсткий 3D-наклон сегментов руки (вместо прежнего сдвига-расслоения):
 *  плечо и предплечье ПОВОРАЧИВАЮТСЯ вслед за кулаком вокруг своих суставов.
 *  Ось наклона — ЕДИНАЯ для позиций и ориентации кубов сегмента, перпендикулярна
 *  ТЕКУЩЕМУ направлению сегмента (после цепи и корня): тогда наклон двигает
 *  сегмент строго к ±Z, без скручивания кубов вокруг оси руки.
 *  Все оси/опорные точки — в системе «после корневого поворота». */
interface ArmTilt {
  thU: number; thF: number                  // углы наклона (плечо/предплечье)
  axU: number; ayU: number                  // ось плеча (после корня, ⊥ сегменту)
  axF: number; ayF: number                  // ось предплечья (после корня, ⊥ сегменту)
  shX: number; shY: number; shZ: number     // плечо (после корня, 3D)
  elPreX: number; elPreY: number            // локоть ДО наклона (после корня) — опор вращения предплечья
  elX: number; elY: number; elZ: number     // локоть после наклона плеча (после корня)
}
const newTilt = (): ArmTilt => ({
  thU: 0, thF: 0,
  axU: 0, ayU: 1, axF: 0, ayF: 1,
  shX: 0, shY: 0, shZ: 0, elPreX: 0, elPreY: 0, elX: 0, elY: 0, elZ: 0,
})

/** Поворот точки вокруг оси (ax, ay, 0), формула Родригеса */
function rotAround(
  x: number, y: number, z: number, ax: number, ay: number, th: number,
): { x: number; y: number; z: number } {
  const c = Math.cos(th), s = Math.sin(th), t = 1 - c
  const dot = ax * x + ay * y            // â·p (ось в плоскости XY)
  const cx = ay * z                      // (â×p).x
  const cy = -ax * z                     // (â×p).y
  const cz = ax * y - ay * x             // (â×p).z
  return {
    x: x * c + cx * s + ax * dot * t,
    y: y * c + cy * s + ay * dot * t,
    z: z * c + cz * s,
  }
}

/** Композиция кватернионов a⊗b (Гамильтон) */
function quatMul(
  ax: number, ay: number, az: number, aw: number,
  bx: number, by: number, bz: number, bw: number,
): { x: number; y: number; z: number; w: number } {
  return {
    x: aw * bx + ax * bw + ay * bz - az * by,
    y: aw * by - ax * bz + ay * bw + az * bx,
    z: aw * bz + ax * by - ay * bx + az * bw,
    w: aw * bw - ax * bx - ay * by - az * bz,
  }
}

const P_ROOT = 0, P_NECK = 1, P_SHL = 2, P_ELL = 3, P_SHR = 4, P_ELR = 5, P_HIP_L = 6, P_KNEE_L = 7, P_HIP_R = 8, P_KNEE_R = 9, P_ANK_L = 10, P_ANK_R = 11
const PIVOT_COUNT = 12
const UPPER_LEN = 0.78
const FORE_LEN = 0.78
/** Жёсткая досягаемость руки (два сегмента): бюджет Z-смещения кисти.
 *  Сегменты жёсткие — Z-смещение реализуется ПОВОРОТОМ в плече и изгибом
 *  в локте (никакого расслоения), поэтому бюджет ограничен длиной руки. */
const RIGID_REACH = UPPER_LEN + FORE_LEN - 0.02
/** Y-уровни суставов руки: граница сегментов «плечо / предплечье» */
const SHOULDER_Y = 4.0, ELBOW_Y = 3.25
/** Z пивотов плеч */
const SHOULDER_Z_L = -0.875, SHOULDER_Z_R = 0.875
/** Стойка кистей (локально) */
const REST_X = 0.18, REST_Y = 2.55
/** Центр вращения кувырка */
const FLIP_CX = 0.2, FLIP_CY = 2.2
const DEG = Math.PI / 180

/** Задержка фазы дыхания живота (рад): живот поднимается ЧУТЬ медленнее груди */
const BREATH_LAG_BELLY = 0.5
/** Задержка фазы дыхания рук (рад): руки поднимаются медленнее груди */
const BREATH_LAG_ARM = 0.9
/** Задержка фазы дыхания головы (рад): голова тянется за шеёй ещё медленнее рук */
const BREATH_LAG_HEAD = 1.3

/** Параметры дыхания куба (меню, ТЗ 4.7): w — вес амплитуды, lag — задержка фазы (рад).
 *  Грудь (g13+) и перекладина плеч — ведущая фаза, шея тянется вместе с грудью;
 *  живот (g10–g12) поднимается ЧУТЬ медленнее груди; руки — медленнее груди;
 *  голова — вслед за шеёй, ещё медленнее рук; таз и ноги НЕПОДВИЖНЫ. Части тела
 *  жёсткие (кубы одной части не расслаиваются), мягкие стыки только МЕЖДУ
 *  частями: грудь/живот, корпус/руки, шея/голова (анатомическое дыхание).
 *  Порядок задержек: грудь 0 → живот 0.5 → руки 0.9 → голова 1.3 (рад). */
function breathParams(v: Voxel): { w: number; lag: number } {
  if (v.limb === 'armL' || v.limb === 'armR') return { w: 1, lag: BREATH_LAG_ARM }
  if (v.limb === 'head') return { w: 1, lag: BREATH_LAG_HEAD }
  if (v.limb === 'neck') return { w: 1, lag: 0 }
  if (v.limb === 'spine' || v.limb === 'crossbar') {
    if (v.y >= 3.25) return { w: 1, lag: 0 }               // грудь — ведущая фаза
    if (v.y >= 2.5) return { w: 1, lag: BREATH_LAG_BELLY } // живот тянется следом
    return { w: 0, lag: 0 }                                // таз стоит на земле
  }
  return { w: 0, lag: 0 } // ноги — неподвижны
}

export interface StrikePoseState {
  data: StrikeData
  elapsed: number
  strikeDur: number
  totalDur: number
  stopPoint: { left: Vec3 | null; right: Vec3 | null }
  stump: { left: boolean; right: boolean }
}

export interface BlockPoseState {
  data: BlockData
  /** 0..1 — прогресс принятия позы (BLOCK_POSE_S) */
  blend: number
}

export class BotAnimator {
  private data: BotData
  private chains: ChainNode[][] = []
  private angles: Float32Array = new Float32Array(PIVOT_COUNT)
  private pivots: Vec3[] = []
  private grid: { worldPos: Float32Array; worldAngle: Float32Array; worldScale: Float32Array; worldQuat: Float32Array }
  private handLocal: { left: Vec3; right: Vec3 } = { left: { x: REST_X, y: REST_Y, z: SHOULDER_Z_L }, right: { x: REST_X, y: REST_Y, z: SHOULDER_Z_R } }
  /** Принадлежность куба руке: 1 = левая, 2 = правая (для жёсткого наклона сегментов) */
  private zSide: Uint8Array = new Uint8Array(0)
  /** Жёсткие наклоны сегментов рук (плечо/предплечье) текущего кадра */
  private tiltL: ArmTilt = newTilt()
  private tiltR: ArmTilt = newTilt()
  /** Вес амплитуды дыхания по кубам (меню) */
  private breathW: Float32Array = new Float32Array(0)
  /** Задержка фазы дыхания по кубам, рад (меню): живот/руки отстают от груди */
  private breathLag: Float32Array = new Float32Array(0)

  // Входы состояния (задаются BotEntity/системами)
  time = 0
  facing: 1 | -1 = 1
  botX = 0
  botY = 0
  walkPhase = 0
  walkAmp = 0          // 0..1
  crouchK = 0          // 0..1
  airborne = false
  /** Импульсный wobble от ударов (радианы, до 20° при повреждённом гироскопе), затухает */
  wobble = 0
  /** Базовый wobble гироскопа (градусы: 3 повреждён / 6 уничтожен), 0 = нет */
  gyroWobbleDeg = 0
  gyroWobblePeriod = DEBUFFS.gyroDestWobblePeriodS
  private gyroPhase = Math.random() * Math.PI * 2
  breath = false       // «дыхание» в меню
  strikePose: StrikePoseState | null = null
  blockPose: BlockPoseState | null = null
  deathK = 0           // 0..1 падение при нокауте
  /** Нокдаун (UPD-07): 0..1 — лежит (1) с завёрнутыми фазами падения/подъёма внутри */
  knockdownK = 0
  /** Автотурн (UPD-06): 0..1 прогресс разворота на 180° */
  turnK = 0
  /** Кувырок (UPD-05): 0..1 прогресс сальто, dir — направление */
  flipK = 0
  flipDir: -1 | 1 = 1
  /** Глитч материнки (RGB shift модели + смещения 1–2 кубов) */
  glitchOn = false
  /** Есть ли рука (для культи) — обновляет BotEntity */
  hasArmLeft = true
  hasArmRight = true

  /** Экран победы: непрерывное вращение вокруг вертикальной оси (радианы, 360° цикл).
   *  Кубы поворачиваются вокруг локальной вертикальной оси бота — как автотурн, но без предела. */
  victorySpin = 0
  /** Экран победы: 0..1 — подъём правой руки победителя (если правой нет — левой) */
  victoryArm = 0

  /** Мировые позиции кистей (для хитбоксов ударов) */
  handWorld: { left: Vec3; right: Vec3 } = { left: { x: 0, y: 0, z: 0 }, right: { x: 0, y: 0, z: 0 } }

  /** Состояние глитча (кубы + смещение + кадры) */
  private glitchIds: number[] = []
  private glitchOff: Vec3 = { x: 0, y: 0, z: 0 }
  private glitchFramesLeft = 0

  constructor(data: BotData, grid: { worldPos: Float32Array; worldAngle: Float32Array; worldScale: Float32Array }) {
    this.data = data
    this.grid = grid
    this.pivots = [
      { x: 0, y: 0, z: 0 },          // root
      { ...data.joints.neck },
      { ...data.joints.shoulderL }, { ...data.joints.elbowL },
      { ...data.joints.shoulderR }, { ...data.joints.elbowR },
      { ...data.joints.hipL }, { ...data.joints.kneeL },
      { ...data.joints.hipR }, { ...data.joints.kneeR },
      { x: 0, y: 0.5, z: -0.375 },   // ankleL
      { x: 0, y: 0.5, z: 0.375 },    // ankleR
    ]
    const N_ROOT: ChainNode[] = [{ pivot: P_ROOT, k: 1 }]
    const N_HEAD: ChainNode[] = [{ pivot: P_ROOT, k: 1 }, { pivot: P_NECK, k: 1 }]
    const armChain = (side: 'L' | 'R', rowG: number): ChainNode[] => {
      const nodes: ChainNode[] = [{ pivot: P_ROOT, k: 1 }, { pivot: side === 'L' ? P_SHL : P_SHR, k: 1 }]
      if (rowG < 13) nodes.push({ pivot: side === 'L' ? P_ELL : P_ELR, k: 1 })
      return nodes
    }
    const legChain = (side: 'L' | 'R', rowG: number): ChainNode[] => {
      const nodes: ChainNode[] = [{ pivot: P_ROOT, k: 1 }, { pivot: side === 'L' ? P_HIP_L : P_HIP_R, k: 1 }]
      if (rowG < 5) nodes.push({ pivot: side === 'L' ? P_KNEE_L : P_KNEE_R, k: 1 })
      if (rowG < 2) nodes.push({ pivot: side === 'L' ? P_ANK_L : P_ANK_R, k: 1 })
      return nodes
    }
    const n = data.voxels.length
    this.zSide = new Uint8Array(n)
    this.breathW = new Float32Array(n)
    this.breathLag = new Float32Array(n)
    for (const v of data.voxels) {
      const bpar = breathParams(v)
      this.breathW[v.id] = bpar.w
      this.breathLag[v.id] = bpar.lag
      let chain: ChainNode[] = N_ROOT
      const rowG = Math.round(v.y / 0.25 - 0.5)
      switch (v.limb) {
        case 'head': chain = N_HEAD; break
        case 'neck': chain = v.isSkeleton ? N_ROOT : N_HEAD; break
        case 'armL': chain = armChain('L', rowG); break
        case 'armR': chain = armChain('R', rowG); break
        case 'legL': chain = legChain('L', rowG); break
        case 'legR': chain = legChain('R', rowG); break
        default: chain = N_ROOT
      }
      this.chains.push(chain)
      if (v.limb === 'armL' || v.limb === 'armR') {
        this.zSide[v.id] = v.limb === 'armL' ? 1 : 2
      }
    }
  }

  private ikArm(side: 'L' | 'R', target: Vec3, bendSign: number): void {
    const sh = side === 'L' ? this.pivots[P_SHL] : this.pivots[P_SHR]
    // --- 3D-цель относительно плеча: рука жёсткая (RIGID_REACH). Кисть идёт ТОЧНО
    // к 3D-цели (XY + Z); при недосягаемости — по тому же направлению до сферы
    // досягаемости (как прежний клэмп по XY, только в 3D).
    const dxt = target.x - sh.x, dyt = target.y - sh.y, dzt = target.z - sh.z
    const dcT = Math.hypot(dxt, dyt) || 1e-5
    const d3raw = Math.hypot(dcT, dzt)
    const k = d3raw > RIGID_REACH ? RIGID_REACH / d3raw : 1
    const dz = dzt * k            // Z-смещение кисти (после клэмпа)
    const dxy = dcT * k           // XY-дистанция кисти (после клэмпа)
    // --- Z-изгиб: жёсткие сегменты (без расслоения) — плечо и предплечье
    // ПОВОРАЧИВАЮТСЯ вокруг своих суставов вслед за кулаком (локоть — на
    // половину dz). Подъём сегмента на угол th даёт Z-подъём lu·sin(th)
    // (точно dzE/dzF) и слегка укорачивает XY-проекцию (lu·cos(th)).
    const dzE = clamp(dz * 0.5, -UPPER_LEN * 0.92, UPPER_LEN * 0.92)
    const dzF = clamp(dz - dzE, -FORE_LEN * 0.92, FORE_LEN * 0.92)
    // Порог 1e-4 рад (0.006°): гасит FP-шум траектории (BEZ даёт ~1e-16 по Z даже
    // при z=0) — иначе кватернионы пишутся и при нулевом Z, а рендерер уходит с
    // пути worldAngle (приводило к «независимому вращению кубов» в старой версии).
    const thU0 = Math.asin(clamp(dzE / UPPER_LEN, -1, 1))
    const thF0 = Math.asin(clamp(dzF / FORE_LEN, -1, 1))
    const thU = Math.abs(thU0) < 1e-4 ? 0 : thU0
    const thF = Math.abs(thF0) < 1e-4 ? 0 : thF0
    // Плоская (XY) часть — полными длинами сегментов (кубы жёсткие, укорочение
    // даёт сам наклон): цель — истинная XY-дистанция кисти (dxy уже ≤ RIGID_REACH).
    const tx = sh.x + (dxt / dcT) * dxy
    const ty = sh.y + (dyt / dcT) * dxy
    const res = solveIK2({ x: sh.x, y: sh.y }, { x: tx, y: ty }, UPPER_LEN, FORE_LEN, bendSign)
    this.angles[side === 'L' ? P_SHL : P_SHR] = res.shoulderAngle + Math.PI / 2
    const ex = res.elbow.x, ey = res.elbow.y
    let vx = tx - ex, vy = ty - ey
    const vl = Math.sqrt(vx * vx + vy * vy) || 1e-5
    vx /= vl; vy /= vl
    const ux = Math.cos(res.shoulderAngle), uy = Math.sin(res.shoulderAngle)
    const rel = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy)
    this.angles[side === 'L' ? P_ELL : P_ELR] = rel
    // --- Оси наклона: ⊥ ТЕКУЩЕМУ направлению сегмента (после цепи и корня).
    // Поворот вокруг такой оси двигает конец сегмента СТРОГО по Z (â × d = +ẑ)
    // плюс укорочение вдоль сегмента — никакого скручивания кубов вокруг оси
    // руки (причина «независимого вращения кубов» в прошлой версии).
    const ra = this.angles[P_ROOT]
    const rca = Math.cos(ra), rsa = Math.sin(ra)
    const shPx = sh.x * rca - sh.y * rsa
    const shPy = sh.x * rsa + sh.y * rca
    const elPx = ex * rca - ey * rsa
    const elPy = ex * rsa + ey * rca
    const txP = tx * rca - ty * rsa
    const tyP = tx * rsa + ty * rca
    const T = side === 'L' ? this.tiltL : this.tiltR
    T.thU = thU
    T.thF = thF
    let dux = elPx - shPx, duy = elPy - shPy        // плечо→локоть (после корня)
    const dul = Math.hypot(dux, duy) || 1e-5
    dux /= dul; duy /= dul
    T.axU = duy; T.ayU = -dux                        // â = d × ẑ — поворот к +Z
    let dfx = txP - elPx, dfy = tyP - elPy           // локоть→кисть (после корня)
    const dfl = Math.hypot(dfx, dfy) || 1e-5
    dfx /= dfl; dfy /= dfl
    T.axF = dfy; T.ayF = -dfx
    T.shX = shPx
    T.shY = shPy
    T.shZ = sh.z
    T.elPreX = elPx
    T.elPreY = elPy
    const elRel = rotAround(elPx - shPx, elPy - shPy, 0, T.axU, T.ayU, thU)
    T.elX = shPx + elRel.x
    T.elY = shPy + elRel.y
    T.elZ = sh.z + elRel.z
    // Кисть (хитбокс) — ТА ЖЕ композиция, что у кубов предплечья: поворот вокруг
    // локтя до наклона + перенос к новому локтю; затем возврат в систему модели.
    const hf = rotAround(txP - elPx, tyP - elPy, 0, T.axF, T.ayF, thF)
    const hxP = T.elX + hf.x, hyP = T.elY + hf.y, hzP = T.elZ + hf.z
    const hl = side === 'L' ? this.handLocal.left : this.handLocal.right
    hl.x = hxP * rca + hyP * rsa
    hl.y = -hxP * rsa + hyP * rca
    hl.z = hzP
  }

  private restY(): number {
    return REST_Y - 0.35 * this.crouchK
  }

  /** Стойка кисти (локально): база для кадров-смещений (редактор/движок) */
  restPos(side: 'left' | 'right'): Vec3 {
    return { x: REST_X, y: this.restY(), z: side === 'left' ? SHOULDER_Z_L : SHOULDER_Z_R }
  }

  /** Позиция на траектории движения (квадратичная Безье с изгибом curve) в момент t.
   *  target — конечная точка (смещение от стойки); культя — масштаб 0.35;
   *  «обе» — зеркалирование Z. Возвращает ЛОКАЛЬНЫЕ координаты (у origin бота). */
  private pathPosAt(st: StrikePoseState, side: 'left' | 'right', t: number): Vec3 {
    const rest = this.restPos(side)
    const stump = st.stump[side]
    const scale = stump ? 0.35 : 1 // культя: остаток выдвигается до предела (§3.4.6)
    const sz = side === 'left' ? -1 : 1
    // z зеркалится по стороне СО ЗНАКОМ (как у блока): +z — кисть наружу,
    // −z — внутрь. Прежнее Math.abs для «обеих» рук всегда раздвигало их наружу
    // независимо от знака ползунка — баг, исправлен.
    const oz = st.data.target.z
    const target = {
      x: rest.x + st.data.target.x * scale,
      y: rest.y + st.data.target.y * scale,
      z: rest.z + sz * (stump ? oz * scale : oz),
    }
    const t01 = st.strikeDur > 0 ? clamp(t / st.strikeDur, 0, 1) : 1
    return curveTrajectoryPoint(rest, target, st.data.curve, t01)
  }

  /** Цель кисти для активного удара: траектория Безье (изгиб curve) + культя + стоп-точка.
   *  Фаза возврата: после попадания — из точки контакта за RETRACT_AFTER_HIT_MS (срез фазы
   *  движения), при нормальном завершении — из конечной точки за ACTION_GAP. */
  private strikeTarget(st: StrikePoseState, side: 'left' | 'right'): Vec3 {
    const rest = this.restPos(side)
    const stop = st.stopPoint[side]
    if (st.elapsed >= st.strikeDur) {
      // Фаза возврата руки в стойку
      const gap = Math.max(0.001, st.totalDur - st.strikeDur)
      const k = clamp((st.elapsed - st.strikeDur) / gap, 0, 1)
      // «Откуда»: точка контакта (было попадание) либо позиция на пути в момент среза/конца
      const from = stop ?? this.pathPosAt(st, side, st.strikeDur)
      return {
        x: from.x + (rest.x - from.x) * k,
        y: from.y + (rest.y - from.y) * k,
        z: from.z + (rest.z - from.z) * k,
      }
    }
    if (stop) return { ...stop }
    return this.pathPosAt(st, side, st.elapsed)
  }

  update(dt: number, skeletonScaleOf: (v: Voxel) => number): void {
    this.time += dt
    const A = this.angles
    A.fill(0)

    // --- Глитч материнки: 1–2 случайных куба смещаются на 1–2 кадра ---
    if (this.glitchOn) {
      if (this.glitchFramesLeft <= 0) {
        const alive = this.data.voxels.filter((v) => !v.destroyed && (v.limb === 'spine' || v.limb === 'head'))
        const count = DEBUFFS.glitchShiftCubesMin + Math.floor(Math.random() * (DEBUFFS.glitchShiftCubesMax - DEBUFFS.glitchShiftCubesMin + 1))
        this.glitchIds = []
        for (let i = 0; i < count && alive.length > 0; i++) {
          this.glitchIds.push(alive[Math.floor(Math.random() * alive.length)].id)
        }
        this.glitchOff = { x: (Math.random() - 0.5) * 0.5, y: (Math.random() - 0.5) * 0.4, z: 0 }
        const frames = DEBUFFS.glitchFramesMin + Math.floor(Math.random() * (DEBUFFS.glitchFramesMax - DEBUFFS.glitchFramesMin + 1))
        this.glitchFramesLeft = frames
      }
      this.glitchFramesLeft--
    } else {
      this.glitchFramesLeft = 0
      this.glitchIds = []
    }

    // --- Корпус: шатание/наклон/присед/смерть/нокдаун/ходьба ---
    let rootAngle = this.lean
    let rootY = 0

    // Базовый wobble гироскопа (±3° повреждён / ±6° уничтожен, период 0.8с, фаза случайна)
    if (this.gyroWobbleDeg > 0.01) {
      const amp = this.gyroWobbleDeg * DEG
      const t = this.time
      const p = this.gyroPhase
      const period = Math.max(0.2, this.gyroWobblePeriod)
      rootAngle += amp * Math.sin((t * Math.PI * 2) / period + p) * (0.65 + 0.35 * Math.sin(t * 1.7 + p * 2))
      rootY += Math.abs(Math.sin((t * Math.PI * 2) / period + p)) * 0.05 * (amp / (6 * DEG))
    }
    // Импульсный wobble (крены до 20° при ударах), затухает
    if (this.wobble > 0.0001) {
      rootAngle += Math.sin(this.time * 5.2) * this.wobble
      rootY += Math.abs(Math.sin(this.time * 3.7)) * 0.06 * Math.min(this.wobble * 6, 1)
      this.wobble = Math.max(0, this.wobble - dt * 0.5)
    }

    const amp = this.walkAmp
    if (amp > 0.001) {
      rootY += Math.abs(Math.sin(this.walkPhase)) * 0.07 * amp
      rootAngle += Math.sin(this.walkPhase) * 0.035 * amp
    }
    const ck = this.crouchK
    rootAngle -= 0.15 * ck
    rootY -= 0.55 * ck
    if (this.deathK > 0) {
      rootAngle += 1.35 * this.deathK
      rootY -= 0.25 * this.deathK
    }
    // Нокдаун (UPD-07): падение на спину с вращением → лежит → подъём
    if (this.knockdownK > 0) {
      rootAngle += 1.45 * this.knockdownK
      rootY -= 0.35 * this.knockdownK
    }
    A[P_ROOT] = rootAngle

    // --- Ноги: ходьба/присед/прыжок/кувырок-группировка/нокдаун ---
    const flipTuck = this.flipK > 0 ? Math.min(1, this.flipK * 4) : 0
    const tuckK = Math.max(ck, flipTuck)
    const walkHipL = Math.sin(this.walkPhase) * 0.38 * amp
    const walkHipR = Math.sin(this.walkPhase + Math.PI) * 0.38 * amp
    const kneeLbend = Math.max(0, -Math.sin(this.walkPhase)) * 0.55 * amp + 0.08
    const kneeRbend = Math.max(0, -Math.sin(this.walkPhase + Math.PI)) * 0.55 * amp + 0.08
    const air = this.airborne ? 1 : 0
    A[P_HIP_L] = walkHipL + 0.9 * tuckK + 0.45 * air + 0.4 * this.knockdownK
    A[P_HIP_R] = walkHipR + 0.9 * tuckK + 0.45 * air + 0.4 * this.knockdownK
    A[P_KNEE_L] = -kneeLbend - 1.5 * tuckK - 0.9 * air - 0.6 * this.knockdownK
    A[P_KNEE_R] = -kneeRbend - 1.5 * tuckK - 0.9 * air - 0.6 * this.knockdownK
    A[P_ANK_L] = 0.5 * tuckK + 0.3 * air + 0.15 * amp
    A[P_ANK_R] = 0.5 * tuckK + 0.3 * air + 0.15 * amp
    if (this.deathK > 0) {
      A[P_HIP_L] += 0.4 * this.deathK
      A[P_HIP_R] += 0.4 * this.deathK
      A[P_KNEE_L] -= 0.6 * this.deathK
      A[P_KNEE_R] -= 0.6 * this.deathK
    }

    // --- Руки: удар (полилиния) / блок / стойка / нейтраль автотурна ---
    let armPose = false
    // Затухание наклона (знак-независимое)
    if (this.lean !== 0) {
      const s = Math.sign(this.lean)
      this.lean -= s * Math.min(Math.abs(this.lean), dt * 2.5)
    }
    if (this.strikePose && this.flipK <= 0 && this.turnK <= 0) {
      armPose = true
      const st = this.strikePose
      // Изгиб тела за бьющей рукой (UPD-09): пропорционально выносу кулака от стойки
      const active = st.elapsed < st.strikeDur ? 1 : Math.max(0, 1 - (st.elapsed - st.strikeDur) / Math.max(0.001, st.totalDur - st.strikeDur))
      const mainSide: 'left' | 'right' = st.data.hand === 'right' ? 'right' : 'left'
      const tgt = this.strikeTarget(st, mainSide)
      const rest = this.restPos(mainSide)
      const ext = clamp(Math.hypot(tgt.x - rest.x, tgt.y - rest.y) / STRIKE.editorRange, 0, 1)
      this.lean = Math.min(this.lean, -0.32 * ext * active)
      if (st.data.hand === 'left' || st.data.hand === 'both') {
        this.ikArm('L', this.strikeTarget(st, 'left'), -1)
      }
      if (st.data.hand === 'right' || st.data.hand === 'both') {
        this.ikArm('R', this.strikeTarget(st, 'right'), -1)
      }
      if (st.data.hand === 'left') this.ikArm('R', { x: 0.1, y: 2.6, z: SHOULDER_Z_R }, -1)
      if (st.data.hand === 'right') this.ikArm('L', { x: 0.1, y: 2.6, z: SHOULDER_Z_L }, -1)
    }
    if (this.blockPose && this.flipK <= 0 && this.turnK <= 0 && this.knockdownK <= 0) {
      armPose = true
      const bp = this.blockPose
      const b = clamp(bp.blend, 0, 1)
      const hands: Array<'left' | 'right'> =
        bp.data.hand === 'both' ? ['left', 'right'] : [bp.data.hand]
      for (const side of ['left', 'right'] as const) {
        const rest = this.restPos(side)
        if (hands.includes(side)) {
          // Поза блока: кисть идёт к кадру-позе (смещение от стойки)
          const sz = side === 'left' ? -1 : 1
          const target = {
            x: rest.x + bp.data.frame.x * b,
            y: rest.y + bp.data.frame.y * b,
            z: rest.z + sz * bp.data.frame.z * b,
          }
          this.ikArm(side === 'left' ? 'L' : 'R', target, -1)
        } else if (b > 0.01) {
          const swing = Math.sin(this.walkPhase) * 0.25 * amp
          this.ikArm(side === 'left' ? 'L' : 'R', { x: 0.18 + swing * 0.6, y: rest.y, z: rest.z }, -1)
        }
      }
      // Корпус слегка подан ЗА блокирующими руками (§3.4.9)
      if (b > 0.01) this.lean = Math.max(this.lean, 0.12 * b)
    }
    // --- Экран победы: поднятая рука победителя (правая; если её нет — левая) ---
    if (this.victoryArm > 0.001) {
      armPose = true
      const k = clamp(this.victoryArm, 0, 1)
      const useR = this.hasArmRight || !this.hasArmLeft
      const side = useR ? 'R' : 'L'
      const shZ = useR ? SHOULDER_Z_R : SHOULDER_Z_L
      const rest = { x: REST_X, y: this.restY(), z: shZ }
      // Кисть над плечом: почти прямая рука вверх
      const raised = { x: 0.1, y: SHOULDER_Y + UPPER_LEN + FORE_LEN - 0.08, z: shZ }
      this.ikArm(side, {
        x: rest.x + (raised.x - rest.x) * k,
        y: rest.y + (raised.y - rest.y) * k,
        z: rest.z + (raised.z - rest.z) * k,
      }, -1)
      // Вторая рука — в стойке
      const other = side === 'R' ? 'L' : 'R'
      if (useR ? this.hasArmLeft : this.hasArmRight) {
        this.ikArm(other, { x: REST_X, y: this.restY(), z: other === 'R' ? SHOULDER_Z_R : SHOULDER_Z_L }, -1)
      }
    }
    if (!armPose) {
      const swingL = Math.sin(this.walkPhase + Math.PI) * 0.25 * amp
      const swingR = Math.sin(this.walkPhase) * 0.25 * amp
      this.ikArm('L', { x: 0.18 + swingL * 0.6, y: this.restY() + Math.abs(swingL) * 0.12, z: SHOULDER_Z_L }, -1)
      this.ikArm('R', { x: 0.18 + swingR * 0.6, y: this.restY() + Math.abs(swingR) * 0.12, z: SHOULDER_Z_R }, -1)
    }

    // --- Компенсация наклона головы (голова следует за наклоном корпуса, UPD-09) ---
    A[P_NECK] = -rootAngle * 0.55 + 0.1 * ck

    // --- Мировые позиции кистей ---
    // ВАЖНО: кубы в цикле ниже поворачиваются корневым углом корпуса (наклон/шатание),
    // поэтому хитбокс кисти должен получать тот же поворот — иначе хитбокс отстаёт
    // от видимого кулака и попадания по противнику не регистрируются.
    const f = this.facing
    const rootCos = Math.cos(A[P_ROOT])
    const rootSin = Math.sin(A[P_ROOT])
    for (const side of ['left', 'right'] as const) {
      const hl = this.handLocal[side]
      const rx = hl.x * rootCos - hl.y * rootSin
      const ry = hl.x * rootSin + hl.y * rootCos
      const hw = this.handWorld[side]
      hw.x = this.botX + f * rx
      hw.y = this.botY + ry + rootY
      hw.z = f === 1 ? hl.z : -hl.z
    }

    // --- Пересчёт кубов ---
    const wp = this.grid.worldPos
    const wa = this.grid.worldAngle
    const ws = this.grid.worldScale
    const voxels = this.data.voxels
    const breathOn = this.breath
    const bt = this.time * Math.PI * 2 * ANIM.breathFrequency
    const zSide = this.zSide, breathW = this.breathW, breathLag = this.breathLag
    const tiltL = this.tiltL, tiltR = this.tiltR
    const worldQuat = this.grid.worldQuat
    const bufX = this.pivotBufX, bufY = this.pivotBufY
    // Кэш вращений кувырка/турна (одинаковы для всех кубов)
    const flipAng = this.flipK > 0 ? -this.flipDir * Math.PI * 2 * this.flipK : 0
    const flipCos = flipAng !== 0 ? Math.cos(flipAng) : 1
    const flipSin = flipAng !== 0 ? Math.sin(flipAng) : 0
    const turnAng = this.turnK > 0 ? Math.PI * this.turnK : 0
    const turnCos = turnAng !== 0 ? Math.cos(turnAng) : 1
    const turnSin = turnAng !== 0 ? Math.sin(turnAng) : 0
    // Экран победы: непрерывное вращение вокруг вертикальной оси (кэш вращений)
    const spinAng = this.victorySpin
    const spinCos = spinAng !== 0 ? Math.cos(spinAng) : 1
    const spinSin = spinAng !== 0 ? Math.sin(spinAng) : 0
    const glitchActive = this.glitchOn && this.glitchFramesLeft > 0 && this.glitchIds.length > 0
    const glitchSet = glitchActive ? new Set(this.glitchIds) : null
    for (let i = 0; i < voxels.length; i++) {
      const v = voxels[i]
      let px = v.x, py = v.y
      let cubeAngle = 0
      const chain = this.chains[i]
      const k = chain.length
      {
        for (let c = 0; c < k; c++) {
          const p = this.pivots[chain[c].pivot]
          bufX[c] = p.x
          bufY[c] = p.y
        }
        for (let c = 1; c < k; c++) {
          const ang = A[chain[c - 1].pivot] * chain[c - 1].k
          if (ang !== 0) {
            const cos = Math.cos(ang), sin = Math.sin(ang)
            const hx = bufX[c - 1], hy = bufY[c - 1]
            for (let j = c; j < k; j++) {
              const dx = bufX[j] - hx, dy = bufY[j] - hy
              bufX[j] = hx + dx * cos - dy * sin
              bufY[j] = hy + dx * sin + dy * cos
            }
          }
        }
        for (let c = 0; c < k; c++) {
          const ang = A[chain[c].pivot] * chain[c].k
          if (ang !== 0) {
            const cos = Math.cos(ang), sin = Math.sin(ang)
            const dx = px - bufX[c], dy = py - bufY[c]
            px = bufX[c] + dx * cos - dy * sin
            py = bufY[c] + dx * sin + dy * cos
            cubeAngle += ang
          }
        }
      }
      let pz = v.z
      const zs = zSide[i]
      if (zs !== 0) {
        // Жёсткий поворот сегмента руки вокруг сустава (плечо/локоть) —
        // кулак уводит сегменты вбок, кубы остаются соединены (без расслоения)
        const T = zs === 1 ? tiltL : tiltR
        const upper = v.y >= ELBOW_Y
        if (upper) {
          const r = rotAround(px - T.shX, py - T.shY, pz - T.shZ, T.axU, T.ayU, T.thU)
          px = T.shX + r.x
          py = T.shY + r.y
          pz = T.shZ + r.z
        } else {
          // Предплечье: вращение вокруг локтя ДО наклона, затем перенос к новому
          // локтю (жёсткое тело — геометрия сегмента не искажается)
          const r = rotAround(px - T.elPreX, py - T.elPreY, pz - T.shZ, T.axF, T.ayF, T.thF)
          px = T.elX + r.x
          py = T.elY + r.y
          pz = T.elZ + r.z
        }
      }
      // Кувырок: полное сальто через голову вокруг центра (группировка уже в позе)
      if (flipAng !== 0) {
        const fdx = px - FLIP_CX, fdy = py - FLIP_CY
        px = FLIP_CX + fdx * flipCos - fdy * flipSin
        py = FLIP_CY + fdx * flipSin + fdy * flipCos
        cubeAngle += flipAng
      }
      // Автотурн: разворот на 180° вокруг вертикальной оси (в локале — вращение x/z)
      if (turnAng !== 0) {
        const rdx = px, rdz = pz
        px = rdx * turnCos + rdz * turnSin
        pz = -rdx * turnSin + rdz * turnCos
      }
      // Экран победы: бесконечный цикл 360° вокруг вертикальной оси бота
      if (spinAng !== 0) {
        const rdx = px, rdz = pz
        px = rdx * spinCos + rdz * spinSin
        pz = -rdx * spinSin + rdz * spinCos
      }
      if (breathOn) {
        // Дыхание грудью: грудь+плечи (и шея) — ведущая фаза; живот тянется
        // следом ЧУТЬ медленнее, руки — медленнее груди, голова — вслед за
        // шеёй ещё медленнее (задержка фазы); таз и ноги неподвижны. Части
        // тела жёсткие — кубы одной части не расслаиваются, смещаются
        // только стыки между частями.
        py += Math.sin(bt - breathLag[i]) * ANIM.breathAmplitude * breathW[i]
      }
      if (glitchSet && glitchSet.has(v.id)) {
        px += this.glitchOff.x
        py += this.glitchOff.y
      }
      wp[i * 3] = this.botX + this.facing * px
      wp[i * 3 + 1] = this.botY + py + rootY
      wp[i * 3 + 2] = this.facing === 1 ? pz : -pz
      wa[i] = this.facing === 1 ? cubeAngle : -cubeAngle
      // Ориентация кубов руки (кватернион): ТОТ ЖЕ жёсткий наклон сегмента, что и
      // у позиций (та же ось axU/ayU или axF/ayF и угол th) поверх цепочки
      // z-поворотов — кубы сегмента остаются параллельны друг другу и следуют
      // за изгибом (никакого независимого вращения). Зеркалирование фасинга
      // Ry(π): (x,y,z,w) → (−x, y, −z, w) — ТОЛЬКО при facing = −1 (прежде
      // зеркалилось всегда — грани кубов наклонялись в обратную сторону).
      // При нулевом наклоне пишем identity — сброс «залипшего» наклона после
      // удара (иначе кубы оставались повёрнутыми даже при нулевом Z).
      if (zs !== 0) {
        const T = zs === 1 ? tiltL : tiltR
        const upperQ = v.y >= ELBOW_Y
        const th = upperQ ? T.thU : T.thF
        if (th !== 0) {
          const ax = upperQ ? T.axU : T.axF
          const ay = upperQ ? T.ayU : T.ayF
          const hth = th * 0.5
          const hca = cubeAngle * 0.5
          const tq = quatMul(
            ax * Math.sin(hth), ay * Math.sin(hth), 0, Math.cos(hth),
            0, 0, Math.sin(hca), Math.cos(hca),
          )
          const ms = this.facing === 1 ? 1 : -1
          worldQuat[i * 4] = ms * tq.x
          worldQuat[i * 4 + 1] = tq.y
          worldQuat[i * 4 + 2] = ms * tq.z
          worldQuat[i * 4 + 3] = tq.w
        } else {
          worldQuat[i * 4] = 0
          worldQuat[i * 4 + 1] = 0
          worldQuat[i * 4 + 2] = 0
          worldQuat[i * 4 + 3] = 1
        }
      }
      const scale = v.destroyed ? 0 : skeletonScaleOf(v)
      ws[i] = v.size * scale
    }
  }

  private lean = 0
  private pivotBufX = new Float32Array(6)
  private pivotBufY = new Float32Array(6)
}
