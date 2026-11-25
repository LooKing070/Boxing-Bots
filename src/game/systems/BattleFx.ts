// BattleFx — визуальные эффекты боя: частицы, плавающие надписи, полоски стамины, вспышки (ТЗ 5.3, 6.2, 11)
import * as THREE from 'three'
import { ParticleSystem } from '../rendering/ParticleSystem'
import { FloatingText3D } from '../rendering/FloatingText3D'
import { COLORS } from '../shared/constants/bot-config'
import { STAMINA_BAR } from '../shared/constants/physics'

/** Градиент полоски стамины #3fa9e2→#7fd4ff (§3.5.8) */
function staminaGradientTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas')
  c.width = 64
  c.height = 4
  const ctx = c.getContext('2d')!
  const g = ctx.createLinearGradient(0, 0, 64, 0)
  g.addColorStop(0, '#3fa9e2')
  g.addColorStop(1, '#7fd4ff')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 64, 4)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

export class BattleFx {
  particles: ParticleSystem
  texts: FloatingText3D
  private staminaBars: Array<{ group: THREE.Group; fill: THREE.Mesh; bg: THREE.Mesh }> = []
  private flash: THREE.PointLight
  private flashT = 0
  private scene: THREE.Scene

  constructor(scene: THREE.Scene, particleLimit: number, isMobile: boolean) {
    this.scene = scene
    this.particles = new ParticleSystem(scene, particleLimit, isMobile)
    this.texts = new FloatingText3D(scene)

    // Полоски стамины над ботами (только при активном блоке; градиент, 1.2 юнита, 6px)
    for (let i = 0; i < 2; i++) {
      const group = new THREE.Group()
      const bgMat = new THREE.MeshBasicMaterial({ color: 0x1a1f2a, transparent: true, opacity: 0.85, depthTest: false })
      const bg = new THREE.Mesh(new THREE.PlaneGeometry(STAMINA_BAR.widthUnits, 0.09), bgMat)
      const fillMat = new THREE.MeshBasicMaterial({ map: staminaGradientTexture(), transparent: true, opacity: 0.95, depthTest: false })
      const fill = new THREE.Mesh(new THREE.PlaneGeometry(STAMINA_BAR.widthUnits, 0.07), fillMat)
      fill.position.z = 0.001
      bg.renderOrder = 40
      fill.renderOrder = 41
      group.add(bg)
      group.add(fill)
      group.visible = false
      group.renderOrder = 40
      scene.add(group)
      this.staminaBars.push({ group, fill, bg })
    }

    // Вспышка при уничтожении компонента (ТЗ 11.2)
    this.flash = new THREE.PointLight(0xffffff, 0, 6)
    scene.add(this.flash)
  }

  spawnFlash(x: number, y: number, z: number, color: number): void {
    this.flash.position.set(x, y, z)
    this.flash.color.setHex(color)
    this.flash.intensity = 14
    this.flashT = 0.25
  }

  setStamina(botIndex: number, active: boolean, stamina: number, x: number, y: number, facing: number): void {
    const bar = this.staminaBars[botIndex]
    if (!bar) return
    bar.group.visible = active
    if (!active) return
    bar.group.position.set(x, y, 0)
    // fill от левого края: сдвигаем и масштабируем
    const w = Math.max(0.02, stamina / 100)
    bar.fill.scale.x = w
    bar.fill.position.x = -(1 - w) / 2
    bar.group.scale.x = facing
  }

  update(dt: number): void {
    this.particles.update(dt)
    this.texts.update(dt)
    if (this.flashT > 0) {
      this.flashT -= dt
      this.flash.intensity *= Math.max(0, 1 - dt * 12)
      if (this.flashT <= 0) this.flash.intensity = 0
    }
  }

  /** Эффекты попаданий по слоям (ТЗ 11.2) */
  hitArmor(point: THREE.Vector3 | { x: number; y: number; z: number }): void {
    this.particles.spawnBurst(point.x, point.y, point.z, 3 + Math.floor(Math.random() * 3), 0xffcc00, 2.4, 0.9)
  }

  hitSkeleton(point: { x: number; y: number; z: number }): void {
    this.particles.spawnBurst(point.x, point.y, point.z, 5 + Math.floor(Math.random() * 4), 0xff3300, 2.8, 1.1)
    this.particles.spawnBurst(point.x, point.y, point.z, 1 + Math.floor(Math.random() * 2), 0x888899, 1.6, 1.3)
  }

  hitComponent(point: { x: number; y: number; z: number }, colorHex: number, destroyed: boolean): void {
    const n = destroyed ? 15 + Math.floor(Math.random() * 6) : 8 + Math.floor(Math.random() * 5)
    this.particles.spawnBurst(point.x, point.y, point.z, n, colorHex, destroyed ? 3.6 : 2.6, destroyed ? 1.5 : 1.1)
    if (destroyed) {
      this.particles.spawnBurst(point.x, point.y, point.z, 5 + Math.floor(Math.random() * 4), 0x555a66, 3.0, 1.5)
      this.spawnFlash(point.x, point.y, point.z, colorHex === 0 ? 0xffffff : colorHex)
    }
  }

  notify(text: string, x: number, y: number, z: number): void {
    this.texts.spawn(text, x, y, z)
  }

  dispose(): void {
    this.particles.dispose()
    this.texts.dispose()
    for (const b of this.staminaBars) {
      this.scene.remove(b.group)
      b.fill.geometry.dispose()
      b.bg.geometry.dispose()
      ;(b.fill.material as THREE.Material).dispose()
      ;(b.bg.material as THREE.Material).dispose()
    }
    this.scene.remove(this.flash)
  }
}

export const COMPONENT_COLORS: Record<string, number> = {
  camera: COLORS.cameraOwn,
  motherboard: COLORS.motherboard,
  gyroscope: 0x333340,
  battery: 0x2a5c8c,
}
