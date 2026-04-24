import { getBlobUrl } from '@/lib/services/walrus'
import { getSealSessionTtlMinutes, getSealRuntimeConfig } from '@/lib/services/seal'
import { generateMemoryDocumentId } from '@/lib/services/seal-crypto'
import type { MemoryAccessResponse, SoulAssetDetail, SoulMemoryEntryRecord } from '@/lib/soulidity/types'
import { getSoulGrantObject, getSoulStateObject, normalizeSuiValue, sameSuiValue } from '@/lib/soulidity/queries'

export class MemoryAccessDeniedError extends Error {
  constructor(message: string, readonly status = 403) {
    super(message)
    this.name = 'MemoryAccessDeniedError'
  }
}

export async function resolveMemoryAccessPayload(params: {
  soul: SoulAssetDetail
  entry: SoulMemoryEntryRecord
  viewerAddresses: string[]
  packageId: string
}): Promise<MemoryAccessResponse> {
  const viewerAddresses = params.viewerAddresses
    .map((address) => normalizeSuiValue(address))
    .filter((value): value is string => value != null)
  const state = await getSoulStateObject(params.soul.stateOnChainId, params.packageId)
  const resolvedPackageId = state.packageId ?? params.packageId

  if (!params.entry.sealSidecar) {
    throw new MemoryAccessDeniedError('Memory Seal sidecar is missing', 409)
  }
  if (!params.entry.blobId) {
    throw new MemoryAccessDeniedError('Memory blob is not available', 409)
  }

  const ownerMatch = viewerAddresses.find((address) => sameSuiValue(address, state.currentOwnerAddress))
  if (ownerMatch) {
    return {
      artifact: {
        walrusBlobUrl: getBlobUrl(params.entry.blobId),
        walrusBlobId: params.entry.blobId,
        blobObjectId: params.entry.blobObjectId,
      },
      accessPolicy: {
        packageId: resolvedPackageId,
        stateObjectId: params.soul.stateOnChainId,
        memoryObjectId: params.entry.memoryOnChainId,
        timestampKey: params.entry.timestampKey,
        moduleName: 'seal_policy',
        functionName: 'seal_approve_memory_owner',
        soulGrantObjectId: null,
        documentIdHex: generateMemoryDocumentId(params.entry.memoryOnChainId, params.entry.timestampKey),
      },
      seal: getSealRuntimeConfig(),
      sealSidecar: params.entry.sealSidecar,
      viewerAddress: ownerMatch,
      accessKind: 'owner',
      sessionTtlMin: getSealSessionTtlMinutes(),
    }
  }

  const activeMemorySlot = state.activeGrants.find((slot) =>
    slot.scopes.includes('memory')
      && viewerAddresses.some((address) => sameSuiValue(address, slot.granteeAddress)),
  )
  if (!activeMemorySlot) {
    throw new MemoryAccessDeniedError('Only the owner or the active granted agent can access this memory entry')
  }

  const viewerMatch = viewerAddresses.find((address) => sameSuiValue(address, activeMemorySlot.granteeAddress))
  if (!viewerMatch) {
    throw new MemoryAccessDeniedError('Only the owner or the active granted agent can access this memory entry')
  }

  const grant = await getSoulGrantObject(activeMemorySlot.grantId, resolvedPackageId)
  if (!sameSuiValue(grant.granteeAddress, viewerMatch)) {
    throw new MemoryAccessDeniedError('The active SoulGrant does not belong to this wallet')
  }
  if (grant.expiresAtMs != null && grant.expiresAtMs < Date.now()) {
    throw new MemoryAccessDeniedError('The active SoulGrant has expired')
  }
  if (!grant.scopes.includes('memory')) {
    throw new MemoryAccessDeniedError('The active SoulGrant does not allow memory access')
  }

  return {
    artifact: {
      walrusBlobUrl: getBlobUrl(params.entry.blobId),
      walrusBlobId: params.entry.blobId,
      blobObjectId: params.entry.blobObjectId,
    },
    accessPolicy: {
      packageId: resolvedPackageId,
      stateObjectId: params.soul.stateOnChainId,
      memoryObjectId: params.entry.memoryOnChainId,
      timestampKey: params.entry.timestampKey,
      moduleName: 'seal_policy',
      functionName: 'seal_approve_memory_granted_agent',
      soulGrantObjectId: grant.objectId,
      documentIdHex: generateMemoryDocumentId(params.entry.memoryOnChainId, params.entry.timestampKey),
    },
    seal: getSealRuntimeConfig(),
    sealSidecar: params.entry.sealSidecar,
    viewerAddress: viewerMatch,
    accessKind: 'granted-agent',
    sessionTtlMin: getSealSessionTtlMinutes(),
  }
}
