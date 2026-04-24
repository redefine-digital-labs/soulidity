import { NextResponse } from 'next/server'
import { getBlobUrl } from '@/lib/services/walrus'
import { generateSkillDocumentIdForVersion } from '@/lib/services/seal-crypto'
import { getSealRuntimeConfig, getSealSessionTtlMinutes, hasSealSessionConfig } from '@/lib/services/seal'
import { prisma } from '@/lib/prisma'
import { takeRateLimitToken } from '@/lib/rate-limit'
import { findSoulAssetDetailByRouteId } from '@/lib/soulidity/repository'
import { getRequiredSoulidityEnv } from '@/lib/soulidity/env'
import { SOUL_GRANT_SCOPE_SKILLS } from '@/lib/soulidity/grant-scopes'
import { getSoulGrantObject, getSoulStateObject, normalizeSuiValue, sameSuiValue } from '@/lib/soulidity/queries'
import { requireAgentWalletIdentity } from '@/lib/soulidity/agent-server'

export const dynamic = 'force-dynamic'

const AGENT_SKILL_ACCESS_RATE_LIMIT = {
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
  { params }: { params: Promise<{ id: string; skillName: string; versionIndex: string }> },
) {
  const { id, skillName, versionIndex } = await params
  const parsedVersionIndex = parseVersionParam(versionIndex)
  if (parsedVersionIndex == null) {
    return NextResponse.json({ error: 'versionIndex must be a non-negative integer' }, { status: 400 })
  }

  const soul = await findSoulAssetDetailByRouteId(id)
  if (!soul) {
    return NextResponse.json({ error: 'Soul not found' }, { status: 404 })
  }

  const version = await prisma.soulSkillVersionRecord.findFirst({
    where: {
      soulOnChainId: soul.onChainId,
      skillsOnChainId: soul.skillsOnChainId ?? undefined,
      skillName,
      versionIndex: parsedVersionIndex,
    },
  })
  if (!version) {
    return NextResponse.json({ error: 'Skill version not found' }, { status: 404 })
  }
  if (version.deletedAt) {
    return NextResponse.json({ error: 'Skill version has been deleted' }, { status: 410 })
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

  const rateLimit = await takeRateLimitToken(`agent-skill-access:${auth.agent.agentMemberId}`, AGENT_SKILL_ACCESS_RATE_LIMIT)
  if (rateLimit.limited) {
    return NextResponse.json(
      { error: 'Too many Soulidity skill access requests, try again later' },
      { status: 429, headers: { 'Retry-After': String(rateLimit.retryAfterSeconds) } },
    )
  }

  if (!hasSealSessionConfig()) {
    return NextResponse.json({ error: 'Seal session is not configured' }, { status: 503 })
  }
  if (!version.sealSidecar) {
    return NextResponse.json({ error: 'Private skill Seal sidecar is missing' }, { status: 409 })
  }
  if (!soul.skillsOnChainId) {
    return NextResponse.json({ error: 'Soul skills root is missing' }, { status: 409 })
  }

  const state = await getSoulStateObject(soul.stateOnChainId, getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_PACKAGE_ID'))
  const resolvedPackageId = state.packageId ?? getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_PACKAGE_ID')
  const viewerAddresses = auth.walletAddresses
    .map((address) => normalizeSuiValue(address))
    .filter((value): value is string => value != null)
  const documentIdHex = generateSkillDocumentIdForVersion(soul.skillsOnChainId, version.skillName, version.versionIndex)

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
        skillsObjectId: soul.skillsOnChainId,
        skillName: version.skillName,
        versionIndex: version.versionIndex,
        moduleName: 'skills',
        functionName: 'seal_approve_private_read_owner',
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

  const activeSkillsSlot = state.activeGrants.find((slot) =>
    slot.scopes.includes('skills')
      && viewerAddresses.some((address) => sameSuiValue(address, slot.granteeAddress)),
  )
  if (activeSkillsSlot) {
    const grant = await getSoulGrantObject(activeSkillsSlot.grantId, resolvedPackageId)
    const viewerMatch = viewerAddresses.find((address) => sameSuiValue(address, grant.granteeAddress))
    if (!viewerMatch) {
      return NextResponse.json({ error: 'The active skills grant does not belong to this wallet' }, { status: 403 })
    }
    if (grant.expiresAtMs != null && grant.expiresAtMs < Date.now()) {
      return NextResponse.json({ error: 'The active skills grant has expired' }, { status: 403 })
    }
    if (!grant.scopes.includes('skills')) {
      return NextResponse.json({ error: 'The active grant does not allow skills access' }, { status: 403 })
    }

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
        skillsObjectId: soul.skillsOnChainId,
        skillName: version.skillName,
        versionIndex: version.versionIndex,
        moduleName: 'skills',
        functionName: 'seal_approve_private_read_granted_agent',
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

  if (soul.accessListOnChainId) {
    const accessMatch = await prisma.contentAccessRecord.findFirst({
      where: {
        soulOnChainId: soul.onChainId,
        granteeAddress: { in: viewerAddresses },
        ownershipEpochSnapshot: state.ownershipEpoch,
        revokedAt: null,
      },
    })
    if (accessMatch && (accessMatch.scopeMask & SOUL_GRANT_SCOPE_SKILLS) === SOUL_GRANT_SCOPE_SKILLS) {
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
            skillsObjectId: soul.skillsOnChainId,
            skillName: version.skillName,
            versionIndex: version.versionIndex,
            moduleName: 'content_access',
            functionName: 'seal_approve_skill_allowlisted',
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

  return NextResponse.json(
    { error: 'Only the owner, an active skills grant, or an allowlisted address can access this version' },
    { status: 403 },
  )
}
