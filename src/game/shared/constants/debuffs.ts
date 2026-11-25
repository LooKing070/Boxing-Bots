// Дебаффы (TZ-UPDATE §3.3, UPD-11 — уточнённые числа шатаний гироскопа)
export const DEBUFFS = {
  /** Материнская плата повреждена: задержка ввода 500 мс ТОЛЬКО для действий A–D (удары/блоки; движение не задерживается) */
  motherboardInputDelayMs: 500,
  /** Аккумулятор повреждён: сила удара ×0.7 (DEBUFF_FORCE_MULT); тусклые глаза */
  batteryForceMult: 0.7,
  /** Гироскоп повреждён: скорость ×0.6 (DEBUFF_SPEED_MULT); wobble ±3°; крены до 20° при ударах */
  gyroSpeedMult: 0.6,
  gyroWobbleDeg: 3,
  gyroTiltDeg: 20,
  /** Гироскоп уничтожен: скорость ×0.5 (DEBUFF_SPEED_MULT_DESTROYED); сильное шатание ±6° с периодом 0.8с, фаза случайна */
  gyroSpeedMultDestroyed: 0.5,
  gyroDestWobbleDeg: 6,
  gyroDestWobblePeriodS: 0.8,
  /** Нет ноги: скорость ×0.3 (DEBUFF_NOLEG_MULT) */
  nolegMult: 0.3,
  /** Камеры повреждены: виньетка 0.6; уничтожены: виньетка 0.9 + шум 2% (бой продолжается) */
  cameraVignette: 0.6,
  cameraDestroyedVignette: 0.9,
  noiseDestroyed: 0.02,
  /** Глитч материнской платы — только на модели бота: RGB shift + смещения 1–2 кубов на 1–2 кадра */
  glitchShiftCubesMin: 1,
  glitchShiftCubesMax: 2,
  glitchFramesMin: 1,
  glitchFramesMax: 2,
} as const

export const DEBUFF_LABELS = {
  motherboard: 'Задержка ударов/блоков 0.5 с',
  battery: 'Сила удара −30%',
  gyro: 'Скорость −40%, шатание ±3°',
  gyroDestroyed: 'Скорость −50%, сильное шатание',
  camera: 'Виньетка',
  cameraDestroyed: 'Сильная виньетка + шум',
} as const
