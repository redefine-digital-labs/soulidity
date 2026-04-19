import { useId } from 'react'
import { cn } from '@/lib/utils/cn'

interface SealMarkProps {
  size?: number
  variant?: 'gradient' | 'mono'
  className?: string
}

export function SealMark({ size = 48, variant = 'gradient', className }: SealMarkProps) {
  const gradientId = `sealmark-${useId()}`
  const strokeUrl = variant === 'gradient' ? `url(#${gradientId})` : 'currentColor'
  const coreColor = variant === 'gradient' ? '#F59E0B' : 'currentColor'

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
      className={cn('shrink-0', className)}
    >
      {variant === 'gradient' && (
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#A855F7" />
            <stop offset="1" stopColor="#14B8A6" />
          </linearGradient>
        </defs>
      )}
      <path
        d="M16 3 C 9 3, 4 8, 4 15 C 4 21, 8 25, 13 26 L 13 29 L 19 29 L 19 26 C 24 25, 28 21, 28 15 C 28 8, 23 3, 16 3 Z"
        fill={strokeUrl}
        opacity="0.15"
      />
      <path
        d="M16 6 C 10.5 6, 7 10, 7 15 C 7 19, 9.5 22, 13 23"
        stroke={strokeUrl}
        strokeWidth="1.8"
        strokeLinecap="round"
        fill="none"
      />
      <path
        d="M16 6 C 21.5 6, 25 10, 25 15 C 25 19, 22.5 22, 19 23"
        stroke={strokeUrl}
        strokeWidth="1.8"
        strokeLinecap="round"
        fill="none"
      />
      <circle cx="16" cy="15" r="3" fill={coreColor} />
      <path
        d="M13 25 L 13 28 L 19 28 L 19 25"
        stroke={strokeUrl}
        strokeWidth="1.8"
        strokeLinejoin="round"
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  )
}
