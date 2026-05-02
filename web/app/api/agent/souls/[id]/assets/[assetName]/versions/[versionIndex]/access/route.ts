import { NextResponse } from 'next/server'
import { getBlobUrl } from '@/lib/services/walrus'
import { generateAssetDocumentIdForVersion } from '@/lib/services/seal-crypto'
import { getSealRuntimeConfig, getSealSessionTtlMinutes, hasSealSessionConfig } from '@/lib/services/seal'
import { prisma } from '@/lib/prisma'
import { takeRateLimitToken } from '@/lib/rate-limit'
import { findSoulAssetDetailByRouteId } from '@/lib/soulidity/repository'
import { getRequiredSoulidityEnv } from '@/lib/soulidity/env'
import {
  findActiveGrantSlotForViewer,
  getSoulGrantObject,
  getSoulStateObject,
  normalizeSuiValue,
  sameSuiValue,
} from '@/lib/soulidity/queries'
import { requireAgentWalletIdentity } from '@/lib/soulidity/agent-server'

export const dynamic = 'force-dynamic'

const SCOPE_ASSETS = 8

const AGENT_ASSET_ACCESS_RATE_LIMIT = {
  max: 60,
  windowMs: 60 * 1000,
} as const

function parseVersionParam(value: string) {
  if (!/^\d+$/.test(value.trim())) return null
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null
}

export async function GET(
  request: Request,
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

  const auth = await requireAgentWalletIdentity(request)
  if ('error' in auth) {
    return auth.error
  }

  const rateLimit = await takeRateLimitToken(`agent-asset-access:${auth.agent.agentMemberId}`, AGENT_ASSET_ACCESS_RATE_LIMIT)
  if (rateLimit.limited) {
    return NextResponse.json(
      { error: 'Too many Soulidity asset access requests, try again later' },
      { status: 429, headers: { 'Retry-After': String(rateLimit.retryAfterSeconds) } },
    )
  }

  if (!hasSealSessionConfig()) {
    return NextResponse.json({ error: 'Seal session is not configured' }, { status: 503 })
  }
  if (!version.sealSidecar) {
    return NextResponse.json({ error: 'Private asset Seal sidecar is missing' }, { status: 409 })
  }
  if (!soul.assetsOnChainId) {
    return NextResponse.json({ error: 'Soul assets root is missing' }, { status: 409 })
  }

  const state = await getSoulStateObject(soul.stateOnChainId, getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_PACKAGE_ID'), {
    includeActiveGrants: false,
  })
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

  // 2. Active grant with assets scope (Move contract checks SCOPE_ASSETS=8 in grant)
  const activeAssetsSlot = await findActiveGrantSlotForViewer({
    state,
    viewerAddresses,
    scope: 'assets',
  })
  if (activeAssetsSlot) {
    const grant = await getSoulGrantObject(activeAssetsSlot.grantId, resolvedPackageId)
    const viewerMatch = viewerAddresses.find((address) => sameSuiValue(address, grant.granteeAddress))
    if (viewerMatch) {
      if (grant.ownershipEpochSnapshot !== state.ownershipEpoch) {
        return NextResponse.json({ error: 'The active asset grant is no longer valid for this Soul owner' }, { status: 403 })
      }
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
  //    Epoch-pinned: only entries under the current SoulState.ownership_epoch
  //    are valid (matches on-chain has_access; a stale entry would be rejected
  //    by the Seal server's seal_approve call anyway).
  if (soul.accessListOnChainId) {
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
