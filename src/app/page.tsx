'use client'
// Boxing-Bots — единственный маршрут: 3D-канвас + React-оверлеи 4 сцен (ТЗ 1.4, 13)
import dynamic from 'next/dynamic'
import { useEffect } from 'react'
import GameUI from '@/components/game'
import { useGameStore } from '@/components/game/store'

const GameRoot = dynamic(() => import('@/components/game/GameRoot'), {
  ssr: false,
  loading: () => (
    <div className="fixed inset-0 flex items-center justify-center bg-[#0a1520]">
      <div className="text-center">
        <div className="mx-auto mb-4 h-10 w-10 animate-spin rounded-full border-2 border-[#686c98] border-t-transparent" />
        <p className="text-sm tracking-widest text-[#686c98]">ЗАГРУЗКА АРЕНЫ…</p>
      </div>
    </div>
  ),
})

export default function Page() {
  const setPortraitBlocked = useGameStore((s) => s.setPortraitBlocked)

  // Landscape-only: CSS-заглушка при portrait (ТЗ 1.2)
  useEffect(() => {
    const isTouch = typeof window !== 'undefined' &&
      ('ontouchstart' in window || navigator.maxTouchPoints > 0)
    const mq = window.matchMedia('(orientation: portrait)')
    const check = () => setPortraitBlocked(isTouch && mq.matches)
    check()
    mq.addEventListener('change', check)
    return () => mq.removeEventListener('change', check)
  }, [setPortraitBlocked])

  return (
    <main className="fixed inset-0 overflow-hidden bg-[#0a1520]" aria-label="Boxing-Bots">
      <GameRoot />
      <GameUI />
    </main>
  )
}
