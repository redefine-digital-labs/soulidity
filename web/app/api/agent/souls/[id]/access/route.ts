import { NextRequest, NextResponse } from 'next/server'
import { requireAgentApiKey } from '@web/lib/auth/require-agent-api-key'
import { getMemberPrimarySuiWalletAddress } from '@web/lib/auth/sui-wallet'
import { takeRateLimitToken } from '@web/lib/rate-limit'
import { getRequiredPublicEnv } from '@web/lib/souls/config'
import {
  getVerifiedSoulAccessCapState,
  getVerifiedSoulState,
  OnChainVerificationError,
  sameSuiValue,
} from '@web/lib/souls/on-chain-verification'
import { findSoulAssetDetailByRouteId } from '@web/lib/souls/repository'
import { getClientSafeOnChainVerificationErrorMessage, toSafeErrorDetails } from '@web/lib/souls/route-safety'
import {
  hasCredentialedSealServerConfigs,
  getSealRuntimeConfig,
  getOwnerSealSession,
  getAgentSealSession,
  hasSealSessionConfig,
} from '@web/lib/services/seal'
import { getBlobUrl } from '@web/lib/services/walrus'

const AGENT_ACCESS_RATE_LIMIT = {
  max: 60,
  windowMs: 60 * 1000,
} as const

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
  const soul = await findSoulAssetDetailByRouteId(id)
  if (!soul) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
  if (!soul.sealSidecar) {
    return NextResponse.json({ error: 'Soul access is not ready yet' }, { status: 503 })
  }

  let soulPackageId: string
  try {
    soulPackageId = getRequiredPublicEnv('NEXT_PUBLIC_SOUL_OBJECT_PACKAGE_ID')
  } catch {
    return NextResponse.json({ error: 'Service temporarily unavailable' }, { status: 503 })
  }

  let agentAddress: string | null
  try {
    agentAddress = await getMemberPrimarySuiWalletAddress(agent.agentMemberId)
  } catch (walletError) {
    if (walletError instanceof Error && walletError.name === 'MultipleSuiWalletBindingsError') {
      return NextResponse.json({ error: walletError.message }, { status: 409 })
    }
    throw walletError
  }
  if (!agentAddress) {
    return NextResponse.json({ error: 'Agent has no Sui wallet binding' }, { status: 403 })
  }

  try {
    const soulState = await getVerifiedSoulState(soul.onChainId, soulPackageId)

    let accessPolicy
    let soulAccessCapObjectId: string | null = null

    const isDirectOwner = soulState.ownerAddress && sameSuiValue(soulState.ownerAddress, agentAddress)
    const isListedSeller = (
      soul.listingStatus === 'listed'
      && soul.currentOwnerMemberId === agent.agentMemberId
    )

    if (isDirectOwner || isListedSeller) {
      accessPolicy = getOwnerSealSession(soul.onChainId)
    } else if (
      soul.agentGrantAddress
      && soul.agentAccessCapOnChainId
      && sameSuiValue(soul.agentGrantAddress, agentAddress)
      && sameSuiValue(soulState.agentGrant, agentAddress)
    ) {
      const capState = await getVerifiedSoulAccessCapState(soul.agentAccessCapOnChainId, soulPackageId)
      if (
        !sameSuiValue(capState.ownerAddress, agentAddress)
        || !sameSuiValue(capState.soulObjectId, soul.onChainId)
        || capState.grantVersion !== soulState.grantVersion
      ) {
        return NextResponse.json({ error: 'Soul access cap is no longer valid' }, { status: 403 })
      }

      accessPolicy = getAgentSealSession(soul.onChainId)
      soulAccessCapObjectId = capState.objectId
    } else {
      return NextResponse.json({ error: 'Agent does not have access to this Soul' }, { status: 403 })
    }

    const seal = getSealRuntimeConfig()
    return NextResponse.json({
      artifact: {
        walrusBlobUrl: getBlobUrl(soul.contentBlobId),
        walrusBlobId: soul.contentBlobId,
        contentBlobObjectId: soul.contentBlobObjectId,
      },
      accessPolicy: {
        ...accessPolicy,
        soulAccessCapObjectId,
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
      sealSidecar: soul.sealSidecar,
    })
  } catch (accessError) {
    if (accessError instanceof OnChainVerificationError) {
      return NextResponse.json(
        { error: getClientSafeOnChainVerificationErrorMessage(accessError) },
        { status: accessError.status },
      )
    }

    console.error('[agent-access] Failed to resolve Soul access', {
      agentMemberId: agent.agentMemberId,
      soulOnChainId: soul.onChainId,
      error: toSafeErrorDetails(accessError),
    })
    return NextResponse.json({ error: 'Unable to verify Soul access right now' }, { status: 503 })
  }
}
