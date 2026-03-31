import { NextResponse } from 'next/server'
import { requireIdentity } from '@web/lib/auth/identity'
import { isMultipleSuiWalletBindingsError } from '@web/lib/auth/sui-wallet-errors'
import { getMemberSuiWalletAddresses } from '@web/lib/auth/sui-wallet'
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

const HUMAN_ACCESS_RATE_LIMIT = {
  max: 30,
  windowMs: 60 * 1000,
} as const

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { error, identity } = await requireIdentity()
  if (error) {
    return error
  }
  if (identity.kind !== 'human') {
    return NextResponse.json({ error: 'This access route only supports human sessions' }, { status: 403 })
  }

  const rateLimit = await takeRateLimitToken(`human-access:${identity.memberId}`, HUMAN_ACCESS_RATE_LIMIT)
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
      { error: 'Credentialed Seal key servers are not supported for browser access' },
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

  try {
    const viewerAddresses = await getMemberSuiWalletAddresses(identity.memberId)
    if (viewerAddresses.length === 0) {
      return NextResponse.json({ error: 'Bind a Sui wallet before accessing Soul content' }, { status: 403 })
    }

    return NextResponse.json(await resolveSoulAccessPayload({
      soul,
      viewerAddresses,
      soulPackageId,
      allowlistRegistryObjectId,
    }))
  } catch (accessError) {
    if (isMultipleSuiWalletBindingsError(accessError)) {
      return NextResponse.json({ error: accessError.message }, { status: 409 })
    }
    if (accessError instanceof SoulAccessDeniedError) {
      return NextResponse.json({ error: accessError.message }, { status: accessError.status })
    }
    if (accessError instanceof OnChainVerificationError) {
      return NextResponse.json(
        { error: getClientSafeOnChainVerificationErrorMessage(accessError) },
        { status: accessError.status },
      )
    }

    console.error('[human-access] Failed to resolve Soul access', {
      memberId: identity.memberId,
      soulOnChainId: soul.onChainId,
      error: toSafeErrorDetails(accessError),
    })
    return NextResponse.json({ error: 'Unable to verify Soul access right now' }, { status: 503 })
  }
}
