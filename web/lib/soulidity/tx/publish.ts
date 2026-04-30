import { Transaction } from '@mysten/sui/transactions'
import { getRequiredSoulidityEnv } from '@/lib/soulidity/env'
import { CANONICAL_PERSONA_SPRITE_ASSET_NAME } from '@/lib/soulidity/metadata'
import { resolveWalrusBlobType } from '@/lib/soulidity/walrus-blob'
import { buildBuyerKioskArgs, finishBuyerKioskArgs, validateSoulPublishArgs } from '@/lib/soulidity/tx/shared'

import type { AssetType, SoulDownloadPolicy } from '@/lib/soulidity/types'

type InitialSpriteInput = {
  blobObjectId: string
  assetName?: string | null
  versionIndex?: number | null
  visibility?: 'public' | 'private'
  downloadPolicy?: SoulDownloadPolicy | null
  spriteConfigJson: string
  spriteMoodMapJson?: string | null
}

type InitialVoiceInput = {
  blobObjectId: string
  assetName: string
  versionIndex?: number | null
  visibility?: 'public' | 'private'
  downloadPolicy?: SoulDownloadPolicy | null
  voiceConfigJson?: string | null
}

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
  initialSprite?: InitialSpriteInput | null
  initialVoice?: InitialVoiceInput | null
  assetBlobObjectId?: string | null
  initialAssetName?: string | null
  assetVisibility?: 'public' | 'private'
  assetType?: AssetType
  contentAccessPriceAtomic?: number
  contentAccessDefaultScopeMask?: number
  contentAccessDefaultDurationMs?: number | null
  creatorRoyaltyBps: number
  /**
   * Optional hook to splice extra commands into the publish PTB after the
   * personal-kiosk setup and before `mint_native_in_personal_kiosk`. The
   * batch publish flow uses this to bundle N `certify_blob` calls into the
   * mint TX, so registering and certifying N blobs costs 2 wallet
   * signatures total instead of 1 + 2N.
   */
  attachBeforeMint?: (tx: Transaction) => void | Promise<void>
}

const SUI_CLOCK_OBJECT_ID = '0x6'
// SCOPE_SEAL | SCOPE_MEMORY | SCOPE_SKILLS | SCOPE_ASSETS (mirrors Move grant::all_scopes)
const ALL_ACCESS_SCOPES = 15

function buildFoundingMemoryArg(tx: Transaction, blobObjectId?: string | null) {
  return tx.object.option({
    type: resolveWalrusBlobType(),
    value: blobObjectId ? tx.object(blobObjectId) : null,
  })
}

function buildSkillsArg(tx: Transaction, blobObjectId?: string | null) {
  return tx.object.option({
    type: resolveWalrusBlobType(),
    value: blobObjectId ? tx.object(blobObjectId) : null,
  })
}

function buildAssetArg(tx: Transaction, blobObjectId?: string | null) {
  return tx.object.option({
    type: resolveWalrusBlobType(),
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

function downloadPolicyToU8(policy: SoulDownloadPolicy): number {
  switch (policy) {
    case 'public': return 0
    case 'owner_only': return 1
    case 'allowlist': return 2
  }
}

function utf8Bytes(value: string | null | undefined) {
  if (!value) {
    return null
  }
  return Array.from(new TextEncoder().encode(value))
}

function resolveLegacySprite(params: Pick<PublishTxParams, 'assetBlobObjectId' | 'initialAssetName' | 'assetVisibility' | 'assetType'>): InitialSpriteInput | null {
  return null
}

function resolveLegacyVoice(params: Pick<PublishTxParams, 'assetBlobObjectId' | 'initialAssetName' | 'assetVisibility' | 'assetType'>): InitialVoiceInput | null {
  return null
}

function resolveInitialSprite(params: PublishTxParams) {
  return params.initialSprite ?? resolveLegacySprite(params)
}

function resolveInitialVoice(params: PublishTxParams) {
  return params.initialVoice ?? resolveLegacyVoice(params)
}

function resolveAssetBlobObjectId(params: PublishTxParams) {
  return resolveInitialSprite(params)?.blobObjectId
    ?? resolveInitialVoice(params)?.blobObjectId
    ?? params.assetBlobObjectId
    ?? null
}

function resolveAssetName(params: PublishTxParams) {
  const initialSprite = resolveInitialSprite(params)
  if (initialSprite?.assetName) {
    return initialSprite.assetName
  }
  const initialVoice = resolveInitialVoice(params)
  if (initialVoice?.assetName) {
    return initialVoice.assetName
  }
  if (params.initialAssetName) {
    return params.initialAssetName
  }
  if (resolveAssetBlobObjectId(params) && resolveAssetType(params) === 'sprite') {
    return CANONICAL_PERSONA_SPRITE_ASSET_NAME
  }
  return 'default'
}

function resolveAssetVisibility(params: PublishTxParams) {
  return resolveInitialSprite(params)?.visibility
    ?? resolveInitialVoice(params)?.visibility
    ?? params.assetVisibility
    ?? 'private'
}

function resolveAssetType(params: PublishTxParams): AssetType | undefined {
  if (resolveInitialSprite(params)) return 'sprite'
  if (resolveInitialVoice(params)) return 'audio'
  return params.assetType
}

function resolveDownloadPolicy(
  policy: SoulDownloadPolicy | null | undefined,
  visibility: 'public' | 'private' | null | undefined,
): SoulDownloadPolicy {
  if (policy) {
    return policy
  }
  return visibility === 'public' ? 'public' : 'owner_only'
}

export async function buildPublishSoulTx(params: PublishTxParams): Promise<Transaction> {
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
  if (params.attachBeforeMint) {
    await params.attachBeforeMint(tx)
  }
  const initialSprite = resolveInitialSprite(params)
  const initialVoice = resolveInitialVoice(params)

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
      buildFoundingMemoryArg(tx, params.foundingMemoryBlobObjectId),
      buildSkillsArg(tx, params.skillsBlobObjectId),
      tx.pure.string(params.initialSkillName || 'default'),
      tx.pure.bool((params.skillsVisibility ?? 'private') === 'public'),
      buildAssetArg(tx, resolveAssetBlobObjectId(params)),
      tx.pure.string(resolveAssetName(params)),
      tx.pure.bool(resolveAssetVisibility(params) === 'public'),
      tx.pure.u8(assetTypeToU8(resolveAssetType(params))),
      tx.pure.option('string', initialSprite?.assetName ?? null),
      tx.pure.option('u64', initialSprite?.versionIndex ?? (initialSprite ? 0 : null)),
      tx.pure.option('u8', initialSprite ? downloadPolicyToU8(resolveDownloadPolicy(initialSprite.downloadPolicy, initialSprite.visibility)) : null),
      tx.pure.option('vector<u8>', initialSprite ? utf8Bytes(initialSprite.spriteConfigJson) : null),
      tx.pure.option('vector<u8>', initialSprite ? utf8Bytes(initialSprite.spriteMoodMapJson ?? null) : null),
      tx.pure.option('string', initialVoice?.assetName ?? null),
      tx.pure.option('u64', initialVoice?.versionIndex ?? (initialVoice ? 0 : null)),
      tx.pure.option('u8', initialVoice ? downloadPolicyToU8(resolveDownloadPolicy(initialVoice.downloadPolicy, initialVoice.visibility)) : null),
      tx.pure.option('vector<u8>', initialVoice ? utf8Bytes(initialVoice.voiceConfigJson ?? null) : null),
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
