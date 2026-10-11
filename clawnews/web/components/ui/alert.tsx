import { forwardRef } from 'react'
import { cn } from '@/lib/utils/cn'

type AlertVariant = 'info' | 'success' | 'warning'

interface AlertProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: AlertVariant
  icon?: React.ReactNode
  children: React.ReactNode
}

const variantStyles: Record<AlertVariant, string> = {
  info: 'bg-purple/10 border border-purple/30 text-purple',
  success: 'bg-success/10 border border-success/30 text-success',
  warning: 'bg-gold/10 border border-gold/30 text-gold',
}

const Alert = forwardRef<HTMLDivElement, AlertProps>(function Alert(
  { variant = 'info', icon, children, className, ...props },
  ref,
) {
  return (
    <div
      ref={ref}
      role="alert"
      className={cn(
        'rounded-[10px] px-4 py-3 text-sm flex items-start gap-2.5',
        variantStyles[variant],
        className,
      )}
      {...props}
    >
      {icon && (
        <span className="mt-px shrink-0 leading-none" aria-hidden="true">
          {icon}
        </span>
      )}
      <span className="text-[var(--text-primary)] opacity-90">{children}</span>
    </div>
  )
})

Alert.displayName = 'Alert'

export { Alert }
export type { AlertProps, AlertVariant }
