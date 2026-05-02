import { Transaction } from '@mysten/sui/transactions'
import { getRequiredSoulidityEnv } from '@/lib/soulidity/env'
import type { AssetType } from '@/lib/soulidity/types'

const SUI_CLOCK_OBJECT_ID = '0x6'

function assetTypeToU8(assetType: AssetType): number {
  switch (assetType) {
    case 'sprite': return 0
    case 'live2d': return 1
    case 'audio': return 2
  }
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
