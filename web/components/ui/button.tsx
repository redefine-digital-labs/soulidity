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
    'border border-transparent bg-[var(--ui-action)] text-[var(--ui-action-text)] hover:bg-[var(--ui-action-hover)]',
  gold:
    'border border-transparent bg-[var(--ui-value)] text-[var(--ui-value-action-text)] hover:bg-[var(--ui-value-hover)]',
  teal:
    'border border-transparent bg-[var(--ui-tech)] text-[var(--ui-tech-action-text)] hover:opacity-85',
  outline:
    'border border-[var(--ui-border)] bg-[var(--ui-surface)] text-[var(--ui-text)] hover:border-[var(--ui-action)] hover:bg-[var(--ui-soft-action)] hover:text-[var(--ui-action-label)]',
  ghost:
    'border border-transparent bg-transparent text-[var(--ui-muted)] hover:bg-[var(--ui-surface-muted)] hover:text-[var(--ui-text)]',
  danger:
    'border border-transparent bg-[var(--ui-danger)] text-white hover:opacity-85',
  landing:
    'border border-transparent bg-[linear-gradient(135deg,var(--ui-action),var(--ui-action-hover))] text-[var(--ui-action-text)] shadow-[var(--ui-shadow-action)] hover:opacity-88 hover:-translate-y-px',
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
    'ui-button inline-flex items-center justify-center gap-1.5 whitespace-nowrap font-semibold cursor-pointer select-none transition-[transform,background-color,border-color,color,opacity] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ui-focus)]/40 focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--ui-bg)]',
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
        disabled && 'cursor-not-allowed opacity-50 grayscale-[25%]',
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
