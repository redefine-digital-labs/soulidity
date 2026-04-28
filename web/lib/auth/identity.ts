import { NextResponse } from 'next/server'

import { prisma } from '@/lib/prisma'
import {
  buildChallengeMessage,
  normalizeSuiWalletAddress,
} from '@/lib/auth/challenge'
import { isUuid } from '@/lib/is-uuid'
import { getRequestHeaders } from '@/lib/request-headers'
import { getRequestIp, takeRateLimitToken } from '@/lib/rate-limit'
import { verifyPersonalMessageSignature } from '@/lib/sui-verify'
import {
  SESSION_COOKIE_NAME,
  verifySession,
  type SessionPayload,
} from '@/lib/auth/session'
import { checkCsrfForCookieAuth, csrfFailureResponse } from '@/lib/auth/csrf'

import { resolveAgentByApiKey } from './resolve-agent'

export interface Identity {
  accountId: string
  memberId: string
  ownerMemberId?: string
  kind: 'human' | 'agent'
  /** Present when the identity was resolved from a session cookie. */
  session?: SessionPayload
}

const WALLET_IDENTITY_RATE_LIMIT = {
  max: 10,
  windowMs: 60 * 1000,
} as const

function redactWalletAddress(address: string): string {
  if (address.length <= 14) {
    return address
  }

  return `${address.slice(0, 10)}...${address.slice(-4)}`
}

function getCookieValue(cookieHeader: string | null, name: string): string | null {
  if (!cookieHeader) return null

  const prefix = `${name}=`
  for (const part of cookieHeader.split(';')) {
    const cookie = part.trim()
    if (!cookie.startsWith(prefix)) continue

    const value = cookie.slice(prefix.length).trim()
    return value.length > 0 ? value : null
  }

  return null
}

export async function resolveIdentity(): Promise<Identity | null> {
  const headerStore = await getRequestHeaders()

  // 1. Wallet signature path (agents)
  const agentAddress = headerStore.get('x-agent-address')
  const agentSignature = headerStore.get('x-agent-signature')
  const agentMessage = headerStore.get('x-agent-message')
  if (agentAddress && agentSignature && agentMessage) {
    return resolveWalletIdentity(agentAddress, agentSignature, agentMessage, headerStore)
  }

  // 2. API key path (agents)
  const authHeader = headerStore.get('authorization')
  if (authHeader) {
    if (!authHeader.startsWith('Bearer ')) return null
    const token = authHeader.slice(7).trim()
    if (token.length === 0) return null

    if (token.startsWith('sk-')) {
      if (token.length < 10) return null
      const agent = await resolveAgentByApiKey(token)
      if (!agent) return null
      return {
        accountId: agent.accountId,
        memberId: agent.agentMemberId,
        ownerMemberId: agent.ownerMemberId,
        kind: 'agent',
      }
    }

    // Unknown bearer token from a retired auth provider — reject so callers must
    // adopt the new wallet/session flow.
    return null
  }

  // 3. Session cookie path (browser humans)
  const sessionToken = getCookieValue(headerStore.get('cookie'), SESSION_COOKIE_NAME)
  if (!sessionToken) return null

  return resolveSessionCookie(sessionToken)
}

async function resolveSessionCookie(token: string): Promise<Identity | null> {
  const payload = await verifySession(token)
  if (!payload) return null

  // Verify the member still exists with the expected kind/account. Stale
  // session tokens (member deleted, kind changed) must not authenticate.
  const member = await prisma.member.findUnique({
    where: { id: payload.memberId },
    select: { id: true, accountId: true, kind: true },
  })
  if (!member?.accountId) return null
  if (member.kind !== 'human') return null
  if (member.accountId !== payload.accountId) return null

  return {
    accountId: payload.accountId,
    memberId: payload.memberId,
    kind: 'human',
    session: payload,
  }
}

async function resolveWalletIdentity(
  address: string,
  signature: string,
  nonce: string,
  requestHeaders: Awaited<ReturnType<typeof getRequestHeaders>>,
): Promise<Identity | null> {
  if (address.length > 128 || nonce.length > 128 || signature.length > 8192) return null
  if (!isUuid(nonce)) return null

  const normalizedAddress = normalizeSuiWalletAddress(address)
  if (!normalizedAddress) return null

  const requestIp = getRequestIp(requestHeaders)
  if (!requestIp) {
    console.warn('Wallet auth requires a trusted client IP; check proxy forwarding or TRUST_PROXY_HEADERS', {
      address: redactWalletAddress(normalizedAddress),
    })
    return null
  }

  const ipRateLimit = await takeRateLimitToken(`wallet-auth-ip:${requestIp}`, WALLET_IDENTITY_RATE_LIMIT)
  if (ipRateLimit.limited) return null

  const addressRateLimitKey = `wallet-auth:${requestIp}:${normalizedAddress}`
  const addressRateLimit = await takeRateLimitToken(addressRateLimitKey, WALLET_IDENTITY_RATE_LIMIT)
  if (addressRateLimit.limited) return null

  try {
    const challenge = await prisma.walletChallenge.findUnique({
      where: { nonce },
    })
    if (!challenge) return null
    if (challenge.address !== normalizedAddress) return null
    if (challenge.usedAt) return null
    if (challenge.expiresAt < new Date()) return null

    const challengeDomain = challenge.domain?.trim()
    if (!challengeDomain) {
      console.warn('Wallet challenge missing stored domain, rejecting challenge', { nonce })
      return null
    }

    const expectedMessage = buildChallengeMessage(
      challengeDomain,
      normalizedAddress,
      nonce,
      challenge.expiresAt,
    )
    const msg = new TextEncoder().encode(expectedMessage)
    let publicKey: Awaited<ReturnType<typeof verifyPersonalMessageSignature>>
    try {
      publicKey = await verifyPersonalMessageSignature(msg, signature, {
        address: normalizedAddress,
      })
    } catch {
      return null
    }

    if (normalizeSuiWalletAddress(publicKey.toSuiAddress()) !== normalizedAddress) {
      return null
    }

    const result = await prisma.walletChallenge.updateMany({
      where: { nonce, usedAt: null },
      data: { usedAt: new Date() },
    })
    if (result.count === 0) return null

    const binding = await prisma.walletBinding.findFirst({
      where: { chain: 'sui', address: normalizedAddress },
      select: {
        member: {
          select: { id: true, accountId: true, kind: true },
        },
      },
    })
    if (!binding?.member || !binding.member.accountId) return null

    const kind = binding.member.kind
    if (kind !== 'human' && kind !== 'agent') return null

    return {
      accountId: binding.member.accountId,
      memberId: binding.member.id,
      kind,
    }
  } catch (error) {
    console.error('Unexpected wallet identity resolution failure', {
      address: redactWalletAddress(normalizedAddress),
      nonce,
      error,
    })
    return null
  }
}

/**
 * Mutating-route auth helper. Header-based auth (agent wallet sig / API key)
 * is accepted directly. Cookie-based session auth additionally requires a
 * matching CSRF token and same-origin Origin/Referer.
 */
export async function requireMutationIdentity(
  request: Request,
): Promise<{ error: NextResponse; identity: null } | { error: null; identity: Identity }> {
  const identity = await resolveIdentity()
  if (!identity) {
    return {
      error: NextResponse.json({ error: '请先登录' }, { status: 401 }),
      identity: null,
    }
  }

  // Header-based identity bypasses CSRF (agent wallet sig + agent API key).
  if (!identity.session) {
    return { error: null, identity }
  }

  const csrf = checkCsrfForCookieAuth(request, identity.session.csrfHash)
  if (!csrf.ok) {
    return { error: csrfFailureResponse(), identity: null }
  }

  return { error: null, identity }
}

/**
 * Read-only / personalization helper. Accepts header auth or session cookie
 * without CSRF — safe because no state mutation happens.
 *
 * Mutating routes MUST use {@link requireMutationIdentity}, not this.
 */
export async function requireIdentity(): Promise<
  { error: NextResponse; identity: null } | { error: null; identity: Identity }
> {
  const identity = await resolveIdentity()
  if (!identity) {
    return {
      error: NextResponse.json({ error: '请先登录' }, { status: 401 }),
      identity: null,
    }
  }
  return { error: null, identity }
}
