'use client'
// GameRoot — монтирует WebGL-канвас и движок игры (ТЗ 15.1)
// StrictMode-безопасно: один экземпляр Game на канвас (повторный монтаж переиспользует его).
import { useEffect, useRef } from 'react'
import { Game } from '@/game/Game'
import { useGameStore } from './store'

let singleton: Game | null = null
let singletonCanvas: HTMLCanvasElement | null = null

export default function GameRoot() {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    // Повторный монтаж (StrictMode): переиспользуем живой экземпляр
    if (singleton && singletonCanvas === canvas) {
      useGameStore.getState().setEngine(singleton.bridge)
      return
    }

    const game = new Game(canvas)
    singleton = game
    singletonCanvas = canvas
    useGameStore.getState().setEngine(game.bridge)
    // Отладочный хук стора (dev-QA)
    ;(window as unknown as { __bbStore?: typeof useGameStore }).__bbStore = useGameStore

    let resizeTimer: ReturnType<typeof setTimeout> | null = null
    const onResize = () => {
      if (resizeTimer) clearTimeout(resizeTimer)
      resizeTimer = setTimeout(() => game.engine.resize(), 100)
    }
    window.addEventListener('resize', onResize)

    // Инициализация (Rapier WASM + сцена меню + запуск цикла)
    game.init().catch((e) => {
      console.error('[GameRoot] Ошибка инициализации', e)
      useGameStore.getState().pushToast('Ошибка запуска игры. Обновите страницу.', 'error')
    })

    // Первый жест: разблокировка звука (Howler сам снимает автоплей-блокировку)
    const unlock = () => {
      void import('@/game/core/AudioManager').then(({ audioManager }) => {
        const s = useGameStore.getState().settings
        audioManager.init({ volume: s.volume, muted: s.muted, sfxVolume: s.sfxVolume, musicVolume: s.musicVolume })
      })
      window.removeEventListener('pointerdown', unlock)
      window.removeEventListener('keydown', unlock)
    }
    window.addEventListener('pointerdown', unlock)
    window.addEventListener('keydown', unlock)

    return () => {
      // Только слушатели: экземпляр Game живёт на канвасе (StrictMode remount переиспользует)
      window.removeEventListener('resize', onResize)
      window.removeEventListener('pointerdown', unlock)
      window.removeEventListener('keydown', unlock)
    }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      className="fixed inset-0 block h-full w-full"
      style={{ touchAction: 'none' }}
      aria-label="3D-сцена Boxing-Bots"
    />
  )
}
