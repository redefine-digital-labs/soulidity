import { cn } from '@/lib/utils/cn'
import { Button, type ButtonVariant } from './button'

interface EmptyStateProps {
  icon: string
  label: string
  sublabel?: string
  actionLabel?: string
  actionVariant?: ButtonVariant
  onAction?: () => void
  actionHref?: string
  className?: string
}

function EmptyState({
  icon,
  label,
  sublabel,
  actionLabel,
  actionVariant = 'outline',
  onAction,
  className,
}: EmptyStateProps) {
  return (
    <div className={cn('flex flex-col items-center justify-center py-12 text-center', className)}>
      <div className="text-5xl opacity-40">{icon}</div>
      <div className="mt-4 text-base font-semibold text-foreground">{label}</div>
      {sublabel && (
        <div className="mt-1.5 text-[13px] text-muted">{sublabel}</div>
      )}
      {actionLabel && onAction && (
        <Button variant={actionVariant} size="sm" onClick={onAction} className="mt-4">
          {actionLabel}
        </Button>
      )}
    </div>
  )
}

export { EmptyState }
export type { EmptyStateProps }
