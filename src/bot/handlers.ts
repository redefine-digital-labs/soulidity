import crypto from 'node:crypto'
import type { Bot, Context } from 'grammy'
import { insertRawItem } from '../db/database.js'
import type { PrismaClient } from '../db/database.js'

const SKILL_URL = 'https://clawnews-mu.vercel.app/join-skill.md'

function generateInviteCode(): string {
  return crypto.randomBytes(4).toString('hex').toUpperCase()
}

function buildJoinPrompt(tgId: number, inviteCode: string): string {
  return `🦞 欢迎加入 OpenClaw 社群！

请将以下内容复制发送给你的 OpenClaw Agent：

---
请执行以下 skill 帮我加入 OpenClaw 社群：
${SKILL_URL}

我的验证信息：
- tg_id: ${tgId}
- invite_code: ${inviteCode}
---`
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
    await ctx.reply(buildJoinPrompt(tgId, 'NO_CODE'))
    return
  }

  const code = generateInviteCode()
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000)
  await prisma.inviteCode.create({ data: { code, expiresAt } })
  await ctx.reply(buildJoinPrompt(tgId, code))
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
