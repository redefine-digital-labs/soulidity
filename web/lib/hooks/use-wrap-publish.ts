'use client'

import { normalizeStructTag, normalizeSuiAddress } from '@mysten/sui/utils'
import { useSingleSoulAuthoring, type PublishStatus } from './use-publish'
import type { KioskNft } from './use-kiosk-nfts'
import type { WrapPublishResult } from '@/components/providers/wrap-provider'
import type { SoulAuthoringPacketRecord } from '../soulidity/soul-authoring-packet'

export type WrapPublishStatus = PublishStatus
const MIME_MAP: Record<string, string> = {
  '.md': 'text/markdown', '.txt': 'text/plain',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.gif': 'image/gif',
  '.json': 'application/json', '.zip': 'application/zip',
}

/** Re-wrap a File with correct MIME type based on extension (browsers often misdetect .md) */
function withMime(file: File): File {
  const ext = file.name.includes('.') ? '.' + file.name.split('.').pop()!.toLowerCase() : ''
  const expected = MIME_MAP[ext]
  if (!expected || file.type === expected) return file
  return new File([file], file.name, { type: expected })
}
export interface WrapPublishParams {
  nft: KioskNft; charFile: File; memoryFile: File; skillsFile?: File | null; royalty: number
}
/** Preserve the selected external object's identity, without inventing a cover
 * or public previews. Payment and recovery use the shared durable controller. */
export function useWrapPublish(approve: (record: SoulAuthoringPacketRecord, signal: AbortSignal) => Promise<boolean>) {
  const flow = useSingleSoulAuthoring(approve, 'JOINED')
  const value = flow.publishData
  const result: WrapPublishResult | null = value ? { txDigest: value.txDigest, soulOnChainId: value.soulOnChainId,
    provenanceKind: 'personal-join', originRef: value.originRef!, authoringCompletionKey: value.authoringCompletionKey } : null
  return { ...flow, result, publish: (input?: WrapPublishParams) => input ? flow.publish({
    name: input.nft.name, description: input.nft.description ?? '', imageUrl: input.nft.imageUrl ?? '',
    source: { objectId: normalizeSuiAddress(input.nft.objectId), objectType: normalizeStructTag(input.nft.objectType) },
    originRef: `sui:${normalizeSuiAddress(input.nft.objectId)}`, tags: [], creatorRoyaltyBps: input.royalty,
    character: withMime(input.charFile), memory: withMime(input.memoryFile), skills: input.skillsFile ? withMime(input.skillsFile) : null,
    collectionBindTarget: null, listOnPublish: false, listingPriceAtomic: null,
  }) : flow.resume() }
}
