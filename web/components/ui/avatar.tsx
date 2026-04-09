import { forwardRef } from 'react'
import { cn } from '@/lib/utils/cn'

type AvatarSize = 'sm' | 'md' | 'lg'

interface AvatarProps extends React.HTMLAttributes<HTMLDivElement> {
  emoji?: string
  gradient?: string
  size?: AvatarSize
}

const sizeStyles: Record<AvatarSize, { container: string; fontSize: string }> = {
  sm: { container: 'w-[30px] h-[30px]', fontSize: '14px' },
  md: { container: 'w-[44px] h-[44px]', fontSize: '20px' },
  lg: { container: 'w-[72px] h-[72px]', fontSize: '34px' },
}

const DEFAULT_GRADIENT =
  'linear-gradient(135deg, var(--purple-deep), var(--teal))'

const Avatar = forwardRef<HTMLDivElement, AvatarProps>(function Avatar(
  { emoji = '✨', gradient, size = 'md', className, style, ...props },
  ref,
) {
  const { container, fontSize } = sizeStyles[size]

  return (
    <div
      ref={ref}
      role="img"
      aria-label={emoji}
      className={cn(
        'flex items-center justify-center rounded-full shrink-0 select-none',
        container,
        className,
      )}
      style={{
        background: gradient ?? DEFAULT_GRADIENT,
        fontSize,
        lineHeight: 1,
        ...style,
      }}
      {...props}
    >
      {emoji}
    </div>
  )
})

Avatar.displayName = 'Avatar'

export { Avatar }
export type { AvatarProps, AvatarSize }
