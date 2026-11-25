// Физические и боевые константы — единый целевой набор (TZ-UPDATE §8, UPD-13).
// Все числовые значения проекта — только здесь (в документации — MECHANICS §8–9).

/** Фиксированный шаг физики — PHYS_STEP_HZ = 60 */
export const FIXED_DT = 1 / 60
export const PHYS_STEP_HZ = 60
export const MAX_FRAME_DT = 0.1

/** Арена — ARENA_SIZE=(20,1,6); ринг = КРЫША ЗДАНИЯ (новое): плоская крыша высотки,
 *  столбики с тросами — канатный забор. Забор можно ПЕРЕПРЫГНУТЬ: в воздухе клэмп
 *  шире, бот падает с крыши и возрождается в центре арены (без обшивки). */
export const ARENA = {
  platformLength: 20,
  platformThickness: 1,
  platformDepth: 6,
  platformColor: 0x4a4a5a,
  /** Крыша: тёмный битум / бетон кровли */
  roofColor: 0x3b3f46,
  /** Бетонный парапет по периметру крыши (декор) */
  parapetColor: 0x585d66,
  /** Фасад здания под крышей */
  facadeColor: 0x1c2129,
  edgeColor: 0x000000,
  postColor: 0x888888,
  postSize: { x: 0.5, y: 3, z: 0.5 },
  ropeColor: 0xcccccc,
  railHeight: 1.5,
  ropeLevels: 2,
  /** Границы движения бойцов по X (невидимые стены) */
  boundX: 9.2,
  platformTopY: 0,
  /** Полукрыши (platformLength/2): земля существует ТОЛЬКО над зданием; за краем — падение */
  roofHalfX: 10,
  /** Клэмп в воздухе: шире забора (столбики x=±9.5, тросы y=0.75..1.5) — канат можно
   *  перелететь и упасть с крыши */
  airBoundX: 10.9,
  /** Ниже этой высоты упавший бот считается сошедшим с крыши → респаун в центре */
  fallResetY: -14,
} as const

// Камера — CAM_FOV=30, CAM_POS=(0,5,18), CAM_LOOK=(0,3,0), CAM_LERP=0.05, FOV 25–35.
// Динамический ракурс (новое): чем дальше бот игрока к краю арены по X, тем сильнее
// камера поворачивается вокруг арены: левый край — ракурс 3/4 со спины,
// правый край — 3/4 спереди (при стартовой расстановке: игрок слева, противник справа).
export const CAMERA = {
  fov: 30,
  fovMin: 25,
  fovMax: 35,
  position: { x: 0, y: 5, z: 18 } as const,
  lookAt: { x: 0, y: 3, z: 0 } as const,
  lerp: 0.05,
  /** Максимальный угол поворота камеры на краю арены, градусы (ракурс 3/4) */
  dynaYawMaxDeg: 45,
} as const

/** Фон и свет (CITY_DIST=50; LIGHT_POS=(-5,10,5); LIGHT_INTENSITY=1.0; AMBIENT=0.3; EYE 0.5/3; гроза ×3/0.1с/8–20с) */
export const ENVIRONMENT = {
  camera: CAMERA,
  cityColor: 0x1a2a3a,
  cityDistance: 50,
  skyTop: 0x0a1520,
  skyBottom: 0x8899aa,
  cloudColor: 0x2a3a4a,
  dirLight: {
    pos: [-5, 10, 5] as const,
    color: 0xfff5e6,
    intensity: 1.0,
    shadowMapDesktop: 1024,
    shadowMapMobile: 512,
  },
  ambient: { color: 0x8899aa, intensity: 0.3 },
  eyeLight: { intensity: 0.5, distance: 3 },
  /** Гроза: вспышка-мерцание (молния + болт), интервалы 6–14 с; длительность окна мерцания */
  stormFlash: { multiplier: 3, duration: 0.26, intervalMin: 6, intervalMax: 14, doubleChance: 0.4, doubleDelay: 0.4 },
} as const

/** Размеры боевых хитбоксов: FIST_HITBOX_SIZE=0.75 (=3×VOXEL_SIZE); культя — VOXEL_SIZE */
export const FIST_HITBOX_SIZE = 0.75
export const VOXEL_HITBOX_SIZE = 0.25

/** Движение бойца — MOVE_SPEED=5.0; JUMP_FORCE=8.0; GRAVITY=-9.81; CROUCH_HEIGHT_MULT=0.6.
 *  Масса (новое требование): 1 живой куб бота = 1 кг (BOT_MASS_KG_PER_CUBE).
 *  Прыжок — импульсный: J = JUMP_FORCE · m₀ (м₀ — масса целого бота), vy = J / m
 *  → у целого бота vy = 8.0 (как раньше), у повреждённого (масса меньше) — выше,
 *  но не более JUMP_VEL_MAX. Гравитация одна для всех (не зависит от массы). */
export const BOT_MOVE = {
  walkSpeed: 5.0,
  crouchSpeed: 3.0,
  /** Базовая скорость отрыва от земли при полной массе (JUMP_FORCE) */
  jumpVelocity: 8.0,
  /** Потолок скорости прыжка (защита от сверхпрыжков сильно повреждённых ботов) */
  jumpVelMax: 11.0,
  /** Масса одного живого куба, кг (1 кубик = 1 кг) */
  kgPerCube: 1,
  gravity: -9.81,
  groundY: 0,
  boundX: ARENA.boundX,
  /** Квадратный коллайдер бота: половина стороны квадрата в плане (X = Z).
   *  Сталкивается ТОЛЬКО с коллайдером другого бота (не с ареной/мусором/ударами).
   *  Высота динамическая — BotEntity.collisionSpan(): стоя ~4.9 (сквозь не пройти),
   *  кувырок — группировка в компактный «шар» (проход НАД противником сальто),
   *  нокдаун — 1.2 (лежит), присед — ниже. 0.65+0.65 = 1.3 — грудь к груди. */
  botColliderHalf: 0.65,
  /** Нет ноги: скорость ×0.3 (DEBUFF_NOLEG_MULT) */
  nolegMult: 0.3,
  /** Удержание блока: ходьба ×0.5 */
  blockWalkMult: 0.5,
  /** Управление в воздухе (новое): доля скорости при удержании ←/→ в прыжке —
   *  позволяет перелететь канатный забор и упасть с крыши */
  airControl: 0.45,
} as const

/** Удары — модель «движение» (новая редакция: кадров больше нет, у удара одна
 *  конечная точка): ACTION_GAP_MS=200 (фаза возврата руки — единственная пауза
 *  между действиями); скорость движения 0.2–1.0 с (медленнее = сильнее);
 *  урон 2–10; EDITOR_RANGE=±2.75; KNOCKBACK_BASE=4.0.
 *  Отталкивание (новое): слайдер 0–10 (дефолт 0); +1 ед → −0.5 ед урона и
 *  +knockbackPerUnit к импульсу отброса.
 *  Кривая (новое): слайдер −5..+5 (0 = прямая) — изгиб траектории кисти от
 *  стойки к цели (квадратичная Безье, перпендикуляр к прямой rest→target).
 *  Попадание по противнику: фаза движения срезается немедленно, рука убирается
 *  в стойку за RETRACT_AFTER_HIT_MS=100 мс; после возврата руки любой слот
 *  удара/блока доступен сразу.
 *  Множественный урон БЕЗ пробития насквозь (новое): при контакте повреждаются
 *  ТОЛЬКО ПОВЕРХНОСТНЫЕ кубы задетой зоны (хитбокс + crushRadius от точки
 *  первого контакта) — перед которыми по направлению удара НЕТ живого куба.
 *  Удар по обшивке — урон обшивке; скелет за обшивкой и внутренние компоненты
 *  не повреждаются, пока не оголены; частично оголённый компонент, до которого
 *  кулак дотягивается первым, получает урон первым. Основной куб (ближайший)
 *  получает полный урон, остальные задетые — долю splashRatio. */
export const STRIKE = {
  actionGapMs: 200,
  /** Время анимации убирания бьющей руки в исходное положение после попадания, мс */
  retractAfterHitMs: 100,
  /** Скорость движения к цели (время), с — бывшая «длительность кадра» */
  speedMin: 0.2,
  speedMax: 1.0,
  strDmgMin: 2,
  strDmgMax: 10,
  /** Пол урона после вычета отталкивания (удар не становится безвредным) */
  dmgFloor: 1,
  /** Отталкивание: слайдер 0–10 (дефолт 0) */
  knockbackMax: 10,
  /** Цена отталкивания: +1 ед слайдера = −0.5 ед урона */
  damageCostPerKnockback: 0.5,
  /** Импульс отброса за единицу слайдера (поверх KNOCKBACK_BASE) */
  knockbackPerUnit: 0.8,
  /** Кривая траектории: −5..+5 (0 = прямая), масштаб изгиба — curveScale·curve */
  curveMax: 5,
  curveScale: 0.35,
  editorRange: 2.75,
  knockbackBase: 4.0,
  /** Затухание горизонтальной скорости отбрасывания */
  knockbackDecay: 6,
  /** Радиус запроса хитбокса кулака: FIST_HITBOX_SIZE/2 + пол-куба цели */
  fistQueryR: FIST_HITBOX_SIZE / 2 + 0.125,
  /** Радиус запроса хитбокса культи: VOXEL_SIZE/2 + пол-куба цели */
  stumpQueryR: VOXEL_HITBOX_SIZE / 2 + 0.125,
  /** Радиус зоны дробления вокруг точки первого контакта: задетые кубы в этом
   *  радиусе получают урон вместе с основным (несколько кубов от удара) */
  crushRadius: 0.32,
  /** Доля урона вторичным задетым кубам зоны (основной куб — полный урон) */
  splashRatio: 0.5,
  // Тест «первого контакта» — StrikeSystem.isSurfaceCube: куб поверхностный, если
  // НИ ОДИН живой куб цели не стоит перед ним по направлению удара (оси — от
  // хитбокса к первичному кубу) с перекрытием «колонны» (по полусуммам размеров,
  // вплотную сбоку стоящие кубы колонну не перекрывают).
} as const

/** Стамина блока — 100; тап −10; −10/с; +2/2с; поза блока 0.5с; 0 → прерывание без stagger */
export const STAMINA = {
  max: 100,
  tapCost: 10,
  holdCostPerSec: 10,
  regenAmount: 2,
  regenEverySec: 2,
  /** Удержание короче этого времени считается тапом */
  tapThresholdSec: 1.0,
  /** Скорость принятия позы блока (BLOCK_POSE_S=0.5) */
  blockPoseSec: 0.5,
} as const

/** Баффы блока — фиксированные значения (не передаются по сети):
 *  «Усиление» ×0.65 (BLOCK_REDUCTION_DEFAULT_PCT=35 ≤ 90); «Контратака» 8% (≤100%) */
export const BLOCK_BUFFS = {
  fortificationMultiplier: 0.65,
  counterstrikeRatio: 0.08,
  fortificationPct: 35,
  fortificationMaxPct: 90,
  counterstrikePct: 8,
  counterstrikeMaxPct: 100,
} as const

/** Нокдаун (UPD-07): падение 1.5с, подъём 0.4с */
export const KNOCKDOWN = {
  s: 1.5,
  recover: 0.4,
  /** Фаза падения на спину (до лежания) */
  fall: 0.35,
} as const

/** Автотурн (UPD-06): разворот при смене сторон — МГНОВЕННЫЙ (анимация поворота
 *  убрана, оба бота моментально стоят лицом друг к другу). Константы длительности
 *  оставлены для сетевой совместимости (локально не применяются). */
export const TURN = {
  base: 1.5,
  gyroDmg: 0.25,
  gyroDest: 0.5,
  mbDmg: 0.5,
  angle: 180,
} as const

/** Кувырок в прыжке (UPD-05): окно 0.25с, апекс 4.5, длина 5.0, один за прыжок */
export const AIRFLIP = {
  window: 0.25,
  apex: 4.5,
  dist: 5.0,
} as const

/** Лимиты производительности (PERF_): ≤300 тел; обломки 200/100; частицы 150/50 */
export const LIMITS = {
  particlesDesktop: 150,
  particlesMobile: 50,
  debrisDesktop: 200,
  debrisMobile: 100,
  maxPhysicsBodies: 300,
  particleLifeSec: 1.5,
  debrisSleepSec: 0.5,
  debrisRemoveSec: 5,
} as const

/** Анимации — дыхание грудью (меню, ТЗ 4.7): фазовая модель — грудь/плечи/шея
 *  ведущая (lag 0), живот тянется следом чуть медленнее (lag 0.5 рад), руки —
 *  медленнее груди (0.9), голова — вслед за шеёй ещё медленнее (1.3);
 *  амплитуда BREATH_AMP (1 Гц) у всех, таз/ноги на земле. Части тела жёсткие
 *  (без расслоения на кольца). WALK_AMP=0.3/2Гц */
export const ANIM = {
  breathAmplitude: 0.06,
  breathFrequency: 1,
  walkAmplitude: 0.3,
  walkFrequency: 2,
} as const

/** Матч — MATCH_DURATION_S=180; MATCH_COUNTDOWN_S=3 */
export const MATCH = {
  duration: 180,
  countdown: 3,
} as const

/** Экран победы (новое): боты стоят на месте — игрок слева (−standX), противник
 *  справа (+standX) — и медленно крутятся вокруг своей оси (оборот revolutionS секунд,
 *  бесконечный цикл 360°) для осмотра итогового состояния после боя. У победителя
 *  поднята правая рука (armRaiseS секунд подъём), проигравший — в исходной позе.
 *  Камера — статичный план обоих ботов (halfWidth — запас по ширине кадра). */
export const VICTORY = {
  standX: 3.2,
  revolutionS: 16,
  armRaiseS: 0.8,
  camY: 3.6,
  lookY: 2.9,
  halfWidth: 5.6,
  minDist: 13.5,
} as const

/** Надписи о повреждениях — FLOAT_TEXT_DURATION_S=2; FLOAT_TEXT_RISE=0.5 */
export const FLOATING_TEXT = {
  duration: 2,
  rise: 0.5,
} as const

/** Сеть — снапшоты строго 30 Гц; буфер 50мс; heartbeat 1 Гц; таймаут 3с; реконнект 10с */
export const NET = {
  snapshotHz: 30,
  inputBufferMs: 50,
  rollbackMaxFrames: 7,
  rollbackSmoothMs: 100,
  reconnectS: 30,
  heartbeatHz: 1,
  timeoutS: 3,
  roundDecimals: 3,
  presetBytesMax: 200,
} as const

/** Полоска стамины — только при активном блоке; 6px; градиент #3fa9e2→#7fd4ff; ширина 1.2 */
export const STAMINA_BAR = {
  heightPx: 6,
  widthUnits: 1.2,
  colorFrom: 0x3fa9e2,
  colorTo: 0x7fd4ff,
} as const

/** Пост-эффекты камер — виньетка 0.6/0.9 + шум 2% */
export const POSTFX = {
  vignetteDamaged: 0.6,
  vignetteDestroyed: 0.9,
  noiseDestroyed: 0.02,
} as const
