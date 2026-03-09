import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@web/lib/prisma'

export async function POST(request: NextRequest) {
  let body: any
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON body' }, { status: 400 })
  }

  const { tg_id, invite_code } = body

  if (!tg_id || !invite_code) {
    return NextResponse.json({ success: false, error: 'tg_id and invite_code required' }, { status: 400 })
  }

  const token = process.env.TG_BOT_TOKEN
  const groupId = process.env.TG_GROUP_ID
  if (!token || !groupId) {
    const missing = [!token && 'TG_BOT_TOKEN', !groupId && 'TG_GROUP_ID'].filter(Boolean)
    return NextResponse.json({ success: false, error: `Server not configured: missing ${missing.join(', ')}` }, { status: 500 })
  }

  // Validate invite code
  const invite = await prisma.inviteCode.findFirst({
    where: { code: invite_code, active: 1, usedBy: null },
  })
  if (!invite) {
    return NextResponse.json({ success: false, error: 'Invalid or used invite code' }, { status: 422 })
  }
  if (invite.expiresAt && new Date(invite.expiresAt) < new Date()) {
    return NextResponse.json({ success: false, error: 'Invite code expired' }, { status: 422 })
  }

  // Generate invite link before consuming code (so failure doesn't waste the code)
  let invite_link: string
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/createChatInviteLink`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: groupId,
        member_limit: 1,
        expire_date: Math.floor(Date.now() / 1000) + 600,
      }),
    })
    const data = await res.json()
    if (!data.ok) {
      return NextResponse.json({ success: false, error: `Telegram API error: ${data.description}` }, { status: 500 })
    }
    invite_link = data.result.invite_link
  } catch (err) {
    return NextResponse.json({ success: false, error: `Failed to create invite link: ${err instanceof Error ? err.message : String(err)}` }, { status: 500 })
  }

  // Consume invite code and create member
  await prisma.inviteCode.update({
    where: { code: invite_code },
    data: { usedBy: tg_id, active: 0 },
  })
  await prisma.member.upsert({
    where: { tgId: tg_id },
    create: { tgId: tg_id, inviteCode: invite_code },
    update: {},
  })

  return NextResponse.json({ success: true, invite_link })
}
