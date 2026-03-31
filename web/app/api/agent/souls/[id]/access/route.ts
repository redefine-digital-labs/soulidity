import { NextRequest, NextResponse } from 'next/server'
import { requireAgentApiKey } from '@web/lib/auth/require-agent-api-key'
import { isMultipleSuiWalletBindingsError } from '@web/lib/auth/sui-wallet-errors'
import { getMemberPrimarySuiWalletAddress } from '@web/lib/auth/sui-wallet'
import { takeRateLimitToken } from '@web/lib/rate-limit'
import { getOptionalPublicEnv, getRequiredPublicEnv } from '@web/lib/souls/config'
import { OnChainVerificationError } from '@web/lib/souls/on-chain-verification'
import { resolveSoulAccessPayload, SoulAccessDeniedError } from '@web/lib/souls/access'
import { findSoulAssetDetailByRouteId } from '@web/lib/souls/repository'
import { getClientSafeOnChainVerificationErrorMessage, toSafeErrorDetails } from '@web/lib/souls/route-safety'
import {
  hasCredentialedSealServerConfigs,
  hasSealSessionConfig,
} from '@web/lib/services/seal'

export const dynamic = 'force-dynamic'

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

  let soulPackageId: string
  try {
    soulPackageId = getRequiredPublicEnv('NEXT_PUBLIC_SOUL_OBJECT_PACKAGE_ID')
  } catch {
    return NextResponse.json({ error: 'Service temporarily unavailable' }, { status: 503 })
  }
  const allowlistRegistryObjectId = getOptionalPublicEnv('NEXT_PUBLIC_SOUL_ALLOWLIST_REGISTRY_ID')

  let agentAddress: string | null
  try {
    agentAddress = await getMemberPrimarySuiWalletAddress(agent.agentMemberId)
  } catch (walletError) {
    if (isMultipleSuiWalletBindingsError(walletError)) {
      return NextResponse.json({ error: walletError.message }, { status: 409 })
    }
    throw walletError
  }
  if (!agentAddress) {
    return NextResponse.json({ error: 'Agent has no Sui wallet binding' }, { status: 403 })
  }

  try {
    return NextResponse.json(await resolveSoulAccessPayload({
      soul,
      viewerAddresses: [agentAddress],
      soulPackageId,
      allowlistRegistryObjectId,
    }))
  } catch (accessError) {
    if (accessError instanceof SoulAccessDeniedError) {
      return NextResponse.json({ error: accessError.message }, { status: accessError.status })
    }
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
