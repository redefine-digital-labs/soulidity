import { cn } from '@/lib/utils/cn'

interface LiveDotProps {
  className?: string
}

function LiveDot({ className }: LiveDotProps) {
  return (
    <span
      role="status"
      aria-label="Live"
      className={cn(
        'inline-block w-[7px] h-[7px] bg-success rounded-full',
        'animate-[pulse_1.5s_ease-in-out_infinite]',
        className,
      )}
    />
  )
}

export { LiveDot }
export type { LiveDotProps }
