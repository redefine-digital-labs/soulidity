'use client'

import type { ReactNode } from 'react'
import { useSoulDetail } from '@/lib/hooks/use-souls'
import { SoulCoverImage } from './soul-cover-image'

/** Discovery rows identify a Soul, not its current ownership/equipment. Resolve
 * the existing verified chain model before selecting the display authority. */
export function ChainSoulCover({ soulId, className, children }: {
  soulId: string; className?: string; children?: ReactNode
}) {
  const detail = useSoulDetail(soulId)
  if (detail.data && !detail.isError && detail.data.onChainId === soulId) return <SoulCoverImage
    soul={detail.data} imageUrl={detail.data.imageUrl} className={className} hasOverlay>{children}</SoulCoverImage>
  return <div className={`relative flex items-center justify-center bg-card2 p-3 text-center text-xs ${className ?? ''}`}>
    {detail.isError || detail.data && detail.data.onChainId !== soulId ? <button onClick={event => { event.preventDefault(); event.stopPropagation(); void detail.refetch() }}>
      Current appearance unavailable · Retry</button> : <span role="status">Loading verified Soul…</span>}
    {children}
  </div>
}
