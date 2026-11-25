// Backdrop — общая сцена-подложка (арена + фон + дыхающий бот) для меню/редактора/настроек (ТЗ 13.1)
import * as THREE from 'three'
import { buildEnvironment, type EnvironmentHandles } from '../rendering/Environment'
import { buildBot } from '../entities/BotFactory'
import { BotEntity } from '../entities/BotEntity'
import { BotVoxelRenderer } from '../rendering/VoxelRenderer'
import { defaultSlots } from '../shared/constants/defaults'
import { ENVIRONMENT } from '../shared/constants/physics'
import type { SlotsConfig } from '../shared/types/strike.types'

export class Backdrop {
  scene: THREE.Scene
  env: EnvironmentHandles
  bot: BotEntity
  renderer: BotVoxelRenderer
  eyeLight: THREE.PointLight

  constructor(scene: THREE.Scene, glRenderer?: THREE.WebGLRenderer, slots?: SlotsConfig) {
    this.scene = scene
    this.env = buildEnvironment(scene, glRenderer)
    const data = buildBot(0x3fa9e2)
    this.bot = new BotEntity('backdrop', 'Бот', data, slots ?? defaultSlots())
    this.bot.x = -0.6
    this.renderer = new BotVoxelRenderer(data, this.bot.grid, scene)
    this.eyeLight = new THREE.PointLight(0x3fa9e2, 0.5, 3)
    scene.add(this.eyeLight)
  }

  update(dt: number): void {
    // «Дыхание» в меню (ТЗ 4.7)
    this.bot.update(dt, { move: 'none', jump: false, crouch: false }, this.bot.x + 1, true)
    this.renderer.update(this.bot.grid, 1 - this.bot.fx.eyesDim * 0.7)
    this.env.updateStorm(dt)
    // Свет глаз: от живых кубов-камер (глаз), чуть впереди лица (бот в меню смотрит в +X)
    const eye = this.bot.grid.eyeCenterWorld()
    if (eye) {
      this.eyeLight.position.set(eye.x + 0.18, eye.y, eye.z)
      this.eyeLight.intensity = ENVIRONMENT.eyeLight.intensity * (1 - this.bot.fx.eyesDim * 0.7)
    } else {
      this.eyeLight.intensity = 0
    }
  }

  dispose(): void {
    this.renderer.dispose(this.scene)
    this.env.dispose()
    this.scene.remove(this.eyeLight)
  }
}
