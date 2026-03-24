import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@web/lib/prisma'
import { privy } from '@web/lib/auth/privy'
import { isInviteCode, normalizeInviteCode } from '@shared/invite-code-format'
import { getRequestIp, MISSING_CLIENT_IP_ERROR, takeRateLimitToken } from '@web/lib/rate-limit'
import { isUniqueConstraintError } from '@shared/prisma-errors'

export const dynamic = 'force-dynamic'
const FALLBACK_PENDING_REGISTRATION_WINDOW_MS = 24 * 60 * 60 * 1000

export async function POST(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return NextResponse.json({ error: '未登录' }, { status: 401 })
  }

  const requestIp = getRequestIp(request.headers)
  if (!requestIp) {
    return NextResponse.json({ error: MISSING_CLIENT_IP_ERROR }, { status: 400 })
  }

  const ipRateLimit = takeRateLimitToken(`register-ip:${requestIp}`, {
    max: 20,
    windowMs: 10 * 60 * 1000,
  })
  if (ipRateLimit.limited) {
    return NextResponse.json(
      { error: '请求过于频繁，请稍后再试' },
      {
        status: 429,
        headers: {
          'Retry-After': String(ipRateLimit.retryAfterSeconds),
        },
      }
    )
  }

  const token = authHeader.slice(7)
  let claims
  try {
    claims = await privy.verifyAuthToken(token)
  } catch {
    return NextResponse.json({ error: '无效的认证令牌' }, { status: 401 })
  }

  const privyDid = claims.userId

  // Check if already registered
  const existing = await prisma.account.findUnique({
    where: { privyDid },
    select: { id: true },
  })
  if (existing) {
    return NextResponse.json({ error: '该账号已注册' }, { status: 409 })
  }

  const body = await request.json().catch(() => null)
  if (!body?.code) {
    return NextResponse.json({ error: '缺少邀请码' }, { status: 400 })
  }
  if (typeof body.code !== 'string') {
    return NextResponse.json({ error: '邀请码格式无效' }, { status: 400 })
  }

  const code = normalizeInviteCode(body.code)
  if (!isInviteCode(code)) {
    return NextResponse.json({ error: '邀请码格式无效' }, { status: 400 })
  }

  const userRateLimit = takeRateLimitToken(`register:${privyDid}`, {
    max: 10,
    windowMs: 10 * 60 * 1000,
  })
  if (userRateLimit.limited) {
    return NextResponse.json(
      { error: '请求过于频繁，请稍后再试' },
      {
        status: 429,
        headers: {
          'Retry-After': String(userRateLimit.retryAfterSeconds),
        },
      }
    )
  }

  try {
    // Get Privy user email inside the guarded block so upstream failures
    // return the route's standard JSON error shape.
    const privyUser = await privy.getUser(privyDid)
    const email = privyUser.email?.firstVerifiedAt
      ? privyUser.email.address.toLowerCase()
      : null
    if (!email) {
      return NextResponse.json({ error: '未找到已验证的邮箱信息' }, { status: 400 })
    }

    // Check email not taken by another account
    const emailTaken = await prisma.account.findUnique({
      where: { email },
      select: { id: true },
    })
    if (emailTaken) {
      return NextResponse.json({ error: '该邮箱已注册' }, { status: 409 })
    }

    // Registration is only allowed after the join flow creates a pending member.
    const invite = await prisma.inviteCode.findUnique({
      where: { code },
      select: { createdAt: true, expiresAt: true, active: true, usedBy: true },
    })
    if (!invite) {
      return NextResponse.json({ error: '邀请码无效或已使用' }, { status: 422 })
    }

    const pendingMember = await prisma.member.findFirst({
      where: { inviteCode: code, accountId: null, kind: 'human' },
      select: { id: true, tgId: true },
    })

    if (!pendingMember) {
      return NextResponse.json({ error: '邀请码无效或已使用' }, { status: 422 })
    }
    if (invite.usedBy !== pendingMember.tgId) {
      return NextResponse.json({ error: '邀请码无效或已使用' }, { status: 422 })
    }

    // Join consumes the invite code before registration. A consumed code stays
    // valid only while the pending registration window remains open.
    const pendingRegistrationExpiresAt = invite.expiresAt
      ? new Date(invite.expiresAt)
      : new Date(new Date(invite.createdAt).getTime() + FALLBACK_PENDING_REGISTRATION_WINDOW_MS)
    if (pendingRegistrationExpiresAt < new Date()) {
      return NextResponse.json({ error: '邀请码已过期' }, { status: 422 })
    }

    // Registration completes by linking the pending member created during the join flow.
    const result = await prisma.$transaction(async (tx) => {
      const existingMember = await tx.member.findFirst({
        where: { inviteCode: code, accountId: null, kind: 'human' },
        select: { id: true, tgId: true, displayName: true },
      })

      if (!existingMember) {
        throw new Error('INVITE_RACE')
      }

      let account
      try {
        account = await tx.account.create({
          data: {
            privyDid,
            tgId: existingMember.tgId ?? null,
            email,
          },
        })
      } catch (error) {
        if (isUniqueConstraintError(error)) {
          const targets = Array.isArray(error.meta?.target)
            ? error.meta.target
            : typeof error.meta?.target === 'string'
              ? [error.meta.target]
              : []
          if (targets.some(target => target.includes('privy'))) {
            throw new Error('ACCOUNT_EXISTS')
          }
          if (targets.some(target => target.includes('tg'))) {
            throw new Error('ACCOUNT_EXISTS')
          }
          if (targets.some(target => target.includes('email'))) {
            throw new Error('EMAIL_EXISTS')
          }
          throw new Error('ACCOUNT_CONFLICT')
        }
        throw error
      }

      const linked = await tx.member.updateMany({
        where: { id: existingMember.id, accountId: null },
        data: {
          accountId: account.id,
          displayName: (existingMember.displayName ?? email.split('@')[0]) || email,
        },
      })
      if (linked.count === 0) {
        throw new Error('INVITE_RACE')
      }

      // The invite should already be consumed by the join flow, but keep this
      // as a defensive backfill if an upstream flow left it active.
      await tx.inviteCode.updateMany({
        where: { code, active: 1, usedBy: null },
        data: { active: 0, usedBy: existingMember.tgId ?? null },
      })

      return { memberId: existingMember.id }
    })

    return NextResponse.json({ success: true, memberId: result.memberId })
  } catch (error) {
    if (error instanceof Error && error.message === 'INVITE_RACE') {
      return NextResponse.json({ error: '邀请码无效或已使用' }, { status: 422 })
    }
    if (error instanceof Error && (error.message === 'ACCOUNT_EXISTS' || error.message === 'ACCOUNT_CONFLICT')) {
      return NextResponse.json({ error: '该账号已注册' }, { status: 409 })
    }
    if (error instanceof Error && error.message === 'EMAIL_EXISTS') {
      return NextResponse.json({ error: '该邮箱已注册' }, { status: 409 })
    }

    console.error('[register] unexpected error:', {
      name: error instanceof Error ? error.name : 'UnknownError',
      message: error instanceof Error ? error.message : String(error),
    })
    return NextResponse.json({ error: '注册失败，请稍后重试' }, { status: 500 })
  }
}
