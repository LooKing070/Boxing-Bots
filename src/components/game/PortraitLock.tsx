'use client'

// Блокировка портретной ориентации (ТЗ: игра — только landscape)
import { RotateCcw } from 'lucide-react'
import { useGameStore } from './store'

export default function PortraitLock() {
  const blocked = useGameStore((s) => s.portraitBlocked)
  if (!blocked) return null
  return (
    <div className="dark pointer-events-auto fixed inset-0 z-50 flex touch-none flex-col items-center justify-center gap-5 bg-[#0a1520] px-8 text-center select-none">
      <RotateCcw className="size-14 animate-pulse text-[#686c98]" />
      <p className="text-lg font-semibold text-zinc-100 sm:text-xl">
        Поверните устройство горизонтально
      </p>
      <p className="text-sm text-[#686c98]">Игра доступна только в альбомной ориентации</p>
    </div>
  )
}
