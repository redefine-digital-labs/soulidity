import { cn } from '@/lib/utils/cn'

interface ProgressBarProps {
  value: number
  className?: string
}

function ProgressBar({ value, className }: ProgressBarProps) {
  const clamped = Math.min(100, Math.max(0, value))

  return (
    <div
      role="progressbar"
      aria-valuenow={clamped}
      aria-valuemin={0}
      aria-valuemax={100}
      className={cn('w-full h-1 bg-card2 rounded-full overflow-hidden', className)}
    >
      <div
        className="h-full rounded-full transition-all duration-500"
        style={{
          width: `${clamped}%`,
          background: 'linear-gradient(90deg, var(--purple), var(--teal))',
        }}
      />
    </div>
  )
}

export { ProgressBar }
export type { ProgressBarProps }
