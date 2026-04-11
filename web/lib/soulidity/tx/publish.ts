import { Transaction } from '@mysten/sui/transactions'
import { getRequiredSoulidityEnv } from '@/lib/soulidity/env'
import { buildBuyerKioskArgs, finishBuyerKioskArgs, validateSoulPublishArgs } from '@/lib/soulidity/tx/shared'

import type { AssetType } from '@/lib/soulidity/types'

type PublishTxParams = {
  currentKioskId?: string | null
  currentKioskCapOnChainId?: string | null
  name: string
  description: string
  imageUrl: string
  metadataRef?: string | null
  protectedBlobObjectId: string
  foundingMemoryBlobObjectId?: string | null
  skillsBlobObjectId?: string | null
  initialSkillName?: string | null
  skillsVisibility?: 'public' | 'private'
  assetBlobObjectId?: string | null
  initialAssetName?: string | null
  assetVisibility?: 'public' | 'private'
  assetType?: AssetType
  contentAccessPriceAtomic?: number
  contentAccessDefaultScopeMask?: number
  creatorRoyaltyBps: number
}

const SUI_CLOCK_OBJECT_ID = '0x6'
const WALRUS_BLOB_TYPE = '0xd84704c17fc870b8764832c535aa6b11f21a95cd6f5bb38a9b07d2cf42220c66::blob::Blob'

function buildFoundingMemoryArg(tx: Transaction, blobObjectId?: string | null) {
  return tx.object.option({
    type: WALRUS_BLOB_TYPE,
    value: blobObjectId ? tx.object(blobObjectId) : null,
  })
}

function buildSkillsArg(tx: Transaction, blobObjectId?: string | null) {
  return tx.object.option({
    type: WALRUS_BLOB_TYPE,
    value: blobObjectId ? tx.object(blobObjectId) : null,
  })
}

function buildAssetArg(tx: Transaction, blobObjectId?: string | null) {
  return tx.object.option({
    type: WALRUS_BLOB_TYPE,
    value: blobObjectId ? tx.object(blobObjectId) : null,
  })
}

function assetTypeToU8(assetType?: AssetType): number {
  switch (assetType) {
    case 'sprite': return 0
    case 'live2d': return 1
    case 'audio': return 2
    default: return 0
  }
}

export function buildPublishSoulTx(params: PublishTxParams) {
  validateSoulPublishArgs(params)

  const packageId = getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_PACKAGE_ID')
  const marketConfigId = getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_MARKET_CONFIG_ID')
  const transferPolicyId = getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_SOUL_TRANSFER_POLICY_ID')
  const tx = new Transaction()
  const personalKiosk = buildBuyerKioskArgs(tx, {
    buyerKioskId: params.currentKioskId,
    buyerKioskCapOnChainId: params.currentKioskCapOnChainId,
  })
  tx.moveCall({
    target: `${packageId}::market::mint_native_in_personal_kiosk`,
    arguments: [
      tx.object(marketConfigId),
      tx.object(transferPolicyId),
      personalKiosk.buyerKiosk,
      personalKiosk.buyerKioskCap,
      tx.pure.string(params.name),
      tx.pure.string(params.description),
      tx.pure.string(params.imageUrl),
      tx.pure.option('string', params.metadataRef ?? null),
      tx.object(params.protectedBlobObjectId),
      buildFoundingMemoryArg(tx, params.foundingMemoryBlobObjectId),
      buildSkillsArg(tx, params.skillsBlobObjectId),
      tx.pure.string(params.initialSkillName || 'default'),
      tx.pure.bool((params.skillsVisibility ?? 'private') === 'public'),
      buildAssetArg(tx, params.assetBlobObjectId),
      tx.pure.string(params.initialAssetName || 'default'),
      tx.pure.bool((params.assetVisibility ?? 'private') === 'public'),
      tx.pure.u8(assetTypeToU8(params.assetType)),
      tx.pure.u64(params.contentAccessPriceAtomic ?? 0),
      tx.pure.u64(params.contentAccessDefaultScopeMask ?? 0),
      tx.pure.u16(params.creatorRoyaltyBps),
      tx.object(SUI_CLOCK_OBJECT_ID),
    ],
  })

  finishBuyerKioskArgs(tx, personalKiosk)
  return tx
}
