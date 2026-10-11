'use client'

import { cn } from '@/lib/utils/cn'
import { Spinner } from '@/components/ui/spinner'

interface TxPendingProps {
  message?: string
  visible: boolean
  className?: string
}

function TxPending({ message = 'Transaction pending…', visible, className }: TxPendingProps) {
  if (!visible) return null

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={message}
      className={cn(
        'fixed bottom-20 left-1/2 -translate-x-1/2 z-[250]',
        'flex items-center gap-3 px-5 py-3',
        'rounded-[12px] border border-purple/40 bg-card2',
        'shadow-[0_8px_32px_rgba(168,85,247,0.18)]',
        className,
      )}
    >
      <Spinner size="sm" />
      <span className="text-sm font-medium text-foreground">{message}</span>
    </div>
  )
}

export { TxPending }
export type { TxPendingProps }
