// Менеджер ввода: клавиатура + виртуальные тач-кнопки, буфер с таймстампами,
// внедрение дебаффа материнской платы (сдвиг на 500 мс) (ТЗ 8.1, 12.1, 5.5)
import type { SlotId } from '../shared/types/strike.types'
import { SLOT_IDS } from '../shared/types/strike.types'
import { DEBUFFS } from '../shared/constants/debuffs'

export type MoveDir = 'left' | 'right' | 'none'

export interface InputEventItem {
  type: 'slot_down' | 'slot_up'
  slot: SlotId
  timestamp: number
}

export interface SampledInput {
  move: MoveDir
  jumpPressed: boolean
  crouchHeld: boolean
  slotDown: SlotId[]
  slotUp: SlotId[]
  held: Set<SlotId>
  holdDurations: Map<SlotId, number>
}

const KEY_TO_SLOT: Record<string, SlotId> = {
  KeyJ: 'A', KeyK: 'B', KeyL: 'C', KeyI: 'D',
  Digit1: 'A', Digit2: 'B', Digit3: 'C', Digit4: 'D',
}

export class InputManager {
  private keyMove = { left: false, right: false }
  private virtMove = { left: false, right: false }
  private keyJump = false
  private virtJump = false
  private keyCrouch = false
  private virtCrouch = false

  private jumpEdge = false
  private held = new Set<SlotId>()
  private holdStart = new Map<SlotId, number>()
  /** Очередь событий с учётом задержки материнки */
  private queue: InputEventItem[] = []
  /** Активная задержка ввода (мс), 0 = нет */
  private delayMs = 0
  private attached = false

  private onKeyDown = (e: KeyboardEvent): void => {
    if (e.repeat) return
    if (this.isEditableTarget(e)) return
    const slot = KEY_TO_SLOT[e.code]
    if (slot) {
      e.preventDefault()
      this.pushSlot(slot, true)
      return
    }
    switch (e.code) {
      case 'KeyA': case 'ArrowLeft':
        this.keyMove.left = true
        break
      case 'KeyD': case 'ArrowRight':
        this.keyMove.right = true
        break
      case 'KeyW': case 'ArrowUp':
        if (!this.keyJump) this.jumpEdge = true
        this.keyJump = true
        break
      case 'KeyS': case 'ArrowDown':
        this.keyCrouch = true
        break
    }
  }

  private onKeyUp = (e: KeyboardEvent): void => {
    if (this.isEditableTarget(e)) return
    const slot = KEY_TO_SLOT[e.code]
    if (slot) {
      this.pushSlot(slot, false)
      return
    }
    switch (e.code) {
      case 'KeyA': case 'ArrowLeft': this.keyMove.left = false; break
      case 'KeyD': case 'ArrowRight': this.keyMove.right = false; break
      case 'KeyW': case 'ArrowUp': this.keyJump = false; break
      case 'KeyS': case 'ArrowDown': this.keyCrouch = false; break
    }
  }

  private onBlur = (): void => {
    this.keyMove.left = this.keyMove.right = this.keyJump = this.keyCrouch = false
    this.virtMove.left = this.virtMove.right = this.virtJump = this.virtCrouch = false
  }

  /** Цель события — редактируемое поле (код комнаты, имя и т.п.):
   *  не перехватываем клавиши, чтобы текст вводился (баг: JKLI не печатались) */
  private isEditableTarget(e: KeyboardEvent): boolean {
    const t = e.target as HTMLElement | null
    if (!t) return false
    return t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable
  }

  attach(): void {
    if (this.attached) return
    window.addEventListener('keydown', this.onKeyDown)
    window.addEventListener('keyup', this.onKeyUp)
    window.addEventListener('blur', this.onBlur)
    this.attached = true
  }

  detach(): void {
    window.removeEventListener('keydown', this.onKeyDown)
    window.removeEventListener('keyup', this.onKeyUp)
    window.removeEventListener('blur', this.onBlur)
    this.attached = false
  }

  /** Виртуальные тач-кнопки (ТЗ 8.1: pointerId-изоляция на стороне React) */
  setVirtualMove(dir: 'left' | 'right' | 'jump' | 'crouch', pressed: boolean): void {
    if (dir === 'left') this.virtMove.left = pressed
    else if (dir === 'right') this.virtMove.right = pressed
    else if (dir === 'jump') {
      if (pressed && !this.virtJump) this.jumpEdge = true
      this.virtJump = pressed
    } else this.virtCrouch = pressed
  }

  setVirtualSlot(slot: SlotId, pressed: boolean): void {
    this.pushSlot(slot, pressed)
  }

  private pushSlot(slot: SlotId, down: boolean): void {
    const now = performance.now()
    this.queue.push({ type: down ? 'slot_down' : 'slot_up', slot, timestamp: now })
    if (down) {
      this.held.add(slot)
      this.holdStart.set(slot, now)
    } else {
      this.held.delete(slot)
      this.holdStart.delete(slot)
    }
  }

  /** Дебафф материнской платы (UPD-11): сдвиг таймстемпов ТОЛЬКО действий A–D на 500 мс.
   *  Движение (ходьба/прыжок/присед) не задерживается. */
  setInputDelay(enabled: boolean): void {
    this.delayMs = enabled ? DEBUFFS.motherboardInputDelayMs : 0
  }

  /** Сэмплировать ввод: мгновенное движение + события слотов, «вышедшие» из задержки */
  sample(dt: number): SampledInput {
    const now = performance.now()
    const slotDown: SlotId[] = []
    const slotUp: SlotId[] = []
    // Выпускаем события из очереди, чья задержка истекла
    while (this.queue.length > 0) {
      const item = this.queue[0]
      if (now - item.timestamp >= this.delayMs) {
        this.queue.shift()
        if (item.type === 'slot_down') slotDown.push(item.slot)
        else slotUp.push(item.slot)
      } else break
    }
    // Прыжок — движение: НЕ задерживается (UPD-11)
    let jumpPressed = false
    if (this.jumpEdge) {
      this.jumpEdge = false
      jumpPressed = true
    }
    const move: MoveDir =
      this.keyMove.left || this.virtMove.left ? 'left'
      : this.keyMove.right || this.virtMove.right ? 'right'
      : 'none'
    const crouchHeld = this.keyCrouch || this.virtCrouch
    const holdDurations = new Map<SlotId, number>()
    for (const s of this.held) {
      const t0 = this.holdStart.get(s)
      if (t0 !== undefined) holdDurations.set(s, (now - t0) / 1000)
    }
    void dt
    return { move, jumpPressed, crouchHeld, slotDown, slotUp, held: new Set(this.held), holdDurations }
  }

  reset(): void {
    this.queue = []
    this.held.clear()
    this.holdStart.clear()
    this.delayMs = 0
    this.onBlur()
  }
}

export const ALL_SLOTS = SLOT_IDS
