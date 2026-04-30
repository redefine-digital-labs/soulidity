import { NextRequest, NextResponse } from 'next/server'
import { isValidSuiAddress, normalizeSuiAddress } from '@mysten/sui/utils'
import { takeBestEffortRateLimitToken } from '@/lib/rate-limit'
import { resolveOwnedPersonalKiosk, SoulidityPersonalKioskInvariantError } from '@/lib/soulidity/personal-kiosk'
import { requireSoulCreateWalletIdentity } from '@/lib/soulidity/server'

export const dynamic = 'force-dynamic'

const SOUL_PERSONAL_KIOSK_RATE_LIMIT = {
  max: 30,
  windowMs: 60 * 1000,
} as const

export async function GET(req: NextRequest) {
  const auth = await requireSoulCreateWalletIdentity(req)
  if ('error' in auth) {
    return auth.error
  }

  const rateLimit = await takeBestEffortRateLimitToken(`soul-personal-kiosk:${auth.identity.memberId}`, SOUL_PERSONAL_KIOSK_RATE_LIMIT)
  if (rateLimit.limited) {
    return NextResponse.json(
      { error: 'Too many Soul personal kiosk requests, try again later' },
      { status: 429, headers: { 'Retry-After': String(rateLimit.retryAfterSeconds) } },
    )
  }

  const memberWalletAddresses = auth.walletAddresses

  // If client provides a wallet address, validate it belongs to the authenticated member
  const clientWalletAddress = req.nextUrl.searchParams.get('walletAddress')?.trim()
  let walletAddresses: string[]

  if (clientWalletAddress) {
    try {
      const normalized = normalizeSuiAddress(clientWalletAddress)
      if (!isValidSuiAddress(normalized)) {
        return NextResponse.json({ error: 'Invalid walletAddress' }, { status: 400 })
      }
      if (!memberWalletAddresses.some(addr => normalizeSuiAddress(addr) === normalized)) {
        return NextResponse.json({ error: 'walletAddress does not match the signed-in wallet' }, { status: 403 })
      }
      walletAddresses = [normalized]
    } catch {
      return NextResponse.json({ error: 'Invalid walletAddress' }, { status: 400 })
    }
  } else {
    walletAddresses = memberWalletAddresses
  }

  try {
    const resolvedPersonalKiosk = await resolveOwnedPersonalKiosk({ ownerAddresses: walletAddresses })
    if (resolvedPersonalKiosk.status === 'missing') {
      return NextResponse.json(
        { error: 'No Soulidity personal kiosk found for this wallet' },
        { status: 404 },
      )
    }

    return NextResponse.json(resolvedPersonalKiosk.kiosk)
  } catch (error) {
    if (error instanceof SoulidityPersonalKioskInvariantError && error.kind === 'conflict') {
      return NextResponse.json({ error: error.message }, { status: 409 })
    }
    console.error('[soul-personal-kiosk] Failed to resolve owned Soulidity kiosk', {
      memberId: auth.identity.memberId,
      error,
    })
    return NextResponse.json({ error: 'Unable to resolve Soulidity personal kiosk right now' }, { status: 503 })
  }
}
