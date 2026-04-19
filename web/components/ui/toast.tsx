'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react'
import { cn } from '@/lib/utils/cn'

type ToastColor = 'purple' | 'gold' | 'teal' | 'success' | 'danger' | 'default'

interface ToastItem {
  id: number
  message: string
  color: ToastColor
}

interface ToastContextValue {
  showToast: (message: string, color?: ToastColor) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

// Semantic left-border stripe per design-review X5:
//   success = teal, warning = gold, danger = red, default = purple.
// Body is a dark card so the stripe is the signal, not a full-bleed pill.
const stripeMap: Record<ToastColor, string> = {
  success: 'border-l-teal',
  teal: 'border-l-teal',
  gold: 'border-l-gold',
  danger: 'border-l-danger',
  purple: 'border-l-purple',
  default: 'border-l-purple',
}

const iconMap: Record<ToastColor, string> = {
  success: '✓',
  teal: '✓',
  gold: '⚑',
  danger: '✕',
  purple: '✦',
  default: '✦',
}

const iconColorMap: Record<ToastColor, string> = {
  success: 'text-teal',
  teal: 'text-teal',
  gold: 'text-gold',
  danger: 'text-danger',
  purple: 'text-purple',
  default: 'text-purple',
}

const MAX_TOASTS = 3
const DISMISS_MS = 6000

let nextId = 0

function ToastRow({
  item,
  paused,
  onDismiss,
}: {
  item: ToastItem
  paused: boolean
  onDismiss: (id: number) => void
}) {
  const [visible, setVisible] = useState(false)
  const pausedRef = useRef(paused)
  const remainingRef = useRef(DISMISS_MS)
  const startedAtRef = useRef<number | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    // Fade-in after mount.
    const showTimer = requestAnimationFrame(() => setVisible(true))
    return () => cancelAnimationFrame(showTimer)
  }, [])

  useEffect(() => {
    function scheduleDismiss(ms: number) {
      if (timerRef.current) clearTimeout(timerRef.current)
      startedAtRef.current = Date.now()
      timerRef.current = setTimeout(() => {
        setVisible(false)
        setTimeout(() => onDismiss(item.id), 200)
      }, ms)
    }

    if (!paused) {
      scheduleDismiss(remainingRef.current)
    } else if (pausedRef.current === false && startedAtRef.current !== null) {
      // Transition: unpaused → paused. Record how much time is left.
      const elapsed = Date.now() - startedAtRef.current
      remainingRef.current = Math.max(0, remainingRef.current - elapsed)
      if (timerRef.current) clearTimeout(timerRef.current)
    }
    pausedRef.current = paused
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [paused, item.id, onDismiss])

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        'pointer-events-auto flex min-w-[260px] max-w-[360px] items-start gap-2.5 overflow-hidden rounded-lg border border-border border-l-2 bg-card px-3.5 py-2.5 text-sm shadow-[0_10px_32px_rgba(0,0,0,0.45)] backdrop-blur-[8px] transition-all duration-200',
        stripeMap[item.color],
        visible ? 'translate-x-0 opacity-100' : 'translate-x-3 opacity-0',
      )}
    >
      <span className={cn('mt-0.5 shrink-0 text-base leading-none', iconColorMap[item.color])} aria-hidden="true">
        {iconMap[item.color]}
      </span>
      <span className="flex-1 leading-snug text-foreground">{item.message}</span>
      <button
        type="button"
        onClick={() => onDismiss(item.id)}
        aria-label="Dismiss"
        className="shrink-0 rounded text-[11px] font-bold uppercase tracking-[0.08em] text-muted transition hover:text-foreground"
      >
        ✕
      </button>
    </div>
  )
}

function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([])
  // Track hover and focus pause sources independently. Collapsing them into a
  // single boolean lets a mixed-input sequence resume the timer while one
  // source is still active (e.g. hover the stack, tab through dismiss, tab
  // away — onBlur clears the shared flag even though the pointer is still
  // inside).
  const [isHovered, setIsHovered] = useState(false)
  const [isFocused, setIsFocused] = useState(false)
  const paused = isHovered || isFocused

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  // Reset pause sources once the stack drains, otherwise the next toast inherits
  // stale paused=true (the container unmounted while hovered/focused, so
  // mouseLeave/blur never fired) and never schedules its dismiss timer.
  useEffect(() => {
    if (toasts.length === 0) {
      setIsHovered(false)
      setIsFocused(false)
    }
  }, [toasts.length])

  const showToast = useCallback((message: string, color: ToastColor = 'default') => {
    const id = ++nextId
    setToasts((prev) => {
      const next = [...prev, { id, message, color }]
      // Cap the stack — drop oldest entries if we exceed MAX_TOASTS.
      return next.length > MAX_TOASTS ? next.slice(next.length - MAX_TOASTS) : next
    })
  }, [])

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}

      {toasts.length > 0 && (
        <div
          aria-label="Notifications"
          onMouseEnter={() => setIsHovered(true)}
          onMouseLeave={() => setIsHovered(false)}
          onFocus={() => setIsFocused(true)}
          onBlur={(e) => {
            // Keep paused while focus is still inside the toast stack (e.g. tabbing
            // between dismiss buttons). Only resume the countdown when focus
            // genuinely leaves the container.
            if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
              setIsFocused(false)
            }
          }}
          className="pointer-events-none fixed bottom-5 right-5 z-[300] flex w-auto flex-col items-end gap-2 sm:bottom-6 sm:right-6"
        >
          {toasts.map((item) => (
            <ToastRow key={item.id} item={item} paused={paused} onDismiss={dismiss} />
          ))}
        </div>
      )}
    </ToastContext.Provider>
  )
}

function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext)
  if (!ctx) {
    throw new Error('useToast must be used within a ToastProvider')
  }
  return ctx
}

export { ToastProvider, useToast }
export type { ToastColor, ToastItem }
