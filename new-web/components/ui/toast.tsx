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

const bgMap: Record<ToastColor, string> = {
  purple: 'bg-purple',
  gold: 'bg-gold',
  teal: 'bg-teal',
  success: 'bg-success',
  danger: 'bg-danger',
  default: 'bg-card2',
}

const textMap: Record<ToastColor, string> = {
  purple: 'text-white',
  gold: 'text-[#1A1040]',
  teal: 'text-[#0D0A1E]',
  success: 'text-white',
  danger: 'text-white',
  default: 'text-[var(--text-primary)]',
}

let nextId = 0

function ToastItem({ item, onDismiss }: { item: ToastItem; onDismiss: (id: number) => void }) {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    // Trigger fade-up after mount
    const showTimer = requestAnimationFrame(() => setVisible(true))

    const hideTimer = setTimeout(() => {
      setVisible(false)
      setTimeout(() => onDismiss(item.id), 300)
    }, 3000)

    return () => {
      cancelAnimationFrame(showTimer)
      clearTimeout(hideTimer)
    }
  }, [item.id, onDismiss])

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        'px-5 py-3 rounded-full text-sm font-medium shadow-lg border border-white/10 transition-all duration-300',
        bgMap[item.color],
        textMap[item.color],
        visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-3',
      )}
    >
      {item.message}
    </div>
  )
}

function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([])

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  const showToast = useCallback((message: string, color: ToastColor = 'default') => {
    const id = ++nextId
    setToasts((prev) => [...prev, { id, message, color }])
  }, [])

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}

      {/* Toast container */}
      {toasts.length > 0 && (
        <div
          aria-label="Notifications"
          className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[300] flex flex-col items-center gap-2 pointer-events-none"
        >
          {toasts.map((item) => (
            <ToastItem key={item.id} item={item} onDismiss={dismiss} />
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
