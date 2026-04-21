import { cn } from '@/lib/utils/cn'

type GridCols = 2 | 3 | 5
type GridGap = 'sm' | 'default'

interface GridProps {
  cols?: GridCols
  gap?: GridGap
  className?: string
  children: React.ReactNode
}

const colStyles: Record<GridCols, string> = {
  2: 'grid-cols-1 sm:grid-cols-2',
  3: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3',
  5: 'grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5',
}

const gapStyles: Record<GridGap, string> = {
  sm: 'gap-[14px]',
  default: 'gap-[16px]',
}

export function Grid({ cols = 3, gap = 'default', className, children }: GridProps) {
  return (
    <div className={cn('grid', colStyles[cols], gapStyles[gap], className)}>
      {children}
    </div>
  )
}
