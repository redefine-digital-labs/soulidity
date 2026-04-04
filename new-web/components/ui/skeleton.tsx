import { cn } from '@/lib/utils/cn'

type SkeletonVariant = 'text' | 'card' | 'circle'

interface SkeletonProps {
  variant?: SkeletonVariant
  className?: string
}

const variantStyles: Record<SkeletonVariant, string> = {
  text: 'h-4 rounded',
  card: 'h-40 rounded-xl',
  circle: 'rounded-full aspect-square',
}

function Skeleton({ variant = 'text', className }: SkeletonProps) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        'bg-card2 animate-pulse',
        variantStyles[variant],
        className,
      )}
    />
  )
}

export { Skeleton }
export type { SkeletonProps, SkeletonVariant }
