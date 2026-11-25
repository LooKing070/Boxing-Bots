// Глобальное состояние (Zustand) — мост между React-оверлеями и 3D-движком (ТЗ 8, 13)
import { create } from 'zustand'
import type { SlotId, SlotsConfig, SlotConfig } from '@/game/shared/types/strike.types'
import type { MatchEnd } from '@/game/shared/types/damage.types'
import type { BbSettings } from '@/game/shared/utils/serialization'
import { defaultSlots } from '@/game/shared/constants/defaults'
import {
  loadSettingsLocal, saveSettingsLocal, loadPresetsLocal, savePresetsLocal,
  loadPlayerName, savePlayerName,
} from '@/game/shared/utils/serialization'

export type SceneId = 'menu' | 'editor' | 'settings' | 'battle'

export interface HudState {
  timeLeft: number
  damageMe: number
  damageFoe: number
  ping: number | null
  fps: number
  /** Отсчёт до боя (MATCH_COUNTDOWN_S=3); 0 = нет */
  countdown: number
}

export type PvpStatus = 'idle' | 'searching' | 'waiting_room' | 'connecting' | 'battle' | 'error'

export interface PvpState {
  status: PvpStatus
  roomId: string | null
  role: 'host' | 'guest' | null
  peerName: string | null
  message: string | null
}

/** Мост: методы, которые UI вызывает у движка (регистрируется в GameRoot) */
export interface GameBridge {
  startPve(): void
  startPvpCreate(): void
  startPvpJoin(roomId: string): void
  startPvpQuick(): void
  cancelMatchmaking(): void
  leaveRoom(): void
  exitBattle(): void
  applyEditorSlot(slot: SlotId, cfg: SlotConfig): void
  previewSlot(slot: SlotId): void
  /** Единоразовый проигрыш слота во вьюпорте (горячие клавиши JKLI, ТЗ ПК) */
  previewSlotOnce(slot: SlotId): void
  stopPreview(): void
  savePresetsToServer(slots: SlotsConfig): void
  pressMove(dir: 'left' | 'right' | 'jump' | 'crouch', pressed: boolean): void
  pressSlot(slot: SlotId, pressed: boolean): void
  /** Реванш: голос готовности (UPD-12) */
  setRematch(ready: boolean): void
  requestFullscreen(): void
}

export interface UiToast {
  id: number
  text: string
  kind: 'info' | 'error' | 'success'
}

interface GameState {
  scene: SceneId
  setScene: (s: SceneId) => void

  settings: BbSettings
  updateSettings: (patch: Partial<BbSettings>) => void

  playerName: string
  setPlayerName: (n: string) => void

  slots: SlotsConfig
  updateSlot: (slot: SlotId, cfg: SlotConfig) => void
  resetSlots: () => void

  hud: HudState
  setHud: (patch: Partial<HudState>) => void

  battleResult: (MatchEnd & { selfWon: boolean | null }) | null
  setBattleResult: (r: (MatchEnd & { selfWon: boolean | null }) | null) => void

  pvp: PvpState
  setPvp: (patch: Partial<PvpState>) => void

  editorSlot: SlotId
  setEditorSlot: (s: SlotId) => void
  /** Активная плитка кадра в редакторе (подсветка маркера во вьюпорте) */
  editorFrameIdx: number
  setEditorFrameIdx: (i: number) => void
  editorPreviewPlaying: boolean
  setEditorPreviewPlaying: (v: boolean) => void
  /** Единоразовый проигрыш (не цикл): JKLI во вьюпорте редактора */
  editorPreviewOnce: boolean
  setEditorPreviewOnce: (v: boolean) => void
  /** Счётчик сессий превью: сцена сбрасывает таймеры при изменении */
  editorPreviewSeq: number
  bumpEditorPreviewSeq: () => void
  /** Реванш (UPD-12): мой голос + статус соперника (null = нет голоса) */
  rematch: { me: boolean; peer: boolean | null }
  setRematch: (p: { me?: boolean; peer?: boolean | null }) => void

  toasts: UiToast[]
  pushToast: (text: string, kind?: UiToast['kind']) => void
  dismissToast: (id: number) => void

  engine: GameBridge | null
  setEngine: (b: GameBridge | null) => void

  portraitBlocked: boolean
  setPortraitBlocked: (v: boolean) => void
}

let toastSeq = 1

export const useGameStore = create<GameState>((set, get) => ({
  scene: 'menu',
  setScene: (s) => set({ scene: s, battleResult: s === 'battle' ? null : get().battleResult }),

  settings: typeof window !== 'undefined' ? loadSettingsLocal() : {
    shadows: 'pcf', particleLimit: 150, pixelRatio: 1.5,
    volume: 0.8, sfxVolume: 0.8, musicVolume: 0.8,
    muted: false, touchSensitivity: 1, pingVisible: true, region: 'RU-MSK',
    aiDifficulty: 'normal',
  },
  updateSettings: (patch) => {
    const next = { ...get().settings, ...patch }
    saveSettingsLocal(next)
    set({ settings: next })
  },

  playerName: typeof window !== 'undefined' ? loadPlayerName() : 'Боец',
  setPlayerName: (n) => {
    savePlayerName(n)
    set({ playerName: n })
  },

  slots: (typeof window !== 'undefined' ? loadPresetsLocal() : null) || defaultSlots(),
  updateSlot: (slot, cfg) => {
    const next = { ...get().slots, [slot]: cfg }
    savePresetsLocal(next)
    set({ slots: next })
    // Автосохранение профиля на сервере (ТЗ 7.1: localStorage + профиль на сервере)
    get().engine?.savePresetsToServer(next)
  },
  resetSlots: () => {
    const d = defaultSlots()
    savePresetsLocal(d)
    set({ slots: d })
    get().engine?.savePresetsToServer(d)
  },

  hud: { timeLeft: 180, damageMe: 0, damageFoe: 0, ping: null, fps: 0, countdown: 0 },
  setHud: (patch) => set({ hud: { ...get().hud, ...patch } }),

  battleResult: null,
  setBattleResult: (r) => set({ battleResult: r }),

  pvp: { status: 'idle', roomId: null, role: null, peerName: null, message: null },
  setPvp: (patch) => set({ pvp: { ...get().pvp, ...patch } }),

  editorSlot: 'A',
  setEditorSlot: (s) => set({ editorSlot: s, editorFrameIdx: 0 }),
  editorFrameIdx: 0,
  setEditorFrameIdx: (i) => set({ editorFrameIdx: i }),
  editorPreviewPlaying: false,
  setEditorPreviewPlaying: (v) => set({ editorPreviewPlaying: v }),
  editorPreviewOnce: false,
  setEditorPreviewOnce: (v) => set({ editorPreviewOnce: v }),
  editorPreviewSeq: 0,
  bumpEditorPreviewSeq: () => set({ editorPreviewSeq: get().editorPreviewSeq + 1 }),

  rematch: { me: false, peer: null },
  setRematch: (p) => set({ rematch: { me: p.me ?? get().rematch.me, peer: p.peer !== undefined ? p.peer : get().rematch.peer } }),

  toasts: [],
  pushToast: (text, kind = 'info') => {
    const id = toastSeq++
    set({ toasts: [...get().toasts.slice(-3), { id, text, kind }] })
    setTimeout(() => get().dismissToast(id), 4000)
  },
  dismissToast: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),

  engine: null,
  setEngine: (b) => set({ engine: b }),

  portraitBlocked: false,
  setPortraitBlocked: (v) => set({ portraitBlocked: v }),
}))
