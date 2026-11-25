// SceneManager — переходы 4 сцен, загрузка/выгрузка (ТЗ 12.1, 1.4)
import type { RenderEngine, PostAmounts } from '../rendering/RenderEngine'
import type { InputManager } from '../core/InputManager'
import type { PhysicsWorld } from '../physics/PhysicsWorld'
import type { Scene, SceneCtx, GameSceneId, SceneParams } from './Scene'
import { MainMenuScene, SettingsScene } from './MainMenuScene'
import { StrikeEditorScene } from './StrikeEditorScene'
import { BattleScene } from './BattleScene'
import { audioManager } from '../core/AudioManager'
import { useGameStore } from '@/components/game/store'

const BASE_POST: PostAmounts = { vignette: 0.14, glitch: 0, noise: 0 }

export class SceneManager {
  current: Scene | null = null
  currentId: GameSceneId | null = null
  postAmounts: PostAmounts = { ...BASE_POST }

  private ctx: SceneCtx
  private physics: PhysicsWorld
  private input: InputManager
  private switching = false
  private fpsRef: () => number

  constructor(engine: RenderEngine, physics: PhysicsWorld, input: InputManager, isMobile: boolean, fpsRef: () => number) {
    this.ctx = { engine, isMobile }
    this.physics = physics
    this.input = input
    this.fpsRef = fpsRef
  }

  async switchTo(id: GameSceneId, params?: SceneParams): Promise<void> {
    if (this.switching) return
    // Уже в этой сцене (кроме боя с другими параметрами)
    if (this.currentId === id && !(id === 'battle' && params?.mode)) return
    this.switching = true
    try {
      this.current?.dispose()
      this.current = null
      this.currentId = null
      this.ctx.engine.camera.fov = 30
      let scene: Scene
      switch (id) {
        case 'settings':
          scene = new SettingsScene(this.ctx)
          break
        case 'editor':
          scene = new StrikeEditorScene(this.ctx)
          break
        case 'battle':
          scene = new BattleScene(this.ctx, params ?? { mode: 'pve' }, this.input, this.physics)
          break
        case 'menu':
        default:
          scene = new MainMenuScene(this.ctx)
      }
      this.current = scene
      this.currentId = id
      if (scene instanceof BattleScene) {
        scene.fpsRef = this.fpsRef
      }
      // Тихий фоновый эмбиент в каждой сцене (меню/редактор/настройки — один,
      // бой — свой; включается после успешной загрузки сцены)
      audioManager.startAmbient(id === 'battle' ? 'battle' : 'menu')
      this.input.reset()
    } catch (e) {
      // Обработка ошибок без «белых экранов» (ТЗ 19)
      console.error('[SceneManager] Ошибка переключения сцены', e)
      useGameStore.getState().pushToast('Ошибка загрузки сцены', 'error')
    } finally {
      this.switching = false
    }
  }

  update(dt: number): void {
    this.current?.update(dt, 0)
    // Постэффекты: виньетка/глитч/шум дебаффов локального бота (ТЗ 5.5)
    const battle = this.current instanceof BattleScene ? this.current : null
    this.postAmounts = battle ? battle.post : { ...BASE_POST }
  }

  /** Активная боевая сцена (для моста реванша, UPD-12) */
  get battle(): BattleScene | null {
    return this.current instanceof BattleScene ? this.current : null
  }

  dispose(): void {
    this.current?.dispose()
    this.current = null
    this.currentId = null
    audioManager.stopAmbient()
  }
}
