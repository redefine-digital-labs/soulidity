import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@web/lib/prisma'
import { getRequestIp, MISSING_CLIENT_IP_ERROR, takeRateLimitToken } from '@web/lib/rate-limit'

const VERIFY_RATE_LIMIT = { max: 5, windowMs: 15 * 60 * 1000 } as const

export async function POST(request: NextRequest) {
  const ip = getRequestIp(request.headers)
  if (!ip) {
    return NextResponse.json({ error: MISSING_CLIENT_IP_ERROR }, { status: 400 })
  }
  const rl = await takeRateLimitToken(`verify:${ip}`, VERIFY_RATE_LIMIT)
  if (rl.limited) {
    return NextResponse.json(
      { error: 'Too many requests, try again later' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSeconds) } },
    )
  }

  const body = await request.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { code, tg_id, tg_name } = body as {
    code?: unknown
    tg_id?: unknown
    tg_name?: unknown
  }
  const trimmedTgName = typeof tg_name === 'string' ? tg_name.trim() : null

  if (!code || !tg_id) {
    return NextResponse.json({ error: 'code and tg_id required' }, { status: 400 })
  }

  if (
    typeof code !== 'string'
    || typeof tg_id !== 'string'
    || code.length > 64
    || tg_id.length > 64
    || !/^\d+$/.test(tg_id)
    || (tg_name != null && (typeof tg_name !== 'string' || (trimmedTgName?.length ?? 0) > 100))
  ) {
    return NextResponse.json({ error: 'Invalid input' }, { status: 400 })
  }

  const verified = await prisma.$transaction(async (tx) => {
    const inviteUpdate = await tx.inviteCode.updateMany({
      where: { code, active: 1, usedBy: null },
      data: { usedBy: tg_id, active: 0 },
    })
    if (inviteUpdate.count === 0) {
      return false
    }

    await tx.member.upsert({
      where: { tgId: tg_id },
      create: {
        tgId: tg_id,
        tgName: trimmedTgName || null,
        inviteCode: code,
      },
      update: {},
    })

    return true
  })

  if (!verified) {
    return NextResponse.json({ verified: false, error: 'Invalid or used invite code' }, { status: 422 })
  }

  return NextResponse.json({ verified: true })
}
