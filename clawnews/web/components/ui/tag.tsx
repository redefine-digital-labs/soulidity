import { forwardRef } from 'react'
import { cn } from '@/lib/utils/cn'

type TagColor = 'purple' | 'gold' | 'teal' | 'muted' | 'success' | 'danger'

interface TagProps extends React.HTMLAttributes<HTMLSpanElement> {
  color?: TagColor
  children: React.ReactNode
}

const colorStyles: Record<TagColor, { text: string; border: string; bg: string }> = {
  purple: {
    text: 'text-purple',
    border: 'border-purple',
    bg: 'bg-purple/10',
  },
  gold: {
    text: 'text-gold',
    border: 'border-gold',
    bg: 'bg-gold/10',
  },
  teal: {
    text: 'text-teal',
    border: 'border-teal',
    bg: 'bg-teal/10',
  },
  muted: {
    text: 'text-muted',
    border: 'border-border',
    bg: 'bg-transparent',
  },
  success: {
    text: 'text-success',
    border: 'border-success',
    bg: 'bg-success/10',
  },
  danger: {
    text: 'text-danger',
    border: 'border-danger',
    bg: 'bg-danger/10',
  },
}

const Tag = forwardRef<HTMLSpanElement, TagProps>(function Tag(
  { color = 'purple', children, className, onClick, ...props },
  ref,
) {
  const { text, border, bg } = colorStyles[color]

  return (
    <span
      ref={ref}
      onClick={onClick}
      className={cn(
        'inline-flex items-center rounded-full border px-2.5 py-[3px] text-[11.5px] font-semibold tracking-[0.02em]',
        text,
        border,
        bg,
        onClick && 'cursor-pointer hover:opacity-80 transition-opacity',
        className,
      )}
      {...props}
    >
      {children}
    </span>
  )
})

Tag.displayName = 'Tag'

export { Tag }
export type { TagProps, TagColor }
