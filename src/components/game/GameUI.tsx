'use client'

// Корневой React-оверлей поверх WebGL-канваса (ТЗ 8, 13).
// Переключение сцен — только через store.scene + мост движка (без роутера).
import { useGameStore } from './store'
import BattleHUD from './BattleHUD'
import MainMenuUI from './MainMenuUI'
import PortraitLock from './PortraitLock'
import SettingsUI from './SettingsUI'
import StrikeEditorUI from './StrikeEditorUI'
import Toasts from './Toasts'

export default function GameUI() {
  const scene = useGameStore((s) => s.scene)
  return (
    <div className="pointer-events-none fixed inset-0 z-10">
      {scene === 'menu' && <MainMenuUI />}
      {scene === 'editor' && <StrikeEditorUI />}
      {scene === 'settings' && <SettingsUI />}
      {scene === 'battle' && <BattleHUD />}
      <Toasts />
      <PortraitLock />
    </div>
  )
}
