import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@web/lib/prisma'
import { createSession } from '@web/lib/auth/session'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  const { token } = await request.json()
  if (!token) {
    return NextResponse.json({ error: 'token required' }, { status: 400 })
  }

  const challenge = await prisma.loginChallenge.findUnique({
    where: { token },
    select: {
      consumedAt: true,
      expiresAt: true,
      memberId: true,
      status: true,
      tgId: true,
    },
  })

  if (!challenge) {
    return NextResponse.json({ error: '登录请求不存在' }, { status: 404 })
  }

  if (challenge.consumedAt || challenge.status === 'consumed') {
    return NextResponse.json({ error: '登录请求已使用' }, { status: 409 })
  }

  if (challenge.expiresAt.getTime() <= Date.now()) {
    await prisma.loginChallenge.update({
      where: { token },
      data: { error: 'expired', status: 'expired' },
    })
    return NextResponse.json({ error: '登录请求已过期' }, { status: 410 })
  }

  if (challenge.status !== 'verified' || !challenge.memberId || !challenge.tgId) {
    return NextResponse.json({ error: '登录尚未确认' }, { status: 409 })
  }

  const member = await prisma.member.findUnique({
    where: { id: challenge.memberId },
    select: { avatar: true, id: true, level: true, tgId: true, tgName: true },
  })

  if (!member) {
    return NextResponse.json({ error: '账号不存在' }, { status: 404 })
  }

  await createSession(member.id, member.tgId)
  await prisma.loginChallenge.update({
    where: { token },
    data: {
      consumedAt: new Date(),
      error: null,
      status: 'consumed',
    },
  })

  return NextResponse.json({
    member: {
      avatar: member.avatar,
      id: member.id,
      level: member.level,
      tgName: member.tgName,
    },
    ok: true,
  })
}
