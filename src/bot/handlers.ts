import type { Bot, Context } from 'grammy'
import { insertRawItem } from '../db/database.js'
import type { PrismaClient } from '../db/database.js'
import { getAppBaseUrl } from '../shared/app-config.js'
import { createInviteCodeRecord } from '../shared/invite-code-record.js'

const JOIN_INVITE_CODE_TTL_MS = 30 * 60 * 1000

function getSkillUrl(): string {
  return `${getAppBaseUrl()}/join-skill.md`
}

function buildJoinPrompt(tgId: number, inviteCode: string): string {
  return `🦞 欢迎加入 OpenClaw 社群！

请将以下内容复制发送给你的 OpenClaw Agent：

---
请执行以下 skill 帮我加入 OpenClaw 社群：
${getSkillUrl()}

我的验证信息：
- tg_id: ${tgId}
- invite_code: ${inviteCode}
---

验证成功后，你将获得：
1. Telegram 群组邀请链接
2. 网站注册链接

请先完成验证，再使用返回的注册链接注册网站账号
（邀请码 30 分钟内有效）`
}

export async function handleStart(ctx: Context, prisma?: PrismaClient): Promise<void> {
  if (ctx.chat?.type !== 'private') return

  // Deep link: /start join → trigger join flow
  const payload = (ctx as any).match
  if (payload === 'join') {
    return handleJoin(ctx, prisma)
  }
  await ctx.reply(
    '🦞 欢迎来到 CryptoOpenClaw！\n\n' +
    '可用命令：\n' +
    '/join — 验证身份加入社群\n' +
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

  const existingMember = await prisma.member.findUnique({
    where: { tgId: String(tgId) },
    select: { id: true, accountId: true, inviteCode: true },
  })
  if (existingMember?.accountId) {
    await ctx.reply(`你已注册网站账号，请直接登录 ${getAppBaseUrl()}/login`)
    return
  }

  const pendingMember = existingMember?.accountId === null ? existingMember : null
  if (pendingMember?.inviteCode) {
    const pendingInvite = await prisma.inviteCode.findUnique({
      where: { code: pendingMember.inviteCode },
      select: { expiresAt: true },
    })
    if (pendingInvite && (!pendingInvite.expiresAt || pendingInvite.expiresAt >= new Date())) {
      await ctx.reply(buildJoinPrompt(tgId, pendingMember.inviteCode))
      return
    }
  }

  const expiresAt = new Date(Date.now() + JOIN_INVITE_CODE_TTL_MS)
  try {
    const code = await prisma.$transaction(async (tx) => {
      const nextCode = await createInviteCodeRecord(tx, { expiresAt })
      await tx.member.upsert({
        where: { tgId: String(tgId) },
        create: { tgId: String(tgId), accountId: null, inviteCode: nextCode },
        update: { inviteCode: nextCode },
      })
      return nextCode
    })
    await ctx.reply(buildJoinPrompt(tgId, code))
  } catch (error) {
    console.error('[handleJoin] transaction failed:', error)
    await ctx.reply('系统暂时不可用，请稍后再试')
  }
}

export async function handleMark(ctx: Context, prisma: PrismaClient): Promise<void> {
  const chatId = ctx.chat?.id
  const fromId = ctx.from?.id
  if (!chatId || !fromId) return

  // Check admin status first to avoid leaking command behavior to non-admins
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

  await ctx.reply('✅ 已标记为素材')
}

export function registerHandlers(bot: Bot, prisma: PrismaClient): void {
  bot.command('start', (ctx) => handleStart(ctx, prisma))
  bot.command('join', (ctx) => handleJoin(ctx, prisma))
  bot.command('chatid', async (ctx) => {
    await ctx.reply(`Chat ID: <code>${ctx.chat.id}</code>`, { parse_mode: 'HTML' })
  })
  bot.command('mark', (ctx) => handleMark(ctx, prisma))

  // Welcome new members joining the group
  bot.on('chat_member', async (ctx) => {
    const { old_chat_member, new_chat_member } = ctx.chatMember
    const wasOut = old_chat_member.status === 'left' || old_chat_member.status === 'kicked'
    const isIn = new_chat_member.status === 'member' || new_chat_member.status === 'administrator'
    if (wasOut && isIn) {
      const name = new_chat_member.user.first_name
      await ctx.reply(`🦞 欢迎 ${name} 加入 OpenClaw 社群！`)
    }
  })
}
