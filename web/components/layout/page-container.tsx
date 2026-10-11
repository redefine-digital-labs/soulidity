import { cn } from '@/lib/utils/cn'

type PageContainerSize = 'default' | 'sm' | 'md'

interface PageContainerProps {
  size?: PageContainerSize
  className?: string
  children: React.ReactNode
}

const maxWidths: Record<PageContainerSize, string> = {
  default: 'max-w-[1100px]',
  sm: 'max-w-[540px]',
  md: 'max-w-[720px]',
}

export function PageContainer({ size = 'default', className, children }: PageContainerProps) {
  return (
    <div className={cn('relative z-10 mx-auto w-full px-4 py-8 sm:px-6 sm:py-10 lg:px-8', maxWidths[size], className)}>
      {children}
    </div>
  )
}
