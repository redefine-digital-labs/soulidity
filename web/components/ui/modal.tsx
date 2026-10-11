'use client'

import { useEffect } from 'react'
import { cn } from '@/lib/utils/cn'

type ModalMaxWidth = 'sm' | 'md' | 'lg'

const maxWidthMap: Record<ModalMaxWidth, string> = {
  sm: '420px',
  md: '500px',
  lg: '640px',
}

interface OverlayProps {
  onClick?: () => void
  children?: React.ReactNode
  className?: string
}

function Overlay({ onClick, children, className }: OverlayProps) {
  return (
    <div
      className={cn(
        'fixed inset-0 bg-[var(--ui-overlay)] backdrop-blur-sm z-[200] flex items-center justify-center p-4',
        className,
      )}
      onClick={onClick}
    >
      {children}
    </div>
  )
}

interface ModalProps {
  open: boolean
  onClose: () => void
  maxWidth?: ModalMaxWidth
  title?: string
  subtitle?: string
  children: React.ReactNode
  className?: string
}

function Modal({
  open,
  onClose,
  maxWidth = 'md',
  title,
  subtitle,
  children,
  className,
}: ModalProps) {
  // Lock body scroll when open
  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => {
      document.body.style.overflow = ''
    }
  }, [open])

  if (!open) return null

  return (
    <Overlay onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? 'modal-title' : undefined}
        style={{ maxWidth: maxWidthMap[maxWidth] }}
        className={cn(
          'relative w-full rounded-[var(--ui-radius-lg)] border border-[var(--ui-border)] bg-[var(--ui-surface)] p-8 shadow-[var(--ui-shadow-md)]',
          className,
        )}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close button */}
        <button
          onClick={onClose}
          aria-label="Close modal"
          className="absolute top-4 right-4 w-8 h-8 flex items-center justify-center rounded-lg text-muted hover:text-[var(--ui-text)] hover:bg-[var(--ui-surface-muted)] transition-all"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path
              d="M12 4L4 12M4 4l8 8"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
            />
          </svg>
        </button>

        {/* Header */}
        {(title || subtitle) && (
          <div className="mb-6">
            {title && (
              <h2 id="modal-title" className="text-lg font-semibold text-[var(--ui-text)]">
                {title}
              </h2>
            )}
            {subtitle && (
              <p className="mt-1 text-sm text-muted">{subtitle}</p>
            )}
          </div>
        )}

        {children}
      </div>
    </Overlay>
  )
}

export { Modal, Overlay }
export type { ModalProps, OverlayProps, ModalMaxWidth }
