import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@web/lib/prisma'
import { Bot } from 'grammy'
import { processJoinRequest } from '../../../../src/bot/gateway.js'

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
    return NextResponse.json({ success: false, error: 'Server not configured' }, { status: 500 })
  }

  const bot = new Bot(token)

  const result = await processJoinRequest(prisma, {
    tg_id,
    invite_code,
    createInviteLink: async () => {
      const link = await bot.api.createChatInviteLink(groupId, {
        member_limit: 1,
        expire_date: Math.floor(Date.now() / 1000) + 600,
      })
      return link.invite_link
    },
  })

  if (!result.success) {
    return NextResponse.json({ success: false, error: result.error }, { status: 422 })
  }

  return NextResponse.json({ success: true, invite_link: result.invite_link })
}
