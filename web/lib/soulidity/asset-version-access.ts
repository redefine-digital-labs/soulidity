import { getBlobUrl } from '@/lib/services/walrus'
import type { SealEnvelopeSidecar } from '@/lib/services/seal-crypto'
import { generateAssetDocumentIdForVersion } from '@/lib/services/seal-crypto'
import {
  getSealRuntimeConfig,
  getSealSessionTtlMinutes,
  hasCredentialedSealServerConfigs,
  hasSealSessionConfig,
} from '@/lib/services/seal'
import { prisma } from '@/lib/prisma'
import { getRequiredSoulidityEnv } from '@/lib/soulidity/env'
import {
  getSoulGrantObject,
  getSoulStateObject,
  normalizeSuiValue,
  sameSuiValue,
} from '@/lib/soulidity/queries'
import { findSoulAssetDetailByRouteId } from '@/lib/soulidity/repository'
import type { AssetAccessResponse } from '@/lib/soulidity/types'

const SCOPE_ASSETS = 8

export class AssetAccessDeniedError extends Error {
  constructor(message: string, readonly status = 403) {
    super(message)
    this.name = 'AssetAccessDeniedError'
  }
}

function buildPublicAssetAccessResponse(params: {
  walrusBlobId: string | null
  blobObjectId: string
}): Extract<AssetAccessResponse, { visibility: 'public' }> {
  return {
    visibility: 'public',
    artifact: {
      walrusBlobUrl: params.walrusBlobId ? getBlobUrl(params.walrusBlobId) : null,
      walrusBlobId: params.walrusBlobId,
      blobObjectId: params.blobObjectId,
    },
  }
}

function buildPrivateAssetAccessResponse(params: {
  walrusBlobId: string | null
  blobObjectId: string
  packageId: string
  stateObjectId: string
  assetsObjectId: string
  accessListOnChainId?: string | null
  assetName: string
  versionIndex: number
  sealSidecar: SealEnvelopeSidecar
  functionName:
    | 'seal_approve_asset_read_owner'
    | 'seal_approve_asset_read_granted_agent'
    | 'seal_approve_asset_allowlisted'
  moduleName: 'assets' | 'content_access'
  soulGrantObjectId: string | null
  viewerAddress: string
  accessKind: 'owner' | 'granted-agent' | 'allowlisted'
}): Extract<AssetAccessResponse, { visibility: 'private' }> {
  return {
    visibility: 'private',
    artifact: {
      walrusBlobUrl: params.walrusBlobId ? getBlobUrl(params.walrusBlobId) : null,
      walrusBlobId: params.walrusBlobId,
      blobObjectId: params.blobObjectId,
    },
    accessPolicy: {
      packageId: params.packageId,
      stateObjectId: params.stateObjectId,
      assetsObjectId: params.assetsObjectId,
      assetName: params.assetName,
      versionIndex: params.versionIndex,
      moduleName: params.moduleName,
      functionName: params.functionName,
      soulGrantObjectId: params.soulGrantObjectId,
      ...(params.accessListOnChainId ? { accessListOnChainId: params.accessListOnChainId } : {}),
      documentIdHex: generateAssetDocumentIdForVersion(
        params.assetsObjectId,
        params.assetName,
        params.versionIndex,
      ),
    },
    seal: getSealRuntimeConfig(),
    sealSidecar: params.sealSidecar,
    viewerAddress: params.viewerAddress,
    accessKind: params.accessKind,
    sessionTtlMin: getSealSessionTtlMinutes(),
  }
}

export async function resolveSoulAssetVersionAccessPayload(params: {
  soulOnChainId: string
  assetName: string
  versionIndex: number
  viewerAddresses: string[]
  packageId?: string
}): Promise<AssetAccessResponse> {
  const soul = await findSoulAssetDetailByRouteId(params.soulOnChainId)
  if (!soul) {
    throw new AssetAccessDeniedError('Soul not found', 404)
  }

  const version = await prisma.soulAssetVersionRecord.findFirst({
    where: {
      soulOnChainId: soul.onChainId,
      assetsOnChainId: soul.assetsOnChainId ?? undefined,
      assetName: params.assetName,
      versionIndex: params.versionIndex,
    },
  })
  if (!version) {
    throw new AssetAccessDeniedError('Asset version not found', 404)
  }
  if (version.deletedAt) {
    throw new AssetAccessDeniedError('Asset version has been deleted', 410)
  }

  if (version.visibility === 'public') {
    return buildPublicAssetAccessResponse({
      walrusBlobId: version.blobId,
      blobObjectId: version.blobObjectId,
    })
  }

  if (!hasSealSessionConfig()) {
    throw new AssetAccessDeniedError('Seal session is not configured', 503)
  }
  if (hasCredentialedSealServerConfigs()) {
    throw new AssetAccessDeniedError(
      'Credentialed Seal key servers are not supported for browser access',
      503,
    )
  }
  if (!version.sealSidecar) {
    throw new AssetAccessDeniedError('Private asset Seal sidecar is missing', 409)
  }
  if (!soul.assetsOnChainId) {
    throw new AssetAccessDeniedError('Soul assets root is missing', 409)
  }
  const sealSidecar = version.sealSidecar as unknown as SealEnvelopeSidecar

  const viewerAddresses = params.viewerAddresses
    .map((address) => normalizeSuiValue(address))
    .filter((value): value is string => value != null)
  const packageId = params.packageId ?? getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_PACKAGE_ID')
  const state = await getSoulStateObject(soul.stateOnChainId, packageId)
  const resolvedPackageId = state.packageId ?? packageId

  const ownerMatch = viewerAddresses.find((address) => sameSuiValue(address, state.currentOwnerAddress))
  if (ownerMatch) {
    return buildPrivateAssetAccessResponse({
      walrusBlobId: version.blobId,
      blobObjectId: version.blobObjectId,
      packageId: resolvedPackageId,
      stateObjectId: soul.stateOnChainId,
      assetsObjectId: soul.assetsOnChainId,
      assetName: version.assetName,
      versionIndex: version.versionIndex,
      moduleName: 'assets',
      functionName: 'seal_approve_asset_read_owner',
      soulGrantObjectId: null,
      viewerAddress: ownerMatch,
      accessKind: 'owner',
      sealSidecar,
    })
  }

  const activeAssetsSlot = state.activeGrants.find((slot) =>
    slot.scopes.includes('assets')
      && viewerAddresses.some((address) => sameSuiValue(address, slot.granteeAddress)),
  )
  if (activeAssetsSlot) {
    const grant = await getSoulGrantObject(activeAssetsSlot.grantId, resolvedPackageId)
    const viewerMatch = viewerAddresses.find((address) => sameSuiValue(address, grant.granteeAddress))
    if (viewerMatch && (grant.expiresAtMs == null || grant.expiresAtMs >= Date.now()) && grant.scopes.includes('assets')) {
      return buildPrivateAssetAccessResponse({
        walrusBlobId: version.blobId,
        blobObjectId: version.blobObjectId,
        packageId: resolvedPackageId,
        stateObjectId: soul.stateOnChainId,
        assetsObjectId: soul.assetsOnChainId,
        assetName: version.assetName,
        versionIndex: version.versionIndex,
        moduleName: 'assets',
        functionName: 'seal_approve_asset_read_granted_agent',
        soulGrantObjectId: grant.objectId,
        viewerAddress: viewerMatch,
        accessKind: 'granted-agent',
        sealSidecar,
      })
    }
  }

  if (soul.accessListOnChainId) {
    // Only entries recorded under the CURRENT SoulState.ownership_epoch are
    // valid; anything older is stale (would be rejected by the on-chain
    // has_access check anyway — bailing here lets us return 403 before the
    // user wastes a Seal round-trip).
    const accessMatch = await prisma.contentAccessRecord.findFirst({
      where: {
        soulOnChainId: soul.onChainId,
        granteeAddress: { in: viewerAddresses },
        ownershipEpochSnapshot: state.ownershipEpoch,
        revokedAt: null,
      },
    })
    if (accessMatch && (accessMatch.scopeMask & SCOPE_ASSETS) === SCOPE_ASSETS) {
      const viewerMatch = viewerAddresses.find((address) =>
        address.toLowerCase() === accessMatch.granteeAddress.toLowerCase(),
      )
      if (viewerMatch) {
        return buildPrivateAssetAccessResponse({
          walrusBlobId: version.blobId,
          blobObjectId: version.blobObjectId,
          packageId: resolvedPackageId,
          stateObjectId: soul.stateOnChainId,
          assetsObjectId: soul.assetsOnChainId,
          accessListOnChainId: soul.accessListOnChainId,
          assetName: version.assetName,
          versionIndex: version.versionIndex,
          moduleName: 'content_access',
          functionName: 'seal_approve_asset_allowlisted',
          soulGrantObjectId: null,
          viewerAddress: viewerMatch,
          accessKind: 'allowlisted',
          sealSidecar,
        })
      }
    }
  }

  throw new AssetAccessDeniedError(
    'Only the owner, an active grant, or an allowlisted address can access this asset version',
    403,
  )
}
