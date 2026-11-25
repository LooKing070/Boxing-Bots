// CameraController — следование, адаптивный зум (ТЗ 3.3) и динамический ракурс 3/4:
// чем дальше бот игрока уходит к краю арены по X, тем сильнее камера поворачивается
// вокруг арены (левый край — 3/4 со спины, правый — 3/4 спереди).
import * as THREE from 'three'
import { ARENA, ENVIRONMENT } from '../shared/constants/physics'
import { lerp, clamp } from '../shared/utils/math'

export class CameraController {
  private cam: THREE.PerspectiveCamera
  private basePos = new THREE.Vector3(
    ENVIRONMENT.camera.position.x,
    ENVIRONMENT.camera.position.y,
    ENVIRONMENT.camera.position.z
  )
  private lookTarget = new THREE.Vector3(
    ENVIRONMENT.camera.lookAt.x,
    ENVIRONMENT.camera.lookAt.y,
    ENVIRONMENT.camera.lookAt.z
  )
  private curLook = new THREE.Vector3()
  /** Текущий угол динамического ракурса (радианы) — плавится lerp'ом */
  private curYaw = 0

  constructor(cam: THREE.PerspectiveCamera) {
    this.cam = cam
    this.curLook.copy(this.lookTarget)
  }

  /**
   * Следование: lerp 0.05 к центру между бойцами по X/Y;
   * зум: FOV 25°–35° от расстояния между бойцами (ТЗ 3.3);
   * динамический ракурс: yaw = (playerX / boundX) · dynaYawMaxDeg — позиция камеры
   * вращается вокруг вертикальной оси арены (через точку lookAt):
   * игрок у левого края → камера со стороны спины (3/4 со спины),
   * у правого края → со стороны лица (3/4 спереди).
   */
  update(dt: number, fighterA: THREE.Vector3, fighterB: THREE.Vector3, playerX = 0): void {
    const midX = (fighterA.x + fighterB.x) / 2
    const midY = Math.min(2.6, (fighterA.y + fighterB.y) / 2 + 1.2)
    const dist = Math.abs(fighterA.x - fighterB.x)
    // FOV: бойцы рядом — зумим (25°), далеко — отъезд (35°)
    const targetFov = clamp(ENVIRONMENT.camera.fovMin + (dist / 14) * (ENVIRONMENT.camera.fovMax - ENVIRONMENT.camera.fovMin), ENVIRONMENT.camera.fovMin, ENVIRONMENT.camera.fovMax)

    const k = 1 - Math.pow(1 - ENVIRONMENT.camera.lerp, dt * 60)
    // Динамический ракурс 3/4 (плавный поворот за позицией игрока)
    const yawMax = (ENVIRONMENT.camera.dynaYawMaxDeg * Math.PI) / 180
    const targetYaw = clamp(playerX / ARENA.boundX, -1, 1) * yawMax
    this.curYaw = lerp(this.curYaw, targetYaw, k)
    // База (0,5,18) вращается вокруг вертикальной оси через центр арены
    const radius = Math.hypot(this.basePos.x, this.basePos.z)
    const baseYaw = Math.atan2(this.basePos.x, this.basePos.z)
    const yaw = baseYaw + this.curYaw
    const rx = Math.sin(yaw) * radius
    const rz = Math.cos(yaw) * radius

    this.cam.position.x = lerp(this.cam.position.x, rx + midX * 0.72, k)
    this.cam.position.y = lerp(this.cam.position.y, this.basePos.y + midY * 0.25, k)
    this.cam.position.z = lerp(this.cam.position.z, rz, k)
    this.curLook.x = lerp(this.curLook.x, this.lookTarget.x + midX * 0.8, k)
    this.curLook.y = lerp(this.curLook.y, this.lookTarget.y + midY * 0.3, k)
    this.cam.lookAt(this.curLook)
    this.cam.fov = lerp(this.cam.fov, targetFov, k)
    this.cam.updateProjectionMatrix()
  }

  /** Статичная камера для меню/редактора */
  reset(): void {
    this.cam.position.copy(this.basePos)
    this.curLook.copy(this.lookTarget)
    this.curYaw = 0
    this.cam.lookAt(this.curLook)
    this.cam.fov = ENVIRONMENT.camera.fov
    this.cam.updateProjectionMatrix()
  }

  /** Орбита редактора (лёгкое покачивание); бот в верхней половине экрана — панели снизу */
  editorSway(t: number): void {
    this.cam.position.set(this.basePos.x + Math.sin(t * 0.3) * 1.2, 3.2, this.basePos.z - 1.0)
    this.cam.lookAt(0, 1.2, 0)
    this.cam.fov = 34
    this.cam.updateProjectionMatrix()
  }
}
