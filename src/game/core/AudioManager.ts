// AudioManager — процедурная звуковая система «Boxing-Bots» (ТЗ, раздел 10).
//
// СОСТАВ ЗВУКОВ → МАТЕРИАЛ ЦЕЛИ (ТЗ 10):
//   armor       — обшивка: металлический лязг/скрежет. Инхармоничные синус-партиалы
//                 (800/1300/2400 Гц, расстроенные) + короткий металлический шумовой
//                 всплеск (ФВЧ), decay 0.12–0.18 c.
//   skeleton    — скелет: «родня» обшивке — те же инхармоничные металлические
//                 партиалы, но ниже и ГЛУШЕ (приглушённые, с низким туком
//                 деформации), decay короче.
//   motherboard — материнская плата: электрический треск, помехи. Серия коротких
//                 тресковых щелчков (ФВЧ) + крошечные square-блипы.
//   battery     — аккумулятор: глухой пластиковый удар (ФНЧ-шум + синус 210→140 Гц)
//                 + низкочастотный гул 60 Гц с медленным затуханием.
//   gyroscope   — гироскоп: высокий металлический звон механизмов. 2100 + 3400 Гц
//                 с биениями, длинный звон decay ~0.5 c.
//   camera      — камеры: звон разбивающегося стекла + ВЧ-писк. ВЧ-шум 4–9 кГц
//                 + серия коротких высоких пингов (5.2–8.3 кГц).
//   destroy     — уничтожение компонента: громкий взрыв. Шумовой всплеск с ФНЧ-свипом
//                 вниз (3000→150 Гц) + саб-синус 55→38 Гц, ~0.55 c.
//   ui          — короткий тихий тик кнопки (не материал, системный).
//   victory     — восходящий мажорный аккорд-стингер (C4→E4→G4→C5), ≤1.2 c.
//   defeat      — нисходящий минорный аккорд-стингер (A4→E4→C4→A3), ≤1.2 c.
//   thunder     — гром (только бой, локально и в PvP): полноценный штормовой раскат
//                 ~5.6 c: треск разряда → ударная волна → серия перекатов-волн →
//                 далёкий гул-эхо. Каждая волна — свой шумовой слой со своим
//                 ФНЧ и огибающей (нарастание→спад), саб-синус держит низ.
//
// ДОЖДЬ (новое): отдельный зацикленный слой дождя (бой). Держится тихим фоном,
// при вспышке молнии взлетает громкостью (burstRain) — гроза звучит цельно.
//
// КАНАЛЫ ГРОМКОСТИ (новое): sfxVolume (все боевые/UI-звуки и стингеры) и
// musicVolume (эмбиенты + слой дождя) — независимые ползунки настроек поверх
// общей громкости Howler.
//
// ЭМБИЕНТ: тихий бесшовный фоновый луп в каждой сцене — menu (глубокий спокойный
// дрон с медленным биением и мягким городским воздухом) / battle (тёмный дрон +
// дальний гул грозы; дождь — отдельный слой). Не участвует в лимите голосов.
//
// ПРАВИЛА ТЗ 10:
//   - ЗВУКИ ШАГОВ ОТСУТСТВУЮТ — намеренно, запрещены ТЗ (никаких footstep-звуков).
//   - НЕ БОЛЕЕ 3 ОДНОВРЕМЕННЫХ ЗВУКОВ: счёт активных голосов через события
//     'end'/'stop'/'playerror' каждого Howl; при исчерпании лимита новые вызовы
//     play() молча ПРОПУСКАЮТСЯ (страховка от «утечки» голоса — по таймауту).
//   - Короткий decay у всех боевых звуков.
//
// Реализация: Howler.js v2.2.4 + рантайм-синтез 16-битного PCM WAV (22050 Гц, моно),
// упакованного в data URI `data:audio/wav;base64,...`. Аудио-файлов-ассетов НЕТ —
// всё генерируется в рантайме (синус-партиалы с экспоненциальным затуханием,
// шумовые всплески через однополюсные ФНЧ/ФВЧ, свипы частоты).
// Модуль браузерный (browser-only): на сервере (typeof window === 'undefined')
// все методы — no-op; недоступность AudioContext → disabled-флаг, no-op.

import { Howl, Howler } from 'howler'

// ---------------------------------------------------------------------------
// Константы
// ---------------------------------------------------------------------------

const SAMPLE_RATE = 22050 // Гц, моно, 16 бит
const MAX_VOICES = 3 // ТЗ 10: не более 3 одновременных звуков
const DEFAULT_VOLUME = 0.8
const RATE_VARIATION = 0.1 // случайная вариация скорости ±10%
const RATE_MIN = 0.5
const RATE_MAX = 2
const ATTACK_DEFAULT = 0.002 // с, антикликовый fade-in по умолчанию

export type SoundName =
  | 'armor'
  | 'skeleton'
  | 'motherboard'
  | 'battery'
  | 'gyroscope'
  | 'camera'
  | 'destroy'
  | 'ui'
  | 'victory'
  | 'defeat'
  | 'thunder'

const SOUND_NAMES: readonly SoundName[] = [
  'armor',
  'skeleton',
  'motherboard',
  'battery',
  'gyroscope',
  'camera',
  'destroy',
  'ui',
  'victory',
  'defeat',
  'thunder',
]

// Звуки без случайной вариации rate: UI-тик и стингеры (стабильный тон)
const NO_RATE_VARIATION: ReadonlySet<SoundName> = new Set<SoundName>(['ui', 'victory', 'defeat'])

export interface AudioManagerInitOptions {
  volume?: number
  muted?: boolean
  /** Канал боевых/UI звуков и стингеров (0..1) */
  sfxVolume?: number
  /** Канал эмбиентов и музыки (0..1) */
  musicVolume?: number
}

export interface PlayOptions {
  volume?: number
  rate?: number
}

interface SoundDef {
  dur: number // полная длительность, с (≤0.6 c; стингеры ≤1.2 c)
  volume: number // базовая громкость 0..1
  build: () => Float32Array // синтез сэмплов [-1..1]
}

// ---------------------------------------------------------------------------
// WAV-энкодер (16 бит PCM, 22050 Гц, моно → data URI)
// ---------------------------------------------------------------------------

const B64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

function toBase64(bytes: Uint8Array): string {
  let out = ''
  let i = 0
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2]
    out +=
      B64_ALPHABET[(n >> 18) & 63] +
      B64_ALPHABET[(n >> 12) & 63] +
      B64_ALPHABET[(n >> 6) & 63] +
      B64_ALPHABET[n & 63]
  }
  const rest = bytes.length - i
  if (rest === 1) {
    const n = bytes[i] << 16
    out += B64_ALPHABET[(n >> 18) & 63] + B64_ALPHABET[(n >> 12) & 63] + '=='
  } else if (rest === 2) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8)
    out += B64_ALPHABET[(n >> 18) & 63] + B64_ALPHABET[(n >> 12) & 63] + B64_ALPHABET[(n >> 6) & 63] + '='
  }
  return out
}

function writeAscii(view: DataView, offset: number, text: string): void {
  for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i))
}

/** Упаковка сэмплов [-1..1] в 16-битный PCM WAV (22050 Гц, моно) → data URI. */
function encodeWavDataUri(samples: Float32Array): string {
  // Мягкий пик-нормализатор: при пике >0.98 масштабируем вниз (анти-клиппинг)
  let peak = 0
  for (let i = 0; i < samples.length; i++) {
    const a = Math.abs(samples[i])
    if (a > peak) peak = a
  }
  const gain = peak > 0.98 ? 0.98 / peak : 1
  const dataSize = samples.length * 2
  const buffer = new ArrayBuffer(44 + dataSize)
  const view = new DataView(buffer)
  writeAscii(view, 0, 'RIFF')
  view.setUint32(4, 36 + dataSize, true)
  writeAscii(view, 8, 'WAVE')
  writeAscii(view, 12, 'fmt ')
  view.setUint32(16, 16, true) // размер fmt-чанка
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, 1, true) // моно
  view.setUint32(24, SAMPLE_RATE, true)
  view.setUint32(28, SAMPLE_RATE * 2, true) // байт/с
  view.setUint16(32, 2, true) // блок (сэмпл=2 байта)
  view.setUint16(34, 16, true) // бит на сэмпл
  writeAscii(view, 36, 'data')
  view.setUint32(40, dataSize, true)
  let offset = 44
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i] * gain))
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true)
    offset += 2
  }
  return 'data:audio/wav;base64,' + toBase64(new Uint8Array(buffer))
}

// ---------------------------------------------------------------------------
// Примитивы синтеза
// ---------------------------------------------------------------------------

/** Детерминированный PRNG (mulberry32) — повторяемый шум. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function createBuffer(dur: number): Float32Array {
  return new Float32Array(Math.max(1, Math.ceil(dur * SAMPLE_RATE)))
}

interface PartialOptions {
  freq: number // начальная частота, Гц
  freqEnd?: number // конечная частота (экспоненциальный свип высоты)
  t0?: number // старт, с
  dur: number // длительность, с
  decay: number // постоянная экспоненциального затухания, с
  amp: number // амплитуда 0..1
  attack?: number // антикликовый fade-in, с
}

/** Синус-партиал с экспоненциальным затуханием и опциональным свипом высоты. */
function addPartial(buf: Float32Array, o: PartialOptions): void {
  const start = Math.max(0, Math.floor((o.t0 ?? 0) * SAMPLE_RATE))
  const len = Math.min(buf.length - start, Math.floor(o.dur * SAMPLE_RATE))
  if (len <= 0) return
  const ratio = o.freqEnd !== undefined && o.freq > 0 ? o.freqEnd / o.freq : 1
  const sweep = ratio > 0 ? Math.pow(ratio, 1 / len) : 1
  const attackLen = Math.max(1, Math.floor((o.attack ?? ATTACK_DEFAULT) * SAMPLE_RATE))
  let freq = o.freq
  let phase = 0
  for (let i = 0; i < len; i++) {
    const env = Math.exp(-i / SAMPLE_RATE / o.decay) * Math.min(1, i / attackLen)
    buf[start + i] += Math.sin(phase) * o.amp * env
    phase += (2 * Math.PI * freq) / SAMPLE_RATE
    if (phase > 2 * Math.PI) phase -= 2 * Math.PI
    freq *= sweep
  }
}

interface NoiseOptions {
  t0?: number
  dur: number
  amp: number
  decay: number
  attack?: number
  lp?: number // однополюсный ФНЧ, Гц (без lp — белый шум)
  lpEnd?: number // свип ФНЧ к этой частоте к концу (требует lp)
  hp?: number // однополюсный ФВЧ (вычитание), Гц
  seed?: number
}

/** Шумовой всплеск через однополюсные ФНЧ/ФВЧ (каскад: LP → HP). */
function addNoise(buf: Float32Array, o: NoiseOptions): void {
  const start = Math.max(0, Math.floor((o.t0 ?? 0) * SAMPLE_RATE))
  const len = Math.min(buf.length - start, Math.floor(o.dur * SAMPLE_RATE))
  if (len <= 0) return
  const rand = mulberry32(o.seed ?? 1)
  const attackLen = Math.max(1, Math.floor((o.attack ?? ATTACK_DEFAULT) * SAMPLE_RATE))
  const lpStart = o.lp ?? 0
  const lpEnd = o.lpEnd ?? o.lp ?? 0
  const lpSweep = lpStart > 0 && lpEnd > 0 && lpStart !== lpEnd ? Math.pow(lpEnd / lpStart, 1 / len) : 1
  // Однополюсный ФНЧ сильно гасит белым шумом — компенсация усиления
  const comp = lpStart > 0 && o.hp === undefined ? 1.8 : 1
  let lpY = 0
  let hpY = 0
  let lpFreq = lpStart
  for (let i = 0; i < len; i++) {
    const raw = rand() * 2 - 1
    let x = raw
    if (lpFreq > 0) {
      const alphaLp = 1 - Math.exp((-2 * Math.PI * lpFreq) / SAMPLE_RATE)
      lpY += (raw - lpY) * alphaLp
      x = lpY
      lpFreq *= lpSweep
    }
    if (o.hp !== undefined && o.hp > 0) {
      const alphaHp = 1 - Math.exp((-2 * Math.PI * o.hp) / SAMPLE_RATE)
      hpY += (x - hpY) * alphaHp
      x -= hpY
    }
    const env = Math.exp(-i / SAMPLE_RATE / o.decay) * Math.min(1, i / attackLen)
    buf[start + i] += x * o.amp * comp * env
  }
}

interface SquareOptions {
  freq: number
  t0?: number
  dur: number
  amp: number
  decay?: number
  attack?: number
}

/** Крошечный square-блип (помехи материнской платы). */
function addSquare(buf: Float32Array, o: SquareOptions): void {
  const start = Math.max(0, Math.floor((o.t0 ?? 0) * SAMPLE_RATE))
  const len = Math.min(buf.length - start, Math.floor(o.dur * SAMPLE_RATE))
  if (len <= 0) return
  const attackLen = Math.max(1, Math.floor((o.attack ?? ATTACK_DEFAULT) * SAMPLE_RATE))
  const decay = o.decay ?? o.dur
  let phase = 0
  for (let i = 0; i < len; i++) {
    phase += o.freq / SAMPLE_RATE
    const square = phase % 1 < 0.5 ? 1 : -1
    const env = Math.exp(-i / SAMPLE_RATE / decay) * Math.min(1, i / attackLen)
    buf[start + i] += square * o.amp * env
  }
}

// ---------------------------------------------------------------------------
// Определения звуков (ТЗ 10)
// ---------------------------------------------------------------------------

const SOUND_DEFS: Record<SoundName, SoundDef> = {
  armor: {
    dur: 0.18,
    volume: 0.75,
    build: () => {
      const buf = createBuffer(0.18)
      // Инхармоничные расстроенные партиалы — металлический лязг
      addPartial(buf, { freq: 800 * 1.012, dur: 0.17, decay: 0.075, amp: 0.5 })
      addPartial(buf, { freq: 1300 * 0.994, dur: 0.17, decay: 0.085, amp: 0.34 })
      addPartial(buf, { freq: 2400 * 1.006, dur: 0.16, decay: 0.05, amp: 0.22 })
      // Короткий металлический шумовой всплеск — скрежет
      addNoise(buf, { dur: 0.07, amp: 0.34, decay: 0.028, hp: 1800, seed: 101 })
      return buf
    },
  },
  skeleton: {
    dur: 0.24,
    volume: 0.85,
    build: () => {
      const buf = createBuffer(0.24)
      // Те же инхармоничные партиалы, что у обшивки, но ниже — «глухая родня»
      addPartial(buf, { freq: 540 * 1.012, dur: 0.22, decay: 0.06, amp: 0.42 })
      addPartial(buf, { freq: 880 * 0.994, dur: 0.21, decay: 0.07, amp: 0.27 })
      addPartial(buf, { freq: 1520 * 1.006, dur: 0.18, decay: 0.04, amp: 0.13 })
      // Приглушённый металлический всплеск (задавлен ФНЧ — глухой)
      addNoise(buf, { dur: 0.08, amp: 0.34, decay: 0.03, lp: 1500, hp: 450, seed: 202 })
      // Низкий тук деформации кости
      addPartial(buf, { freq: 150, freqEnd: 92, dur: 0.2, decay: 0.09, amp: 0.4 })
      return buf
    },
  },
  motherboard: {
    dur: 0.45,
    volume: 0.6,
    build: () => {
      const buf = createBuffer(0.45)
      // Фоновые помехи
      addNoise(buf, { dur: 0.42, amp: 0.06, decay: 0.5, lp: 6000, seed: 305 })
      // Серия тресковых щелчков (случайные моменты/длины)
      const rand = mulberry32(304)
      for (let i = 0; i < 9; i++) {
        addNoise(buf, {
          t0: 0.01 + rand() * 0.38,
          dur: 0.012 + rand() * 0.014,
          amp: 0.16 + rand() * 0.2,
          decay: 0.008,
          hp: 1200 + rand() * 900,
          seed: 1000 + i * 7919,
        })
      }
      // Крошечные square-блипы
      addSquare(buf, { freq: 1860, t0: 0.05, dur: 0.02, amp: 0.1, decay: 0.012 })
      addSquare(buf, { freq: 2480, t0: 0.17, dur: 0.016, amp: 0.09, decay: 0.01 })
      addSquare(buf, { freq: 3140, t0: 0.29, dur: 0.022, amp: 0.08, decay: 0.012 })
      return buf
    },
  },
  battery: {
    dur: 0.45,
    volume: 0.7,
    build: () => {
      const buf = createBuffer(0.45)
      // Глухой пластиковый удар
      addPartial(buf, { freq: 210, freqEnd: 140, dur: 0.1, decay: 0.045, amp: 0.45 })
      addNoise(buf, { dur: 0.06, amp: 0.4, decay: 0.022, lp: 900, seed: 401 })
      // Низкочастотный гул 60 Гц с медленным затуханием
      addPartial(buf, { freq: 60, dur: 0.45, decay: 0.28, amp: 0.35, attack: 0.02 })
      addPartial(buf, { freq: 120, dur: 0.4, decay: 0.22, amp: 0.12, attack: 0.02 })
      return buf
    },
  },
  gyroscope: {
    dur: 0.52,
    volume: 0.6,
    build: () => {
      const buf = createBuffer(0.52)
      // Высокий металлический звон механизмов (2100 + 3400 Гц с биениями)
      addPartial(buf, { freq: 2100 * 1.003, dur: 0.5, decay: 0.22, amp: 0.4, attack: 0.004 })
      addPartial(buf, { freq: 3400 * 0.996, dur: 0.45, decay: 0.16, amp: 0.24, attack: 0.004 })
      addPartial(buf, { freq: 3400 * 1.008, dur: 0.4, decay: 0.1, amp: 0.1 })
      // Механический тик в момент удара
      addNoise(buf, { dur: 0.02, amp: 0.18, decay: 0.01, hp: 3000, seed: 501 })
      return buf
    },
  },
  camera: {
    dur: 0.55,
    volume: 0.65,
    build: () => {
      const buf = createBuffer(0.55)
      // Звон разбивающегося стекла: ВЧ-шум 4–9 кГц
      addNoise(buf, { dur: 0.28, amp: 0.3, decay: 0.1, lp: 9000, hp: 4000, seed: 601 })
      // Серия коротких высоких пингов
      const pings: Array<[number, number, number]> = [
        [5200, 0.0, 0.22],
        [6800, 0.05, 0.16],
        [7400, 0.11, 0.18],
        [6100, 0.18, 0.13],
        [8300, 0.26, 0.1],
      ]
      for (const [freq, t0, amp] of pings) {
        addPartial(buf, { freq, t0, dur: 0.07, decay: 0.03, amp })
      }
      // Тупой щелчок корпуса
      addPartial(buf, { freq: 900, freqEnd: 500, dur: 0.05, decay: 0.02, amp: 0.2 })
      return buf
    },
  },
  destroy: {
    dur: 0.58,
    volume: 0.95,
    build: () => {
      const buf = createBuffer(0.58)
      // Взрыв: шумовой всплеск с ФНЧ-свипом вниз
      addNoise(buf, { dur: 0.5, amp: 0.85, decay: 0.18, lp: 3000, lpEnd: 150, seed: 701 })
      // Саб-синус ~50 Гц
      addPartial(buf, { freq: 55, freqEnd: 38, dur: 0.55, decay: 0.24, amp: 0.9 })
      // Обломки: треск
      addNoise(buf, { t0: 0.12, dur: 0.3, amp: 0.3, decay: 0.09, hp: 1500, seed: 702 })
      return buf
    },
  },
  ui: {
    dur: 0.06,
    volume: 0.35,
    build: () => {
      const buf = createBuffer(0.06)
      addPartial(buf, { freq: 1150, dur: 0.035, decay: 0.012, amp: 0.5, attack: 0.0005 })
      addNoise(buf, { dur: 0.008, amp: 0.2, decay: 0.004, hp: 2500, seed: 801 })
      return buf
    },
  },
  victory: {
    dur: 1.1,
    volume: 0.8,
    build: () => {
      const buf = createBuffer(1.1)
      // Восходящий мажорный стингер: C4 → E4 → G4 → C5
      const notes = [261.63, 329.63, 392.0, 523.25]
      for (let i = 0; i < notes.length; i++) {
        const t0 = i * 0.1
        addPartial(buf, { freq: notes[i], t0, dur: 1.1 - t0, decay: 0.4, amp: 0.34, attack: 0.006 })
        addPartial(buf, { freq: notes[i] * 2, t0, dur: (1.1 - t0) * 0.8, decay: 0.25, amp: 0.1, attack: 0.006 })
      }
      return buf
    },
  },
  defeat: {
    dur: 1.15,
    volume: 0.8,
    build: () => {
      const buf = createBuffer(1.15)
      // Нисходящий минорный стингер: A4 → E4 → C4 → A3
      const notes = [440, 329.63, 261.63, 220]
      for (let i = 0; i < notes.length; i++) {
        const t0 = i * 0.11
        addPartial(buf, { freq: notes[i], t0, dur: 1.15 - t0, decay: 0.45, amp: 0.3, attack: 0.008 })
        addPartial(buf, { freq: notes[i] / 2, t0, dur: (1.15 - t0) * 0.7, decay: 0.3, amp: 0.08, attack: 0.008 })
      }
      return buf
    },
  },
  thunder: {
    dur: 5.6,
    volume: 0.9,
    build: () => {
      const buf = createBuffer(5.6)
      // 1) Треск разряда: резкий ВЧ-щелчок + свип вниз
      addNoise(buf, { dur: 0.05, amp: 1, decay: 0.02, hp: 2600, seed: 901 })
      addNoise(buf, { dur: 0.22, amp: 0.75, decay: 0.07, lp: 3200, lpEnd: 600, seed: 902 })
      // 2) Первая ударная волна: резкий приход низа
      addNoise(buf, { t0: 0.02, dur: 0.9, amp: 0.95, decay: 0.3, lp: 420, lpEnd: 120, seed: 903, attack: 0.006 })
      // 3) Саб-удар (держит низ всего раската)
      addPartial(buf, { freq: 58, freqEnd: 30, t0: 0.02, dur: 2.8, decay: 0.9, amp: 0.55, attack: 0.01 })
      // 4) Перекаты-волны: серия шумовых «вспуханий» (нарастание → спад),
      //    каждая — свой ФНЧ: гром грохочет волнами, а не одним экспо-хвостом
      const rolls: Array<[number, number, number, number, number, number]> = [
        // t0, dur, amp, lp, attack, decay
        [0.55, 1.6, 0.55, 300, 0.12, 0.55],
        [1.15, 1.9, 0.75, 240, 0.18, 0.7],
        [1.95, 2.0, 0.6, 180, 0.22, 0.8],
        [2.9, 2.1, 0.45, 140, 0.3, 0.9],
        [3.9, 1.7, 0.3, 110, 0.35, 0.9],
      ]
      for (let i = 0; i < rolls.length; i++) {
        const [t0, dur, amp, lp, at, dec] = rolls[i]
        addNoise(buf, { t0, dur, amp, lp, seed: 910 + i * 131, attack: at, decay: dec })
      }
      // 5) Хвост-эхо: далёкий гул, уходящий за горизонт
      addNoise(buf, { t0: 4.4, dur: 1.2, amp: 0.2, decay: 0.7, lp: 90, seed: 906, attack: 0.4 })
      return buf
    },
  },
}

// ---------------------------------------------------------------------------
// Эмбиент — тихий бесшовный фоновый луп (каждая сцена)
// ---------------------------------------------------------------------------

export type AmbientKind = 'menu' | 'battle'

interface AmbientDef {
  /** Длина лупа, с (все частоты — целое число циклов на луп → бесшовный стык) */
  dur: number
  /** Базовая громкость подложки (очень тихо) */
  volume: number
  build: () => Float32Array
}

/** Целочисленно-циклический синус (freq = cycles/dur) — идеально зацикливается. */
function addDrone(buf: Float32Array, cycles: number, amp: number, phase0 = 0): void {
  const freq = cycles / (buf.length / SAMPLE_RATE)
  for (let i = 0; i < buf.length; i++) {
    const t = i / SAMPLE_RATE
    buf[i] += Math.sin(2 * Math.PI * freq * t + phase0) * amp
  }
}

/** Шум, вшитый в петлю кроссфейдом: генерируем dur+0.5 c непрерывным фильтром,
 *  затем хвост вшиваем в начало — стык лупа неразличим. */
function addLoopedNoise(buf: Float32Array, o: { amp: number; lp?: number; hp?: number; seed: number }): void {
  const xfSec = 0.5
  const n = buf.length
  const gen = createBuffer(buf.length / SAMPLE_RATE + xfSec)
  addNoise(gen, { dur: gen.length / SAMPLE_RATE, amp: 1, decay: 1e9, attack: 0.5, lp: o.lp, hp: o.hp, seed: o.seed })
  const xf = Math.min(Math.floor(xfSec * SAMPLE_RATE), n)
  for (let i = 0; i < xf; i++) {
    const w = i / xf // 0 → 1: в начало вшивается продолжение с конца потока
    gen[i] = gen[i] * w + gen[n + i] * (1 - w)
  }
  for (let i = 0; i < n; i++) buf[i] += gen[i] * o.amp
}

const AMBIENT_DEFS: Record<AmbientKind, AmbientDef> = {
  // Меню/редактор/настройки: глубокий спокойный дрон — низкий тон с медленным
  // биением (0.3 Гц, «дыхание» громкости) + очень мягкий НЧ-воздух. Без тональных
  // средних/верхних обертонов — нейтрально-тёмный фон, не раздражает.
  menu: {
    dur: 10,
    volume: 0.08,
    build: () => {
      const buf = createBuffer(10)
      addDrone(buf, 410, 0.16)        // 41 Гц
      addDrone(buf, 413, 0.11, 1.3)   // 41.3 Гц — медленное биение 0.3 Гц
      addDrone(buf, 820, 0.05, 0.6)   // 82 Гц (октава, очень тихо)
      addDrone(buf, 1233, 0.02, 2.0)  // ~123 Гц — призрачный след квинты
      addLoopedNoise(buf, { amp: 0.26, lp: 320, seed: 9501 }) // мягкий городской воздух
      return buf
    },
  },
  // Бой: тёмный дрон + дальний гул грозы (дождь — ОТДЕЛЬНЫЙ слой, чтобы его
  // громкость могла взлетать при вспышках молний)
  battle: {
    dur: 8,
    volume: 0.11,
    build: () => {
      const buf = createBuffer(8)
      addDrone(buf, 440, 0.13)        // 55 Гц
      addDrone(buf, 660, 0.07, 1.9)   // 82.5 Гц
      addDrone(buf, 880, 0.04, 0.4)   // 110 Гц
      addLoopedNoise(buf, { amp: 0.35, lp: 120, seed: 9503 }) // дальний гул
      return buf
    },
  },
}

/** Слой дождя (только бой, отдельный от эмбиента — громкость управляется вспышками) */
const RAIN_DEF: AmbientDef = {
  dur: 4,
  volume: 0.1,
  build: () => {
    const buf = createBuffer(4)
    addLoopedNoise(buf, { amp: 0.55, lp: 6500, hp: 1100, seed: 9504 }) // шелест капель
    addLoopedNoise(buf, { amp: 0.2, lp: 300, seed: 9505 })             // НЧ-тело ливня
    return buf
  },
}

/** Громкость дождя: базовый фон и пик при вспышке молнии (×musicVolume) */
const RAIN_BASE = 0.06
const RAIN_BURST = 0.2

// ---------------------------------------------------------------------------
// AudioManager
// ---------------------------------------------------------------------------

interface VoiceEntry {
  name: SoundName
  id: number
  expiresAt: number // страховка от «утечки» голоса при пропущенном событии 'end'
}

export class AudioManager {
  private howls = new Map<SoundName, Howl>()
  private voices: VoiceEntry[] = []
  private masterVolume = DEFAULT_VOLUME
  /** Каналы громкости: боевые/UI звуки (sfx) и эмбиенты/музыка (music) */
  private sfxVolume = 1
  private musicVolume = 1
  private muted = false
  private initialized = false
  private _disabled = false
  /** Кэш эмбиент-лупов (по видам сцен) — вне лимита голосов */
  private ambientHowls = new Map<AmbientKind, Howl>()
  /** Активная подложка: kind + id голоса */
  private ambientActive: { kind: AmbientKind; id: number } | null = null
  /** Слой дождя (бой): зациклен отдельно, громкость управляется вспышками молний */
  private rainHowl: Howl | null = null
  private rainId: number | null = null
  private rainFadeTimer: ReturnType<typeof setTimeout> | null = null

  /** true — звук недоступен (нет window/AudioContext), все методы — no-op. */
  get disabled(): boolean {
    return this._disabled
  }

  /**
   * Инициализация (идемпотентна, можно вызывать многократно).
   * Лениво синтезирует WAV и строит Howl'ы. При ошибке — no-op режим.
   */
  init(opts?: AudioManagerInitOptions): void {
    if (typeof window === 'undefined') {
      this._disabled = true
      return
    }
    if (opts?.volume !== undefined) this.setVolume(opts.volume)
    if (opts?.muted !== undefined) this.setMuted(opts.muted)
    if (opts?.sfxVolume !== undefined) this.sfxVolume = this.clamp01(opts.sfxVolume)
    if (opts?.musicVolume !== undefined) this.musicVolume = this.clamp01(opts.musicVolume)
    if (this.initialized || this._disabled) return
    try {
      for (const name of SOUND_NAMES) {
        const def = SOUND_DEFS[name]
        const uri = encodeWavDataUri(def.build())
        const howl = new Howl({ src: [uri], format: ['wav'], preload: true, html5: false })
        // Учёт голосов для лимита ≤3 (ТЗ 10)
        howl.on('end', (id) => this.releaseVoice(name, id))
        howl.on('stop', (id) => this.releaseVoice(name, id))
        howl.on('playerror', (id) => this.releaseVoice(name, id))
        howl.on('loaderror', () => this.howls.delete(name))
        this.howls.set(name, howl)
      }
      this.initialized = true
      this.applyMasterSettings()
    } catch (e) {
      // Нет AudioContext/Web Audio и т.п. → отключаемся без исключений
      this._disabled = true
      this.howls.clear()
      console.error('[AudioManager] init failed, audio disabled', e)
    }
  }

  /**
   * Проиграть звук. Громкость = clamp(per-sound base × opts.volume) × глобальная.
   * Rate: ±10% случайно для вариативности (кроме ui/victory/defeat).
   * При 3 активных голосах новый звук ПРОПУСКАЕТСЯ (ТЗ 10).
   */
  play(name: SoundName, opts?: PlayOptions): void {
    if (this._disabled || typeof window === 'undefined') return
    if (!this.initialized) this.init() // ленивая инициализация
    const howl = this.howls.get(name)
    if (!howl) return
    this.purgeExpiredVoices()
    if (this.voices.length >= MAX_VOICES) return
    try {
      const id = howl.play()
      if (typeof id !== 'number') return
      const def = SOUND_DEFS[name]
      const perSound = this.clamp01((opts?.volume ?? 1) * def.volume * this.sfxVolume)
      howl.volume(perSound, id)
      const rate = this.resolveRate(name, opts?.rate)
      howl.rate(rate, id)
      this.voices.push({
        name,
        id,
        expiresAt: Date.now() + (def.dur * 1000 * 2) / rate + 600,
      })
    } catch (e) {
      console.error(`[AudioManager] play(${name}) failed`, e)
    }
  }

  /** Глобальная громкость 0..1 (Howler.volume). */
  setVolume(v: number): void {
    this.masterVolume = this.clamp01(v)
    this.applyMasterSettings()
  }

  /** Канал боевых/UI звуков 0..1 (влияет на последующие play()). */
  setSfxVolume(v: number): void {
    this.sfxVolume = this.clamp01(v)
  }

  /** Канал эмбиентов/музыки 0..1 (плавно применяется к активной подложке и дождю). */
  setMusicVolume(v: number): void {
    this.musicVolume = this.clamp01(v)
    if (this._disabled) return
    try {
      const active = this.ambientActive
      if (active) {
        const howl = this.ambientHowls.get(active.kind)
        if (howl) howl.fade(howl.volume(active.id) as number, AMBIENT_DEFS[active.kind].volume * this.musicVolume, 120, active.id)
      }
      if (this.rainHowl && this.rainId !== null) {
        this.rainHowl.fade(this.rainHowl.volume(this.rainId) as number, this.rainTarget * this.musicVolume, 120, this.rainId)
      }
    } catch {
      // no-op
    }
  }

  /** Глобальный mute (Howler.mute). */
  setMuted(m: boolean): void {
    this.muted = m
    this.applyMasterSettings()
  }

  /** Включить тихий фоновый эмбиент сцены (идемпотентно; с плавным нарастанием).
   *  Бой: вместе с подложкой запускается слой дождя. */
  startAmbient(kind: AmbientKind): void {
    if (this._disabled || typeof window === 'undefined') return
    if (!this.initialized) this.init()
    if (this._disabled) return
    if (this.ambientActive?.kind === kind) return
    this.stopAmbient()
    try {
      let howl = this.ambientHowls.get(kind)
      if (!howl) {
        const def = AMBIENT_DEFS[kind]
        const uri = encodeWavDataUri(def.build())
        howl = new Howl({ src: [uri], format: ['wav'], loop: true, preload: true, html5: false })
        this.ambientHowls.set(kind, howl)
      }
      const id = howl.play()
      if (typeof id !== 'number') return
      howl.volume(0, id)
      howl.fade(0, AMBIENT_DEFS[kind].volume * this.musicVolume, 1500, id)
      this.ambientActive = { kind, id }
      if (kind === 'battle') this.startRain()
    } catch (e) {
      console.error('[AudioManager] startAmbient failed', e)
    }
  }

  /** Слой дождя: тихий постоянный фон (громкость доводится вспышками молний). */
  private startRain(): void {
    try {
      if (!this.rainHowl) {
        const uri = encodeWavDataUri(RAIN_DEF.build())
        this.rainHowl = new Howl({ src: [uri], format: ['wav'], loop: true, preload: true, html5: false })
      }
      const id = this.rainHowl.play()
      if (typeof id !== 'number') return
      this.rainId = id
      this.rainTarget = RAIN_BASE
      this.rainHowl.volume(0, id)
      this.rainHowl.fade(0, RAIN_BASE * this.musicVolume, 2000, id)
    } catch {
      this.rainHowl = null
      this.rainId = null
    }
  }

  private stopRain(): void {
    this.clearRainFade()
    const howl = this.rainHowl
    const id = this.rainId
    this.rainId = null
    this.rainTarget = 0
    if (!howl || id === null) return
    try {
      howl.fade(howl.volume(id) as number, 0, 800, id)
      howl.once('fade', () => {
        try {
          howl.stop(id)
        } catch {
          // no-op
        }
      })
    } catch {
      // no-op
    }
  }

  private clearRainFade(): void {
    if (this.rainFadeTimer !== null) {
      clearTimeout(this.rainFadeTimer)
      this.rainFadeTimer = null
    }
  }

  /** Целевая громкость дождя (до musicVolume); меняется вспышками молний */
  private rainTarget = RAIN_BASE

  /** Плавно довести дождь до целевой громкости за fadeSec. */
  private fadeRain(target: number, fadeSec: number): void {
    this.rainTarget = target
    const howl = this.rainHowl
    const id = this.rainId
    if (!howl || id === null) return
    try {
      howl.fade(howl.volume(id) as number, target * this.musicVolume, Math.max(50, fadeSec * 1000), id)
    } catch {
      // no-op
    }
  }

  /** Вспышка молнии: дождь взлетает громкостью и за ~3.2 c возвращается к фону. */
  burstRain(): void {
    if (this._disabled || !this.rainHowl || this.rainId === null) return
    this.clearRainFade()
    this.fadeRain(RAIN_BURST, 0.35)
    this.rainFadeTimer = setTimeout(() => {
      this.rainFadeTimer = null
      this.fadeRain(RAIN_BASE, 2.8)
    }, 3200)
  }

  /** Выключить эмбиент (плавное затухание ~0.8 с). */
  stopAmbient(): void {
    this.stopRain()
    const active = this.ambientActive
    this.ambientActive = null
    if (!active) return
    const howl = this.ambientHowls.get(active.kind)
    if (!howl) return
    try {
      howl.fade(howl.volume(active.id) as number, 0, 800, active.id)
      howl.once('fade', () => {
        try {
          howl.stop(active.id)
        } catch {
          // no-op
        }
      })
    } catch {
      // no-op
    }
  }

  /** Остановка и выгрузка всех Howl'ов; init() можно вызвать заново. */
  dispose(): void {
    this.clearRainFade()
    for (const howl of this.howls.values()) {
      try {
        howl.stop()
        howl.unload()
      } catch {
        // dispose не должен бросать
      }
    }
    this.howls.clear()
    this.voices = []
    this.ambientActive = null
    this.rainHowl = null
    this.rainId = null
    for (const howl of this.ambientHowls.values()) {
      try {
        howl.stop()
        howl.unload()
      } catch {
        // dispose не должен бросать
      }
    }
    this.ambientHowls.clear()
    this.initialized = false
  }

  private applyMasterSettings(): void {
    if (this._disabled || typeof window === 'undefined') return
    try {
      Howler.volume(this.masterVolume)
      Howler.mute(this.muted)
    } catch {
      // no-op
    }
  }

  private resolveRate(name: SoundName, requested?: number): number {
    let rate = requested ?? 1
    if (!NO_RATE_VARIATION.has(name)) rate *= 1 - RATE_VARIATION + Math.random() * RATE_VARIATION * 2
    return Math.min(RATE_MAX, Math.max(RATE_MIN, rate))
  }

  private releaseVoice(name: SoundName, id: number): void {
    this.voices = this.voices.filter((v) => !(v.name === name && v.id === id))
  }

  private purgeExpiredVoices(): void {
    const now = Date.now()
    this.voices = this.voices.filter((v) => v.expiresAt > now)
  }

  private clamp01(v: number): number {
    return Math.min(1, Math.max(0, v))
  }
}

/** Отладочная/тестовая утилита: синтез звука → WAV data URI (без Howler). */
export function synthesizeSoundDataUri(name: SoundName): string {
  return encodeWavDataUri(SOUND_DEFS[name].build())
}

/** Глобальный синглтон аудио-менеджера. */
export const audioManager = new AudioManager()
