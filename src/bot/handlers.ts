import type { Bot, Context } from 'grammy'
import { insertRawItem } from '../db/database.js'
import type { PrismaClient } from '../db/database.js'

// TODO: Update to actual hosted URL once repo/file is published
const SKILL_URL = 'https://raw.githubusercontent.com/anthropics/claude-code/main/data/join-skill.md'

function buildJoinPrompt(tgId: number): string {
  return [
    '🦞 欢迎加入 OpenClaw 社群！',
    '',
    '请将以下内容复制发送给你的 OpenClaw Agent：',
    '',
    '---',
    '请执行以下 skill 帮我加入 OpenClaw 社群：',
    SKILL_URL,
    '',
    '我的验证信息：',
    `- tg_id: ${tgId}`,
    '- 请向我索要邀请码',
    '---',
  ].join('\n')
}

export async function handleStart(ctx: Context): Promise<void> {
  if (ctx.chat?.type !== 'private') return

  // Deep link: /start join → trigger join flow
  const payload = (ctx as any).match
  if (payload === 'join') {
    return handleJoin(ctx)
  }

  await ctx.reply(
    '🦞 欢迎来到 CryptoOpenClaw！\n\n' +
    '可用命令：\n' +
    '/join — 验证身份加入社群\n' +
    '/start — 显示本帮助'
  )
}

export async function handleJoin(ctx: Context): Promise<void> {
  if (ctx.chat?.type !== 'private') return
  const tgId = ctx.from?.id
  if (!tgId) return
  await ctx.reply(buildJoinPrompt(tgId))
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
  bot.command('start', handleStart)
  bot.command('join', handleJoin)
  bot.command('mark', (ctx) => handleMark(ctx, prisma))
}
