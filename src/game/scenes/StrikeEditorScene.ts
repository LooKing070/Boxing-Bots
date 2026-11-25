// StrikeEditorScene — редактор (TZ-UPDATE §4): бот в стойке, камера 3/4 спереди,
// траектория движения — квадратичная Безье от стойки к конечной точке (изгиб curve),
// маркер цели, хитбокс кулака FIST_HITBOX_SIZE=0.75, изгиб тела, предпросмотр циклом до остановки.
import * as THREE from 'three'
import type { Scene, SceneCtx } from './Scene'
import { Backdrop } from './Backdrop'
import { CameraController } from '../rendering/CameraController'
import type { SlotId, StrikeData, BlockData } from '../shared/types/strike.types'
import { isStrike, isBlock, curveTrajectoryPoint } from '../shared/types/strike.types'
import { FIST_HITBOX_SIZE, STAMINA } from '../shared/constants/physics'
import { useGameStore } from '@/components/game/store'

const SEGMENTS = 64

export class StrikeEditorScene implements Scene {
  readonly threeScene: THREE.Scene
  private backdrop: Backdrop
  private camCtl: CameraController
  private trajectory: THREE.Line
  private trajectoryMirror: THREE.Line
  private trajMat: THREE.LineBasicMaterial
  /** Кувырк-куб хитбокса кулака (0.75, полупрозрачный) */
  private hitbox: THREE.Mesh
  /** Маркер конечной точки (сфера) */
  private targetMarker: THREE.Mesh
  private t = 0
  private previewSlot: SlotId | null = null
  private previewT = 0
  private previewPlaying = false
  /** Единоразовый проигрыш (JKLI): движение → возврат/спад → стоп (не цикл) */
  private previewOnce = false
  private onceT = 0
  private lastPreviewSeq = 0
  private blockBlend = 0

  constructor(private ctx: SceneCtx) {
    this.threeScene = new THREE.Scene()
    this.backdrop = new Backdrop(this.threeScene, ctx.engine.renderer)
    this.camCtl = new CameraController(ctx.engine.camera)
    this.camCtl.reset()
    this.backdrop.bot.x = 0

    // Линия траектории (квадратичная Безье от стойки к цели, изгиб curve)
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array((SEGMENTS + 1) * 3), 3))
    this.trajMat = new THREE.LineBasicMaterial({ color: 0x9aa0c8, transparent: true, opacity: 0.9 })
    this.trajectory = new THREE.Line(geo, this.trajMat)
    this.trajectory.frustumCulled = false
    this.threeScene.add(this.trajectory)
    // Зеркальная линия — для удара «обеими» руками
    const geoM = new THREE.BufferGeometry()
    geoM.setAttribute('position', new THREE.BufferAttribute(new Float32Array((SEGMENTS + 1) * 3), 3))
    this.trajectoryMirror = new THREE.Line(geoM, this.trajMat)
    this.trajectoryMirror.frustumCulled = false
    this.trajectoryMirror.visible = false
    this.threeScene.add(this.trajectoryMirror)

    // Кувырк-куб хитбокса кулака — фиксированный FIST_HITBOX_SIZE (не настраивается)
    this.hitbox = new THREE.Mesh(
      new THREE.BoxGeometry(FIST_HITBOX_SIZE, FIST_HITBOX_SIZE, FIST_HITBOX_SIZE),
      new THREE.MeshBasicMaterial({ color: 0xff8844, transparent: true, opacity: 0.22, depthWrite: false })
    )
    this.threeScene.add(this.hitbox)

    // Маркер конечной точки
    this.targetMarker = new THREE.Mesh(
      new THREE.SphereGeometry(0.09, 12, 10),
      new THREE.MeshBasicMaterial({ color: 0xffb347, transparent: true, opacity: 0.95, depthWrite: false }),
    )
    this.targetMarker.visible = false
    this.threeScene.add(this.targetMarker)

    this.refreshPreviewFromStore()
  }

  /** Обновить превью из store */
  refreshPreviewFromStore(): void {
    const store = useGameStore.getState()
    this.backdrop.bot.slots = store.slots
    this.previewSlot = store.editorSlot
    this.previewPlaying = store.editorPreviewPlaying
    this.previewOnce = store.editorPreviewOnce
    // Новая сессия превью — сброс таймеров (перезапуск по повторному JKLI)
    if (store.editorPreviewSeq !== this.lastPreviewSeq) {
      this.lastPreviewSeq = store.editorPreviewSeq
      this.previewT = 0
      this.onceT = 0
    }
  }

  /** Завершить единоразовый проигрыш */
  private endPreviewOnce(): void {
    this.previewOnce = false
    this.previewPlaying = false
    this.onceT = 0
    this.previewT = 0
    const st = useGameStore.getState()
    st.setEditorPreviewPlaying(false)
    st.setEditorPreviewOnce(false)
  }

  update(dt: number): void {
    this.t += dt
    this.refreshPreviewFromStore()
    const bot = this.backdrop.bot
    const store = useGameStore.getState()
    bot.slots = store.slots

    const slot = this.previewSlot
    const cfg = slot ? bot.slots[slot] : null
    const strike: StrikeData | null = cfg && isStrike(cfg) ? cfg : null
    const block: BlockData | null = cfg && isBlock(cfg) ? cfg : null

    // Скрыть всё по умолчанию
    this.hitbox.visible = false
    this.targetMarker.visible = false
    this.trajectory.visible = false
    this.trajectoryMirror.visible = false

    if (strike) {
      bot.block.active = false
      bot.block.config = null
      if (this.previewPlaying && this.previewOnce) {
        // Единоразово: движение → возврат → стоп
        const total = strike.speed + 0.2
        this.onceT += dt
        const elapsed = Math.min(this.onceT, total)
        bot.activeStrike = {
          slot: slot!,
          data: strike,
          elapsed,
          strikeDur: strike.speed,
          totalDur: total,
          damage: 0,
          hitDone: { left: false, right: false },
          stopPoint: { left: null, right: null },
          stump: { left: !bot.grid.hasArm('left'), right: !bot.grid.hasArm('right') },
        }
        if (this.onceT >= total) this.endPreviewOnce()
      } else if (this.previewPlaying) {
        // Цикл: движение → возврат → пауза → заново
        const total = strike.speed + 0.2
        this.previewT += dt
        const cycle = total + 0.45
        const tt = this.previewT % cycle
        const elapsed = Math.min(tt, total)
        bot.activeStrike = {
          slot: slot!,
          data: strike,
          elapsed,
          strikeDur: strike.speed,
          totalDur: total,
          damage: 0,
          hitDone: { left: false, right: false },
          stopPoint: { left: null, right: null },
          stump: { left: !bot.grid.hasArm('left'), right: !bot.grid.hasArm('right') },
        }
        if (tt > total) this.previewT = 0
      } else {
        bot.activeStrike = null
      }
      this.updateTrajectory(strike)
    } else if (block) {
      bot.activeStrike = null
      const bpSec = STAMINA.blockPoseSec
      if (this.previewPlaying && this.previewOnce) {
        // Единоразово: подъём позы → удержание → спад → стоп
        const hold = 0.7
        this.onceT += dt
        let target: number
        if (this.onceT < bpSec) target = this.onceT / bpSec
        else if (this.onceT < bpSec + hold) target = 1
        else target = Math.max(0, 1 - (this.onceT - bpSec - hold) / bpSec)
        this.blockBlend = target
        if (this.onceT >= bpSec * 2 + hold) this.endPreviewOnce()
      } else {
        // Поза блока: blend по BLOCK_POSE_S при проигрывании
        this.blockBlend += ((this.previewPlaying ? 1 : 0) - this.blockBlend) * Math.min(1, dt / (bpSec / 2))
      }
      bot.block.active = this.blockBlend > 0.02
      bot.block.config = block
      bot.block.blend = this.blockBlend
    } else {
      bot.activeStrike = null
      bot.block.active = false
      bot.block.config = null
    }

    bot.update(dt, { move: 'none', jump: false, crouch: false }, bot.x + 1, false)
    this.backdrop.renderer.update(bot.grid)
    this.backdrop.env.updateStorm(dt)
    this.camCtl.editorSway(this.t)
  }

  private updateTrajectory(strike: StrikeData): void {
    const bot = this.backdrop.bot
    this.trajectory.visible = true
    const both = strike.hand === 'both'
    this.trajectoryMirror.visible = both
    const mainSide: 'left' | 'right' = strike.hand === 'right' ? 'right' : 'left'
    const mirrorSide: 'left' | 'right' = mainSide === 'left' ? 'right' : 'left'
    // Траектория = фактический путь кисти (как в аниматоре pathPosAt):
    // rest → rest + target; z зеркалится по стороне СО ЗНАКОМ
    // (левая: rest.z − target.z, правая: rest.z + target.z) —
    // +z разводит кисти наружу, −z сводит внутрь. «Обе» — две зеркальные линии.
    const endPoint = (side: 'left' | 'right') => {
      const base = bot.animator.restPos(side)
      const sz = side === 'left' ? -1 : 1
      return {
        x: base.x + strike.target.x,
        y: base.y + strike.target.y,
        z: base.z + sz * strike.target.z,
      }
    }
    const fillLine = (line: THREE.Line, side: 'left' | 'right'): void => {
      const base = bot.animator.restPos(side)
      const end = endPoint(side)
      const pos = line.geometry.getAttribute('position') as THREE.BufferAttribute
      for (let i = 0; i <= SEGMENTS; i++) {
        const p = curveTrajectoryPoint(base, end, strike.curve, i / SEGMENTS)
        pos.setXYZ(i, p.x, p.y, p.z)
      }
      pos.needsUpdate = true
      line.geometry.computeBoundingSphere()
    }
    fillLine(this.trajectory, mainSide)
    if (both) fillLine(this.trajectoryMirror, mirrorSide)

    // Маркер конечной точки (основной стороны)
    const m = this.targetMarker
    m.visible = true
    const mt = endPoint(mainSide)
    m.position.set(mt.x, mt.y, mt.z)
    m.scale.setScalar(1.4 * (1 + Math.sin(this.t * 5) * 0.12))
    ;(m.material as THREE.MeshBasicMaterial).opacity = 1

    // Хитбокс кулака (куб 0.75) — у кисти во время предпросмотра
    if (this.previewPlaying && bot.activeStrike) {
      const st = bot.activeStrike
      if (st.elapsed < st.strikeDur) {
        const hand = strike.hand === 'right'
          ? bot.animator.handWorld.right
          : bot.animator.handWorld.left
        this.hitbox.visible = true
        this.hitbox.position.set(hand.x, hand.y, hand.z)
        const op = 0.14 + 0.12 * Math.abs(Math.sin(this.t * 6))
        ;(this.hitbox.material as THREE.MeshBasicMaterial).opacity = op
      }
    }
  }

  dispose(): void {
    this.backdrop.dispose()
    this.threeScene.remove(this.trajectory, this.trajectoryMirror, this.hitbox, this.targetMarker)
    this.trajectory.geometry.dispose()
    this.trajectoryMirror.geometry.dispose()
    this.trajMat.dispose()
    this.hitbox.geometry.dispose()
    ;(this.hitbox.material as THREE.Material).dispose()
    this.targetMarker.geometry.dispose()
    ;(this.targetMarker.material as THREE.Material).dispose()
  }
}
