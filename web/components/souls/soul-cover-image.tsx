import type { CSSProperties, ReactNode } from 'react'
import { SoulArtworkImage } from './soul-artwork-image'
import { NativeSoulCover } from './native-current-appearance'
import type { ChainSoulDetail } from '@/lib/soulidity/soul-detail-model'

interface SoulCoverImageProps {
  imageUrl?: string | null
  compact?: boolean
  soul?: Pick<ChainSoulDetail, 'provenanceKind' | 'onChainId' | 'stateOnChainId' | 'currentOwnerAddress' | 'currentOwnershipEpoch'>
  className?: string
  fallback?: ReactNode
  fallbackStyle?: CSSProperties
  hasOverlay?: boolean
  children?: ReactNode
}

export function SoulCoverImage({
  imageUrl,
  compact,
  soul,
  className,
  fallback,
  fallbackStyle,
  hasOverlay,
  children,
}: SoulCoverImageProps) {
  const containerClass = `relative overflow-hidden ${className ?? ''}`.trim()
  const currentEquipment = soul?.provenanceKind === 'animacraft'
  const bg: CSSProperties =
    fallbackStyle ?? {
      background: 'linear-gradient(135deg, var(--card2) 0%, var(--purple-deep) 100%)',
    }

  return (
    <div className={containerClass} style={bg}>
      {!currentEquipment && fallback && <div className="absolute inset-0 flex items-center justify-center">{fallback}</div>}
      {currentEquipment ? <NativeSoulCover compact={compact} soulId={soul.onChainId} stateId={soul.stateOnChainId}
        owner={soul.currentOwnerAddress} ownershipEpoch={soul.currentOwnershipEpoch}
        className="absolute inset-0 h-full w-full" /> : imageUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <SoulArtworkImage src={imageUrl} alt="" className="absolute inset-0 h-full w-full object-cover" />
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
