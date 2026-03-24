import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@web/lib/prisma'
import { processJoinRequest } from '@bot/gateway'
import { getAppBaseUrl } from '@shared/app-config'
import { isInviteCode, normalizeInviteCode } from '@shared/invite-code-format'
import { getRequestIp, MISSING_CLIENT_IP_ERROR, takeRateLimitToken } from '@web/lib/rate-limit'

export async function POST(request: NextRequest) {
  const requestIp = getRequestIp(request.headers)
  if (!requestIp) {
    return NextResponse.json({ success: false, error: MISSING_CLIENT_IP_ERROR }, { status: 400 })
  }

  const joinRateLimit = takeRateLimitToken(`join:${requestIp}`, {
    max: 20,
    windowMs: 10 * 60 * 1000,
  })
  if (joinRateLimit.limited) {
    return NextResponse.json(
      { success: false, error: 'Too many join attempts, please try again later' },
      {
        status: 429,
        headers: {
          'Retry-After': String(joinRateLimit.retryAfterSeconds),
        },
      }
    )
  }

  let body: any
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON body' }, { status: 400 })
  }

  const { tg_id, invite_code } = body

  if ((typeof tg_id !== 'string' && typeof tg_id !== 'number') || typeof invite_code !== 'string') {
    return NextResponse.json({ success: false, error: 'tg_id and invite_code required' }, { status: 400 })
  }

  const tgId = String(tg_id).trim()
  const inviteCode = normalizeInviteCode(invite_code)

  if (!tgId || !/^\d+$/.test(tgId) || !isInviteCode(inviteCode)) {
    return NextResponse.json({ success: false, error: 'Invalid tg_id or invite_code format' }, { status: 400 })
  }

  const token = process.env.TG_BOT_TOKEN
  const groupId = process.env.TG_GROUP_ID
  if (!token || !groupId) {
    console.error('[join] server not configured: missing Telegram env')
    return NextResponse.json({ success: false, error: 'Server not configured' }, { status: 500 })
  }
  const result = await processJoinRequest(prisma, {
    tg_id: tgId,
    invite_code: inviteCode,
    createInviteLink: async () => {
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
        if (!data.ok || typeof data.result?.invite_link !== 'string') {
          console.error('[join] Telegram API error:', {
            description: typeof data.description === 'string' ? data.description : undefined,
            error_code: typeof data.error_code === 'number' ? data.error_code : undefined,
          })
          throw new Error('TELEGRAM_INVITE_FAILED')
        }
        return data.result.invite_link
      } catch (error) {
        console.error('[join] failed to create Telegram invite link:', error)
        throw new Error('TELEGRAM_INVITE_FAILED')
      }
    },
  })

  if (!result.success) {
    const status = result.error_code === 'LINK_FAILED'
      ? 500
      : result.error_code === 'ALREADY_REGISTERED'
        ? 409
        : 422
    return NextResponse.json({ success: false, error: result.error }, { status })
  }

  const register_url = `${getAppBaseUrl()}/register?code=${result.register_code ?? inviteCode}`

  return NextResponse.json({ success: true, invite_link: result.invite_link, register_url })
}
