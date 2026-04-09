import {
  getVerifiedPersonalKioskCapState,
  getVerifiedSoulAllowlistCapState,
  getVerifiedSoulAllowlistCapStates,
  getVerifiedSoulState,
  OnChainVerificationError,
  sameSuiValue,
} from '@web/lib/souls/on-chain-verification'
import { findViewerKioskMatchingOnChain } from '@web/lib/souls/personal-kiosk'
import { suiClient } from '@web/lib/sui'
import type { findSoulAssetDetailByRouteId } from '@web/lib/souls/repository'
import {
  getAllowlistedSealSession,
  getOwnerSealSession,
  getSealRuntimeConfig,
  getSealSessionTtlMinutes,
} from '@web/lib/services/seal'
import {
  assertDocumentIdMatchesExpectedBinding,
  parseSealEnvelopeSidecar,
  type SealEnvelopeSidecar,
} from '@web/lib/services/seal-crypto'
import { getBlobUrl } from '@web/lib/services/walrus'

type SoulDetailRecord = NonNullable<Awaited<ReturnType<typeof findSoulAssetDetailByRouteId>>>
const MAX_ALLOWLIST_CAP_PAGES = 5

export class SoulAccessDeniedError extends Error {
  constructor(message: string, readonly status = 403) {
    super(message)
    this.name = 'SoulAccessDeniedError'
  }
}

function isAvailableKioskCapId(currentKioskCapOnChainId: string | null | undefined): currentKioskCapOnChainId is string {
  return typeof currentKioskCapOnChainId === 'string' && currentKioskCapOnChainId.trim().length > 0
}

function getSoulAllowlistCapType(packageId: string) {
  return `${packageId}::allowlist::SoulAllowlistCap`
}

async function findViewerAllowlistCapMatchingOnChain(params: {
  viewerAddresses: string[]
  soulObjectId: string
  allowlistedAddress: string
  allowlistVersion: bigint
  soulPackageId: string
}) {
  const matches = await Promise.all(params.viewerAddresses.map(async (viewerAddress) => {
    let cursor: string | null | undefined = undefined
    let pagesRead = 0

    do {
      const page = await suiClient.getOwnedObjects({
        owner: viewerAddress,
        ...(cursor ? { cursor } : {}),
        filter: { StructType: getSoulAllowlistCapType(params.soulPackageId) },
        options: { showType: true },
      })

      const candidateObjectIds = page.data.flatMap((entry) => (
        typeof entry.data?.objectId === 'string' && entry.data.objectId.trim().length > 0
          ? [entry.data.objectId]
          : []
      ))

      const capStates = await getVerifiedSoulAllowlistCapStates(candidateObjectIds, params.soulPackageId)
      const matchedCapState = capStates.find((capState) => (
        sameSuiValue(capState.ownerAddress, viewerAddress)
        && sameSuiValue(capState.soulObjectId, params.soulObjectId)
        && sameSuiValue(capState.allowlistedAddress, params.allowlistedAddress)
        && capState.allowlistVersion === params.allowlistVersion
      ))
      if (matchedCapState) {
        return matchedCapState
      }

      pagesRead += 1
      if (pagesRead >= MAX_ALLOWLIST_CAP_PAGES || !page.hasNextPage) {
        break
      }
      cursor = page.nextCursor
    } while (cursor)

    return null
  }))

  return matches.find((match): match is NonNullable<typeof match> => match != null) ?? null
}

function readSealEnvelopeSidecar(
  sidecar: unknown,
  expectedSoulObjectId: string,
): SealEnvelopeSidecar | null {
  if (!sidecar) {
    return null
  }

  try {
    const parsed = parseSealEnvelopeSidecar(sidecar)
    assertDocumentIdMatchesExpectedBinding({
      documentId: parsed.documentId,
      expectedSoulObjectId,
    })
    return parsed
  } catch (error) {
    console.warn('[soul-access] Ignoring invalid seal sidecar', {
      soulOnChainId: expectedSoulObjectId,
      error: error instanceof Error ? error.message : String(error),
    })
    return null
  }
}

export async function resolveSoulAccessPayload(params: {
  soul: SoulDetailRecord
  viewerAddresses: string[]
  soulPackageId: string
  allowlistRegistryObjectId?: string | null
}) {
  const sealSidecar = readSealEnvelopeSidecar(params.soul.sealSidecar, params.soul.onChainId)
  if (!sealSidecar) {
    throw new SoulAccessDeniedError('Soul access is not ready yet', 503)
  }

  const currentKioskCapOnChainId = isAvailableKioskCapId(params.soul.currentKioskCapOnChainId)
    ? params.soul.currentKioskCapOnChainId
    : null
  const mirroredKioskCapStatePromise = currentKioskCapOnChainId && params.soul.currentKioskId
    ? getVerifiedPersonalKioskCapState(currentKioskCapOnChainId).catch((error) => {
      if (error instanceof OnChainVerificationError) {
        return null
      }
      throw error
    })
    : null
  const mirroredAllowlistCapStatePromise = params.allowlistRegistryObjectId && params.soul.allowlistCapOnChainId
    ? getVerifiedSoulAllowlistCapState(params.soul.allowlistCapOnChainId, params.soulPackageId).catch((error) => {
      if (error instanceof OnChainVerificationError) {
        return null
      }
      throw error
    })
    : null

  const soulState = await getVerifiedSoulState(params.soul.onChainId, params.soulPackageId, {
    expectedKioskId: params.soul.currentKioskId,
  })
  const contentBlobId = soulState.contentBlobId
  if (!contentBlobId) {
    throw new SoulAccessDeniedError('Soul content is not available', 503)
  }
  if (soulState.ownerKind === 'object' && !params.soul.currentKioskId) {
    throw new SoulAccessDeniedError('Soul kiosk state is not available', 503)
  }

  let viewerAddress: string | null = null
  let soulAllowlistCapObjectId: string | null = null
  let accessPolicy = null
  let accessKind: 'owner' | 'allowlisted' = 'owner'
  let skipOwnerKioskFallback = false

  const soulKioskId = soulState.kioskParentId ?? soulState.ownerObjectId
  if (
    soulState.ownerKind === 'object'
    && soulKioskId && sameSuiValue(soulKioskId, params.soul.currentKioskId)
    && currentKioskCapOnChainId
  ) {
    const kioskCapState = mirroredKioskCapStatePromise ? await mirroredKioskCapStatePromise : null
    if (!kioskCapState) {
      // Mirror can lag behind the cap object; fall back to on-chain kiosk discovery below.
    } else if (sameSuiValue(kioskCapState.kioskId, params.soul.currentKioskId)) {
      const ownerAddress = params.viewerAddresses.find((address) =>
        sameSuiValue(kioskCapState.ownerAddress, address),
      ) ?? null
      if (ownerAddress) {
        viewerAddress = ownerAddress
        accessPolicy = getOwnerSealSession({
          packageId: soulState.packageId ?? params.soulPackageId,
          soulObjectId: params.soul.onChainId,
          currentKioskId: kioskCapState.kioskId,
          currentKioskCapOnChainId,
        })
      } else {
        skipOwnerKioskFallback = true
      }
    }
  }

  // On-chain kiosk may not match DB mirror during purchase-sync recovery —
  // resolve viewer's kiosks on-chain as fallback
  if (!viewerAddress && !skipOwnerKioskFallback && soulState.ownerKind === 'object' && soulKioskId) {
    const matchingKiosk = await findViewerKioskMatchingOnChain(soulKioskId, params.viewerAddresses)
    if (matchingKiosk) {
      viewerAddress = matchingKiosk.ownerAddress
      accessPolicy = getOwnerSealSession({
        packageId: soulState.packageId ?? params.soulPackageId,
        soulObjectId: params.soul.onChainId,
        currentKioskId: matchingKiosk.currentKioskId,
        currentKioskCapOnChainId: matchingKiosk.currentKioskCapOnChainId,
      })
    }
  }

  if (!viewerAddress) {
    if (!soulState.allowlistAddress) {
      throw new SoulAccessDeniedError('Viewer does not have access to this Soul')
    }

    const allowlistedAddress = params.viewerAddresses.find((address) =>
      sameSuiValue(soulState.allowlistAddress, address),
    ) ?? null

    if (!allowlistedAddress) {
      throw new SoulAccessDeniedError('Viewer does not have access to this Soul')
    }
    if (!params.allowlistRegistryObjectId) {
      throw new SoulAccessDeniedError('Soul allowlist access is not configured', 503)
    }

    let capState = null
    if (mirroredAllowlistCapStatePromise) {
      const mirroredCapState = await mirroredAllowlistCapStatePromise
      if (
        mirroredCapState
        && sameSuiValue(mirroredCapState.ownerAddress, allowlistedAddress)
        && sameSuiValue(mirroredCapState.soulObjectId, params.soul.onChainId)
        && sameSuiValue(mirroredCapState.allowlistedAddress, allowlistedAddress)
        && mirroredCapState.allowlistVersion === soulState.allowlistVersion
      ) {
        capState = mirroredCapState
      }
    }

    if (!capState) {
      capState = await findViewerAllowlistCapMatchingOnChain({
        viewerAddresses: params.viewerAddresses,
        soulObjectId: params.soul.onChainId,
        allowlistedAddress,
        allowlistVersion: soulState.allowlistVersion,
        soulPackageId: params.soulPackageId,
      })
    }

    if (!capState) {
      if (!params.soul.allowlistCapOnChainId) {
        throw new SoulAccessDeniedError('Soul allowlist access is still syncing', 503)
      }
      throw new SoulAccessDeniedError('Soul allowlist cap is no longer valid')
    }

    viewerAddress = allowlistedAddress
    accessPolicy = getAllowlistedSealSession({
      packageId: soulState.packageId ?? params.soulPackageId,
      soulObjectId: params.soul.onChainId,
      allowlistRegistryObjectId: params.allowlistRegistryObjectId,
    })
    soulAllowlistCapObjectId = capState.objectId
    accessKind = 'allowlisted'
  }

  if (!viewerAddress || !accessPolicy) {
    throw new SoulAccessDeniedError('Viewer does not have access to this Soul')
  }

  const seal = getSealRuntimeConfig()
  return {
    artifact: {
      walrusBlobUrl: getBlobUrl(contentBlobId),
      walrusBlobId: contentBlobId,
      contentBlobObjectId: soulState.contentBlobObjectId,
    },
    accessPolicy: {
      ...accessPolicy,
      soulAllowlistCapObjectId,
    },
    seal: {
      network: seal.network,
      threshold: seal.threshold,
      verifyKeyServers: seal.verifyKeyServers,
      serverConfigs: seal.serverConfigs.map(({ objectId, weight, aggregatorUrl }) => ({
        objectId,
        weight,
        ...(aggregatorUrl ? { aggregatorUrl } : {}),
      })),
    },
    sealSidecar,
    viewerAddress,
    accessKind,
    sessionTtlMin: getSealSessionTtlMinutes(),
  }
}
