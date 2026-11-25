// FloatingText3D — пул спрайтов: надписи о повреждении компонентов, 2 сек, подъём 0.5 (ТЗ 5.3)
import * as THREE from 'three'
import { FLOATING_TEXT } from '../shared/constants/physics'

const POOL = 8

export class FloatingText3D {
  private sprites: THREE.Sprite[] = []
  private lifes: number[] = []
  private start: number[] = []
  private cursor = 0
  private scene: THREE.Scene

  constructor(scene: THREE.Scene) {
    this.scene = scene
    for (let i = 0; i < POOL; i++) {
      const canvas = document.createElement('canvas')
      canvas.width = 512
      canvas.height = 96
      const mat = new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(canvas), transparent: true, depthTest: false, depthWrite: false })
      const sprite = new THREE.Sprite(mat)
      sprite.scale.set(3.4, 0.64, 1)
      sprite.position.set(0, -100, 0)
      sprite.visible = false
      sprite.renderOrder = 50
      this.sprites.push(sprite)
      this.lifes.push(0)
      this.start.push(0)
      scene.add(sprite)
    }
  }

  spawn(text: string, x: number, y: number, z: number): void {
    const i = this.cursor
    this.cursor = (this.cursor + 1) % POOL
    const sprite = this.sprites[i]
    const canvas = (sprite.material.map as THREE.CanvasTexture).image as HTMLCanvasElement
    const ctx = canvas.getContext('2d')!
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.font = 'bold 40px "Segoe UI", Arial, sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.lineWidth = 8
    ctx.strokeStyle = 'rgba(10,15,25,0.9)'
    ctx.strokeText(text, 256, 48)
    ctx.fillStyle = '#ffd7d0'
    ctx.fillText(text, 256, 48)
    ;(sprite.material.map as THREE.CanvasTexture).needsUpdate = true
    sprite.position.set(x, y, z)
    sprite.visible = true
    sprite.material.opacity = 1
    this.lifes[i] = FLOATING_TEXT.duration
    this.start[i] = y
  }

  update(dt: number): void {
    for (let i = 0; i < POOL; i++) {
      if (this.lifes[i] <= 0) continue
      this.lifes[i] -= dt
      const sprite = this.sprites[i]
      if (this.lifes[i] <= 0) {
        sprite.visible = false
        continue
      }
      // Плавный подъём на ~0.5 юнита за 2 сек + затухание
      const t = 1 - this.lifes[i] / FLOATING_TEXT.duration
      sprite.position.y = this.start[i] + t * FLOATING_TEXT.rise
      sprite.material.opacity = this.lifes[i] < 0.6 ? this.lifes[i] / 0.6 : 1
    }
  }

  dispose(): void {
    for (const s of this.sprites) {
      this.scene.remove(s)
      s.material.map?.dispose()
      s.material.dispose()
    }
  }
}
