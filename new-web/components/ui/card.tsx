import { forwardRef } from 'react'
import { cn } from '@/lib/utils/cn'

type CardAccent = 'default' | 'purple' | 'gold' | 'teal'

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  accent?: CardAccent
  hover?: boolean
  children: React.ReactNode
}

const accentStyles: Record<CardAccent, string> = {
  default: 'border-border',
  purple: 'border-purple',
  gold: 'border-gold',
  teal: 'border-teal',
}

const Card = forwardRef<HTMLDivElement, CardProps>(function Card(
  { accent = 'default', hover = false, children, className, ...props },
  ref,
) {
  return (
    <div
      ref={ref}
      className={cn(
        'card rounded-xl p-5',
        accentStyles[accent],
        hover &&
          'card-hover cursor-pointer',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  )
})

Card.displayName = 'Card'

export { Card }
export type { CardProps, CardAccent }
