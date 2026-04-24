import { Transaction } from '@mysten/sui/transactions'
import { getRequiredSoulidityEnv } from '../env'
import { buildBuyerKioskArgs, finishBuyerKioskArgs, validateSoulPublishArgs } from './shared'

type AssetType = 'sprite' | 'live2d' | 'audio'

type PublishTxParams = {
  currentKioskId?: string | null
  currentKioskCapOnChainId?: string | null
  name: string
  description: string
  imageUrl: string
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
  contentAccessDefaultDurationMs?: number | null
  creatorRoyaltyBps: number
}

const SUI_CLOCK_OBJECT_ID = '0x6'
const WALRUS_BLOB_TYPE = '0xd84704c17fc870b8764832c535aa6b11f21a95cd6f5bb38a9b07d2cf42220c66::blob::Blob'
const CANONICAL_PERSONA_SPRITE_ASSET_NAME = 'persona-sprite'
// SCOPE_SEAL | SCOPE_MEMORY | SCOPE_SKILLS | SCOPE_ASSETS (mirrors Move grant::all_scopes)
const ALL_ACCESS_SCOPES = 15

function buildOptionalBlobArg(tx: Transaction, blobObjectId?: string | null) {
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

function resolveInitialAssetName(params: Pick<PublishTxParams, 'assetBlobObjectId' | 'initialAssetName'>) {
  if (!params.assetBlobObjectId) {
    return params.initialAssetName || 'default'
  }
  return params.initialAssetName || CANONICAL_PERSONA_SPRITE_ASSET_NAME
}

export function buildPublishSoulTx(params: PublishTxParams) {
  validateSoulPublishArgs(params)

  const packageId = getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_PACKAGE_ID')
  const marketConfigId = getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_MARKET_CONFIG_ID')
  const kioskRegistryId = getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_KIOSK_REGISTRY_ID')
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
      tx.object(kioskRegistryId),
      tx.object(transferPolicyId),
      personalKiosk.buyerKiosk,
      personalKiosk.buyerKioskCap,
      tx.pure.string(params.name),
      tx.pure.string(params.description),
      tx.pure.string(params.imageUrl),
      tx.object(params.protectedBlobObjectId),
      buildOptionalBlobArg(tx, params.foundingMemoryBlobObjectId),
      buildOptionalBlobArg(tx, params.skillsBlobObjectId),
      tx.pure.string(params.initialSkillName || 'default'),
      tx.pure.bool((params.skillsVisibility ?? 'private') === 'public'),
      buildOptionalBlobArg(tx, params.assetBlobObjectId),
      tx.pure.string(resolveInitialAssetName(params)),
      tx.pure.bool((params.assetVisibility ?? 'private') === 'public'),
      tx.pure.u8(assetTypeToU8(params.assetType)),
      tx.pure.option('string', null),
      tx.pure.option('u64', null),
      tx.pure.option('u8', null),
      tx.pure.option('vector<u8>', null),
      tx.pure.option('vector<u8>', null),
      tx.pure.option('string', null),
      tx.pure.option('u64', null),
      tx.pure.option('u8', null),
      tx.pure.option('vector<u8>', null),
      tx.pure.u64(params.contentAccessPriceAtomic ?? 0),
      tx.pure.u64(params.contentAccessDefaultScopeMask ?? ALL_ACCESS_SCOPES),
      tx.pure.option('u64', params.contentAccessDefaultDurationMs ?? null),
      tx.pure.u16(params.creatorRoyaltyBps),
      tx.object(SUI_CLOCK_OBJECT_ID),
    ],
  })

  finishBuyerKioskArgs(tx, personalKiosk)
  return tx
}
