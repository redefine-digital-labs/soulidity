import { getBlobUrl } from '@web/lib/services/walrus'
import { getSealRuntimeConfig, getSealSessionTtlMinutes } from '@web/lib/services/seal'
import type { SoulAccessResponse } from '@/lib/soulidity/types'
import { getSoulGrantObject, getSoulStateObject, normalizeSuiValue, sameSuiValue } from '@/lib/soulidity/queries'
import type { SoulAssetDetail } from '@/lib/soulidity/types'

export class SoulAccessDeniedError extends Error {
  constructor(message: string, readonly status = 403) {
    super(message)
    this.name = 'SoulAccessDeniedError'
  }
}

export async function resolveSoulAccessPayload(params: {
  soul: SoulAssetDetail
  viewerAddresses: string[]
  packageId: string
}): Promise<SoulAccessResponse> {
  const viewerAddresses = params.viewerAddresses
    .map((address) => normalizeSuiValue(address))
    .filter((value): value is string => value != null)
  const state = await getSoulStateObject(params.soul.stateOnChainId, params.packageId)
  // Prefer the on-chain resolved package — after a Sui package upgrade the env
  // package may differ from the type-defining package that Seal ciphertext is bound to.
  const resolvedPackageId = state.packageId ?? params.packageId

  if (!params.soul.sealSidecar) {
    throw new SoulAccessDeniedError('Soul Seal sidecar is missing', 409)
  }
  if (!params.soul.contentBlobId) {
    throw new SoulAccessDeniedError('Soul content blob is not available', 409)
  }

  const ownerAddress = state.currentOwnerAddress
  const ownerMatch = viewerAddresses.find((address) => sameSuiValue(address, ownerAddress))
  if (ownerMatch) {
    return {
      artifact: {
        walrusBlobUrl: getBlobUrl(params.soul.contentBlobId),
        walrusBlobId: params.soul.contentBlobId,
        contentBlobObjectId: params.soul.contentBlobObjectId,
      },
      accessPolicy: {
        packageId: resolvedPackageId,
        soulObjectId: params.soul.onChainId,
        stateObjectId: params.soul.stateOnChainId,
        moduleName: 'seal_policy',
        functionName: 'seal_approve_owner',
        soulGrantObjectId: null,
      },
      seal: getSealRuntimeConfig(),
      sealSidecar: params.soul.sealSidecar,
      viewerAddress: ownerMatch,
      accessKind: 'owner',
      sessionTtlMin: getSealSessionTtlMinutes(),
    }
  }

  const activeSealSlot = state.activeGrants.find((slot) =>
    slot.scopes.includes('seal')
      && viewerAddresses.some((address) => sameSuiValue(address, slot.granteeAddress)),
  )

  if (!activeSealSlot) {
    throw new SoulAccessDeniedError('Only the owner or the active granted agent can access this Soul')
  }

  const granteeMatch = viewerAddresses.find((address) => sameSuiValue(address, activeSealSlot.granteeAddress))
  if (!granteeMatch) {
    throw new SoulAccessDeniedError('Only the owner or the active granted agent can access this Soul')
  }

  const grant = await getSoulGrantObject(activeSealSlot.grantId, resolvedPackageId)
  if (!sameSuiValue(grant.granteeAddress, granteeMatch)) {
    throw new SoulAccessDeniedError('The active SoulGrant does not belong to this wallet')
  }
  if (grant.expiresAtMs != null && grant.expiresAtMs < Date.now()) {
    throw new SoulAccessDeniedError('The active SoulGrant has expired')
  }
  if (!grant.scopes.includes('seal')) {
    throw new SoulAccessDeniedError('The active SoulGrant does not allow Soul Seal access')
  }

  return {
    artifact: {
      walrusBlobUrl: getBlobUrl(params.soul.contentBlobId),
      walrusBlobId: params.soul.contentBlobId,
      contentBlobObjectId: params.soul.contentBlobObjectId,
    },
    accessPolicy: {
      packageId: resolvedPackageId,
      soulObjectId: params.soul.onChainId,
      stateObjectId: params.soul.stateOnChainId,
      moduleName: 'seal_policy',
      functionName: 'seal_approve_granted_agent',
      soulGrantObjectId: grant.objectId,
    },
    seal: getSealRuntimeConfig(),
    sealSidecar: params.soul.sealSidecar,
    viewerAddress: granteeMatch,
    accessKind: 'granted-agent',
    sessionTtlMin: getSealSessionTtlMinutes(),
  }
}
