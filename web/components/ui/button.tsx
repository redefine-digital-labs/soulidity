import { forwardRef } from 'react'
import { cn } from '@/lib/utils/cn'

type ButtonVariant = 'primary' | 'gold' | 'teal' | 'outline' | 'ghost' | 'danger' | 'landing'
type ButtonSize = 'sm' | 'default' | 'lg'

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  full?: boolean
  children: React.ReactNode
}

const variantStyles: Record<ButtonVariant, string> = {
  primary:
    'border border-transparent bg-purple text-white hover:bg-purple-deep',
  gold:
    'border border-transparent bg-gold text-black hover:bg-gold-light',
  teal:
    'border border-transparent bg-teal text-black hover:opacity-85',
  outline:
    'border border-border bg-transparent text-foreground hover:border-purple hover:text-purple',
  ghost:
    'border border-transparent bg-transparent text-muted hover:text-[var(--text-primary)]',
  danger:
    'border border-transparent bg-danger text-white hover:opacity-85',
  landing:
    'border border-transparent bg-[linear-gradient(135deg,var(--purple),var(--purple-deep))] text-white hover:opacity-88 hover:-translate-y-px',
}

const sizeStyles: Record<ButtonSize, string> = {
  sm: 'rounded-lg px-3 py-2 text-xs sm:py-[5px]',
  default: 'rounded-lg px-4 py-2.5 text-[13px] sm:px-[18px] sm:py-2',
  lg: 'rounded-xl px-5 py-3 text-sm sm:px-7 sm:text-[15px]',
}

export function buttonStyles({
  variant = 'primary',
  size = 'default',
  full = false,
  className,
}: {
  variant?: ButtonVariant
  size?: ButtonSize
  full?: boolean
  className?: string
} = {}) {
  return cn(
    'inline-flex items-center justify-center gap-1.5 whitespace-nowrap font-semibold cursor-pointer select-none transition-[transform,background-color,border-color,color,opacity] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple/40 focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)]',
    variantStyles[variant],
    sizeStyles[size],
    full && 'w-full',
    className,
  )
}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'default', full = false, children, className, disabled, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled}
      className={cn(
        buttonStyles({ variant, size, full, className }),
        disabled && 'opacity-40 pointer-events-none cursor-not-allowed',
      )}
      {...props}
    >
      {children}
    </button>
  )
})

Button.displayName = 'Button'

export { Button }
export type { ButtonProps, ButtonVariant, ButtonSize }
