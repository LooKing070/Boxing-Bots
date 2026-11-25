// MainMenuScene / SettingsScene — фон: 3D-сцена с «дышащим» ботом (ТЗ 13.1, 13.3)
import * as THREE from 'three'
import type { Scene, SceneCtx } from './Scene'
import { Backdrop } from './Backdrop'
import { CameraController } from '../rendering/CameraController'

export class MainMenuScene implements Scene {
  readonly threeScene: THREE.Scene
  private backdrop: Backdrop
  private camCtl: CameraController
  private t = 0

  constructor(_ctx: SceneCtx) {
    this.threeScene = new THREE.Scene()
    this.backdrop = new Backdrop(this.threeScene, _ctx.engine.renderer)
    this.camCtl = new CameraController(_ctx.engine.camera)
    this.camCtl.reset()
  }

  update(dt: number): void {
    this.t += dt
    this.backdrop.update(dt)
    // Медленный дрейф камеры
    this.camCtl.editorSway(this.t)
  }

  dispose(): void {
    this.backdrop.dispose()
  }
}

/** Настройки используют ту же подложку (ТЗ 13.3) */
export class SettingsScene extends MainMenuScene {}
