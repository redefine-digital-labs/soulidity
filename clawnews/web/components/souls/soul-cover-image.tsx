import type { CSSProperties, ReactNode } from 'react'

interface SoulCoverImageProps {
  imageUrl?: string | null
  className?: string
  fallback?: ReactNode
  fallbackStyle?: CSSProperties
  hasOverlay?: boolean
  children?: ReactNode
}

export function SoulCoverImage({
  imageUrl,
  className,
  fallback,
  fallbackStyle,
  hasOverlay,
  children,
}: SoulCoverImageProps) {
  const containerClass = `relative overflow-hidden ${className ?? ''}`.trim()
  const bg: CSSProperties =
    fallbackStyle ?? {
      background: 'linear-gradient(135deg, var(--card2) 0%, var(--purple-deep) 100%)',
    }

  return (
    <div className={containerClass} style={bg}>
      {fallback && <div className="absolute inset-0 flex items-center justify-center">{fallback}</div>}
      {imageUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={imageUrl} alt="" className="absolute inset-0 h-full w-full object-cover" />
      )}
      {hasOverlay && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 bottom-0 h-2/5"
          style={{
            background: 'linear-gradient(to top, rgba(0,0,0,0.70) 0%, rgba(0,0,0,0.25) 50%, transparent 100%)',
          }}
        />
      )}
      {children}
    </div>
  )
}
