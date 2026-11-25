// SceneManager + базовые типы сцен (ТЗ 12.1)
import type * as THREE from 'three'
import type { RenderEngine } from '../rendering/RenderEngine'

export interface SceneCtx {
  engine: RenderEngine
  isMobile: boolean
}

export interface Scene {
  /** THREE-сцена для рендера */
  readonly threeScene: THREE.Scene
  update(dt: number, alpha: number): void
  dispose(): void
}

export type GameSceneId = 'menu' | 'editor' | 'settings' | 'battle'

export interface SceneParams {
  mode?: 'pve' | 'pvp-host' | 'pvp-guest'
  selfPresetId?: string
  peerName?: string
}

export type Vec3Like = THREE.Vector3
