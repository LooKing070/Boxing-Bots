// RenderEngine — Three.js рендерер, свет, тени, постобработка (ТЗ 12.2)
import * as THREE from 'three'
import { ENVIRONMENT } from '../shared/constants/physics'
import { PostFX } from './PostProcessing'

export type ShadowQuality = 'pcf' | 'basic' | 'off'

export interface PostAmounts {
  vignette: number
  glitch: number
  noise: number
}

export class RenderEngine {
  renderer: THREE.WebGLRenderer
  camera: THREE.PerspectiveCamera
  postfx: PostFX | null = null
  isMobile: boolean
  private disposed = false

  constructor(canvas: HTMLCanvasElement) {
    this.isMobile = typeof window !== 'undefined' &&
      ('ontouchstart' in window || navigator.maxTouchPoints > 0) &&
      window.innerWidth < 1024

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: !this.isMobile,
      powerPreference: 'high-performance',
      alpha: false,
    })
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFShadowMap
    this.renderer.outputColorSpace = THREE.SRGBColorSpace

    // Камера по ТЗ 3.3: PerspectiveCamera FOV 30, позиция (0,5,18), lookAt(0,3,0)
    this.camera = new THREE.PerspectiveCamera(ENVIRONMENT.camera.fov, 1, 0.1, 200)
    this.camera.position.set(ENVIRONMENT.camera.position.x, ENVIRONMENT.camera.position.y, ENVIRONMENT.camera.position.z)
    this.camera.lookAt(ENVIRONMENT.camera.lookAt.x, ENVIRONMENT.camera.lookAt.y, ENVIRONMENT.camera.lookAt.z)

    this.resize()
  }

  setPixelRatio(ratio: number): void {
    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio : 1
    const r = Math.min(ratio, this.isMobile ? Math.min(dpr, 1.25) : dpr)
    this.renderer.setPixelRatio(Math.max(0.5, r))
    this.resize()
  }

  setShadowQuality(q: ShadowQuality): void {
    if (q === 'off') {
      this.renderer.shadowMap.enabled = false
    } else {
      this.renderer.shadowMap.enabled = true
      this.renderer.shadowMap.type = q === 'pcf' ? THREE.PCFSoftShadowMap : THREE.BasicShadowMap
    }
    // Требуется пересоздание материалов для смены типа теней
    this.renderer.shadowMap.needsUpdate = true
  }

  resize(): void {
    if (this.disposed) return
    const canvas = this.renderer.domElement
    const w = canvas.clientWidth || window.innerWidth
    const h = canvas.clientHeight || window.innerHeight
    this.renderer.setSize(w, h, false)
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
    this.postfx?.setSize(w, h)
  }

  /** Рендер сцены; постэффекты — одним проходом (виньетка/глитч/шум) */
  render(scene: THREE.Scene, amounts: PostAmounts): void {
    if (amounts.vignette > 0.001 || amounts.glitch > 0.001 || amounts.noise > 0.001) {
      if (!this.postfx) {
        this.postfx = new PostFX(this.renderer)
      }
      this.postfx.uniforms.vignette.value = amounts.vignette
      this.postfx.uniforms.glitch.value = amounts.glitch
      this.postfx.uniforms.noise.value = amounts.noise
      this.renderer.setRenderTarget(this.postfx.target)
      this.renderer.render(scene, this.camera)
      this.renderer.setRenderTarget(null)
      // Полноэкранный треугольник из PostFX (его собственная сцена)
      this.postfx.update(performance.now() / 1000)
      this.renderer.render(this.postfx.scene, this.postfx.cam)
    } else {
      this.renderer.setRenderTarget(null)
      this.renderer.render(scene, this.camera)
    }
  }

  dispose(): void {
    this.disposed = true
    this.postfx?.dispose()
    this.renderer.dispose()
  }
}
