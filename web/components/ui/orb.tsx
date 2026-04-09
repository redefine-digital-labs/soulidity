import { cn } from '@/lib/utils/cn'

interface OrbProps {
  color?: string
  size?: number
  top?: number | string
  left?: number | string
  right?: number | string
  bottom?: number | string
  className?: string
}

function Orb({
  color = 'var(--purple)',
  size = 400,
  top,
  left,
  right,
  bottom,
  className,
}: OrbProps) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        'fixed rounded-full blur-[80px] opacity-20 pointer-events-none z-0',
        className,
      )}
      style={{
        width: size,
        height: size,
        backgroundColor: color,
        top,
        left,
        right,
        bottom,
      }}
    />
  )
}

export { Orb }
export type { OrbProps }
