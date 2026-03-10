import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@web/lib/prisma'
import { verifyTelegramLogin, type TelegramLoginData } from '@web/lib/auth/verify-telegram'
import { createSession } from '@web/lib/auth/session'

export async function POST(request: NextRequest) {
  const data: TelegramLoginData = await request.json()

  if (!data.id || !data.hash || !data.auth_date) {
    return NextResponse.json({ error: '无效的登录数据' }, { status: 400 })
  }

  if (!verifyTelegramLogin(data)) {
    return NextResponse.json({ error: '签名验证失败' }, { status: 401 })
  }

  const tgId = String(data.id)
  const member = await prisma.member.findUnique({
    where: { tgId },
    select: { id: true, tgName: true, avatar: true, level: true },
  })

  if (!member) {
    return NextResponse.json(
      { error: '未找到关联账号，请先通过邀请码加入社区' },
      { status: 404 }
    )
  }

  // Update avatar/name from TG if changed
  const updates: Record<string, string> = {}
  const tgName = data.username || `${data.first_name}${data.last_name ? ' ' + data.last_name : ''}`
  if (tgName && tgName !== member.tgName) updates.tgName = tgName
  if (data.photo_url && data.photo_url !== member.avatar) updates.avatar = data.photo_url

  if (Object.keys(updates).length > 0) {
    await prisma.member.update({ where: { tgId }, data: updates })
    Object.assign(member, updates)
  }

  await createSession(member.id, tgId)

  return NextResponse.json({
    ok: true,
    member: { id: member.id, tgName: member.tgName, avatar: member.avatar, level: member.level },
  })
}
