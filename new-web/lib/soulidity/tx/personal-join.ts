import { Transaction } from '@mysten/sui/transactions'
import { getRequiredSoulidityEnv } from '@/lib/soulidity/env'
import { buildBuyerKioskArgs, finishBuyerKioskArgs, validateSoulPublishArgs } from '@/lib/soulidity/tx/shared'

type PersonalJoinTxParams = {
  currentKioskId?: string | null
  currentKioskCapOnChainId?: string | null
  sourceObjectId: string
  sourceObjectType: string
  name: string
  description: string
  imageUrl: string
  metadataRef?: string | null
  protectedBlobObjectId: string
  foundingMemoryBlobObjectId?: string | null
  skillsBlobObjectId?: string | null
  initialSkillName?: string | null
  skillsVisibility?: 'public' | 'private'
  originRef: string
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

export function buildPersonalJoinSoulTx(params: PersonalJoinTxParams) {
  validateSoulPublishArgs(params)
  if (params.originRef.trim().length === 0) {
    throw new Error('originRef is required for Personal Join')
  }
  if (params.sourceObjectType.trim().length === 0) {
    throw new Error('sourceObjectType is required for Personal Join')
  }

  const packageId = getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_PACKAGE_ID')
  const marketConfigId = getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_MARKET_CONFIG_ID')
  const transferPolicyId = getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_SOUL_TRANSFER_POLICY_ID')
  const tx = new Transaction()
  const personalKiosk = buildBuyerKioskArgs(tx, {
    buyerKioskId: params.currentKioskId,
    buyerKioskCapOnChainId: params.currentKioskCapOnChainId,
  })

  // Place the source NFT into the personal kiosk first (contract requires it).
  // PersonalKioskCap wraps KioskOwnerCap — use borrow_val/return_val to extract it for kiosk::place.
  const kioskPackageId = process.env.NEXT_PUBLIC_KIOSK_PACKAGE_ID?.trim() || '0x2'
  const [kioskOwnerCap, borrowHotPotato] = tx.moveCall({
    target: `${kioskPackageId}::personal_kiosk::borrow_val`,
    arguments: [personalKiosk.buyerKioskCap],
  })
  tx.moveCall({
    target: '0x2::kiosk::place',
    typeArguments: [params.sourceObjectType],
    arguments: [
      personalKiosk.buyerKiosk,
      kioskOwnerCap,
      tx.object(params.sourceObjectId),
    ],
  })
  tx.moveCall({
    target: `${kioskPackageId}::personal_kiosk::return_val`,
    arguments: [personalKiosk.buyerKioskCap, kioskOwnerCap, borrowHotPotato],
  })

  tx.moveCall({
    target: `${packageId}::market::mint_joined_in_personal_kiosk`,
    typeArguments: [params.sourceObjectType],
    arguments: [
      tx.object(marketConfigId),
      tx.object(transferPolicyId),
      personalKiosk.buyerKiosk,
      personalKiosk.buyerKioskCap,
      tx.pure.id(params.sourceObjectId),
      tx.pure.string(params.name),
      tx.pure.string(params.description),
      tx.pure.string(params.imageUrl),
      tx.pure.option('string', params.metadataRef ?? null),
      tx.object(params.protectedBlobObjectId),
      buildFoundingMemoryArg(tx, params.foundingMemoryBlobObjectId),
      buildSkillsArg(tx, params.skillsBlobObjectId),
      tx.pure.string(params.initialSkillName || 'default'),
      tx.pure.bool((params.skillsVisibility ?? 'private') === 'public'),
      tx.pure.string(params.originRef),
      tx.pure.u16(params.creatorRoyaltyBps),
      tx.object(SUI_CLOCK_OBJECT_ID),
    ],
  })

  finishBuyerKioskArgs(tx, personalKiosk)
  return tx
}
