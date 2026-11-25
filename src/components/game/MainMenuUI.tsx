'use client'

// Главное меню (ТЗ 3.1): левая колонка + встроенная онлайн-подпанель
import { useState } from 'react'
import {
  ArrowLeft, Copy, Globe, Loader2, Maximize, Play, Settings as SettingsIcon,
  SlidersHorizontal, X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import { useGameStore } from './store'

const MENU_BTN =
  'h-12 justify-start gap-3 border-[#686c98]/40 bg-[#101d2c]/80 text-base text-zinc-100 hover:border-[#686c98] hover:bg-[#686c98]/15'

export default function MainMenuUI() {
  const engine = useGameStore((s) => s.engine)
  const setScene = useGameStore((s) => s.setScene)
  const playerName = useGameStore((s) => s.playerName)
  const setPlayerName = useGameStore((s) => s.setPlayerName)
  const pvp = useGameStore((s) => s.pvp)
  const pushToast = useGameStore((s) => s.pushToast)

  const [onlineOpen, setOnlineOpen] = useState(false)
  const [joinCode, setJoinCode] = useState('')

  const matchmakingActive =
    pvp.status === 'searching' || pvp.status === 'waiting_room' || pvp.status === 'connecting'

  const copyRoomCode = async () => {
    if (!pvp.roomId) return
    try {
      await navigator.clipboard.writeText(pvp.roomId)
      pushToast('Код комнаты скопирован', 'success')
    } catch {
      pushToast('Не удалось скопировать код', 'error')
    }
  }

  return (
    <div className="absolute inset-0 flex items-start sm:items-center">
      <div className="dark pointer-events-auto m-2 flex max-h-[calc(100%-1rem)] w-[min(92vw,25rem)] flex-col overflow-y-auto rounded-xl border border-[#686c98]/30 bg-[#0a1520]/90 p-4 shadow-[0_0_50px_rgba(0,0,0,0.65)] backdrop-blur-sm select-none sm:m-6 sm:p-6">
        <header className="mb-5">
          <h1 className="text-[clamp(1.6rem,5vw,2.4rem)] leading-none font-black tracking-[0.18em] text-zinc-100">
            BOXING<span className="text-[#e02010]">-BOTS</span>
          </h1>
          <p className="mt-1.5 text-xs tracking-[0.35em] uppercase text-[#686c98]">
            Кубические бойцы
          </p>
        </header>

        {!onlineOpen ? (
          <nav className="flex flex-col gap-2.5">
            <Button
              onClick={() => engine?.startPve()}
              className="h-12 justify-start gap-3 bg-[#ab1002] text-base text-white hover:bg-[#c62010]"
            >
              <Play className="size-5" /> Играть с ботом
            </Button>
            <Button variant="outline" onClick={() => setOnlineOpen(true)} className={MENU_BTN}>
              <Globe className="size-5" /> Онлайн-бой
            </Button>
            <Button variant="outline" onClick={() => setScene('editor')} className={MENU_BTN}>
              <SlidersHorizontal className="size-5" /> Редактор ударов
            </Button>
            <Button variant="outline" onClick={() => setScene('settings')} className={MENU_BTN}>
              <SettingsIcon className="size-5" /> Настройки
            </Button>
            <Button variant="outline" onClick={() => engine?.requestFullscreen()} className={cn(MENU_BTN, 'h-11')}>
              <Maximize className="size-4" /> Во весь экран
            </Button>
          </nav>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-bold tracking-wide text-zinc-100">Онлайн-бой</h2>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setOnlineOpen(false)}
                className="h-11 gap-1.5 px-3 text-[#686c98] hover:text-zinc-100"
              >
                <ArrowLeft className="size-4" /> Назад
              </Button>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="bb-player-name" className="text-[11px] tracking-wider uppercase text-[#686c98]">
                Имя бойца
              </Label>
              <Input
                id="bb-player-name"
                value={playerName}
                onChange={(e) => setPlayerName(e.target.value)}
                maxLength={24}
                placeholder="Боец"
                className="h-11 border-[#686c98]/40 bg-[#0c1826]/80 text-zinc-100 placeholder:text-[#4d5170]"
              />
            </div>

            <Button
              onClick={() => engine?.startPvpCreate()}
              disabled={matchmakingActive}
              className="h-12 bg-[#ab1002] text-base text-white hover:bg-[#c62010]"
            >
              Создать комнату
            </Button>

            <div className="flex gap-2">
              <Input
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                maxLength={8}
                placeholder="КОД"
                aria-label="Код комнаты"
                className="h-11 min-w-0 flex-1 border-[#686c98]/40 bg-[#0c1826]/80 font-mono tracking-widest text-zinc-100 placeholder:text-[#4d5170]"
              />
              <Button
                variant="outline"
                onClick={() => engine?.startPvpJoin(joinCode.trim().toUpperCase())}
                disabled={joinCode.trim().length === 0 || matchmakingActive}
                className="h-11 shrink-0 border-[#686c98]/40 bg-[#101d2c]/80 text-sm text-zinc-100 hover:border-[#686c98] hover:bg-[#686c98]/15"
              >
                Войти по коду
              </Button>
            </div>

            <Button
              variant="outline"
              onClick={() => engine?.startPvpQuick()}
              disabled={matchmakingActive}
              className="h-12 border-[#686c98]/40 bg-[#101d2c]/80 text-base text-zinc-100 hover:border-[#686c98] hover:bg-[#686c98]/15"
            >
              Быстрый матч
            </Button>

            {(pvp.status === 'searching' || pvp.status === 'connecting') && (
              <div className="flex items-center gap-2.5 rounded-md border border-[#686c98]/30 bg-[#0c1826]/80 px-3 py-2.5 text-sm text-[#9ba0d8]">
                <Loader2 className="size-4 shrink-0 animate-spin" />
                {pvp.status === 'connecting' ? 'Подключение…' : 'Поиск соперника…'}
              </div>
            )}

            {pvp.status === 'waiting_room' && pvp.roomId && (
              <div className="rounded-md border border-[#686c98]/30 bg-[#0c1826]/80 p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-2xl font-bold tracking-[0.25em] text-zinc-100">
                    {pvp.roomId}
                  </span>
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={copyRoomCode}
                    aria-label="Скопировать код комнаты"
                    className="size-11 shrink-0 border-[#686c98]/40 bg-transparent text-[#9ba0d8] hover:bg-[#686c98]/15 hover:text-zinc-100"
                  >
                    <Copy className="size-4" />
                  </Button>
                </div>
                <p className="mt-1 text-xs text-[#686c98]">Отправьте код сопернику</p>
              </div>
            )}

            {pvp.message && (
              <p
                className={cn(
                  'rounded-md border px-3 py-2 text-sm leading-snug',
                  pvp.status === 'error'
                    ? 'border-[#ab1002]/60 bg-[#1c0906]/80 text-[#ff8f80]'
                    : 'border-[#686c98]/30 bg-[#0c1826]/80 text-[#9ba0d8]',
                )}
              >
                {pvp.message}
              </p>
            )}

            {matchmakingActive && (
              <Button
                variant="outline"
                onClick={() => engine?.cancelMatchmaking()}
                className="h-11 border-[#ab1002]/50 bg-transparent text-[#ff8f80] hover:bg-[#ab1002]/15 hover:text-[#ff8f80]"
              >
                <X className="size-4" /> Отмена
              </Button>
            )}
          </div>
        )}

        <p className="mt-5 border-t border-[#686c98]/20 pt-3 text-[11px] leading-relaxed text-[#686c98]">
          Клавиши: WASD — движение, J K L I / 1 2 3 4 — слоты A B C D
        </p>
      </div>
    </div>
  )
}
