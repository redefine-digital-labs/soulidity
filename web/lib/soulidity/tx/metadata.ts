import { Transaction } from '@mysten/sui/transactions'
import { getRequiredSoulidityEnv } from '@/lib/soulidity/env'
import type { SoulDownloadPolicy } from '@/lib/soulidity/types'

function downloadPolicyToU8(policy: SoulDownloadPolicy): number {
  switch (policy) {
    case 'public':
      return 0
    case 'owner_only':
      return 1
    case 'allowlist':
      return 2
  }
}

function normalizeMetadataKey(key: string) {
  const normalized = key.trim()
  if (!normalized) {
    throw new Error('metadata key is required')
  }
  return normalized
}

function normalizeMetadataText(value: string) {
  if (value.trim().length === 0) {
    throw new Error('metadata value is required')
  }
  return value
}

function utf8Bytes(value: string) {
  return Array.from(new TextEncoder().encode(value))
}

export function buildSetActiveSpriteTx(params: {
  metadataObjectId: string
  stateObjectId: string
  assetsObjectId: string
  assetName: string
  versionIndex: number
  downloadPolicy: SoulDownloadPolicy
}) {
  const packageId = getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_PACKAGE_ID')
  const tx = new Transaction()

  tx.moveCall({
    target: `${packageId}::market::set_active_sprite`,
    arguments: [
      tx.object(params.metadataObjectId),
      tx.object(params.stateObjectId),
      tx.object(params.assetsObjectId),
      tx.pure.string(params.assetName),
      tx.pure.u64(params.versionIndex),
      tx.pure.u8(downloadPolicyToU8(params.downloadPolicy)),
    ],
  })

  return tx
}

export function buildClearActiveSpriteTx(params: {
  metadataObjectId: string
  stateObjectId: string
}) {
  const packageId = getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_PACKAGE_ID')
  const tx = new Transaction()

  tx.moveCall({
    target: `${packageId}::market::clear_active_sprite`,
    arguments: [
      tx.object(params.metadataObjectId),
      tx.object(params.stateObjectId),
    ],
  })

  return tx
}

export function buildSetActiveVoiceTx(params: {
  metadataObjectId: string
  stateObjectId: string
  assetsObjectId: string
  assetName: string
  versionIndex: number
  downloadPolicy: SoulDownloadPolicy
}) {
  const packageId = getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_PACKAGE_ID')
  const tx = new Transaction()

  tx.moveCall({
    target: `${packageId}::market::set_active_voice`,
    arguments: [
      tx.object(params.metadataObjectId),
      tx.object(params.stateObjectId),
      tx.object(params.assetsObjectId),
      tx.pure.string(params.assetName),
      tx.pure.u64(params.versionIndex),
      tx.pure.u8(downloadPolicyToU8(params.downloadPolicy)),
    ],
  })

  return tx
}

export function buildClearActiveVoiceTx(params: {
  metadataObjectId: string
  stateObjectId: string
}) {
  const packageId = getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_PACKAGE_ID')
  const tx = new Transaction()

  tx.moveCall({
    target: `${packageId}::market::clear_active_voice`,
    arguments: [
      tx.object(params.metadataObjectId),
      tx.object(params.stateObjectId),
    ],
  })

  return tx
}

export function buildUpsertMetadataBlobTx(params: {
  metadataObjectId: string
  stateObjectId: string
  key: string
  value: string
}) {
  const packageId = getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_PACKAGE_ID')
  const tx = new Transaction()

  tx.moveCall({
    target: `${packageId}::metadata::upsert_metadata_blob`,
    arguments: [
      tx.object(params.metadataObjectId),
      tx.object(params.stateObjectId),
      tx.pure.string(normalizeMetadataKey(params.key)),
      tx.pure.vector('u8', utf8Bytes(normalizeMetadataText(params.value))),
    ],
  })

  return tx
}

export function buildDeleteMetadataBlobTx(params: {
  metadataObjectId: string
  stateObjectId: string
  key: string
}) {
  const packageId = getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_PACKAGE_ID')
  const tx = new Transaction()

  tx.moveCall({
    target: `${packageId}::metadata::delete_metadata_blob`,
    arguments: [
      tx.object(params.metadataObjectId),
      tx.object(params.stateObjectId),
      tx.pure.string(normalizeMetadataKey(params.key)),
    ],
  })

  return tx
}
