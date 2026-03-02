import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@web/lib/prisma'

export async function POST(request: NextRequest) {
  const { code, tg_id, tg_name } = await request.json()

  if (!code || !tg_id) {
    return NextResponse.json({ error: 'code and tg_id required' }, { status: 400 })
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
