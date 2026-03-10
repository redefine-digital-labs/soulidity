import { randomBytes } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@web/lib/prisma'

const CHALLENGE_TTL_MS = 10 * 60 * 1000

export const dynamic = 'force-dynamic'

function getEffectiveStatus(challenge: { expiresAt: Date; status: string }): string {
  if (challenge.status === 'pending' && challenge.expiresAt.getTime() <= Date.now()) {
    return 'expired'
  }

  return challenge.status
}

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get('token')
  if (!token) {
    return NextResponse.json({ error: 'token required' }, { status: 400 })
  }

  const challenge = await prisma.loginChallenge.findUnique({
    where: { token },
    select: { expiresAt: true, status: true },
  })

  if (!challenge) {
    return NextResponse.json({ error: '登录请求不存在' }, { status: 404 })
  }

  return NextResponse.json({
    expiresAt: challenge.expiresAt.toISOString(),
    status: getEffectiveStatus(challenge),
  })
}

export async function POST() {
  const botUsername = process.env.TG_BOT_USERNAME || process.env.NEXT_PUBLIC_TG_BOT_USERNAME
  if (!botUsername) {
    return NextResponse.json({ error: 'TG_BOT_USERNAME not configured' }, { status: 500 })
  }

  const token = randomBytes(18).toString('hex')
  const expiresAt = new Date(Date.now() + CHALLENGE_TTL_MS)

  await prisma.loginChallenge.create({
    data: {
      token,
      expiresAt,
    },
  })

  return NextResponse.json({
    expiresAt: expiresAt.toISOString(),
    telegramUrl: `https://t.me/${botUsername}?start=login_${token}`,
    token,
  })
}
