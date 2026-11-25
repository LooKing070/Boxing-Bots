'use client'

// Боевой HUD (TZ-UPDATE §3.1, §5.2, UPD-12): таймер, урон ЦИФРАМИ (без HP-баров),
// countdown 3с, D-Pad, слоты A B C D, реванш по чек-боксам обоих игроков, ничья.
import { useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react'
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Check, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useGameStore } from './store'
import { SLOT_IDS, isStrike } from '@/game/shared/types/strike.types'
import type { SlotConfig, SlotId } from '@/game/shared/types/strike.types'
import type { MatchEndReason } from '@/game/shared/types/damage.types'
import { BLOCK_BUFFS } from '@/game/shared/constants/physics'

type MoveDir = 'left' | 'right' | 'jump' | 'crouch'

const REASON_LABELS: Record<MatchEndReason, string> = {
  knockout: 'Нокаут',
  timeout: 'Время истекло',
  draw: 'Ничья',
  host_left: 'Матч отменён: хост отключился',
  guest_timeout: 'Соперник не вернулся',
}

function formatTime(sec: number): string {
  const s = Math.max(0, Math.floor(sec))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

function slotLabel(cfg: SlotConfig): string {
  if (isStrike(cfg)) {
    const hand = cfg.hand === 'left' ? 'Л' : cfg.hand === 'right' ? 'П' : 'Обе'
    return `Удар ${hand}`
  }
  return cfg.buff === 'fortification'
    ? `Блок: Усиление ${BLOCK_BUFFS.fortificationPct}%`
    : `Блок: Контратака ${BLOCK_BUFFS.counterstrikePct}%`
}

const PAD_BUTTONS: ReadonlyArray<{
  dir: MoveDir
  label: string
  icon: ReactNode
  pos: string
}> = [
  { dir: 'jump', label: 'Прыжок', icon: <ArrowUp className="size-[clamp(18px,3.2vh,24px)]" />, pos: 'col-start-2 row-start-1' },
  { dir: 'left', label: 'Влево (кувырок)', icon: <ArrowLeft className="size-[clamp(18px,3.2vh,24px)]" />, pos: 'col-start-1 row-start-2' },
  { dir: 'right', label: 'Вправо (кувырок)', icon: <ArrowRight className="size-[clamp(18px,3.2vh,24px)]" />, pos: 'col-start-3 row-start-2' },
  { dir: 'crouch', label: 'Присед', icon: <ArrowDown className="size-[clamp(18px,3.2vh,24px)]" />, pos: 'col-start-2 row-start-3' },
]

interface HoldButtonProps {
  onDown: () => void
  onUp: () => void
  ariaLabel: string
  className?: string
  heldClassName?: string
  children: ReactNode
}

/** Кнопка удержания: pointer capture + нажатое состояние (надёжный релиз) */
function HoldButton({ onDown, onUp, ariaLabel, className, heldClassName, children }: HoldButtonProps) {
  const [held, setHeld] = useState(false)
  const heldRef = useRef(false)

  const handleDown = (e: ReactPointerEvent<HTMLButtonElement>) => {
    e.preventDefault()
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      /* поток указателя недоступен — релиз придёт по up/cancel/leave */
    }
    heldRef.current = true
    setHeld(true)
    onDown()
  }

  const handleUp = () => {
    if (!heldRef.current) return
    heldRef.current = false
    setHeld(false)
    onUp()
  }

  return (
    <button
      type="button"
      aria-label={ariaLabel}
      onPointerDown={handleDown}
      onPointerUp={handleUp}
      onPointerCancel={handleUp}
      onPointerLeave={handleUp}
      onContextMenu={(e) => e.preventDefault()}
      className={cn(
        'flex select-none touch-none items-center justify-center rounded-lg border outline-none transition-[transform,border-color,background-color] duration-75 active:scale-95',
        held && heldClassName,
        className,
      )}
    >
      {children}
    </button>
  )
}

/** Экран победы (новый): боты стоят на подиуме и крутятся в 3D позади оверлея.
 *  Сверху по центру — статус игрока (ПОБЕДИЛ/ПРОИГРАЛ/НИЧЬЯ) + причина;
 *  снизу по центру — кнопки: PvE — «В меню», PvP — реванш + «В меню». */
function VictoryScreen() {
  const result = useGameStore((s) => s.battleResult)
  const pvpRole = useGameStore((s) => s.pvp.role)
  const peerName = useGameStore((s) => s.pvp.peerName)
  const rematchMe = useGameStore((s) => s.rematch.me)
  const rematchPeer = useGameStore((s) => s.rematch.peer)
  const engine = useGameStore((s) => s.engine)

  if (!result) return null

  const title =
    result.selfWon === true ? 'ПОБЕДИЛ' : result.selfWon === false ? 'ПРОИГРАЛ' : 'НИЧЬЯ'
  const titleClass =
    result.selfWon === true
      ? 'text-emerald-400 drop-shadow-[0_0_22px_rgba(52,211,153,0.45)]'
      : result.selfWon === false
        ? 'text-[#ff3b25] drop-shadow-[0_0_22px_rgba(255,59,37,0.4)]'
        : 'text-[#c3c6ee] drop-shadow-[0_0_18px_rgba(155,160,216,0.35)]'

  const isPvp = pvpRole !== null

  return (
    <div className="pointer-events-none absolute inset-0 z-20 flex flex-col">
      {/* Верх по центру: статус игрока */}
      <div className="flex flex-col items-center pt-[max(0.75rem,env(safe-area-inset-top))] sm:pt-5">
        <h2
          className={cn(
            'text-[clamp(1.8rem,8vw,3.5rem)] leading-none font-black tracking-[0.1em]',
            titleClass,
          )}
        >
          {title}
        </h2>
        <p className="mt-1.5 rounded-full border border-[#686c98]/25 bg-[#0a1520]/70 px-3 py-0.5 text-xs font-semibold text-[#9ba0d8] backdrop-blur-sm sm:text-sm">
          {REASON_LABELS[result.reason]}
        </p>
      </div>

      {/* Низ по центру: выход в меню / кнопки PvP (реванш) */}
      <div className="pointer-events-auto mt-auto mb-[max(1rem,env(safe-area-inset-bottom))] flex w-full flex-col items-center gap-2.5 px-4">
        {isPvp && (
          <div className="flex flex-col items-center gap-1.5 rounded-xl border border-[#686c98]/30 bg-[#0a1520]/80 px-4 py-3 backdrop-blur-sm">
            <button
              type="button"
              role="checkbox"
              aria-checked={rematchMe}
              onClick={() => engine?.setRematch(!rematchMe)}
              className={cn(
                'flex w-full min-w-56 items-center justify-center gap-2 rounded-md border px-4 py-2.5 text-sm font-semibold transition-colors',
                rematchMe
                  ? 'border-[#68c898] bg-[#68c898]/15 text-[#8fe8c0]'
                  : 'border-[#686c98]/50 bg-[#0c1826]/70 text-zinc-100 hover:border-[#686c98]',
              )}
            >
              <span
                className={cn(
                  'flex size-5 items-center justify-center rounded border',
                  rematchMe ? 'border-[#68c898] bg-[#68c898]/30' : 'border-[#686c98]/60 bg-[#0a1520]',
                )}
              >
                {rematchMe && <Check className="size-4 text-[#8fe8c0]" />}
              </span>
              Реванш
            </button>
            <p className="text-xs text-[#686c98]">
              {peerName ?? 'Соперник'}:{' '}
              <span className={rematchPeer ? 'font-semibold text-[#8fe8c0]' : 'text-[#9ba0d8]'}>
                {rematchPeer ? 'подтвердил' : 'не подтвердил'}
              </span>
            </p>
          </div>
        )}
        <Button
          onClick={() => engine?.exitBattle()}
          className="h-12 w-full max-w-xs bg-[#ab1002] text-base font-bold text-white shadow-lg hover:bg-[#c62010]"
        >
          В меню
        </Button>
      </div>
    </div>
  )
}

export default function BattleHUD() {
  const engine = useGameStore((s) => s.engine)
  const slots = useGameStore((s) => s.slots)
  const timeLeft = useGameStore((s) => s.hud.timeLeft)
  const damageMe = useGameStore((s) => s.hud.damageMe)
  const damageFoe = useGameStore((s) => s.hud.damageFoe)
  const countdown = useGameStore((s) => s.hud.countdown)
  const ping = useGameStore((s) => s.hud.ping)
  const fps = useGameStore((s) => s.hud.fps)
  const pingVisible = useGameStore((s) => s.settings.pingVisible)
  const pvpRole = useGameStore((s) => s.pvp.role)
  // Экран победы: HUD боя скрыт — только статус сверху и кнопки снизу,
  // боты крутятся в 3D-сцене позади оверлея
  const battleResult = useGameStore((s) => s.battleResult)

  if (battleResult) {
    return <VictoryScreen />
  }

  const timeLow = timeLeft < 30

  return (
    <div className="absolute inset-0 select-none">
      {/* Верх-право: выход (SCN-4.6): PvE — в меню; PvP — дисконнект по NET-6.
          pointer-events-auto обязателен: корневой оверлей UI — pointer-events-none. */}
      <button
        type="button"
        onClick={() => engine?.exitBattle()}
        aria-label="Выйти из боя"
        className="pointer-events-auto absolute top-1.5 right-1.5 z-10 flex items-center gap-1.5 rounded-lg border border-[#686c98]/40 bg-[#0a1520]/80 px-3 py-2 text-xs font-semibold text-zinc-300 backdrop-blur-sm transition-colors hover:border-[#ab1002] hover:text-[#ff8f80] sm:top-3 sm:right-3"
      >
        <X className="size-3.5" /> Выйти
      </button>

      {/* Верх по центру: таймер + урон цифрами */}
      <div className="absolute top-1.5 left-1/2 flex -translate-x-1/2 flex-col items-center sm:top-3">
        <div className="rounded-lg border border-[#686c98]/25 bg-[#0a1520]/75 px-3 py-1 text-center backdrop-blur-sm sm:px-5 sm:py-1.5">
          <div
            className={cn(
              'font-mono text-[clamp(1.5rem,5vh,2.6rem)] leading-none font-bold tabular-nums',
              timeLow ? 'animate-pulse text-[#ff3b25]' : 'text-zinc-100',
            )}
          >
            {formatTime(timeLeft)}
          </div>
          <div className="mt-1 font-mono text-[clamp(0.8rem,2.4vh,1.1rem)] tabular-nums text-zinc-400">
            УРОН{' '}
            <span className="font-bold text-[#9ba0d8]">{damageMe}</span>
            <span className="text-zinc-600"> : </span>
            <span className="font-bold text-[#ff6a55]">{damageFoe}</span>
          </div>
        </div>
      </div>

      {/* Countdown 3с (MATCH_COUNTDOWN_S): большой номер по центру */}
      {countdown > 0 && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
          <div
            key={countdown}
            className="font-mono text-[clamp(4rem,22vh,10rem)] font-black text-[#ffb347] opacity-90 drop-shadow-[0_0_28px_rgba(255,179,71,0.45)]"
          >
            {countdown}
          </div>
        </div>
      )}

      {/* Верх справа (только PvP): пинг + FPS — под кнопкой «Выйти» */}
      {pvpRole !== null && (
        <div className="absolute top-12 right-1.5 rounded-lg border border-[#686c98]/25 bg-[#0a1520]/75 px-2.5 py-1 text-right font-mono backdrop-blur-sm sm:top-14 sm:right-3">
          {ping !== null && pingVisible && (
            <div className="text-xs tabular-nums text-[#9ba0d8] sm:text-sm">
              {Math.round(ping)} мс
            </div>
          )}
          <div className="text-[10px] tabular-nums text-[#686c98] sm:text-xs">{fps} FPS</div>
        </div>
      )}

      {/* Низ слева: D-Pad (3×3) — влево/вправо в прыжке = кувырок */}
      <div className="pointer-events-auto absolute bottom-2 left-2 p-1.5 sm:bottom-4 sm:left-4 sm:p-2">
        <div className="grid grid-cols-3 gap-1.5 sm:gap-2">
          {PAD_BUTTONS.map((b) => (
            <HoldButton
              key={b.dir}
              ariaLabel={b.label}
              onDown={() => engine?.pressMove(b.dir, true)}
              onUp={() => engine?.pressMove(b.dir, false)}
              className={cn(
                b.pos,
                'size-[clamp(56px,9.5vh,72px)] border-[#686c98]/50 bg-[#101d2c]/80 text-zinc-200 active:border-[#9ba0d8] active:bg-[#686c98]/25',
              )}
              heldClassName="scale-95 border-[#9ba0d8] bg-[#686c98]/30"
            >
              {b.icon}
            </HoldButton>
          ))}
        </div>
      </div>

      {/* Низ справа: слоты A B C D (2×2) с увеличенной зоной нажатия */}
      <div className="pointer-events-auto absolute right-2 bottom-2 p-2 sm:right-4 sm:bottom-4">
        <div className="grid grid-cols-2 gap-1.5 sm:gap-2">
          {SLOT_IDS.map((id: SlotId) => {
            const cfg = slots[id]
            const strike = isStrike(cfg)
            return (
              <HoldButton
                key={id}
                ariaLabel={`Слот ${id}: ${slotLabel(cfg)}`}
                onDown={() => engine?.pressSlot(id, true)}
                onUp={() => engine?.pressSlot(id, false)}
                className={cn(
                  'h-[clamp(64px,11vh,84px)] w-[clamp(78px,13.5vh,100px)] flex-col gap-0.5 px-1 backdrop-blur-sm',
                  strike
                    ? 'border-[#ab1002]/60 bg-[#160a08]/85 text-[#f2b8b0] active:border-[#ff5040] active:bg-[#ab1002]/25'
                    : 'border-[#686c98]/60 bg-[#101a2e]/85 text-[#c3c6ee] active:border-[#9ba0d8] active:bg-[#686c98]/25',
                )}
                heldClassName={
                  strike
                    ? 'scale-95 border-[#ff5040] bg-[#ab1002]/40'
                    : 'scale-95 border-[#9ba0d8] bg-[#686c98]/35'
                }
              >
                <span className="font-mono text-[clamp(1rem,3vh,1.35rem)] leading-none font-black">
                  {id}
                </span>
                <span className="text-center text-[9px] leading-tight font-semibold sm:text-[10px]">
                  {slotLabel(cfg)}
                </span>
              </HoldButton>
            )
          })}
        </div>
      </div>

      {/* Экран победы: боты крутятся на подиуме, статус + кнопки */}
      <VictoryScreen />
    </div>
  )
}
