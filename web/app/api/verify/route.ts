import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@web/lib/prisma'
import { getRequestIp, takeRateLimitToken } from '@web/lib/rate-limit'

const VERIFY_RATE_LIMIT = { max: 5, windowMs: 15 * 60 * 1000 } as const

export async function POST(request: NextRequest) {
  const ip = getRequestIp(request.headers)
  const rl = takeRateLimitToken(`verify:${ip}`, VERIFY_RATE_LIMIT)
  if (rl.limited) {
    return NextResponse.json(
      { error: 'Too many requests, try again later' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSeconds) } },
    )
  }

  const { code, tg_id, tg_name } = await request.json()

  if (!code || !tg_id) {
    return NextResponse.json({ error: 'code and tg_id required' }, { status: 400 })
  }

  if (typeof code !== 'string' || typeof tg_id !== 'string' || code.length > 64 || tg_id.length > 64) {
    return NextResponse.json({ error: 'Invalid input' }, { status: 400 })
  }

  const invite = await prisma.inviteCode.findFirst({
    where: { code, active: 1, usedBy: null },
  })
  if (!invite) {
    return NextResponse.json({ verified: false, error: 'Invalid or used invite code' })
  }

  await prisma.inviteCode.update({ where: { code }, data: { usedBy: tg_id, active: 0 } })
  await prisma.member.upsert({
    where: { tgId: tg_id },
    create: { tgId: tg_id, tgName: tg_name ?? null, inviteCode: code },
    update: {},
  })

  return NextResponse.json({ verified: true })
}
