import { createHash, createHmac, randomBytes } from 'node:crypto'

import { NextResponse } from 'next/server'

import { prisma } from '@/lib/prisma'
import {
  requireIdentity,
  requireMutationIdentity,
  type Identity,
} from '@/lib/auth/identity'

const TOKEN_PREFIX = 'dtk_'
const TOKEN_RANDOM_BYTES = 32
const TOKEN_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000 // 90 days

// ── Token generation + hashing ────────────────────────────

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

function getDesktopAccessTokenSecret(): string {
  const secret = process.env.AUTH_SECRET ?? process.env.SOUL_UPLOAD_SECRET
  if (secret && secret.length > 0) {
    return secret
  }

  if (process.env.NODE_ENV !== 'production') {
    return 'clawnews-desktop-access-token-dev-secret'
  }

  throw new Error('AUTH_SECRET or SOUL_UPLOAD_SECRET is required to mint desktop access tokens')
}

export function generateDesktopAccessToken(): { token: string; hash: string } {
  const token = `${TOKEN_PREFIX}${randomBytes(TOKEN_RANDOM_BYTES).toString('hex')}`
  return { token, hash: hashToken(token) }
}

export function generateDesktopAccessTokenForDeviceSession(deviceCode: string): { token: string; hash: string } {
  const digest = createHmac('sha256', getDesktopAccessTokenSecret())
    .update(`desktop-device-session:${deviceCode}`)
    .digest('hex')
  const token = `${TOKEN_PREFIX}${digest}`
  return { token, hash: hashToken(token) }
}

// ── Token verification ────────────────────────────────────

export async function verifyDesktopAccessToken(
  token: string,
): Promise<{ accountId: string } | null> {
  if (!token.startsWith(TOKEN_PREFIX) || token.length <= TOKEN_PREFIX.length) {
    return null
  }

  const hash = hashToken(token)

  const profile = await prisma.desktopProfile.findUnique({
    where: {
      desktopAccessTokenHash: hash,
    },
    select: {
      accountId: true,
      desktopAccessTokenHash: true,
      desktopAccessTokenIssuedAt: true,
    },
  })

  if (!profile) {
    return null
  }

  if (profile.desktopAccessTokenHash !== hash) {
    return null
  }

  if (
    profile.desktopAccessTokenIssuedAt &&
    Date.now() - profile.desktopAccessTokenIssuedAt.getTime() > TOKEN_MAX_AGE_MS
  ) {
    return null
  }

  return { accountId: profile.accountId }
}

// ── Route-level auth middleware ────────────────────────────

export interface RequireDesktopIdentityOptions {
  /**
   * For mutating routes (POST/PUT/PATCH/DELETE), set to true so that browser
   * session cookies must be paired with a matching CSRF token + same-origin
   * Origin/Referer. Read-only routes (GET/HEAD) can leave this false.
   *
   * The desktop bearer token (`dtk_*`) bypasses CSRF either way.
   */
  mutation?: boolean
}

export async function requireDesktopIdentity(
  request: Request,
  options: RequireDesktopIdentityOptions = {},
): Promise<{ error?: NextResponse; accountId?: string; identity?: Identity }> {
  const authHeader = request.headers.get('authorization')

  // Desktop token path: Authorization: Bearer dtk_...
  if (authHeader) {
    const parts = authHeader.split(' ')
    const token = parts.length === 2 && parts[0] === 'Bearer' ? parts[1] : null

    if (token && token.startsWith(TOKEN_PREFIX)) {
      const result = await verifyDesktopAccessToken(token)
      if (!result) {
        return {
          error: NextResponse.json({ error: 'Invalid desktop access token' }, { status: 401 }),
        }
      }

      return { accountId: result.accountId }
    }
  }

  const { error, identity } = options.mutation
    ? await requireMutationIdentity(request)
    : await requireIdentity()
  if (error) {
    return { error }
  }

  if (identity.kind !== 'human') {
    return {
      error: NextResponse.json(
        { error: 'Only human accounts can access desktop endpoints' },
        { status: 403 },
      ),
    }
  }

  return { accountId: identity.accountId, identity }
}
