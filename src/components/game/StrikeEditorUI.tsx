'use client'

// Редактор ударов и блоков — редакция «движение» (кадры упразднены):
// СЛЕВА СВЕРХУ «Параметры» (только отображение итога); СЛЕВА СНИЗУ «Движение» —
// ползунки Скорость / X / Y / Z / Отталкивание / Кривая (у блока — поза X/Y/Z);
// СЕРЕДИНА НИЗ — слоты/тип/сброс; СПРАВА СНИЗУ — действия; остальное — 3D-вьюпорт.
// У удара и у блока всегда 1 кадр с конечной точкой: удар — движение кисти от
// стойки к цели (x,y,z ±EDITOR_RANGE) за время speed (0.2–1.0 с, медленнее = сильнее),
// отталкивание 0–10 (+1 ед = −0.5 ед урона, сильнее отбрасывает),
// кривая −5..+5 (0 = прямая; +дуга вверх, −дуга вниз).
import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, Info, Play, Save, Square, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { Slider } from '@/components/ui/slider'
import { cn } from '@/lib/utils'
import { useGameStore } from './store'
import { SLOT_IDS, isStrike, strikeDamage } from '@/game/shared/types/strike.types'
import type {
  BlockData, BlockBuff, HandId, SlotConfig, SlotId, StrikeData,
} from '@/game/shared/types/strike.types'
import { sanitizeStrike, sanitizeBlock } from '@/game/shared/utils/serialization'
import { DEFAULT_BLOCK, DEFAULT_LEFT_STRIKE, DEFAULT_RIGHT_STRIKE } from '@/game/shared/constants/defaults'
import { STRIKE, BLOCK_BUFFS } from '@/game/shared/constants/physics'

const SELECT_CONTENT = 'dark border-[#686c98]/40 bg-[#101d2c] text-zinc-100'

const fmt2 = (v: number): string => v.toFixed(2)

const HAND_LABELS: Record<HandId, string> = {
  left: 'Левая',
  right: 'Правая',
  both: 'Обе руки',
}

/** Горячие клавиши превью слотов во вьюпорте (только ПК): J=A, K=B, L=C, I=D */
const EDITOR_KEY_TO_SLOT: Record<string, SlotId> = {
  KeyJ: 'A', KeyK: 'B', KeyL: 'C', KeyI: 'D',
}
const SLOT_KEYS: Record<SlotId, string> = { A: 'J', B: 'K', C: 'L', D: 'I' }

interface ParamSliderProps {
  label: string
  value: number
  min: number
  max: number
  step: number
  format?: (v: number) => string
  onChange: (v: number) => void
}

function ParamSlider({ label, value, min, max, step, format, onChange }: ParamSliderProps) {
  return (
    <div className="min-w-0 select-none">
      <div className="mb-0.5 flex flex-wrap items-baseline justify-between gap-x-2">
        <span className="text-[10px] uppercase tracking-wide text-[#686c98]">{label}</span>
        <span className="font-mono text-[11px] tabular-nums text-zinc-100">
          {format ? format(value) : value}
        </span>
      </div>
      <Slider
        min={min}
        max={max}
        step={step}
        value={[value]}
        onValueChange={(v) => onChange(v[0])}
        className="cursor-pointer touch-none [&_[data-slot=slider-thumb]]:size-4"
      />
    </div>
  )
}

export default function StrikeEditorUI() {
  const slots = useGameStore((s) => s.slots)
  const updateSlot = useGameStore((s) => s.updateSlot)
  const resetSlots = useGameStore((s) => s.resetSlots)
  const editorSlot = useGameStore((s) => s.editorSlot)
  const setEditorSlot = useGameStore((s) => s.setEditorSlot)
  const editorPreviewPlaying = useGameStore((s) => s.editorPreviewPlaying)
  const engine = useGameStore((s) => s.engine)
  const setScene = useGameStore((s) => s.setScene)
  const pushToast = useGameStore((s) => s.pushToast)
  const playerName = useGameStore((s) => s.playerName)

  const [confirmReset, setConfirmReset] = useState(false)
  const [confirmMenu, setConfirmMenu] = useState(false)
  const dirtyRef = useRef(false)

  const cfg: SlotConfig = slots[editorSlot]
  const strike = isStrike(cfg) ? cfg : null
  const block = !isStrike(cfg) ? cfg : null

  const markDirty = () => {
    dirtyRef.current = true
  }

  const patchStrike = (patch: Partial<StrikeData>) => {
    if (!strike) return
    markDirty()
    updateSlot(editorSlot, sanitizeStrike({ ...strike, ...patch }))
  }

  const patchBlock = (patch: Partial<BlockData>) => {
    if (!block) return
    markDirty()
    updateSlot(editorSlot, sanitizeBlock({ ...block, ...patch }))
  }

  const setTargetAxis = (axis: 'x' | 'y' | 'z', value: number) => {
    if (!strike) return
    markDirty()
    patchStrike({ target: { ...strike.target, [axis]: value } })
  }

  const setKind = (kind: 'strike' | 'block') => {
    if (cfg.kind === kind) return
    markDirty()
    if (kind === 'strike') {
      updateSlot(editorSlot, { ...DEFAULT_LEFT_STRIKE })
    } else {
      updateSlot(editorSlot, { ...DEFAULT_BLOCK })
    }
  }

  const togglePreview = () => {
    if (editorPreviewPlaying) engine?.stopPreview()
    else engine?.previewSlot(editorSlot)
  }

  // Единоразовое превью слота по клавишам JKLI (только ПК: клавиатуры нет на тач)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return
      const t = e.target as HTMLElement | null
      if (t && (t.isContentEditable || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return
      // Открытый дропдаун (Radix Select) — не мешаем typeahead
      if (document.querySelector('[data-radix-popper-content-wrapper]')) return
      const slot = EDITOR_KEY_TO_SLOT[e.code]
      if (!slot) return
      e.preventDefault()
      engine?.previewSlotOnce(slot)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [engine])

  const handleReset = () => {
    if (!confirmReset) {
      setConfirmReset(true)
      window.setTimeout(() => setConfirmReset(false), 3000)
      return
    }
    setConfirmReset(false)
    dirtyRef.current = false
    resetSlots()
    pushToast('Пресеты сброшены к дефолтам', 'success')
  }

  const handleSave = () => {
    dirtyRef.current = false
    engine?.savePresetsToServer(useGameStore.getState().slots)
    pushToast(`Пресеты сохранены (${playerName})`, 'success')
  }

  const handleMenu = () => {
    if (dirtyRef.current && !confirmMenu) {
      setConfirmMenu(true)
      window.setTimeout(() => setConfirmMenu(false), 3000)
      return
    }
    setConfirmMenu(false)
    dirtyRef.current = false
    setScene('menu')
  }

  return (
    <div className="pointer-events-none absolute inset-0">
      {/* ===== СЛЕВА СВЕРХУ — «Параметры» (ТОЛЬКО ОТОБРАЖЕНИЕ, без ввода) ===== */}
      <aside
        aria-label="Параметры пресета"
        className="pointer-events-auto dark absolute top-2 left-2 w-[min(280px,44vw)] rounded-xl border border-[#686c98]/30 bg-[#0a1520]/90 p-3 backdrop-blur-sm sm:top-3 sm:left-3"
      >
        <h2 className="text-[11px] font-bold tracking-[0.2em] uppercase text-[#9ba0d8]">
          Параметры · слот {editorSlot}
        </h2>
        {strike ? (
          <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
            <dt className="text-[#686c98]">Итоговый урон</dt>
            <dd className="text-right font-mono font-bold text-[#ffb347] tabular-nums">
              {strikeDamage(strike).toFixed(1)}
            </dd>
            <dt className="text-[#686c98]">Время движения</dt>
            <dd className="text-right font-mono text-zinc-100 tabular-nums">
              {strike.speed.toFixed(2)} с
            </dd>
            <dt className="text-[#686c98]">Отталкивание</dt>
            <dd className="text-right font-mono text-zinc-100 tabular-nums">
              {strike.knockback.toFixed(0)} / {STRIKE.knockbackMax}
            </dd>
            <dt className="text-[#686c98]">Кривая</dt>
            <dd className="text-right font-mono text-zinc-100 tabular-nums">
              {strike.curve > 0 ? `+${strike.curve.toFixed(1)}` : strike.curve.toFixed(1)}
            </dd>
            <dt className="text-[#686c98]">Рука</dt>
            <dd className="text-right text-zinc-100">{HAND_LABELS[strike.hand]}</dd>
          </dl>
        ) : block ? (
          <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
            <dt className="text-[#686c98]">Бафф</dt>
            <dd className="text-right font-bold text-[#68c898]">
              {block.buff === 'fortification'
                ? `Усиление ${BLOCK_BUFFS.fortificationPct}%`
                : `Контратака ${BLOCK_BUFFS.counterstrikePct}%`}
            </dd>
            <dt className="text-[#686c98]">Рука</dt>
            <dd className="text-right text-zinc-100">{HAND_LABELS[block.hand]}</dd>
          </dl>
        ) : null}
        <p className="mt-2 flex items-start gap-1 text-[10px] leading-snug text-[#686c98]">
          <Info className="mt-0.5 size-3 shrink-0" />
          Значения фиксированы константами и пересчитываются реактивно
        </p>
      </aside>

      {/* ===== 3D-вьюпорт — остальное пространство ===== */}
      <div className="absolute inset-0" aria-hidden="true" />

      {/* ===== Низ: Движение (слева) | Слоты/тип (середина) | Действия (справа) ===== */}
      <div className="pointer-events-auto absolute right-0 bottom-0 left-0 flex max-h-[62%] flex-col gap-2 p-2 select-none sm:flex-row sm:items-end sm:gap-3 sm:p-3">
        {/* СЛЕВА СНИЗУ — «Движение» */}
        <section className="dark min-h-0 min-w-0 flex-1 overflow-y-auto rounded-xl border border-[#686c98]/30 bg-[#0a1520]/90 p-3 backdrop-blur-sm">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-xs font-bold tracking-wider uppercase text-[#9ba0d8]">
              Движение {strike ? '(удар)' : '(поза)'}
            </h3>
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-1.5">
                <Label className="text-[10px] tracking-wider uppercase text-[#686c98]">Рука</Label>
                <Select
                  value={cfg.hand}
                  onValueChange={(v) => {
                    markDirty()
                    if (isStrike(cfg)) patchStrike({ hand: v as HandId })
                    else patchBlock({ hand: v as HandId })
                  }}
                >
                  <SelectTrigger className="h-9 w-28 border-[#686c98]/40 bg-[#0c1826]/80 text-xs text-zinc-100">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className={SELECT_CONTENT}>
                    <SelectItem value="right">Правая</SelectItem>
                    <SelectItem value="left">Левая</SelectItem>
                    <SelectItem value="both">Обе руки</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {!strike && (
                <div className="flex items-center gap-1.5">
                  <Label className="text-[10px] tracking-wider uppercase text-[#686c98]">Бафф блока</Label>
                  <Select
                    value={isStrike(cfg) ? 'fortification' : cfg.buff}
                    onValueChange={(v) => {
                      if (!isStrike(cfg)) {
                        markDirty()
                        patchBlock({ buff: v as BlockBuff })
                      }
                    }}
                  >
                    <SelectTrigger className="h-9 w-36 border-[#686c98]/40 bg-[#0c1826]/80 text-xs text-zinc-100">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className={SELECT_CONTENT}>
                      <SelectItem value="fortification">Усиление {BLOCK_BUFFS.fortificationPct}%</SelectItem>
                      <SelectItem value="counterstrike">Контратака {BLOCK_BUFFS.counterstrikePct}%</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
          </div>

          {strike ? (
            <div className="max-w-3xl rounded-md border border-[#686c98]/20 bg-[#0c1826]/70 p-2">
              <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 md:grid-cols-3">
                <ParamSlider
                  label="Скорость"
                  value={strike.speed} min={STRIKE.speedMin} max={STRIKE.speedMax} step={0.05}
                  format={(v) => `${v.toFixed(2)} с`}
                  onChange={(v) => patchStrike({ speed: v })}
                />
                <ParamSlider
                  label="X вперёд"
                  value={strike.target.x} min={-STRIKE.editorRange} max={STRIKE.editorRange} step={0.05}
                  format={fmt2}
                  onChange={(v) => setTargetAxis('x', v)}
                />
                <ParamSlider
                  label="Y вверх"
                  value={strike.target.y} min={-STRIKE.editorRange} max={STRIKE.editorRange} step={0.05}
                  format={fmt2}
                  onChange={(v) => setTargetAxis('y', v)}
                />
                <ParamSlider
                  label="Z вбок"
                  value={strike.target.z} min={-STRIKE.editorRange} max={STRIKE.editorRange} step={0.05}
                  format={fmt2}
                  onChange={(v) => setTargetAxis('z', v)}
                />
                <ParamSlider
                  label="Отталкивание"
                  value={strike.knockback} min={0} max={STRIKE.knockbackMax} step={1}
                  format={(v) => v.toFixed(0)}
                  onChange={(v) => patchStrike({ knockback: v })}
                />
                <ParamSlider
                  label="Кривая"
                  value={strike.curve} min={-STRIKE.curveMax} max={STRIKE.curveMax} step={0.5}
                  format={(v) => (v > 0 ? `+${v.toFixed(1)}` : v.toFixed(1))}
                  onChange={(v) => patchStrike({ curve: v })}
                />
              </div>
              <p className="mt-2 text-[10px] leading-snug text-[#686c98]">
                Медленнее = сильнее (урон по времени движения). Отталкивание: +1 ед = −0.5 ед урона,
                сильнее отбрасывает противника. Кривая: 0 — прямая, + — дуга вверх, − — дуга вниз.
              </p>
            </div>
          ) : block ? (
            <div className="max-w-xl rounded-md border border-[#68c898]/30 bg-[#0c1826]/70 p-2">
              <div className="mb-1.5 text-[10px] font-bold tracking-wider uppercase text-[#68c898]">
                Кадр-поза (принимается за 0.5 с) · смещение от стойки
              </div>
              <div className="grid grid-cols-1 gap-x-3 gap-y-1.5 sm:grid-cols-3">
                <ParamSlider
                  label="X вперёд"
                  value={block.frame.x} min={-STRIKE.editorRange} max={STRIKE.editorRange} step={0.05}
                  format={fmt2}
                  onChange={(v) => {
                    markDirty()
                    patchBlock({ frame: { ...block.frame, x: v } })
                  }}
                />
                <ParamSlider
                  label="Y вверх"
                  value={block.frame.y} min={-STRIKE.editorRange} max={STRIKE.editorRange} step={0.05}
                  format={fmt2}
                  onChange={(v) => {
                    markDirty()
                    patchBlock({ frame: { ...block.frame, y: v } })
                  }}
                />
                <ParamSlider
                  label="Z вбок"
                  value={block.frame.z} min={-STRIKE.editorRange} max={STRIKE.editorRange} step={0.05}
                  format={fmt2}
                  onChange={(v) => {
                    markDirty()
                    patchBlock({ frame: { ...block.frame, z: v } })
                  }}
                />
              </div>
              <p className="mt-2 text-[10px] leading-snug text-[#686c98]">
                Баффы фиксированы: Усиление {BLOCK_BUFFS.fortificationPct}% или Контратака{' '}
                {BLOCK_BUFFS.counterstrikePct}% — ползунков баффов нет (§3.5.5)
              </p>
            </div>
          ) : null}
          <p className="mt-2 text-[10px] leading-snug text-[#686c98]">
            Начальная точка = стойка (не редактируется). Кисть летит к цели по кривой Безье.
          </p>
        </section>

        {/* СЕРЕДИНА НИЗ — слоты/тип/сброс */}
        <section
          aria-label="Слоты и тип"
          className="dark flex shrink-0 flex-col gap-2 rounded-xl border border-[#686c98]/30 bg-[#0a1520]/90 p-3 backdrop-blur-sm sm:w-44"
        >
          <div className="grid grid-cols-4 gap-1.5">
            {SLOT_IDS.map((id) => (
              <button
                key={id}
                type="button"
                onClick={() => setEditorSlot(id)}
                aria-label={`Слот ${id} (превью по клавише ${SLOT_KEYS[id]})`}
                className={cn(
                  'relative h-10 rounded-md border font-mono text-base font-bold transition-colors',
                  id === editorSlot
                    ? 'border-[#ab1002] bg-[#ab1002]/25 text-white'
                    : 'border-[#686c98]/40 bg-[#101d2c]/80 text-[#9ba0d8] hover:border-[#686c98] hover:text-zinc-100',
                )}
              >
                {id}
                <kbd
                  aria-hidden="true"
                  className="absolute top-0.5 right-1 text-[9px] font-semibold leading-none text-[#686c98]"
                >
                  {SLOT_KEYS[id]}
                </kbd>
              </button>
            ))}
          </div>
          <p className="text-[9px] leading-tight text-[#686c98]">
            J K L I — проиграть слот во вьюпорте один раз (ПК)
          </p>
          <div className="grid grid-cols-2 gap-1.5">
            <button
              type="button"
              onClick={() => setKind('strike')}
              className={cn(
                'h-10 rounded-md border text-xs font-semibold transition-colors',
                isStrike(cfg)
                  ? 'border-[#ab1002] bg-[#ab1002]/25 text-white'
                  : 'border-[#686c98]/40 bg-[#101d2c]/80 text-[#9ba0d8] hover:border-[#686c98] hover:text-zinc-100',
              )}
            >
              Удар
            </button>
            <button
              type="button"
              onClick={() => setKind('block')}
              className={cn(
                'h-10 rounded-md border text-xs font-semibold transition-colors',
                !isStrike(cfg)
                  ? 'border-[#686c98] bg-[#686c98]/25 text-white'
                  : 'border-[#686c98]/40 bg-[#101d2c]/80 text-[#9ba0d8] hover:border-[#686c98] hover:text-zinc-100',
              )}
            >
              Блок
            </button>
          </div>
          <Button
            variant="outline"
            onClick={handleReset}
            className={cn(
              'h-10 border-[#686c98]/40 bg-[#101d2c]/80 text-xs',
              confirmReset
                ? 'border-[#ab1002] bg-[#ab1002]/20 text-[#ff8f80] hover:bg-[#ab1002]/25 hover:text-[#ff8f80]'
                : 'text-zinc-100 hover:border-[#686c98] hover:bg-[#686c98]/15',
            )}
          >
            {confirmReset ? 'Точно сбросить?' : 'Сбросить всё'}
          </Button>
        </section>

        {/* СПРАВА СНИЗУ — действия */}
        <section
          aria-label="Действия"
          className="dark flex shrink-0 flex-col gap-2 rounded-xl border border-[#686c98]/30 bg-[#0a1520]/90 p-3 backdrop-blur-sm sm:w-52"
        >
          <Button
            onClick={togglePreview}
            className="h-10 bg-[#ab1002] text-sm text-white hover:bg-[#c62010]"
          >
            {editorPreviewPlaying ? (
              <>
                <Square className="size-4" /> Остановить
              </>
            ) : (
              <>
                <Play className="size-4" /> Проиграть во вьюпорте
              </>
            )}
          </Button>
          <Button
            onClick={handleSave}
            className="h-10 bg-[#68c898] text-sm font-semibold text-[#08131c] hover:bg-[#7fd8aa]"
          >
            <Save className="size-4" /> Сохранить
          </Button>
          <Button
            variant="outline"
            onClick={handleMenu}
            className={cn(
              'h-10 border-[#686c98]/40 bg-[#101d2c]/80 text-sm text-zinc-100 hover:border-[#686c98] hover:bg-[#686c98]/15',
              confirmMenu && 'border-[#ab1002] bg-[#ab1002]/20 text-[#ff8f80] hover:bg-[#ab1002]/25 hover:text-[#ff8f80]',
            )}
          >
            {confirmMenu ? (
              <>
                <X className="size-4" /> Есть несохранённые правки
              </>
            ) : (
              <>
                <ArrowLeft className="size-4" /> В меню
              </>
            )}
          </Button>
        </section>
      </div>
    </div>
  )
}
