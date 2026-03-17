import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@web/lib/prisma'
import { privy } from '@web/lib/auth/privy'
import { takeRateLimitToken } from '@web/lib/rate-limit'
import { isUniqueConstraintError } from '@shared/prisma-errors'
import { createClaimToken } from '../route'

export const dynamic = 'force-dynamic'

// POST /api/agent-join/claim-register — register new account + claim agent in one step
export async function POST(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const token = authHeader.slice(7)
  let claims
  try {
    claims = await privy.verifyAuthToken(token)
  } catch {
    return NextResponse.json({ error: 'Invalid auth token' }, { status: 401 })
  }

  const privyDid = claims.userId

  const body = await request.json().catch(() => null)
  if (!body?.id || !body?.token) {
    return NextResponse.json({ error: 'id and token are required' }, { status: 400 })
  }

  // Verify HMAC claim token
  if (createClaimToken(body.id) !== body.token) {
    return NextResponse.json({ error: 'Invalid claim link' }, { status: 403 })
  }

  // Rate limit
  const rl = takeRateLimitToken(`claim-register:${privyDid}`, {
    max: 10,
    windowMs: 10 * 60 * 1000,
  })
  if (rl.limited) {
    return NextResponse.json(
      { error: 'Too many requests, please try again later' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSeconds) } }
    )
  }

  // Get Privy user email
  const privyUser = await privy.getUser(privyDid)
  const email = privyUser.email?.address?.toLowerCase()
  if (!email) {
    return NextResponse.json({ error: 'No email found' }, { status: 400 })
  }

  // Pre-check: account with this privyDid already exists
  const existingByPrivy = await prisma.account.findUnique({
    where: { privyDid },
    select: { id: true },
  })
  if (existingByPrivy) {
    return NextResponse.json(
      { error: 'Account already exists', code: 'ACCOUNT_EXISTS' },
      { status: 409 }
    )
  }

  // Pre-check: email already used by another account
  const existingByEmail = await prisma.account.findUnique({
    where: { email },
    select: { id: true },
  })
  if (existingByEmail) {
    return NextResponse.json(
      { error: 'Email already used by another account', code: 'EMAIL_EXISTS' },
      { status: 409 }
    )
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      // Confirm agent is still unclaimed inside transaction
      const agent = await tx.member.findUnique({
        where: { id: body.id },
        select: { id: true, kind: true, accountId: true, apiKey: true },
      })

      if (!agent || agent.kind !== 'agent') {
        throw new Error('AGENT_NOT_FOUND')
      }
      if (agent.accountId) {
        throw new Error('AGENT_CLAIMED')
      }

      // Create Account
      let account
      try {
        account = await tx.account.create({
          data: {
            privyDid,
            email,
            tgId: null,
          },
        })
      } catch (error) {
        if (isUniqueConstraintError(error)) {
          const targets = Array.isArray(error.meta?.target)
            ? error.meta.target
            : typeof error.meta?.target === 'string'
              ? [error.meta.target]
              : []
          if (targets.some((t) => t.includes('privy') || t.includes('tg'))) {
            throw new Error('ACCOUNT_EXISTS')
          }
          if (targets.some((t) => t.includes('email'))) {
            throw new Error('EMAIL_EXISTS')
          }
          throw new Error('ACCOUNT_CONFLICT')
        }
        throw error
      }

      // Create human Member
      const displayName = email.split('@')[0] || email
      await tx.member.create({
        data: {
          kind: 'human',
          displayName,
          accountId: account.id,
        },
      })

      // Claim agent (CAS: only if still unclaimed)
      const linked = await tx.member.updateMany({
        where: { id: body.id, accountId: null },
        data: { accountId: account.id },
      })
      if (linked.count === 0) {
        throw new Error('AGENT_CLAIMED')
      }

      return { apiKey: agent.apiKey }
    })

    return NextResponse.json({ ok: true, apiKey: result.apiKey })
  } catch (error) {
    if (error instanceof Error) {
      switch (error.message) {
        case 'AGENT_NOT_FOUND':
          return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
        case 'AGENT_CLAIMED':
          return NextResponse.json(
            { error: 'Agent already claimed', code: 'AGENT_CLAIMED' },
            { status: 409 }
          )
        case 'ACCOUNT_EXISTS':
        case 'ACCOUNT_CONFLICT':
          return NextResponse.json(
            { error: 'Account already exists', code: 'ACCOUNT_EXISTS' },
            { status: 409 }
          )
        case 'EMAIL_EXISTS':
          return NextResponse.json(
            { error: 'Email already used by another account', code: 'EMAIL_EXISTS' },
            { status: 409 }
          )
      }
    }

    console.error('[claim-register] unexpected error:', error)
    return NextResponse.json({ error: 'Registration failed' }, { status: 500 })
  }
}
