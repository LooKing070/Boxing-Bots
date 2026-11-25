// BotFactory — генерация бок-бота по схемам ТЗ 4.3/4.4 (ТЗ 12.3).
// Обшивка — оболочка ВОКРУГ скелета/компонентов, ПЛОТНО прилегающая к ним:
// каждая пластина стоит вплотную к грани внутреннего куба (без воздушных зазоров
// и без пересечения с внутренними кубами). Обшивка головы — квадратный шлем.
// Грудная клетка ГЛУБЖЕ живота (грудные кости): сечение груди 1.25×1.25 против
// живота 1.0×1.0 — грудь больше живота по ширине и глубине.
// Кулак (новое): последний куб цепи руки — КУБ ОБШИВКИ (не скелет): все его грани
// — обшивка, силуэт кулака строго квадратный, вровень с профилем руки (без
// выступающих пластин). Пропорции руки НЕ меняются: длина цепи та же, конец руки
// на прежнем месте. Все пластины привязаны к СКЕЛЕТНЫМ кубам (отсечения работают
// от скелета).
// Бюджет кубов: обшивка 248 + скелет 96 (вкл. 18 грудных костей и 12 суставов)
// + компоненты 27 = 371 ≤ 1000. Гироскоп — «мозг»: в САМОМ СЕРЕДИНЕ черепа
// (2×2×2 половинных куба 0.125, скрыты скелетом головы, доступны после разбора черепа).
// Локальное пространство бота: смотрит в +X (вперёд), +Y вверх, Z — размах плеч.
import type { Voxel, BotData, VoxelType, LimbId, ComponentState } from '../shared/types/bot.types'
import { CUBE_SIZE, LAYER_HP, COLORS, MATERIALS, EMISSIVE, JOINT_SIZE, MAX_CUBES_PER_BOT } from '../shared/constants/bot-config'

const s = CUBE_SIZE
const yOf = (g: number): number => g * s + s / 2 // ряд 0 — низ (стопы), центр ряда

interface Ctx {
  voxels: Voxel[]
  nextId: number
  eyeColor: number
}

function addVoxel(
  ctx: Ctx,
  type: VoxelType,
  x: number, y: number, z: number,
  size: number,
  limb: LimbId,
  parent: number,
  opts?: { color?: number; detachable?: boolean; isSkeleton?: boolean; glow?: boolean; emissiveIntensity?: number }
): Voxel {
  const isSkeleton = opts?.isSkeleton ?? false
  const baseColor = opts?.color ?? (type === 'armor' ? COLORS.armor : COLORS.skeleton)
  const v: Voxel = {
    id: ctx.nextId++,
    type,
    x, y, z,
    size,
    hp: LAYER_HP[type],
    maxHp: LAYER_HP[type],
    damageTaken: 0,
    destroyed: false,
    color: baseColor,
    metalness: MATERIALS[type === 'armor' ? 'armor' : isSkeleton ? 'skeleton' : type === 'camera' ? 'camera' : type === 'motherboard' ? 'motherboard' : type === 'gyroscope' ? 'gyroscope' : 'battery'].metalness,
    roughness: MATERIALS[type === 'armor' ? 'armor' : isSkeleton ? 'skeleton' : type === 'camera' ? 'camera' : type === 'motherboard' ? 'motherboard' : type === 'gyroscope' ? 'gyroscope' : 'battery'].roughness,
    emissive: 0,
    emissiveIntensity: opts?.emissiveIntensity ?? 0,
    limb,
    parent,
    detachable: opts?.detachable ?? true,
    isSkeleton,
    glow: opts?.glow ?? false,
  }
  ctx.voxels.push(v)
  return v
}

export function buildBot(eyeColor: number): BotData {
  const ctx: Ctx = { voxels: [], nextId: 0, eyeColor }
  const V = ctx.voxels

  // ---------- СКЕЛЕТ (68 кубов) ----------
  // Позвоночник: грудь g15(корень)→g13, живот g12→g10, z=0,x=0
  const spine: number[] = []
  for (const g of [15, 14, 13, 12, 11, 10]) {
    const parent = spine.length === 0 ? -1 : spine[spine.length - 1]
    const v = addVoxel(ctx, 'skeleton', 0, yOf(g), 0, s, 'spine', parent, { isSkeleton: true, detachable: false })
    spine.push(v.id)
  }
  // Рёбра (6): g13–15, z ∓0.25
  const ribs: number[] = []
  for (const g of [13, 14, 15]) {
    for (const zz of [-0.25, 0.25]) {
      ribs.push(addVoxel(ctx, 'skeleton', 0, yOf(g), zz, s, 'spine', spine[[13, 14, 15].indexOf(g)], { isSkeleton: true, detachable: false }).id)
    }
  }
  // Плечевая перекладина (5): g15, z −0.5..+0.5
  const crossbar: number[] = []
  for (const c of [2, 3, 4, 5, 6]) {
    const z = (c - 4) * s
    const parent = c === 4 ? spine[2] : crossbar[Math.abs(c - 4) - 1] ?? spine[2]
    crossbar.push(addVoxel(ctx, 'skeleton', 0, yOf(15), z, s, 'crossbar', c === 2 || c === 6 ? spine[2] : parent, { isSkeleton: true, detachable: false }).id)
  }
  // Грудные кости (18): вторая колонка скелета груди — грудная клетка ГЛУБЖЕ живота,
  // обшивка груди сидит на них ВПЛОТНУЮ (внешняя грань 0.375):
  // g13–14 — по 4 куба (x=±0.25, z=±0.125) вокруг материнской платы,
  // g15 — по 5 кубов (x=±0.25) вдоль перекладины плеч
  const chestBones: number[] = []
  const spineRow: Record<number, number> = { 15: 0, 14: 1, 13: 2 }
  for (const g of [13, 14]) {
    for (const zz of [-0.125, 0.125]) {
      chestBones.push(addVoxel(ctx, 'skeleton', 0.25, yOf(g), zz, s, 'spine', spine[spineRow[g]], { isSkeleton: true, detachable: false }).id)
      chestBones.push(addVoxel(ctx, 'skeleton', -0.25, yOf(g), zz, s, 'spine', spine[spineRow[g]], { isSkeleton: true, detachable: false }).id)
    }
  }
  const zb = [-0.5, -0.25, 0, 0.25, 0.5]
  for (const z of zb) {
    const par = crossbar[zb.indexOf(z)]
    chestBones.push(addVoxel(ctx, 'skeleton', 0.25, yOf(15), z, s, 'crossbar', par, { isSkeleton: true, detachable: false }).id)
    chestBones.push(addVoxel(ctx, 'skeleton', -0.25, yOf(15), z, s, 'crossbar', par, { isSkeleton: true, detachable: false }).id)
  }
  // Шея скелет (1)
  const neckSkel = addVoxel(ctx, 'skeleton', 0, yOf(16), 0, s, 'neck', spine[2], { isSkeleton: true, detachable: false }).id
  // Голова скелет (8): 2×2×2
  const headSkel: number[] = []
  for (const g of [17, 18]) {
    for (const zz of [-0.125, 0.125]) {
      for (const xx of [-0.125, 0.125]) {
        headSkel.push(addVoxel(ctx, 'skeleton', xx, yOf(g), zz, s, 'head', neckSkel, { isSkeleton: true, detachable: false }).id)
      }
    }
  }
  // Руки (18 скелет + 2 обшивка кулака): цепь по 9 с каждой стороны.
  // ПОСЛЕДНИЙ куб цепи (g7, у кулака) — КУБ ОБШИВКИ: бьющая поверхность —
  // обшивка, голый скелет на кулаке не виден. Пропорции руки сохранены.
  const armChains: { cubes: number[]; side: -1 | 1 }[] = []
  for (const side of [-1, 1] as const) {
    const cubes: number[] = []
    for (let i = 0; i < 9; i++) {
      const g = 15 - i
      const parent = i === 0 ? crossbar[0] : cubes[i - 1]
      const isFist = i === 8
      cubes.push(addVoxel(ctx, isFist ? 'armor' : 'skeleton', 0, yOf(g), side * 0.875, s, side < 0 ? 'armL' : 'armR', parent, { isSkeleton: !isFist, detachable: false }).id)
    }
    armChains.push({ cubes, side })
  }
  // Таз скелет (2): перекладина g8, z ∓0.125
  const pelvisSkel: number[] = []
  for (const zz of [-0.125, 0.125]) {
    pelvisSkel.push(addVoxel(ctx, 'skeleton', 0, yOf(8), zz, s, 'spine', spine[5], { isSkeleton: true, detachable: false }).id)
  }
  // Ноги (18): цепь по 9: бедро g8(hip)→g5, голень g4→g2, g1, g0
  const legChains: { cubes: number[]; side: -1 | 1 }[] = []
  for (const side of [-1, 1] as const) {
    const cubes: number[] = []
    for (let i = 0; i < 9; i++) {
      const g = 8 - i
      const parent = i === 0 ? (side < 0 ? pelvisSkel[0] : pelvisSkel[1]) : cubes[i - 1]
      cubes.push(addVoxel(ctx, 'skeleton', 0, yOf(g), side * 0.375, s, side < 0 ? 'legL' : 'legR', parent, { isSkeleton: true, detachable: false }).id)
    }
    legChains.push({ cubes, side })
  }
  // Стопы скелет (4): по 2 на ногу, чуть вперёд
  for (const leg of legChains) {
    const side = leg.side
    addVoxel(ctx, 'skeleton', 0.125, yOf(1), side * 0.375, s, side < 0 ? 'legL' : 'legR', leg.cubes[8], { isSkeleton: true, detachable: false })
    addVoxel(ctx, 'skeleton', 0.125, yOf(0), side * 0.375, s, side < 0 ? 'legL' : 'legR', leg.cubes[8], { isSkeleton: true, detachable: false })
  }

  // ---------- ОБШИВКА — плотная оболочка ВОКРУГ скелета и компонентов ----------
  // Каждая пластина прилегает ВПЛОТНУЮ: её внутренняя грань = внешняя грань
  // скелета/компонента, который она закрывает (без зазоров и наложений).
  // Голова — квадратный шлем 1×1 (визор спереди на g18 — глаза-камеры).
  const nearCube = (cands: number[], x: number, y: number, z: number): number => {
    let best = cands[0], bd = Infinity
    for (const id of cands) {
      const v = V[id]
      const d = (v.x - x) ** 2 + (v.y - y) ** 2 + (v.z - z) ** 2
      if (d < bd) { bd = d; best = id }
    }
    return best
  }

  // Голова (36): КВАДРАТНЫЙ шлем вокруг черепа 2×2×2 (g17–18): пластины x=±0.375
  // (вплотную к грани черепа 0.25), борта z=±0.375; на g18 фронт открыт — «визор» глаз;
  // сверху крышка 4×4 (g19) — вровень со стенками шлема, силуэт строго квадратный
  for (const z of [-0.375, -0.125, 0.125, 0.375]) {
    addVoxel(ctx, 'armor', 0.375, yOf(17), z, s, 'head', nearCube(headSkel, 0.375, yOf(17), z), { detachable: false })
    addVoxel(ctx, 'armor', -0.375, yOf(17), z, s, 'head', nearCube(headSkel, -0.375, yOf(17), z), { detachable: false })
  }
  for (const x of [-0.125, 0.125]) {
    for (const z of [-0.375, 0.375]) {
      addVoxel(ctx, 'armor', x, yOf(17), z, s, 'head', nearCube(headSkel, x, yOf(17), z), { detachable: false })
    }
  }
  // g18: тыл (фронт — визор) + борта
  for (const z of [-0.375, -0.125, 0.125, 0.375]) {
    addVoxel(ctx, 'armor', -0.375, yOf(18), z, s, 'head', nearCube(headSkel, -0.375, yOf(18), z), { detachable: false })
  }
  for (const x of [-0.125, 0.125]) {
    for (const z of [-0.375, 0.375]) {
      addVoxel(ctx, 'armor', x, yOf(18), z, s, 'head', nearCube(headSkel, x, yOf(18), z), { detachable: false })
    }
  }
  // g19: КВАДРАТНАЯ крышка 4×4 — вровень со стенками шлема (x/z ±0.5)
  for (const z of [-0.375, -0.125, 0.125, 0.375]) {
    for (const x of [-0.375, -0.125, 0.125, 0.375]) {
      addVoxel(ctx, 'armor', x, yOf(19), z, s, 'head', nearCube(headSkel, x, yOf(19), z), { detachable: false })
    }
  }
  // Шея обшивка (4): кольцо вокруг куба шеи
  addVoxel(ctx, 'armor', 0.25, yOf(16), 0, s, 'neck', neckSkel, { detachable: false })
  addVoxel(ctx, 'armor', -0.25, yOf(16), 0, s, 'neck', neckSkel, { detachable: false })
  addVoxel(ctx, 'armor', 0, yOf(16), -0.25, s, 'neck', neckSkel, { detachable: false })
  addVoxel(ctx, 'armor', 0, yOf(16), 0.25, s, 'neck', neckSkel, { detachable: false })
  // Грудь (42): коробка ВПЛОТНУЮ к грудным костям (грань 0.375) — сечение 1.25×1.25,
  // БОЛЬШЕ живота (1.0×1.0): перед/тыл x=±0.5 (z −0.25..0.25), углы (±0.5, ±0.5),
  // борта z=±0.5 (x −0.25..0.25, вплотную к грани рёбер 0.375);
  // на g15 — ряд перекладины плеч: сплошной фронт/тыл из 5 пластин x=±0.5
  // (вплотную к грудным костям, борта открыты — суставы)
  const chestInner = [...spine.slice(0, 3), ...ribs, ...crossbar, ...chestBones]
  for (const g of [13, 14]) {
    for (const z of [-0.25, 0, 0.25]) {
      addVoxel(ctx, 'armor', 0.5, yOf(g), z, s, 'spine', nearCube(chestInner, 0.5, yOf(g), z), { detachable: false })
      addVoxel(ctx, 'armor', -0.5, yOf(g), z, s, 'spine', nearCube(chestInner, -0.5, yOf(g), z), { detachable: false })
    }
    for (const x of [-0.5, 0.5]) {
      for (const z of [-0.5, 0.5]) {
        addVoxel(ctx, 'armor', x, yOf(g), z, s, 'spine', nearCube(chestInner, x, yOf(g), z), { detachable: false })
      }
    }
    for (const x of [-0.25, 0, 0.25]) {
      for (const z of [-0.5, 0.5]) {
        addVoxel(ctx, 'armor', x, yOf(g), z, s, 'spine', nearCube(chestInner, x, yOf(g), z), { detachable: false })
      }
    }
  }
  for (const z of [-0.5, -0.25, 0, 0.25, 0.5]) {
    addVoxel(ctx, 'armor', 0.5, yOf(15), z, s, 'spine', nearCube(chestInner, 0.5, yOf(15), z), { detachable: false })
    addVoxel(ctx, 'armor', -0.5, yOf(15), z, s, 'spine', nearCube(chestInner, -0.5, yOf(15), z), { detachable: false })
  }
  // Живот (36): плотная оболочка вокруг аккумулятора (2×2, грани ±0.25) и
  // позвоночника (гироскоп перенесён в голову — «мозг»):
  // перед/тыл x=±0.375 (z ±0.125), борта z=±0.375 (x ±0.125), углы закрыты;
  // кисти рук (z=±0.875) свободно проходят снаружи бортов
  for (const g of [10, 11, 12]) {
    for (const z of [-0.125, 0.125]) {
      addVoxel(ctx, 'armor', 0.375, yOf(g), z, s, 'spine', nearCube(spine.slice(3), 0.375, yOf(g), z), { detachable: false })
      addVoxel(ctx, 'armor', -0.375, yOf(g), z, s, 'spine', nearCube(spine.slice(3), -0.375, yOf(g), z), { detachable: false })
    }
    for (const x of [-0.125, 0.125]) {
      for (const z of [-0.375, 0.375]) {
        addVoxel(ctx, 'armor', x, yOf(g), z, s, 'spine', nearCube(spine.slice(3), x, yOf(g), z), { detachable: false })
      }
    }
    for (const x of [-0.375, 0.375]) {
      for (const z of [-0.375, 0.375]) {
        addVoxel(ctx, 'armor', x, yOf(g), z, s, 'spine', nearCube(spine.slice(3), x, yOf(g), z), { detachable: false })
      }
    }
  }
  // Таз (16): фронт только по краям (щель-«вентиляция» под светящуюся полосу заряда
  // аккумулятора, g8–g9); тыл g9 вплотную к бортам/тылу аккумулятора (грани 0.25),
  // тыл g8 вплотную к тазовым кубам (грань 0.125); борта g9 — вплотную и вровень
  // с бортами живота; ноги (g8, z=±0.375) — в стык с фронтовыми колоннами
  for (const g of [8, 9]) {
    for (const z of [-0.375, 0.375]) {
      addVoxel(ctx, 'armor', 0.25, yOf(g), z, s, 'spine', nearCube(pelvisSkel, 0.25, yOf(g), z), { detachable: false })
    }
  }
  for (const z of [-0.125, 0.125]) {
    addVoxel(ctx, 'armor', -0.25, yOf(8), z, s, 'spine', nearCube(pelvisSkel, -0.25, yOf(8), z), { detachable: false })
  }
  for (const z of [-0.375, -0.125, 0.125, 0.375]) {
    addVoxel(ctx, 'armor', -0.375, yOf(9), z, s, 'spine', nearCube(pelvisSkel, -0.375, yOf(9), z), { detachable: false })
  }
  for (const x of [-0.125, 0.125]) {
    for (const z of [-0.375, 0.375]) {
      addVoxel(ctx, 'armor', x, yOf(9), z, s, 'spine', nearCube(pelvisSkel, x, yOf(9), z), { detachable: false })
    }
  }
  // Руки (52): кольцо ВПЛОТНУЮ к цепи (z=±0.875, грань кости 0.125): перед/тыл x=±0.25;
  // только предплечье — внутренняя грань z=side*0.625 (вплотную к грани кости 0.75,
  // снаружи живота). Пластины привязываются ТОЛЬКО к скелетным кубам цепи
  // (куб кулака — обшивка, отсечения идут от скелета).
  for (const arm of armChains) {
    const side = arm.side
    const limb: LimbId = side < 0 ? 'armL' : 'armR'
    const armSkel = arm.cubes.slice(0, 8) // скелетная часть цепи (g15..g8)
    for (const g of [7, 8, 9, 10, 11, 12, 13, 14, 15]) {
      addVoxel(ctx, 'armor', 0.25, yOf(g), side * 0.875, s, limb, nearCube(armSkel, 0.25, yOf(g), side * 0.875), { detachable: false })
      addVoxel(ctx, 'armor', -0.25, yOf(g), side * 0.875, s, limb, nearCube(armSkel, -0.25, yOf(g), side * 0.875), { detachable: false })
    }
    for (const g of [10, 11, 12]) {
      addVoxel(ctx, 'armor', 0, yOf(g), side * 0.625, s, limb, nearCube(armSkel, 0, yOf(g), side * 0.625), { detachable: false })
    }
  }
  // Кулак: последняя секция — КУБ ОБШИВКИ (g7), вровень с профилем руки:
  // перед/тыл закрывают кольцевые пластины x=±0.25 (см. выше), наружная грань —
  // собственная грань куба обшивки. НИКАКИХ выступающих пластин (внутрь/наружу/низ
  // убраны — они удлиняли руку на куб и делали кулак когтевидным). Силуэт кулака —
  // квадратный, длина руки = прежней цепи из 9 кубов.
  // Наплечники (8): ВПЛОТНУЮ к внешней грани плеча (z=side*1.125, грань 1.0),
  // вровень с пластинами перед/тыл (x=±0.25)
  for (const arm of armChains) {
    const side = arm.side
    const limb: LimbId = side < 0 ? 'armL' : 'armR'
    for (const g of [14, 15]) {
      for (const x of [-0.25, 0.25]) {
        addVoxel(ctx, 'armor', x, yOf(g), side * 1.125, s, limb, nearCube(arm.cubes.slice(0, 2), x, yOf(g), side * 1.125), { detachable: false })
      }
    }
  }
  // Ноги (48): замкнутое кольцо ВПЛОТНУЮ к цепи (z=side*0.375, грани кости 0.125/0.25/0.5):
  // перед/тыл x=±0.25, внутренняя z=side*0.125 и внешняя z=side*0.625;
  // коленные/голеностопные суставы видны в зазоре между гранями
  for (const leg of legChains) {
    const side = leg.side
    const limb: LimbId = side < 0 ? 'legL' : 'legR'
    for (const g of [2, 3, 4, 5, 6, 7]) {
      addVoxel(ctx, 'armor', 0.25, yOf(g), side * 0.375, s, limb, nearCube(leg.cubes.slice(1, 7), 0.25, yOf(g), side * 0.375), { detachable: false })
      addVoxel(ctx, 'armor', -0.25, yOf(g), side * 0.375, s, limb, nearCube(leg.cubes.slice(1, 7), -0.25, yOf(g), side * 0.375), { detachable: false })
      addVoxel(ctx, 'armor', 0, yOf(g), side * 0.125, s, limb, nearCube(leg.cubes.slice(1, 7), 0, yOf(g), side * 0.125), { detachable: false })
      addVoxel(ctx, 'armor', 0, yOf(g), side * 0.625, s, limb, nearCube(leg.cubes.slice(1, 7), 0, yOf(g), side * 0.625), { detachable: false })
    }
  }
  // Стопы (16): пластины ВПЛОТНУЮ к скелету стопы (x 0..0.25, борт 0.25..0.5):
  // перед x=0.375 (грань 0.25), тыл x=−0.125 (грань 0), внешний борт z=side*0.625
  // (грань 0.5, x 0.125/0.375)
  for (const leg of legChains) {
    const side = leg.side
    const limb: LimbId = side < 0 ? 'legL' : 'legR'
    for (const g of [0, 1]) {
      for (const x of [-0.125, 0.375]) {
        addVoxel(ctx, 'armor', x, yOf(g), side * 0.375, s, limb, nearCube(leg.cubes.slice(8), x, yOf(g), side * 0.375), { detachable: false })
      }
      for (const x of [0.125, 0.375]) {
        addVoxel(ctx, 'armor', x, yOf(g), side * 0.625, s, limb, nearCube(leg.cubes.slice(8), x, yOf(g), side * 0.625), { detachable: false })
      }
    }
  }

  // ---------- СУСТАВНЫЕ АКЦЕНТЫ (12 красных кубиков 0.5×0.5×0.5 базового куба) ----------
  const J = JOINT_SIZE
  const jz = 0.875, lzn = 0.375
  for (const side of [-1, 1] as const) {
    const arm = armChains[side < 0 ? 0 : 1]
    const leg = legChains[side < 0 ? 0 : 1]
    const limb: LimbId = side < 0 ? 'armL' : 'armR'
    const legLimb: LimbId = side < 0 ? 'legL' : 'legR'
    addVoxel(ctx, 'skeleton', 0, 4.0, side * (jz - 0.19), J, limb, arm.cubes[0], { isSkeleton: true, detachable: false, color: COLORS.joint })
    addVoxel(ctx, 'skeleton', 0, 3.25, side * jz, J, limb, arm.cubes[3], { isSkeleton: true, detachable: false, color: COLORS.joint })
    addVoxel(ctx, 'skeleton', 0, 2.5, side * jz, J, limb, arm.cubes[6], { isSkeleton: true, detachable: false, color: COLORS.joint })
    addVoxel(ctx, 'skeleton', 0, 2.25, side * lzn, J, legLimb, leg.cubes[0], { isSkeleton: true, detachable: false, color: COLORS.joint })
    addVoxel(ctx, 'skeleton', 0, 1.25, side * lzn, J, legLimb, leg.cubes[4], { isSkeleton: true, detachable: false, color: COLORS.joint })
    addVoxel(ctx, 'skeleton', 0, 0.5, side * lzn, J, legLimb, leg.cubes[7], { isSkeleton: true, detachable: false, color: COLORS.joint })
  }

  // ---------- ВНУТРЕННИЕ КОМПОНЕНТЫ (ТЗ 4.6) ----------
  const components: ComponentState[] = []
  const compVoxels: Voxel[] = []

  // Камеры (глаза): 2 куба на передней грани головы
  const eyeIds: number[] = []
  for (const zz of [-0.155, 0.155]) {
    const v = addVoxel(ctx, 'camera', 0.38, 4.625, zz, s, 'head', headSkel[0], {
      color: ctx.eyeColor, detachable: true, glow: true, emissiveIntensity: EMISSIVE.camera,
    })
    v.emissive = ctx.eyeColor
    eyeIds.push(v.id)
    compVoxels.push(v)
  }
  components.push({ type: 'camera', hp: LAYER_HP.camera, maxHp: LAYER_HP.camera, health: 'intact', voxelIds: eyeIds })

  // Материнская плата: 2×2×1 в центре груди + микросхемы
  const mbIds: number[] = []
  for (const g of [13, 14]) {
    for (const zz of [-0.125, 0.125]) {
      mbIds.push(addVoxel(ctx, 'motherboard', 0, yOf(g), zz, s, 'spine', spine[[13, 14].indexOf(g)], { detachable: true, color: COLORS.motherboard }).id)
    }
  }
  // Микросхемы 0.2×0.2×0.1 → мелкие кубики 0.09 (внутри платы, за обшивкой груди)
  for (const [yy, zz] of [[3.68, -0.05], [3.6, 0.06], [3.52, 0]] as const) {
    mbIds.push(addVoxel(ctx, 'motherboard', 0.05, yy, zz, 0.09, 'spine', mbIds[0], { detachable: true, color: COLORS.chip }).id)
  }
  components.push({ type: 'motherboard', hp: LAYER_HP.motherboard, maxHp: LAYER_HP.motherboard, health: 'intact', voxelIds: [...mbIds] })

  // Гироскоп: «МОЗГ» — 2×2×2 половинных куба (0.125) в САМОМ СЕРЕДИНЕ черепа
  // (пересечение всех 8 кубов черепа 2×2×2, g17–18). Скрыт скелетом головы:
  // доступен только после разбора черепа (первый контакт — скелет, гироскоп
  // открывается по мере разрушения кубов). Привязан к шее: отсечённая голова
  // уносит гироскоп с собой.
  const gyroIds: number[] = []
  for (const yy of [4.5 - 0.0625, 4.5 + 0.0625]) {
    for (const zz of [-0.0625, 0.0625]) {
      for (const xx of [-0.0625, 0.0625]) {
        gyroIds.push(addVoxel(ctx, 'gyroscope', xx, yy, zz, 0.125, 'head', neckSkel, { detachable: true, color: COLORS.gyroscope }).id)
      }
    }
  }
  components.push({ type: 'gyroscope', hp: LAYER_HP.gyroscope, maxHp: LAYER_HP.gyroscope, health: 'intact', voxelIds: [...gyroIds] })

  // Аккумулятор: 2×3×2 на границе живота/таза + полосы индикаторов
  const batIds: number[] = []
  for (const g of [9, 10]) {
    for (const zz of [-0.125, 0.125]) {
      for (const xx of [-0.125, 0.125]) {
        batIds.push(addVoxel(ctx, 'battery', xx, yOf(g), zz, s, 'spine', spine[g === 9 ? 5 : 4], { detachable: true, color: COLORS.battery }).id)
      }
    }
  }
  // Полосы индикатора заряда (свечение #1a3a5c) — на фронте таза, в «вентиляции»
  const stripeIds: number[] = []
  for (const yy of [2.42, 2.22]) {
    const v = addVoxel(ctx, 'battery', 0.26, yy, 0, 0.14, 'spine', batIds[0], { detachable: true, color: COLORS.batteryGlow, glow: true, emissiveIntensity: EMISSIVE.batteryGlow })
    v.emissive = COLORS.batteryGlow
    stripeIds.push(v.id)
  }
  components.push({ type: 'battery', hp: LAYER_HP.battery, maxHp: LAYER_HP.battery, health: 'intact', voxelIds: [...batIds, ...stripeIds] })

  // ---------- Проверка лимита (ТЗ 4.1: юнит-проверка ≤1000) ----------
  const total = ctx.voxels.length
  if (total > MAX_CUBES_PER_BOT) {
    console.error(`[BotFactory] ЛИМИТ ПРЕВЫШЕН: ${total} > ${MAX_CUBES_PER_BOT}`)
  }

  const joints = {
    shoulderL: { x: 0, y: 4.0, z: -0.875 }, shoulderR: { x: 0, y: 4.0, z: 0.875 },
    elbowL: { x: 0, y: 3.25, z: -0.875 }, elbowR: { x: 0, y: 3.25, z: 0.875 },
    hipL: { x: 0, y: 2.25, z: -0.375 }, hipR: { x: 0, y: 2.25, z: 0.375 },
    kneeL: { x: 0, y: 1.25, z: -0.375 }, kneeR: { x: 0, y: 1.25, z: 0.375 },
    neck: { x: 0, y: 4.25, z: 0 },
  }
  const componentPos: BotData['componentPos'] = {
    camera: { x: 0.38, y: 4.625, z: 0 },
    motherboard: { x: 0.05, y: 3.625, z: 0 },
    gyroscope: { x: 0, y: 4.5, z: 0 },
    battery: { x: 0, y: 2.5, z: 0 },
  }

  return {
    voxels: ctx.voxels,
    components,
    height: 5.0,
    halfWidthZ: 1.375,
    totalCubes: total,
    joints,
    componentPos,
  }
}
