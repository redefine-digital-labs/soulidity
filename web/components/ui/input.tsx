import { forwardRef } from 'react'
import { cn } from '@/lib/utils/cn'

const baseStyles =
  'w-full rounded-[var(--ui-radius-sm)] border border-[var(--ui-border)] bg-[var(--ui-control-bg)] px-3.5 py-2.5 text-[var(--ui-text)] text-sm outline-none transition-colors placeholder:text-[var(--ui-placeholder)] focus:border-[var(--ui-action)]'

// Input

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {}

const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, ...props },
  ref,
) {
  return (
    <input
      ref={ref}
      className={cn(baseStyles, className)}
      {...props}
    />
  )
})

Input.displayName = 'Input'

// Textarea

interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {}

const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { className, ...props },
  ref,
) {
  return (
    <textarea
      ref={ref}
      className={cn(baseStyles, 'min-h-[120px] resize-y', className)}
      {...props}
    />
  )
})

Textarea.displayName = 'Textarea'

// Select

interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  children: React.ReactNode
}

const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { children, className, ...props },
  ref,
) {
  return (
    <select
      ref={ref}
      className={cn(baseStyles, 'cursor-pointer appearance-none pr-10', className)}
      {...props}
    >
      {children}
    </select>
  )
})

Select.displayName = 'Select'

export { Input, Textarea, Select }
export type { InputProps, TextareaProps, SelectProps }
