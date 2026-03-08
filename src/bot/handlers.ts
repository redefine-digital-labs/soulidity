import type { Context } from 'grammy'

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

export async function handleJoin(ctx: Context): Promise<void> {
  if (ctx.chat?.type !== 'private') return
  const tgId = ctx.from?.id
  if (!tgId) return
  await ctx.reply(buildJoinPrompt(tgId))
}
