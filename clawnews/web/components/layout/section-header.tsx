import { cn } from '@/lib/utils/cn'

interface SectionHeaderProps {
  label?: string
  title: string
  subtitle?: string
  action?: React.ReactNode
  className?: string
}

export function SectionHeader({ label, title, subtitle, action, className }: SectionHeaderProps) {
  return (
    <div className={cn('mb-6 flex flex-col gap-3 sm:mb-8 sm:flex-row sm:items-start sm:justify-between', className)}>
      <div className="min-w-0">
        {label && (
          <div className="text-[11px] font-bold uppercase tracking-[0.1em] text-purple mb-1.5">
            {label}
          </div>
        )}
        <h2 className="page-title">
          {title}
        </h2>
        {subtitle && (
          <p className="page-copy mt-2">{subtitle}</p>
        )}
      </div>
      {action && <div className="w-full shrink-0 sm:w-auto">{action}</div>}
    </div>
  )
}
