import { NextResponse } from 'next/server'
import { requireIdentity } from '@web/lib/auth/identity'
import { isMultipleSuiWalletBindingsError } from '@web/lib/auth/sui-wallet-errors'
import { getMemberSuiWalletAddresses } from '@web/lib/auth/sui-wallet'
import { takeRateLimitToken } from '@web/lib/rate-limit'
import { resolveOwnedPersonalKiosk, SoulPersonalKioskInvariantError } from '@web/lib/souls/personal-kiosk'
import { toSafeErrorDetails } from '@web/lib/souls/route-safety'

export const dynamic = 'force-dynamic'

const SOUL_PERSONAL_KIOSK_RATE_LIMIT = {
  max: 30,
  windowMs: 60 * 1000,
} as const

export async function GET() {
  const { error, identity } = await requireIdentity()
  if (error) {
    return error
  }
  if (identity.kind !== 'human') {
    return NextResponse.json({ error: 'Only human accounts can initialize Soul kiosks' }, { status: 403 })
  }

  const rateLimit = await takeRateLimitToken(`soul-personal-kiosk:${identity.memberId}`, SOUL_PERSONAL_KIOSK_RATE_LIMIT)
  if (rateLimit.limited) {
    return NextResponse.json(
      { error: 'Too many Soul personal kiosk requests, try again later' },
      { status: 429, headers: { 'Retry-After': String(rateLimit.retryAfterSeconds) } },
    )
  }

  let walletAddresses: string[]
  try {
    walletAddresses = await getMemberSuiWalletAddresses(identity.memberId)
  } catch (walletError) {
    if (isMultipleSuiWalletBindingsError(walletError)) {
      return NextResponse.json({ error: walletError.message }, { status: 409 })
    }
    throw walletError
  }

  if (walletAddresses.length === 0) {
    return NextResponse.json({ error: 'Bind a Sui wallet before using the Soul market' }, { status: 403 })
  }

  try {
    const resolvedPersonalKiosk = await resolveOwnedPersonalKiosk({ ownerAddresses: walletAddresses })
    if (resolvedPersonalKiosk.status === 'missing') {
      return NextResponse.json(
        { error: 'No Soul personal kiosk found for this wallet' },
        { status: 404 },
      )
    }

    return NextResponse.json(resolvedPersonalKiosk.kiosk)
  } catch (error) {
    if (error instanceof SoulPersonalKioskInvariantError && error.kind === 'conflict') {
      return NextResponse.json({ error: error.message }, { status: 409 })
    }
    console.error('[soul-personal-kiosk] Failed to resolve owned Soul kiosk', {
      memberId: identity.memberId,
      error: toSafeErrorDetails(error),
    })
    return NextResponse.json({ error: 'Unable to resolve Soul personal kiosk right now' }, { status: 503 })
  }
}
