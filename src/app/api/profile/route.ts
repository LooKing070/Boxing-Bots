// API профиля игрока (TZ-UPDATE §4 «Сохранить»: localStorage + профиль игрока).
// GET  /api/profile?name=X → { name, presets: SlotsConfig | null } (404, если профиля нет)
// POST /api/profile { name, presets } → upsert, { ok: true }
import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import {
  deserializeSlots,
  sanitizeSlots,
  serializeSlots,
} from '@/game/shared/utils/serialization'
import type { SlotsConfig, SlotId } from '@/game/shared/types/strike.types'

export const dynamic = 'force-dynamic'

const SLOT_IDS: SlotId[] = ['A', 'B', 'C', 'D']

/** Ручная валидация SlotsConfig: 4 слота, каждый — strike (target+speed+knockback+curve)
 *  | block (buff+frame). Старый формат с кадрами валидации не проходит — клиент
 *  отправляет только новую модель «движение»; чтение старых записей БД идёт через
 *  deserializeSlots (миграция v1 → v2). */
function isValidSlots(v: unknown): v is SlotsConfig {
  if (!v || typeof v !== 'object') return false
  const rec = v as Record<string, unknown>
  for (const id of SLOT_IDS) {
    const c = rec[id]
    if (!c || typeof c !== 'object') return false
    const cfg = c as Record<string, unknown>
    if (cfg.kind === 'strike') {
      if (typeof cfg.hand !== 'string') return false
      const t = cfg.target as Record<string, unknown> | undefined
      if (!t || typeof t.x !== 'number' || typeof t.y !== 'number' || typeof t.z !== 'number') return false
      if (typeof cfg.speed !== 'number' || typeof cfg.knockback !== 'number' || typeof cfg.curve !== 'number') return false
    } else if (cfg.kind === 'block') {
      if (typeof cfg.hand !== 'string' || typeof cfg.buff !== 'string') return false
      const f = cfg.frame as Record<string, unknown> | undefined
      if (!f || typeof f.x !== 'number' || typeof f.y !== 'number' || typeof f.z !== 'number') return false
    } else {
      return false
    }
  }
  return true
}

export async function GET(request: Request) {
  try {
    const name = (new URL(request.url).searchParams.get('name') ?? '').trim()
    if (!name) {
      return NextResponse.json({ name, presets: null }, { status: 400 })
    }
    const profile = await db.playerProfile.findUnique({ where: { name } })
    if (!profile) {
      return NextResponse.json({ name, presets: null }, { status: 404 })
    }
    const presets = deserializeSlots(profile.presets)
    return NextResponse.json({ name: profile.name, presets })
  } catch (err) {
    console.error('[api/profile] GET ошибка:', err)
    return NextResponse.json({ error: 'Внутренняя ошибка сервера' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => null)) as {
      name?: unknown
      presets?: unknown
    } | null
    const name = typeof body?.name === 'string' ? body.name.trim() : ''
    if (name.length < 1 || name.length > 24) {
      return NextResponse.json(
        { error: 'Имя должно содержать от 1 до 24 символов' },
        { status: 400 },
      )
    }
    if (!isValidSlots(body?.presets)) {
      return NextResponse.json({ error: 'Некорректный формат пресетов' }, { status: 400 })
    }
    // Нормализация (кадры 1–6, длительности 0.2–1.0, ±EDITOR_RANGE) + сериализация ≤200 Б
    const stored = serializeSlots(sanitizeSlots(body?.presets as SlotsConfig))
    await db.playerProfile.upsert({
      where: { name },
      update: { presets: stored },
      create: { name, presets: stored },
    })
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[api/profile] POST ошибка:', err)
    return NextResponse.json({ error: 'Внутренняя ошибка сервера' }, { status: 500 })
  }
}
