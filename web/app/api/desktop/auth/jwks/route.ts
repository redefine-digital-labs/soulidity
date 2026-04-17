import { createPublicKey } from 'node:crypto'
import { NextResponse } from 'next/server'

export const dynamic = 'force-static'
export const revalidate = false

function getJwks() {
  const pem = process.env.PRIVY_CUSTOM_AUTH_PUBLIC_KEY_PEM?.trim()
  if (!pem) {
    throw new Error('PRIVY_CUSTOM_AUTH_PUBLIC_KEY_PEM is not set')
  }

  const jwk = createPublicKey(pem).export({ format: 'jwk' }) as Record<string, string>
  return {
    keys: [
      {
        ...jwk,
        alg: 'ES256',
        use: 'sig',
        kid: 'soulidity-desktop-v1',
      },
    ],
  }
}

export function GET() {
  try {
    return NextResponse.json(getJwks(), {
      headers: {
        'Cache-Control': 'public, max-age=3600, s-maxage=3600',
      },
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to serve JWKS' },
      { status: 500 },
    )
  }
}
