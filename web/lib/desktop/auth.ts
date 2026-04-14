import { createHash, randomBytes } from 'node:crypto'

import { NextResponse } from 'next/server'

import { prisma } from '@web/lib/prisma'
import { resolveIdentity, type Identity } from '@web/lib/auth/identity'

const TOKEN_PREFIX = 'dtk_'
const TOKEN_RANDOM_BYTES = 32
const TOKEN_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000 // 90 days

// ── Token generation + hashing ────────────────────────────

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export function generateDesktopAccessToken(): { token: string; hash: string } {
  const token = `${TOKEN_PREFIX}${randomBytes(TOKEN_RANDOM_BYTES).toString('hex')}`
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

  // Look up the profile that contains this token hash in its preferences JSON.
  // Prisma's Json filter supports path-based equality checks.
  const profile = await prisma.desktopProfile.findFirst({
    where: {
      preferences: {
        path: ['desktopAccessTokenHash'],
        equals: hash,
      },
    },
    select: {
      accountId: true,
      preferences: true,
    },
  })

  if (!profile) {
    return null
  }

  // Double-check the hash in the preferences object (belt-and-suspenders)
  const prefs = profile.preferences as Record<string, unknown> | null
  if (!prefs || prefs.desktopAccessTokenHash !== hash) {
    return null
  }

  // Enforce token TTL using stored issuance timestamp
  if (typeof prefs.desktopAccessTokenIssuedAt === 'string') {
    const issuedMs = new Date(prefs.desktopAccessTokenIssuedAt).getTime()
    if (!Number.isNaN(issuedMs) && Date.now() - issuedMs > TOKEN_MAX_AGE_MS) {
      return null
    }
  }

  return { accountId: profile.accountId }
}

// ── Route-level auth middleware ────────────────────────────

export async function requireDesktopIdentity(
  request: Request,
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

  // Fallback: standard human identity (Privy / wallet / API key)
  const identity = await resolveIdentity({ allowCookieFallback: false })
  if (!identity) {
    return {
      error: NextResponse.json({ error: '请先登录' }, { status: 401 }),
    }
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
