import { NextResponse, type NextRequest } from 'next/server'

import { isSameOrigin } from '@/lib/auth/csrf'
import {
  buildCsrfCookie,
  buildSessionCookie,
  generateCsrfToken,
  hashCsrfToken,
  signSession,
} from '@/lib/auth/session'
import {
  loginWithWalletSignature,
  WalletLoginError,
} from '@/lib/auth/wallet-login'
import {
  getAnonymousRateLimitFingerprint,
  getRequestIp,
  takeRateLimitToken,
} from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

const RATE_LIMIT = { max: 20, windowMs: 60 * 1000 }

interface WalletLoginRequestBody {
  address?: string
  signature?: string
  nonce?: string
}

export async function POST(request: NextRequest) {
  if (!isSameOrigin(request)) {
    return NextResponse.json(
      { error: 'Cross-origin wallet login is not allowed' },
      { status: 403 },
    )
  }

  let body: WalletLoginRequestBody
  try {
    body = await request.json() as WalletLoginRequestBody
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const address = typeof body.address === 'string' ? body.address : ''
  const signature = typeof body.signature === 'string' ? body.signature : ''
  const nonce = typeof body.nonce === 'string' ? body.nonce : ''

  if (!address || !signature || !nonce) {
    return NextResponse.json(
      { error: 'address, signature, and nonce are required' },
      { status: 400 },
    )
  }

  const fingerprint = getRequestIp(request.headers) ?? getAnonymousRateLimitFingerprint(request.headers)
  if (fingerprint) {
    const { limited } = await takeRateLimitToken(`wallet-login:${fingerprint}`, RATE_LIMIT)
    if (limited) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
    }
  }

  try {
    const result = await loginWithWalletSignature({ address, signature, nonce })

    const csrfToken = generateCsrfToken()
    const csrfHash = hashCsrfToken(csrfToken)
    const sessionToken = await signSession({
      memberId: result.memberId,
      accountId: result.accountId,
      walletAddress: result.walletAddress,
      csrfHash,
      kind: 'human',
    })

    const response = NextResponse.json({
      ok: true,
      walletAddress: result.walletAddress,
      csrfToken,
    })
    response.headers.append('Set-Cookie', buildSessionCookie(sessionToken))
    response.headers.append('Set-Cookie', buildCsrfCookie(csrfToken))
    return response
  } catch (error) {
    if (error instanceof WalletLoginError) {
      const status = error.reason === 'wallet_bound_elsewhere' ? 409 : 401
      return NextResponse.json({ error: error.message, reason: error.reason }, { status })
    }
    console.error('Failed to complete wallet login', { error })
    return NextResponse.json({ error: 'Wallet login failed' }, { status: 500 })
  }
}
