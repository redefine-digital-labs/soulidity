import { Transaction } from '@mysten/sui/transactions'
import { getRequiredSoulidityEnv } from '@/lib/soulidity/env'
import type { AssetType, SoulDownloadPolicy } from '@/lib/soulidity/types'

const SUI_CLOCK_OBJECT_ID = '0x6'
const ASSET_TYPE_SPRITE = 0

function assetTypeToU8(assetType: AssetType): number {
  switch (assetType) {
    case 'sprite': return 0
    case 'live2d': return 1
    case 'audio': return 2
  }
}

function downloadPolicyToU8(policy: SoulDownloadPolicy): number {
  switch (policy) {
    case 'public': return 0
    case 'owner_only': return 1
    case 'allowlist': return 2
  }
}

function utf8Bytes(value: string) {
  return Array.from(new TextEncoder().encode(value))
}

export function buildAppendAssetVersionTx(params: {
  stateObjectId: string
  assetsObjectId: string
  assetName: string
  visibility: 'public' | 'private'
  assetType: AssetType
  blobObjectId: string
  grantObjectId?: string | null
}) {
  const packageId = getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_PACKAGE_ID')
  const tx = new Transaction()
  const target = params.grantObjectId
    ? `${packageId}::assets::append_version_as_granted_agent`
    : `${packageId}::assets::append_version_as_owner`

  tx.moveCall({
    target,
    arguments: params.grantObjectId
      ? [
          tx.object(params.assetsObjectId),
          tx.object(params.stateObjectId),
          tx.object(params.grantObjectId),
          tx.pure.string(params.assetName),
          tx.pure.bool(params.visibility === 'public'),
          tx.pure.u8(assetTypeToU8(params.assetType)),
          tx.object(params.blobObjectId),
          tx.object(SUI_CLOCK_OBJECT_ID),
        ]
      : [
          tx.object(params.assetsObjectId),
          tx.object(params.stateObjectId),
          tx.pure.string(params.assetName),
          tx.pure.bool(params.visibility === 'public'),
          tx.pure.u8(assetTypeToU8(params.assetType)),
          tx.object(params.blobObjectId),
          tx.object(SUI_CLOCK_OBJECT_ID),
        ],
  })

  return tx
}

export function buildDeleteAssetVersionTx(params: {
  stateObjectId: string
  metadataObjectId: string
  assetsObjectId: string
  assetName: string
  versionIndex: number
  grantObjectId?: string | null
}) {
  const packageId = getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_PACKAGE_ID')
  const tx = new Transaction()
  const target = params.grantObjectId
    ? `${packageId}::assets::delete_version_as_granted_agent`
    : `${packageId}::assets::delete_version_as_owner`

  tx.moveCall({
    target,
    arguments: params.grantObjectId
      ? [
          tx.object(params.assetsObjectId),
          tx.object(params.metadataObjectId),
          tx.object(params.stateObjectId),
          tx.pure.string(params.assetName),
          tx.pure.u64(params.versionIndex),
          tx.object(params.grantObjectId),
          tx.object(SUI_CLOCK_OBJECT_ID),
        ]
      : [
          tx.object(params.assetsObjectId),
          tx.object(params.metadataObjectId),
          tx.object(params.stateObjectId),
          tx.pure.string(params.assetName),
          tx.pure.u64(params.versionIndex),
        ],
  })

  return tx
}

export function buildPurgeDeletedAssetVersionTx(params: {
  stateObjectId: string
  metadataObjectId: string
  assetsObjectId: string
  assetName: string
  versionIndex: number
}) {
  const packageId = getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_PACKAGE_ID')
  const tx = new Transaction()
  tx.moveCall({
    target: `${packageId}::assets::purge_deleted_version_as_owner`,
    arguments: [
      tx.object(params.assetsObjectId),
      tx.object(params.metadataObjectId),
      tx.object(params.stateObjectId),
      tx.pure.string(params.assetName),
      tx.pure.u64(params.versionIndex),
    ],
  })
  return tx
}

/**
 * Build a single PTB that initializes the SoulAssets root with a first
 * sprite version and appends N more sprite versions to it, optionally
 * rebinds the active sprite, and finalizes — all in one wallet signature.
 * Used when the user uploads "first sprite + N additional sprites" in
 * the same action.
 *
 * Move enforces:
 *   - state.assets_id must be `none` at the start (init asserts this).
 *   - sender must be the soul owner.
 *
 * Active binding: `init_assets_and_append_sprite_as_owner` already binds
 * the initial sprite as active (version 0). To rebind to one of the
 * additional appended versions (or a different asset_name), pass
 * `rebindActiveSprite` — the builder appends optional metadata blob
 * upserts and then `metadata::set_active_sprite`.
 */
export function buildInitAndBatchAppendAssetsTx(params: {
  stateObjectId: string
  metadataObjectId: string
  initialSprite: {
    assetName: string
    visibility: 'public' | 'private'
    blobObjectId: string
    spriteConfigJson: string
    spriteMoodMapJson: string
    spriteConfigKey: string
    spriteMoodMapKey: string
    downloadPolicy: SoulDownloadPolicy
  }
  additionalSprites?: ReadonlyArray<{
    assetName: string
    visibility: 'public' | 'private'
    blobObjectId: string
  }>
  rebindActiveSprite?: {
    assetName: string
    versionIndex: number
    downloadPolicy: SoulDownloadPolicy
    metadataUpserts?: ReadonlyArray<{ key: string; valueJson: string }>
  } | null
}) {
  const packageId = getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_PACKAGE_ID')
  const tx = new Transaction()
  const assets = tx.moveCall({
    target: `${packageId}::market::init_assets_and_append_sprite_as_owner`,
    arguments: [
      tx.object(params.stateObjectId),
      tx.object(params.metadataObjectId),
      tx.pure.string(params.initialSprite.assetName),
      tx.pure.bool(params.initialSprite.visibility === 'public'),
      tx.object(params.initialSprite.blobObjectId),
      tx.pure.vector('u8', utf8Bytes(params.initialSprite.spriteConfigJson)),
      tx.pure.vector('u8', utf8Bytes(params.initialSprite.spriteMoodMapJson)),
      tx.pure.string(params.initialSprite.spriteConfigKey),
      tx.pure.string(params.initialSprite.spriteMoodMapKey),
      tx.pure.u8(downloadPolicyToU8(params.initialSprite.downloadPolicy)),
      tx.object(SUI_CLOCK_OBJECT_ID),
    ],
  })
  for (const extra of params.additionalSprites ?? []) {
    tx.moveCall({
      target: `${packageId}::assets::append_version_as_owner`,
      arguments: [
        assets,
        tx.object(params.stateObjectId),
        tx.pure.string(extra.assetName),
        tx.pure.bool(extra.visibility === 'public'),
        tx.pure.u8(ASSET_TYPE_SPRITE),
        tx.object(extra.blobObjectId),
        tx.object(SUI_CLOCK_OBJECT_ID),
      ],
    })
  }
  if (params.rebindActiveSprite) {
    for (const upsert of params.rebindActiveSprite.metadataUpserts ?? []) {
      tx.moveCall({
        target: `${packageId}::metadata::upsert_metadata_blob`,
        arguments: [
          tx.object(params.metadataObjectId),
          tx.object(params.stateObjectId),
          tx.pure.string(upsert.key),
          tx.pure.vector('u8', utf8Bytes(upsert.valueJson)),
        ],
      })
    }
    tx.moveCall({
      target: `${packageId}::market::set_active_sprite`,
      arguments: [
        tx.object(params.metadataObjectId),
        tx.object(params.stateObjectId),
        assets,
        tx.pure.string(params.rebindActiveSprite.assetName),
        tx.pure.u64(params.rebindActiveSprite.versionIndex),
        tx.pure.u8(downloadPolicyToU8(params.rebindActiveSprite.downloadPolicy)),
      ],
    })
  }
  tx.moveCall({
    target: `${packageId}::market::finalize_soul_assets`,
    arguments: [assets],
  })
  return tx
}
