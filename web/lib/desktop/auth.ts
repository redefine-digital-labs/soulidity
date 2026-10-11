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

// 60s in-process throttle for `lastSeenAt` writes. Floating-ball / desktop
// polling hits `verifyDesktopAccessToken` aggressively; without throttling
// every verify would issue an UPDATE on `desktop_pets` and turn the table
// hot. The map is intentionally process-local — it is a write-shedding
// cache, not a security check.
const LAST_SEEN_THROTTLE_MS = 60 * 1000
const lastSeenCache = new Map<string, number>()

// ── Token generation + hashing ────────────────────────────

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

/**
 * Centralised secret lookup for every desktop-credential HMAC (access token
 * + agent API key). Falls back to a known dev value outside production so
 * local tests / `next dev` work without env wiring; throws in production so
 * a misconfigured deploy never silently mints predictable credentials.
 */
export function getDesktopCredentialSecret(): string {
  const secret = process.env.AUTH_SECRET ?? process.env.SOUL_UPLOAD_SECRET
  if (secret && secret.length > 0) {
    return secret
  }

  if (process.env.NODE_ENV !== 'production') {
    return 'clawnews-desktop-credential-dev-secret'
  }

  throw new Error('AUTH_SECRET or SOUL_UPLOAD_SECRET is required to mint desktop credentials')
}

export function generateDesktopAccessToken(): { token: string; hash: string } {
  const token = `${TOKEN_PREFIX}${randomBytes(TOKEN_RANDOM_BYTES).toString('hex')}`
  return { token, hash: hashToken(token) }
}

export function generateDesktopAccessTokenForDeviceSession(deviceCode: string): { token: string; hash: string } {
  const digest = createHmac('sha256', getDesktopCredentialSecret())
    .update(`desktop-device-session:${deviceCode}`)
    .digest('hex')
  const token = `${TOKEN_PREFIX}${digest}`
  return { token, hash: hashToken(token) }
}

/**
 * Lazy import for `hashApiKey` to avoid pulling agent-resolver into routes
 * that only need desktop-token verification.
 */
function hashApiKeyDigest(apiKey: string): string {
  return createHash('sha256').update(apiKey).digest('hex')
}

/**
 * Deterministic agent API key minted from a confirmed device session. The
 * desktop poll route reissues the same `sk-*` on every retry until the
 * desktop calls the rotate endpoint; once rotated, the on-chain hash differs
 * from this digest and the poll route stops surfacing it.
 */
export function generateAgentApiKeyForDeviceSession(deviceCode: string): { apiKey: string; hash: string } {
  const digest = createHmac('sha256', getDesktopCredentialSecret())
    .update(`desktop-agent-api-key:${deviceCode}`)
    .digest('hex')
  const apiKey = `sk-${digest}`
  return { apiKey, hash: hashApiKeyDigest(apiKey) }
}

/**
 * Deterministic agent API key for rotation flows. Keyed on
 * `(agentMemberId, rotationId)` so the desktop client can resume an
 * in-flight rotation by replaying the same `rotationId` and recover the
 * exact `sk-*` value without server-side state beyond the durable
 * `pendingApiKeyHash` / `apiKeyHash` columns.
 */
export function generateAgentApiKeyForRotation(
  agentMemberId: string,
  rotationId: string,
): { apiKey: string; hash: string } {
  const digest = createHmac('sha256', getDesktopCredentialSecret())
    .update(`desktop-agent-api-key-rotate:${agentMemberId}:${rotationId}`)
    .digest('hex')
  const apiKey = `sk-${digest}`
  return { apiKey, hash: hashApiKeyDigest(apiKey) }
}

// ── Token verification ────────────────────────────────────

export interface DesktopPetIdentity {
  id: string
  accountId: string
  agentAddress: string
  agentMemberId: string
}

export interface VerifyDesktopAccessTokenOptions {
  /**
   * If true, accept tokens whose `desktopAccessTokenIssuedAt` is older than
   * the 90-day rotation window. Used by the revoke route only — possessing
   * the token hash is cryptographic proof of ownership and revoking is
   * always a tear-down (never escalates access). This makes the revoke
   * endpoint distinguish "pet still exists, token is stale" from "pet row
   * is gone": with `allowExpired`, the former returns 200 (revoke
   * succeeds) and 401 uniquely means "no pet matches this token hash" —
   * preserving the desktop reset's "401 = pet already gone" semantic.
   *
   * Do NOT enable this for any normal API access path; the 90-day expiry
   * is part of the credential lifecycle policy.
   */
  allowExpired?: boolean
}

export async function verifyDesktopAccessToken(
  token: string,
  options: VerifyDesktopAccessTokenOptions = {},
): Promise<{ accountId: string; desktopPet: DesktopPetIdentity } | null> {
  if (!token.startsWith(TOKEN_PREFIX) || token.length <= TOKEN_PREFIX.length) {
    return null
  }

  const hash = hashToken(token)

  const pet = await prisma.desktopPet.findUnique({
    where: {
      desktopAccessTokenHash: hash,
    },
    select: {
      id: true,
      accountId: true,
      agentAddress: true,
      agentMemberId: true,
      desktopAccessTokenHash: true,
      desktopAccessTokenIssuedAt: true,
    },
  })

  if (!pet) {
    return null
  }

  if (pet.desktopAccessTokenHash !== hash) {
    return null
  }

  if (
    !options.allowExpired &&
    pet.desktopAccessTokenIssuedAt &&
    Date.now() - pet.desktopAccessTokenIssuedAt.getTime() > TOKEN_MAX_AGE_MS
  ) {
    return null
  }

  // Best-effort lastSeen update with a process-local 60s throttle. Fire and
  // forget: a slow UPDATE must never delay the verify path.
  const now = Date.now()
  const last = lastSeenCache.get(pet.id) ?? 0
  if (now - last >= LAST_SEEN_THROTTLE_MS) {
    lastSeenCache.set(pet.id, now)
    void prisma.desktopPet
      .update({
        where: { id: pet.id },
        data: { lastSeenAt: new Date(now) },
      })
      .catch(() => {
        // Swallow — losing a heartbeat row is fine.
      })
  }

  return {
    accountId: pet.accountId,
    desktopPet: {
      id: pet.id,
      accountId: pet.accountId,
      agentAddress: pet.agentAddress,
      agentMemberId: pet.agentMemberId,
    },
  }
}

/** Test-only: clear the in-process lastSeen throttle cache. */
export function __resetDesktopLastSeenThrottleForTests(): void {
  lastSeenCache.clear()
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
  /**
   * When true, accept `dtk_*` bearer tokens that are past the 90-day
   * rotation window. Used by the revoke route only — see
   * `VerifyDesktopAccessTokenOptions.allowExpired` for the rationale.
   */
  allowExpiredDesktopToken?: boolean
}

export type RequireDesktopIdentityResult =
  | { error: NextResponse; accountId?: undefined; identity?: undefined; desktopPet?: undefined }
  | { error?: undefined; accountId: string; desktopPet: DesktopPetIdentity; identity?: undefined }
  | { error?: undefined; accountId: string; identity: Identity; desktopPet?: undefined }

export async function requireDesktopIdentity(
  request: Request,
  options: RequireDesktopIdentityOptions = {},
): Promise<RequireDesktopIdentityResult> {
  const authHeader = request.headers.get('authorization')

  // Desktop token path: Authorization: Bearer dtk_...
  if (authHeader) {
    const parts = authHeader.split(' ')
    const token = parts.length === 2 && parts[0] === 'Bearer' ? parts[1] : null

    if (token && token.startsWith(TOKEN_PREFIX)) {
      const result = await verifyDesktopAccessToken(token, {
        allowExpired: options.allowExpiredDesktopToken,
      })
      if (!result) {
        return {
          error: NextResponse.json({ error: 'Invalid desktop access token' }, { status: 401 }),
        }
      }

      return { accountId: result.accountId, desktopPet: result.desktopPet }
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
