import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@web/lib/prisma'
import { requireAgentApiKey } from '@web/lib/auth/require-agent-api-key'
import { normalizeSuiWalletAddress } from '@web/lib/auth/challenge'
import { isUuid } from '@web/lib/is-uuid'
import { takeRateLimitToken } from '@web/lib/rate-limit'
import { getRequiredPublicEnv } from '@web/lib/souls/config'
import {
  getVerifiedPassState,
  getVerifiedSeriesState,
  OnChainVerificationError,
  sameSuiValue,
} from '@web/lib/souls/on-chain-verification'
import { resolveLatestSeriesRelease, resolveReleaseByOnChainId } from '@web/lib/souls/release-resolution'
import {
  getClientSafeOnChainVerificationErrorMessage,
  toSafeErrorDetails,
} from '@web/lib/souls/route-safety'
import {
  hasCredentialedSealServerConfigs,
  getSealRuntimeConfig,
  getSealSessionPerpetual,
  getSealSessionSubscription,
  hasSealSessionConfig,
} from '@web/lib/services/seal'
import { getBlobUrl, normalizeWalrusBlobId } from '@web/lib/services/walrus'

const AGENT_ACCESS_RATE_LIMIT = {
  max: 60,
  windowMs: 60 * 1000,
} as const
const MAX_SOUL_ROUTE_ID_LENGTH = 128

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { agent, response } = await requireAgentApiKey(req)
  if (!agent) return response

  const rateLimit = await takeRateLimitToken(`agent-access:${agent.agentMemberId}`, AGENT_ACCESS_RATE_LIMIT)
  if (rateLimit.limited) {
    return NextResponse.json(
      { error: 'Too many access requests, try again later' },
      { status: 429, headers: { 'Retry-After': String(rateLimit.retryAfterSeconds) } },
    )
  }

  if (!hasSealSessionConfig()) {
    return NextResponse.json({ error: 'Seal session is not configured' }, { status: 503 })
  }

  if (hasCredentialedSealServerConfigs()) {
    return NextResponse.json(
      { error: 'Credentialed Seal key servers are not supported for direct agent access' },
      { status: 503 },
    )
  }

  const { id } = await params
  if (id.length > MAX_SOUL_ROUTE_ID_LENGTH) {
    return NextResponse.json({ error: 'Soul id is too long' }, { status: 400 })
  }
  const where = isUuid(id)
    ? { OR: [{ id }, { onChainId: id }], status: 'active' as const }
    : { onChainId: id, status: 'active' as const }

  const series = await prisma.soulSeries.findFirst({ where })

  if (!series) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const agentMember = await prisma.member.findFirst({
    where: { id: agent.agentMemberId },
    include: {
      walletBindings: { where: { chain: 'sui' }, orderBy: { isPrimary: 'desc' }, take: 1 },
    },
  })

  const agentAddress = normalizeSuiWalletAddress(agentMember?.walletBindings[0]?.address ?? null)
  if (!agentAddress) {
    return NextResponse.json({ error: 'Agent has no Sui wallet binding' }, { status: 403 })
  }

  // Find passes: agent granted OR agent owns the pass (self-purchase)
  const now = new Date()
  const candidatePasses = await prisma.soulPassSnapshot.findMany({
    where: {
      seriesId: series.id,
      status: 'active',
      OR: [
        { agentGrant: agentAddress },
        { ownerAddress: agentAddress },
      ],
      NOT: { passType: 'subscription', expiresAt: { lt: now } },
    },
    orderBy: [
      { passType: 'desc' },
      { expiresAt: 'desc' },
      { createdAt: 'desc' },
    ],
  })

  if (candidatePasses.length === 0) {
    return NextResponse.json({ error: 'No active pass or direct ownership for this Soul' }, { status: 403 })
  }

  let soulPackageId: string
  try {
    soulPackageId = getRequiredPublicEnv('NEXT_PUBLIC_SOUL_PACKAGE_ID')
  } catch {
    return NextResponse.json({ error: 'Service temporarily unavailable' }, { status: 503 })
  }

  let verifiedPassState: Awaited<ReturnType<typeof getVerifiedPassState>> | null = null
  let sawRetryableVerifyFailure = false
  for (const pass of candidatePasses) {
    try {
      const state = await getVerifiedPassState(pass.onChainId, soulPackageId)
      const hasOnChainAccess =
        sameSuiValue(state.ownerAddress, agentAddress)
        || sameSuiValue(state.agentGrant, agentAddress)
      const isExpiredOnChain =
        state.passType === 'subscription'
        && state.expiresAt != null
        && state.expiresAt < now

      if (sameSuiValue(state.seriesId, series.onChainId) && hasOnChainAccess && !isExpiredOnChain) {
        verifiedPassState = state
        break
      }
    } catch (error) {
      if (!(error instanceof OnChainVerificationError) || error.status >= 500) {
        sawRetryableVerifyFailure = true
      }
      if (!(error instanceof OnChainVerificationError)) {
        console.error('[agent-access] Failed to verify pass access state', {
          agentMemberId: agent.agentMemberId,
          seriesId: series.id,
          passOnChainId: pass.onChainId,
          error: toSafeErrorDetails(error),
        })
      }
    }
  }

  if (!verifiedPassState) {
    // Surface transient errors (RPC/indexer outages) as 503 instead of false 403
    if (sawRetryableVerifyFailure) {
      return NextResponse.json({ error: 'Unable to verify pass access right now' }, { status: 503 })
    }
    return NextResponse.json({ error: 'No active pass or direct ownership for this Soul' }, { status: 403 })
  }

  // Resolve the correct release
  let targetRelease: Awaited<ReturnType<typeof resolveLatestSeriesRelease>> | null = null

  if (verifiedPassState.passType === 'perpetual') {
    if (!verifiedPassState.lockedReleaseId) {
      return NextResponse.json({ error: 'Locked release missing for perpetual pass' }, { status: 404 })
    }
    try {
      targetRelease = await resolveReleaseByOnChainId({
        releaseOnChainId: verifiedPassState.lockedReleaseId,
        seriesDbId: series.id,
        seriesOnChainId: series.onChainId,
        seriesLatestReleaseOnChainId: null,
        soulPackageId,
      })
    } catch (error) {
      if (error instanceof OnChainVerificationError) {
        return NextResponse.json(
          { error: getClientSafeOnChainVerificationErrorMessage(error) },
          { status: error.status },
        )
      }
      console.error('[agent-access] Failed to resolve perpetual release', {
        agentMemberId: agent.agentMemberId,
        seriesId: series.id,
        releaseOnChainId: verifiedPassState.lockedReleaseId,
        error: toSafeErrorDetails(error),
      })
      return NextResponse.json({ error: 'Unable to load the locked release right now' }, { status: 503 })
    }
  } else {
    try {
      const seriesState = await getVerifiedSeriesState(series.onChainId, soulPackageId)
      targetRelease = await resolveLatestSeriesRelease({
        seriesDbId: series.id,
        seriesOnChainId: series.onChainId,
        latestReleaseOnChainId: seriesState.latestReleaseId,
        soulPackageId,
      })
    } catch (error) {
      if (error instanceof OnChainVerificationError) {
        return NextResponse.json(
          { error: getClientSafeOnChainVerificationErrorMessage(error) },
          { status: error.status },
        )
      }
      console.error('[agent-access] Failed to resolve latest subscription release', {
        agentMemberId: agent.agentMemberId,
        seriesId: series.id,
        error: toSafeErrorDetails(error),
      })
      return NextResponse.json({ error: 'Unable to load the latest release right now' }, { status: 503 })
    }
  }

  if (!targetRelease) {
    return NextResponse.json({ error: 'No releases available' }, { status: 404 })
  }

  const walrusBlobRef = normalizeWalrusBlobId(targetRelease.walrusBlobRef)
  if (!walrusBlobRef) {
    return NextResponse.json({ error: 'Release blob reference is invalid' }, { status: 500 })
  }

  const accessPolicy =
    verifiedPassState.passType === 'perpetual'
      ? getSealSessionPerpetual(series.onChainId)
      : getSealSessionSubscription(series.onChainId)

  const seal = getSealRuntimeConfig()

  return NextResponse.json({
    artifact: {
      walrusBlobUrl: getBlobUrl(walrusBlobRef),
      walrusBlobRef,
      contentHash: targetRelease.contentHash,
    },
    accessPolicy: {
      ...accessPolicy,
      passObjectId: verifiedPassState.objectId,
      releaseObjectId: targetRelease.onChainId,
      clockObjectId: verifiedPassState.passType === 'subscription' ? '0x6' : null,
    },
    seal: {
      network: seal.network,
      threshold: seal.threshold,
      verifyKeyServers: seal.verifyKeyServers,
      serverConfigs: seal.serverConfigs.map(({ objectId, weight }) => ({
        objectId,
        weight,
      })),
    },
    sealSidecar: targetRelease.sealSidecar ?? null,
    releaseId: targetRelease.onChainId,
    version: targetRelease.version,
    passType: verifiedPassState.passType,
    passOnChainId: verifiedPassState.objectId,
  })
}
