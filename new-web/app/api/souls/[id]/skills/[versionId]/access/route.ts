import { NextResponse } from 'next/server'
import { getBlobUrl } from '@web/lib/services/walrus'
import { getSealRuntimeConfig, getSealSessionTtlMinutes, hasCredentialedSealServerConfigs, hasSealSessionConfig } from '@web/lib/services/seal'
import { prisma } from '@web/lib/prisma'
import { takeRateLimitToken } from '@web/lib/rate-limit'
import { findSoulAssetDetailByRouteId } from '@/lib/soulidity/repository'
import { getRequiredSoulidityEnv } from '@/lib/soulidity/env'
import { getSoulGrantObject, getSoulStateObject, normalizeSuiValue, sameSuiValue } from '@/lib/soulidity/queries'
import { requireHumanWalletIdentity } from '@/lib/soulidity/server'

export const dynamic = 'force-dynamic'

const HUMAN_SKILL_ACCESS_RATE_LIMIT = {
  max: 30,
  windowMs: 60 * 1000,
} as const

function buildSkillDocumentId(versionId: string) {
  const normalized = normalizeSuiValue(versionId)
  if (!normalized) {
    throw new Error('Skill version id is malformed')
  }
  const hex = normalized.replace(/^0x/, '').padStart(64, '0')
  const versionBytes = Buffer.from(hex, 'hex')
  const domainBytes = Buffer.from('soul-skill:', 'utf8')
  const nonceBytes = Buffer.alloc(16, 0x5a)
  return Buffer.concat([domainBytes, Buffer.from([1]), versionBytes, nonceBytes]).toString('hex')
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; versionId: string }> },
) {
  const { id, versionId } = await params
  const soul = await findSoulAssetDetailByRouteId(id)
  if (!soul) {
    return NextResponse.json({ error: 'Soul not found' }, { status: 404 })
  }

  const version = await prisma.soulSkillVersionRecord.findFirst({
    where: {
      soulOnChainId: soul.onChainId,
      OR: [
        { id: versionId },
        { versionOnChainId: versionId.toLowerCase() },
      ],
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

  const auth = await requireHumanWalletIdentity()
  if ('error' in auth) {
    return auth.error
  }

  const rateLimit = await takeRateLimitToken(`human-skill-access:${auth.identity.memberId}`, HUMAN_SKILL_ACCESS_RATE_LIMIT)
  if (rateLimit.limited) {
    return NextResponse.json(
      { error: 'Too many Soulidity skill access requests, try again later' },
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
    return NextResponse.json({ error: 'Private skill Seal sidecar is missing' }, { status: 409 })
  }
  if (!soul.skillsOnChainId) {
    return NextResponse.json({ error: 'Soul skills root is missing' }, { status: 409 })
  }

  const state = await getSoulStateObject(soul.stateOnChainId, getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_PACKAGE_ID'))
  // Prefer the on-chain resolved package — after a Sui package upgrade the env
  // package may differ from the type-defining package that Seal ciphertext is bound to.
  const resolvedPackageId = state.packageId ?? getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_PACKAGE_ID')
  const viewerAddresses = auth.walletAddresses
    .map((address) => normalizeSuiValue(address))
    .filter((value): value is string => value != null)

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
        versionObjectId: version.versionOnChainId,
        moduleName: 'skills',
        functionName: 'approve_private_read_owner',
        soulGrantObjectId: null,
        documentIdHex: buildSkillDocumentId(version.versionOnChainId),
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
  if (!activeSkillsSlot) {
    return NextResponse.json({ error: 'Only the owner or an active skills grant can access this version' }, { status: 403 })
  }

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
      versionObjectId: version.versionOnChainId,
      moduleName: 'skills',
      functionName: 'approve_private_read_granted_agent',
      soulGrantObjectId: grant.objectId,
      documentIdHex: buildSkillDocumentId(version.versionOnChainId),
    },
    seal: getSealRuntimeConfig(),
    sealSidecar: version.sealSidecar,
    viewerAddress: viewerMatch,
    accessKind: 'granted-agent',
    sessionTtlMin: getSealSessionTtlMinutes(),
  })
}
