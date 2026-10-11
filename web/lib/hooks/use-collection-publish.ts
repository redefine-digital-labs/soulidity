'use client'

import { useSingleSoulAuthoring, type PublishStatus } from './use-publish'
import type { CollectionAuthoringInput } from '../soulidity/collection-authoring-input'
import type { CollectionAuthoringResult } from '../soulidity/collection-authoring-flow'
import type { SoulAuthoringPacketRecord } from '../soulidity/soul-authoring-packet'

export type CollectionPublishStatus = PublishStatus
export type CollectionPublishParams = CollectionAuthoringInput
export type BatchSoulToMint = NonNullable<CollectionAuthoringInput['souls']>[number]
export type CollectionSyncResponse = CollectionAuthoringResult
export interface CollectionPublishProgress { totalSouls: number; mintedSouls: number; boundSouls: number }

/** Original Collection launch. No draft-signature reset, plaintext recovery,
 * owned API or post-mint mirror. Only proved full coverage yields syncData. */
export function useCollectionPublish(approve: (record: SoulAuthoringPacketRecord, signal: AbortSignal) => Promise<boolean>) {
  const flow = useSingleSoulAuthoring(approve, 'COLLECTION')
  return { ...flow, syncData: flow.collectionData, publish: (input: CollectionPublishParams) => flow.publish(input) }
}
