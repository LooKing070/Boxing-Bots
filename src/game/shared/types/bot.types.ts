// Типы бота (ТЗ разделы 4, 5, 12.3)

/** Тип вокселя = слой бота */
export type VoxelType = 'armor' | 'skeleton' | 'camera' | 'motherboard' | 'gyroscope' | 'battery'

/** Части тела для графа отсечения */
export type LimbId =
  | 'spine'      // корневая цепь: грудь → живот → таз
  | 'neck'
  | 'head'
  | 'crossbar'   // плечевая перекладина
  | 'armL'
  | 'armR'
  | 'legL'
  | 'legR'

/** Один куб бота */
export interface Voxel {
  id: number
  type: VoxelType
  /** Позиция покоя в локальном пространстве бота (юниты). Локально бот смотрит в +X */
  x: number
  y: number
  z: number
  /** Длина ребра куба (0.25 базовый, 0.5 суставы) */
  size: number
  hp: number
  maxHp: number
  damageTaken: number
  destroyed: boolean
  /** Цвет (hex) */
  color: number
  metalness: number
  roughness: number
  emissive: number
  emissiveIntensity: number
  /** Часть тела для отсечения */
  limb: LimbId
  /** id родительского вокселя в графе отсечения (-1 = корень) */
  parent: number
  /** Может ли куб отделиться от робота (все части и компоненты отваливаются) */
  detachable: boolean
  /** Является ли куб узлом скелета (уменьшается от урона) */
  isSkeleton: boolean
  /** Свечение (глаза, полосы аккумулятора) */
  glow: boolean
}

/** Состояние внутреннего компонента (ТЗ 5.4) */
export type ComponentHealth = 'intact' | 'damaged' | 'destroyed'

export interface ComponentState {
  type: 'camera' | 'motherboard' | 'gyroscope' | 'battery'
  hp: number
  maxHp: number
  health: ComponentHealth
  /** id вокселей, составляющих компонент */
  voxelIds: number[]
}

/** Сгенерированный бот (данные, без рендера) */
export interface BotData {
  voxels: Voxel[]
  components: ComponentState[]
  /** Габариты */
  height: number
  halfWidthZ: number
  totalCubes: number
  /** Позиции суставов для аниматора (локальные) */
  joints: {
    shoulderL: Vec3; shoulderR: Vec3
    elbowL: Vec3; elbowR: Vec3
    hipL: Vec3; hipR: Vec3
    kneeL: Vec3; kneeR: Vec3
    neck: Vec3
  }
  /** Позиции компонентов (для дебафф-эффектов/вспышек) */
  componentPos: Record<'camera' | 'motherboard' | 'gyroscope' | 'battery', Vec3>
}

export interface Vec3 {
  x: number
  y: number
  z: number
}
