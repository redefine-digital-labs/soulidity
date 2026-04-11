import { NextResponse } from 'next/server'
import { getBlobUrl } from '@web/lib/services/walrus'
import { generateAssetDocumentIdForVersion } from '@web/lib/services/seal-crypto'
import { getSealRuntimeConfig, getSealSessionTtlMinutes, hasCredentialedSealServerConfigs, hasSealSessionConfig } from '@web/lib/services/seal'
import { prisma } from '@web/lib/prisma'
import { takeRateLimitToken } from '@web/lib/rate-limit'
import { findSoulAssetDetailByRouteId } from '@/lib/soulidity/repository'
import { getRequiredSoulidityEnv } from '@/lib/soulidity/env'
import { getSoulGrantObject, getSoulStateObject, normalizeSuiValue, sameSuiValue } from '@/lib/soulidity/queries'
import { requireHumanWalletIdentity } from '@/lib/soulidity/server'

export const dynamic = 'force-dynamic'

const SCOPE_ASSETS = 8

const HUMAN_ASSET_ACCESS_RATE_LIMIT = {
  max: 30,
  windowMs: 60 * 1000,
} as const

function parseVersionParam(value: string) {
  if (!/^\d+$/.test(value.trim())) return null
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; assetName: string; versionIndex: string }> },
) {
  const { id, assetName, versionIndex } = await params
  const decodedAssetName = decodeURIComponent(assetName)
  const parsedVersionIndex = parseVersionParam(versionIndex)
  if (parsedVersionIndex == null) {
    return NextResponse.json({ error: 'versionIndex must be a non-negative integer' }, { status: 400 })
  }

  const soul = await findSoulAssetDetailByRouteId(id)
  if (!soul) {
    return NextResponse.json({ error: 'Soul not found' }, { status: 404 })
  }

  const version = await prisma.soulAssetVersionRecord.findFirst({
    where: {
      soulOnChainId: soul.onChainId,
      assetsOnChainId: soul.assetsOnChainId ?? undefined,
      assetName: decodedAssetName,
      versionIndex: parsedVersionIndex,
    },
  })
  if (!version) {
    return NextResponse.json({ error: 'Asset version not found' }, { status: 404 })
  }
  if (version.deletedAt) {
    return NextResponse.json({ error: 'Asset version has been deleted' }, { status: 410 })
  }

  if (version.visibility === 'public') {
    return NextResponse.json({
      visibility: 'public',
      artifact: {
        walrusBlobUrl: version.blobId ? getBlobUrl(version.blobId) : null,
        walrusBlobId: version.blobId,
        blobObjectId: version.blobObjectId,
      },
    })
  }

  const auth = await requireHumanWalletIdentity()
  if ('error' in auth) {
    return auth.error
  }

  const rateLimit = await takeRateLimitToken(`human-asset-access:${auth.identity.memberId}`, HUMAN_ASSET_ACCESS_RATE_LIMIT)
  if (rateLimit.limited) {
    return NextResponse.json(
      { error: 'Too many Soulidity asset access requests, try again later' },
      { status: 429, headers: { 'Retry-After': String(rateLimit.retryAfterSeconds) } },
    )
  }

  if (!hasSealSessionConfig()) {
    return NextResponse.json({ error: 'Seal session is not configured' }, { status: 503 })
  }
  if (hasCredentialedSealServerConfigs()) {
    return NextResponse.json(
      { error: 'Credentialed Seal key servers are not supported for browser access' },
      { status: 503 },
    )
  }
  if (!version.sealSidecar) {
    return NextResponse.json({ error: 'Private asset Seal sidecar is missing' }, { status: 409 })
  }
  if (!soul.assetsOnChainId) {
    return NextResponse.json({ error: 'Soul assets root is missing' }, { status: 409 })
  }

  const state = await getSoulStateObject(soul.stateOnChainId, getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_PACKAGE_ID'))
  const resolvedPackageId = state.packageId ?? getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_PACKAGE_ID')
  const viewerAddresses = auth.walletAddresses
    .map((address) => normalizeSuiValue(address))
    .filter((value): value is string => value != null)

  const documentIdHex = generateAssetDocumentIdForVersion(soul.assetsOnChainId, version.assetName, version.versionIndex)

  // 1. Owner check
  const ownerMatch = viewerAddresses.find((address) => sameSuiValue(address, state.currentOwnerAddress))
  if (ownerMatch) {
    return NextResponse.json({
      visibility: 'private',
      artifact: {
        walrusBlobUrl: version.blobId ? getBlobUrl(version.blobId) : null,
        walrusBlobId: version.blobId,
        blobObjectId: version.blobObjectId,
      },
      accessPolicy: {
        packageId: resolvedPackageId,
        stateObjectId: soul.stateOnChainId,
        assetsObjectId: soul.assetsOnChainId,
        assetName: version.assetName,
        versionIndex: version.versionIndex,
        moduleName: 'assets',
        functionName: 'seal_approve_asset_read_owner',
        soulGrantObjectId: null,
        documentIdHex,
      },
      seal: getSealRuntimeConfig(),
      sealSidecar: version.sealSidecar,
      viewerAddress: ownerMatch,
      accessKind: 'owner',
      sessionTtlMin: getSealSessionTtlMinutes(),
    })
  }

  // 2. Active grant with assets scope (grant scope_mask bit 8 = SCOPE_ASSETS).
  //    Move contract seal_approve_asset_read_granted_agent checks grant::scope_assets() on chain.
  const activeAssetsSlot = state.activeGrants.find((slot) =>
    slot.scopes.includes('assets')
      && viewerAddresses.some((address) => sameSuiValue(address, slot.granteeAddress)),
  )
  if (activeAssetsSlot) {
    const grant = await getSoulGrantObject(activeAssetsSlot.grantId, resolvedPackageId)
    const viewerMatch = viewerAddresses.find((address) => sameSuiValue(address, grant.granteeAddress))
    if (viewerMatch) {
      if (grant.expiresAtMs == null || grant.expiresAtMs >= Date.now()) {
        if (grant.scopes.includes('assets')) {
          return NextResponse.json({
            visibility: 'private',
            artifact: {
              walrusBlobUrl: version.blobId ? getBlobUrl(version.blobId) : null,
              walrusBlobId: version.blobId,
              blobObjectId: version.blobObjectId,
            },
            accessPolicy: {
              packageId: resolvedPackageId,
              stateObjectId: soul.stateOnChainId,
              assetsObjectId: soul.assetsOnChainId,
              assetName: version.assetName,
              versionIndex: version.versionIndex,
              moduleName: 'assets',
              functionName: 'seal_approve_asset_read_granted_agent',
              soulGrantObjectId: grant.objectId,
              documentIdHex,
            },
            seal: getSealRuntimeConfig(),
            sealSidecar: version.sealSidecar,
            viewerAddress: viewerMatch,
            accessKind: 'granted-agent',
            sessionTtlMin: getSealSessionTtlMinutes(),
          })
        }
      }
    }
  }

  // 3. ContentAccessList check (SCOPE_ASSETS = 8)
  if (soul.accessListOnChainId) {
    const accessMatch = await prisma.contentAccessRecord.findFirst({
      where: {
        soulOnChainId: soul.onChainId,
        granteeAddress: { in: viewerAddresses },
        revokedAt: null,
      },
    })
    if (accessMatch && (accessMatch.scopeMask & SCOPE_ASSETS) === SCOPE_ASSETS) {
      const viewerMatch = viewerAddresses.find((address) =>
        address.toLowerCase() === accessMatch.granteeAddress.toLowerCase(),
      )
      if (viewerMatch) {
        return NextResponse.json({
          visibility: 'private',
          artifact: {
            walrusBlobUrl: version.blobId ? getBlobUrl(version.blobId) : null,
            walrusBlobId: version.blobId,
            blobObjectId: version.blobObjectId,
          },
          accessPolicy: {
            packageId: resolvedPackageId,
            stateObjectId: soul.stateOnChainId,
            accessListOnChainId: soul.accessListOnChainId,
            assetsObjectId: soul.assetsOnChainId,
            assetName: version.assetName,
            versionIndex: version.versionIndex,
            moduleName: 'content_access',
            functionName: 'seal_approve_asset_allowlisted',
            soulGrantObjectId: null,
            documentIdHex,
          },
          seal: getSealRuntimeConfig(),
          sealSidecar: version.sealSidecar,
          viewerAddress: viewerMatch,
          accessKind: 'allowlisted',
          sessionTtlMin: getSealSessionTtlMinutes(),
        })
      }
    }
  }

  return NextResponse.json({ error: 'Only the owner, an active grant, or an allowlisted address can access this asset version' }, { status: 403 })
}
