'use client'

// Настройки (ТЗ 3.2): графика, звук, управление, сеть. Изменения → store.updateSettings (localStorage)
import type { ReactNode } from 'react'
import { ArrowLeft, Keyboard, Monitor, Volume2, Wifi, Swords } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import { useGameStore } from './store'
import type { BbSettings } from '@/game/shared/utils/serialization'

const SELECT_CONTENT = 'dark border-[#686c98]/40 bg-[#101d2c] text-zinc-100'
const SELECT_TRIGGER = 'h-11 w-full border-[#686c98]/40 bg-[#0c1826]/80 text-zinc-100'

function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded border border-[#686c98]/40 bg-[#101d2c] px-1.5 py-0.5 font-mono text-[11px] text-zinc-200">
      {children}
    </kbd>
  )
}

const KEYMAP: ReadonlyArray<{ action: string; keys: ReadonlyArray<string> }> = [
  { action: 'Влево / Вправо', keys: ['A / D', '← / →'] },
  { action: 'Прыжок', keys: ['W', '↑'] },
  { action: 'Присед', keys: ['S', '↓'] },
  { action: 'Слоты A B C D', keys: ['J K L I', '1 2 3 4'] },
  { action: 'Блок', keys: ['удержание слота'] },
]

function limitLabel(v: number): string {
  if (v <= 50) return 'Низкий'
  if (v <= 100) return 'Средний'
  return 'Высокий'
}

export default function SettingsUI() {
  const settings = useGameStore((s) => s.settings)
  const updateSettings = useGameStore((s) => s.updateSettings)
  const setScene = useGameStore((s) => s.setScene)

  return (
    <div className="absolute inset-0 flex items-center justify-center p-2 sm:p-4">
      <div className="dark pointer-events-auto flex max-h-full w-[min(94vw,44rem)] flex-col overflow-hidden rounded-xl border border-[#686c98]/30 bg-[#0a1520]/90 shadow-[0_0_50px_rgba(0,0,0,0.65)] backdrop-blur-sm select-none">
        <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-3 sm:gap-4 sm:p-5">
          <h1 className="text-sm font-bold tracking-[0.25em] uppercase text-zinc-100">Настройки</h1>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {/* Графика */}
            <Card className="border-[#686c98]/25 bg-[#0d1b28]/80">
              <CardHeader className="py-3">
                <CardTitle className="flex items-center gap-2 text-xs tracking-wider uppercase text-[#9ba0d8]">
                  <Monitor className="size-4" /> Графика
                </CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <div className="flex flex-col gap-1.5">
                  <Label className="text-sm text-zinc-300">Качество теней</Label>
                  <Select
                    value={settings.shadows}
                    onValueChange={(v) => updateSettings({ shadows: v as BbSettings['shadows'] })}
                  >
                    <SelectTrigger className={SELECT_TRIGGER}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className={SELECT_CONTENT}>
                      <SelectItem value="pcf">PCF (мягкие)</SelectItem>
                      <SelectItem value="basic">Basic</SelectItem>
                      <SelectItem value="off">Выключены</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex flex-col gap-2">
                  <div className="flex items-baseline justify-between">
                    <Label className="text-sm text-zinc-300">Лимит частиц</Label>
                    <span className="text-xs text-[#9ba0d8]">{limitLabel(settings.particleLimit)}</span>
                  </div>
                  <Slider
                    min={50}
                    max={150}
                    step={50}
                    value={[settings.particleLimit]}
                    onValueChange={(v) => updateSettings({ particleLimit: v[0] })}
                    className="cursor-pointer [&_[data-slot=slider-thumb]]:size-5"
                  />
                  <div className="flex text-[10px] tracking-wider uppercase">
                    {([50, 100, 150] as const).map((v, i) => (
                      <span
                        key={v}
                        className={cn(
                          'flex-1 text-center',
                          i === 0 && 'text-left',
                          i === 2 && 'text-right',
                          settings.particleLimit === v ? 'text-zinc-100' : 'text-[#686c98]/60',
                        )}
                      >
                        {limitLabel(v)}
                      </span>
                    ))}
                  </div>
                </div>

                <div className="flex flex-col gap-2">
                  <div className="flex items-baseline justify-between">
                    <Label className="text-sm text-zinc-300">Разрешение рендера</Label>
                    <span className="font-mono text-xs tabular-nums text-[#9ba0d8]">
                      {settings.pixelRatio}×
                    </span>
                  </div>
                  <Slider
                    min={0.5}
                    max={2}
                    step={0.25}
                    value={[settings.pixelRatio]}
                    onValueChange={(v) => updateSettings({ pixelRatio: v[0] })}
                    className="cursor-pointer [&_[data-slot=slider-thumb]]:size-5"
                  />
                </div>
              </CardContent>
            </Card>

            {/* Звук */}
            <Card className="border-[#686c98]/25 bg-[#0d1b28]/80">
              <CardHeader className="py-3">
                <CardTitle className="flex items-center gap-2 text-xs tracking-wider uppercase text-[#9ba0d8]">
                  <Volume2 className="size-4" /> Звук
                </CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <div className="flex flex-col gap-2">
                  <div className="flex items-baseline justify-between">
                    <Label className="text-sm text-zinc-300">Общая громкость</Label>
                    <span className="font-mono text-xs tabular-nums text-[#9ba0d8]">
                      {Math.round(settings.volume * 100)}%
                    </span>
                  </div>
                  <Slider
                    min={0}
                    max={1}
                    step={0.05}
                    value={[settings.volume]}
                    onValueChange={(v) => updateSettings({ volume: v[0] })}
                    className="cursor-pointer [&_[data-slot=slider-thumb]]:size-5"
                    disabled={settings.muted}
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <div className="flex items-baseline justify-between">
                    <Label className="text-sm text-zinc-300">Звуки</Label>
                    <span className="font-mono text-xs tabular-nums text-[#9ba0d8]">
                      {Math.round(settings.sfxVolume * 100)}%
                    </span>
                  </div>
                  <Slider
                    min={0}
                    max={1}
                    step={0.05}
                    value={[settings.sfxVolume]}
                    onValueChange={(v) => updateSettings({ sfxVolume: v[0] })}
                    className="cursor-pointer [&_[data-slot=slider-thumb]]:size-5"
                    disabled={settings.muted}
                  />
                  <p className="text-[11px] leading-tight text-[#686c98]">
                    Удары, гром, интерфейс и стингеры победы/поражения
                  </p>
                </div>
                <div className="flex flex-col gap-2">
                  <div className="flex items-baseline justify-between">
                    <Label className="text-sm text-zinc-300">Музыка и эмбиент</Label>
                    <span className="font-mono text-xs tabular-nums text-[#9ba0d8]">
                      {Math.round(settings.musicVolume * 100)}%
                    </span>
                  </div>
                  <Slider
                    min={0}
                    max={1}
                    step={0.05}
                    value={[settings.musicVolume]}
                    onValueChange={(v) => updateSettings({ musicVolume: v[0] })}
                    className="cursor-pointer [&_[data-slot=slider-thumb]]:size-5"
                    disabled={settings.muted}
                  />
                  <p className="text-[11px] leading-tight text-[#686c98]">
                    Фоновые подложки сцен и шум дождя
                  </p>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <Label htmlFor="bb-mute" className="text-sm text-zinc-300">
                    Выключить звук
                  </Label>
                  <Switch
                    id="bb-mute"
                    checked={settings.muted}
                    onCheckedChange={(v) => updateSettings({ muted: v })}
                    className="data-[state=checked]:bg-[#686c98]"
                  />
                </div>
              </CardContent>
            </Card>

            {/* Управление */}
            <Card className="border-[#686c98]/25 bg-[#0d1b28]/80 md:col-span-2">
              <CardHeader className="py-3">
                <CardTitle className="flex items-center gap-2 text-xs tracking-wider uppercase text-[#9ba0d8]">
                  <Keyboard className="size-4" /> Управление
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
                  {KEYMAP.map((row) => (
                    <div key={row.action} className="flex items-center justify-between gap-3">
                      <span className="text-sm text-zinc-300">{row.action}</span>
                      <span className="flex flex-wrap items-center justify-end gap-1.5">
                        {row.keys.map((k, i) => (
                          <span key={k} className="flex items-center gap-1.5">
                            {i > 0 && <span className="text-[10px] text-[#686c98]">или</span>}
                            <Kbd>{k}</Kbd>
                          </span>
                        ))}
                      </span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* PvE: сложность ИИ (§3.7, сохраняется в настройках) */}
            <Card className="border-[#686c98]/25 bg-[#0d1b28]/80">
              <CardHeader className="py-3">
                <CardTitle className="flex items-center gap-2 text-xs tracking-wider uppercase text-[#9ba0d8]">
                  <Swords className="size-4" /> Сложность ИИ
                </CardTitle>
              </CardHeader>
              <CardContent>
                <Select
                  value={settings.aiDifficulty}
                  onValueChange={(v) => updateSettings({ aiDifficulty: v as BbSettings['aiDifficulty'] })}
                >
                  <SelectTrigger className={SELECT_TRIGGER}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className={SELECT_CONTENT}>
                    <SelectItem value="easy">Лёгкая</SelectItem>
                    <SelectItem value="normal">Средняя</SelectItem>
                    <SelectItem value="hard">Сложная</SelectItem>
                  </SelectContent>
                </Select>
              </CardContent>
            </Card>

            {/* Сеть */}
            <Card className="border-[#686c98]/25 bg-[#0d1b28]/80 md:col-span-2">
              <CardHeader className="py-3">
                <CardTitle className="flex items-center gap-2 text-xs tracking-wider uppercase text-[#9ba0d8]">
                  <Wifi className="size-4" /> Сеть
                </CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="flex items-center justify-between gap-3">
                  <Label htmlFor="bb-ping" className="text-sm text-zinc-300">
                    Показывать пинг
                  </Label>
                  <Switch
                    id="bb-ping"
                    checked={settings.pingVisible}
                    onCheckedChange={(v) => updateSettings({ pingVisible: v })}
                    className="data-[state=checked]:bg-[#686c98]"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label className="text-sm text-zinc-300">Регион (лобби)</Label>
                  <Select value={settings.region} onValueChange={(v) => updateSettings({ region: v })}>
                    <SelectTrigger className={SELECT_TRIGGER}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className={SELECT_CONTENT}>
                      <SelectItem value="RU-MSK">RU-MSK</SelectItem>
                      <SelectItem value="RU-SPB">RU-SPB</SelectItem>
                      <SelectItem value="EU">EU</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>

        <div className="border-t border-[#686c98]/20 p-3 sm:p-4">
          <Button
            variant="outline"
            onClick={() => setScene('menu')}
            className="h-11 w-full border-[#686c98]/40 bg-[#101d2c]/80 text-zinc-100 hover:border-[#686c98] hover:bg-[#686c98]/15"
          >
            <ArrowLeft className="size-4" /> Назад в меню
          </Button>
        </div>
      </div>
    </div>
  )
}
