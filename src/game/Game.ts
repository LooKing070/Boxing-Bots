// Game — оркестратор: рендер, цикл, сцены, ввод, настройки, сетевой мост (ТЗ 15.1)
import { RenderEngine, type ShadowQuality } from './rendering/RenderEngine'
import { GameLoop } from './core/GameLoop'
import { InputManager } from './core/InputManager'
import { PhysicsWorld } from './physics/PhysicsWorld'
import { SceneManager } from './scenes/SceneManager'
import type { GameSceneId, SceneParams } from './scenes/Scene'
import { audioManager } from './core/AudioManager'
import { networkManager } from './network/NetworkManager'
import { useGameStore, type GameBridge } from '@/components/game/store'
import type { SlotId, SlotsConfig, SlotConfig } from './shared/types/strike.types'
import type { BbSettings } from './shared/utils/serialization'

export class Game {
  engine: RenderEngine
  loop: GameLoop
  input: InputManager
  scenes: SceneManager
  physics: PhysicsWorld
  bridge: GameBridge
  private settings: BbSettings
  private fpsGetter: () => number

  constructor(canvas: HTMLCanvasElement) {
    this.engine = new RenderEngine(canvas)
    this.settings = useGameStore.getState().settings
    this.engine.setPixelRatio(this.settings.pixelRatio)
    this.engine.setShadowQuality(this.settings.shadows as ShadowQuality)

    this.input = new InputManager()
    this.input.attach()
    this.physics = new PhysicsWorld()
    this.fpsGetter = () => this.loop.fps
    this.scenes = new SceneManager(this.engine, this.physics, this.input, this.isMobile(), this.fpsGetter)

    // Цикл: фиксированный шаг 60 Гц + альфа-рендер (ТЗ 12.1)
    this.loop = new GameLoop(
      (dt) => {
        this.scenes.update(dt)
      },
      (alpha) => {
        const scene = this.scenes.current
        if (scene) {
          const meFx = this.scenes.postAmounts
          this.engine.render(scene.threeScene, meFx)
        }
        void alpha
      }
    )

    this.bridge = {
      startPve: () => this.enterBattle('pve'),
      startPvpCreate: () => this.pvpFlow('create'),
      startPvpJoin: (roomId) => this.pvpFlow('join', roomId),
      startPvpQuick: () => this.pvpFlow('quick'),
      cancelMatchmaking: () => {
        networkManager.cancel()
        useGameStore.getState().setPvp({ status: 'idle', message: null })
      },
      leaveRoom: () => {
        networkManager.leave()
        useGameStore.getState().setPvp({ status: 'idle', roomId: null, role: null, peerName: null, message: null })
      },
      exitBattle: () => {
        networkManager.leave()
        const st = useGameStore.getState()
        st.setBattleResult(null)
        st.setPvp({ status: 'idle', roomId: null, role: null, peerName: null, message: null })
        st.setScene('menu')
        void this.switchScene('menu')
      },
      applyEditorSlot: (slot: SlotId, cfg: SlotConfig) => {
        useGameStore.getState().updateSlot(slot, cfg)
      },
      previewSlot: (slot: SlotId) => {
        const st = useGameStore.getState()
        st.setEditorPreviewOnce(false) // циклический режим
        st.setEditorPreviewPlaying(true)
        st.setEditorSlot(slot)
        st.bumpEditorPreviewSeq()
      },
      previewSlotOnce: (slot: SlotId) => {
        // Единоразовый проигрыш (JKLI во вьюпорте редактора)
        const st = useGameStore.getState()
        st.setEditorPreviewOnce(true)
        st.setEditorPreviewPlaying(true)
        st.setEditorSlot(slot)
        st.bumpEditorPreviewSeq()
      },
      stopPreview: () => {
        const st = useGameStore.getState()
        st.setEditorPreviewPlaying(false)
        st.setEditorPreviewOnce(false)
      },
      savePresetsToServer: (slots: SlotsConfig) => {
        const name = useGameStore.getState().playerName
        fetch('/api/profile', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, presets: slots }),
        }).catch(() => {
          /* graceful degradation: пресеты всегда есть в localStorage */
        })
      },
      pressMove: (dir, pressed) => {
        this.input.setVirtualMove(dir, pressed)
      },
      pressSlot: (slot, pressed) => {
        this.input.setVirtualSlot(slot, pressed)
      },
      setRematch: (ready) => {
        this.scenes.battle?.setRematchReady(ready)
      },
      requestFullscreen: () => {
        try {
          if (!document.fullscreenElement) {
            void document.documentElement.requestFullscreen?.()
          }
          // Блокировка landscape (может не поддерживаться — есть CSS-заглушка, ТЗ 1.2)
          const orientation = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> }
          void orientation.lock?.('landscape').catch(() => {})
        } catch {
          /* graceful degradation */
        }
      },
    }

    // Подписка на изменения настроек
    useGameStore.subscribe((state, prev) => {
      if (state.settings !== prev.settings) {
        this.applySettings(state.settings)
      }
      if (state.scene !== prev.scene) {
        // Синхронизация сцен: React → SceneManager (за исключением battle — он входит через мост)
        if (state.scene !== 'battle' && this.scenes.currentId !== state.scene) {
          void this.switchScene(state.scene)
        }
      }
    })

    // Сетевые ошибки → тосты
    networkManager.onError((msg) => {
      useGameStore.getState().pushToast(msg, 'error')
      useGameStore.getState().setPvp({ status: 'error', message: msg })
    })
    networkManager.onLatency((rtt) => {
      useGameStore.getState().setHud({ ping: rtt })
    })
  }

  isMobile(): boolean {
    return this.engine.isMobile
  }

  private applySettings(s: BbSettings): void {
    this.engine.setPixelRatio(s.pixelRatio)
    this.engine.setShadowQuality(s.shadows as ShadowQuality)
    audioManager.setVolume(s.volume)
    audioManager.setSfxVolume(s.sfxVolume)
    audioManager.setMusicVolume(s.musicVolume)
    audioManager.setMuted(s.muted)
  }

  async init(): Promise<void> {
    await this.physics.init()
    await this.switchScene('menu')
    this.loop.start()
    // Отладочный хук (доступен только в dev)
    ;(window as unknown as { __bbGame?: Game }).__bbGame = this
    ;(window as unknown as { __bbScenes?: SceneManager }).__bbScenes = this.scenes
  }

  async switchScene(id: GameSceneId, params?: SceneParams): Promise<void> {
    await this.scenes.switchTo(id, params)
  }

  enterBattle(mode: 'pve' | 'pvp-host' | 'pvp-guest'): void {
    const store = useGameStore.getState()
    store.setBattleResult(null)
    store.setScene('battle')
    void this.switchScene('battle', { mode })
  }

  private pvpFlow(kind: 'create' | 'join' | 'quick', roomId?: string): void {
    const store = useGameStore.getState()
    store.setPvp({ status: kind === 'create' ? 'waiting_room' : 'searching', message: null })
    const name = store.playerName
    const slots = store.slots
    // Код комнаты/роль → UI (лобби-этап, ТЗ 13.1)
    networkManager.onRoomJoined((p) => {
      useGameStore.getState().setPvp({
        status: p.role === 'host' ? 'waiting_room' : 'searching',
        roomId: p.roomId,
        role: p.role,
      })
    })
    if (kind === 'create') {
      void networkManager.createRoom(name, slots)
    } else if (kind === 'join' && roomId) {
      void networkManager.joinRoom(roomId, name, slots)
    } else {
      void networkManager.startQuick(name, slots)
    }
    // Ждём match:start
    networkManager.onMatchStart(() => {
      const role = networkManager.role
      store.setPvp({ status: 'battle', role, peerName: networkManager.peerName, roomId: networkManager.roomId })
      this.enterBattle(role === 'guest' ? 'pvp-guest' : 'pvp-host')
    })
  }

  dispose(): void {
    this.loop.stop()
    this.scenes.dispose()
    this.input.detach()
    this.physics.dispose()
    this.engine.dispose()
    networkManager.leave()
  }
}
