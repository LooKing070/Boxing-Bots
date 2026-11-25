'use client'

// Всплывающие уведомления (ТЗ 8: без alert/confirm — только тосты стора)
import type { ReactNode } from 'react'
import { AlertTriangle, CheckCircle2, Info, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useGameStore } from './store'
import type { UiToast } from './store'

const TOAST_STYLES: Record<UiToast['kind'], { box: string; icon: ReactNode }> = {
  error: {
    box: 'border-[#ab1002]/70 bg-[#1c0906]/95 text-[#ffc9c2]',
    icon: <AlertTriangle className="size-4 shrink-0 text-[#ff6a55]" />,
  },
  success: {
    box: 'border-emerald-500/60 bg-[#07170e]/95 text-[#b8f0d2]',
    icon: <CheckCircle2 className="size-4 shrink-0 text-emerald-400" />,
  },
  info: {
    box: 'border-[#686c98]/60 bg-[#101a2e]/95 text-zinc-200',
    icon: <Info className="size-4 shrink-0 text-[#9ba0d8]" />,
  },
}

export default function Toasts() {
  const toasts = useGameStore((s) => s.toasts)
  const dismissToast = useGameStore((s) => s.dismissToast)
  return (
    <div className="pointer-events-none absolute right-2 top-2 z-30 flex w-[min(20rem,calc(100vw-1rem))] flex-col gap-2 sm:right-3 sm:top-3">
      {toasts.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => dismissToast(t.id)}
          aria-label={`Закрыть уведомление: ${t.text}`}
          className={cn(
            'dark pointer-events-auto flex w-full items-start gap-2.5 rounded-lg border px-3 py-2.5 text-left text-sm shadow-lg backdrop-blur-sm transition-opacity select-none hover:opacity-85',
            TOAST_STYLES[t.kind].box,
          )}
        >
          {TOAST_STYLES[t.kind].icon}
          <span className="flex-1 leading-snug">{t.text}</span>
          <X className="mt-0.5 size-3.5 shrink-0 opacity-60" />
        </button>
      ))}
    </div>
  )
}
