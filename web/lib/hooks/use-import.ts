'use client'

import { useSingleSoulAuthoring, type PublishParams, type PublishStatus } from './use-publish'
import type { SoulAuthoringPacketRecord } from '../soulidity/soul-authoring-packet'

export type ImportStatus = PublishStatus
export type ImportParams = Omit<PublishParams, 'collectionBindTarget' | 'listOnPublish' | 'listingPriceAtomic' | 'originRef'> & { originRef: string }
export interface ImportSyncResponse {
  txDigest: string; soulOnChainId: string; provenanceKind: string; originRef: string; authoringCompletionKey?: string
}
/** Original import entry, sharing durable identity/payment/recovery with ordinary
 * creation while requiring IMPORTED provenance and its frozen origin reference. */
export function useImport(approve: (record: SoulAuthoringPacketRecord, signal: AbortSignal) => Promise<boolean>) {
  const flow = useSingleSoulAuthoring(approve, 'IMPORTED')
  const result = flow.publishData
  const importData: ImportSyncResponse | null = result ? { txDigest: result.txDigest, soulOnChainId: result.soulOnChainId,
    provenanceKind: 'imported', originRef: result.originRef!, authoringCompletionKey: result.authoringCompletionKey } : null
  return { ...flow, importData, importSoul: (input: ImportParams) => flow.publish({ ...input,
    collectionBindTarget: null, listOnPublish: false, listingPriceAtomic: null }) }
}
