import { cn } from '@/lib/utils/cn'

interface DividerProps {
  className?: string
}

function Divider({ className }: DividerProps) {
  return <hr className={cn('border-t border-border my-5', className)} />
}

export { Divider }
export type { DividerProps }
