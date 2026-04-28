import type { Bot, Context } from 'grammy'
import { insertRawItem } from '../db/database.js'
import type { PrismaClient } from '../db/database.js'
import { getAppBaseUrl } from '../shared/app-config.js'
import { captureBackendEvent } from '../observability/posthog.js'

const TG_GROUP_ID = () => process.env.TG_GROUP_ID ?? ''

export async function handleStart(ctx: Context, prisma?: PrismaClient): Promise<void> {
  if (ctx.chat?.type !== 'private') return

  const payload = (ctx as any).match
  if (payload === 'join') {
    return handleJoin(ctx, prisma)
  }
  await ctx.reply(
    '🦞 欢迎来到 CryptoOpenClaw！\n\n' +
    '可用命令：\n' +
    '/join — 领取群邀请链接\n' +
    '/start — 显示本帮助'
  )
}

export async function handleJoin(ctx: Context, prisma?: PrismaClient): Promise<void> {
  if (ctx.chat?.type !== 'private') return
  const tgId = ctx.from?.id
  if (!tgId) return

  if (!prisma) {
    await ctx.reply('系统暂时不可用，请稍后再试')
    return
  }

  const humanMember = await prisma.member.findFirst({
    where: { tgId: String(tgId), kind: 'human' },
    select: { id: true, accountId: true },
  })

  if (!humanMember) {
    await ctx.reply(
      '暂时无法领取群邀请链接。\n' +
      `请先完成网站注册（${getAppBaseUrl()}），或先完成 TG 预绑定流程后再试。`
    )
    return
  }

  const groupId = TG_GROUP_ID()
  if (!groupId) {
    console.error('[handleJoin] TG_GROUP_ID not configured')
    await ctx.reply('系统暂时不可用，请稍后再试')
    return
  }

  let inviteLink: string
  try {
    const result = await ctx.api.createChatInviteLink(groupId, {
      member_limit: 1,
    })
    inviteLink = result.invite_link
  } catch (error) {
    console.error('[handleJoin] failed to create invite link:', error)
    await ctx.reply('系统暂时不可用，请稍后再试')
    return
  }

  captureBackendEvent('bot_join_requested', {
    tgId: String(tgId),
    isRegistered: !!humanMember.accountId,
  })

  if (humanMember.accountId) {
    await ctx.reply(
      `🦞 欢迎加入 OpenClaw！\n` +
      `点击链接加入 Telegram 群：${inviteLink}`
    )
  } else {
    await ctx.reply(
      `🦞 欢迎加入 OpenClaw！\n` +
      `点击链接加入 Telegram 群：${inviteLink}\n\n` +
      `你还没有完成网站注册，可稍后访问：${getAppBaseUrl()}`
    )
  }
}

export async function handleMark(ctx: Context, prisma: PrismaClient): Promise<void> {
  const chatId = ctx.chat?.id
  const fromId = ctx.from?.id
  if (!chatId || !fromId) return

  const member = await ctx.api.getChatMember(chatId, fromId)
  if (member.status !== 'administrator' && member.status !== 'creator') {
    return
  }

  const replyMsg = (ctx.message as any)?.reply_to_message
  if (!replyMsg?.text) {
    await ctx.reply('请回复一条消息后使用 /mark')
    return
  }

  const text = replyMsg.text as string
  const msgId = replyMsg.message_id

  await insertRawItem(prisma, {
    source_type: 'community',
    source_name: 'tg_group',
    title: text.slice(0, 80),
    url: `tg://msg/${chatId}/${msgId}`,
    title_hash: null,
    content: text,
    language: 'zh',
    score: 5.0,
    raw_data: JSON.stringify({ chat_id: chatId, message_id: msgId, from_id: replyMsg.from?.id }),
  })

  captureBackendEvent('bot_item_marked', { chatId: String(chatId), fromId: String(fromId) })
  await ctx.reply('✅ 已标记为素材')
}

export function registerHandlers(bot: Bot, prisma: PrismaClient): void {
  bot.command('start', (ctx) => handleStart(ctx, prisma))
  bot.command('join', (ctx) => handleJoin(ctx, prisma))
  bot.command('chatid', async (ctx) => {
    await ctx.reply(`Chat ID: <code>${ctx.chat.id}</code>`, { parse_mode: 'HTML' })
  })
  bot.command('mark', (ctx) => handleMark(ctx, prisma))

  bot.on('chat_member', async (ctx) => {
    const { old_chat_member, new_chat_member } = ctx.chatMember
    const wasOut = old_chat_member.status === 'left' || old_chat_member.status === 'kicked'
    const isIn = new_chat_member.status === 'member' || new_chat_member.status === 'administrator'
    if (wasOut && isIn) {
      const name = new_chat_member.user.first_name
      captureBackendEvent('bot_user_joined_group', { tgId: String(new_chat_member.user.id) })
      await ctx.reply(`🦞 欢迎 ${name} 加入 OpenClaw 社群！`)
    }
  })
}
