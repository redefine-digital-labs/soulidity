import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@web/lib/prisma'
import { Bot } from 'grammy'
import { formatArticle } from '@web/lib/formatter'

export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const article = await prisma.article.findUnique({
    where: { id },
    include: {
      rawItem: { select: { url: true } },
    },
  })
  if (!article) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const token = process.env.TG_BOT_TOKEN
  const channelId = process.env.TG_CHANNEL_ID
  if (!token || !channelId) {
    return NextResponse.json({ error: 'TG_BOT_TOKEN or TG_CHANNEL_ID not configured' }, { status: 500 })
  }

  const text = formatArticle({
    title_zh: article.titleZh,
    summary_zh: article.summaryZh,
    analysis_zh: article.analysisZh ?? null,
    source_url: article.rawItem?.url ?? '',
  })

  let messageId: string
  try {
    const bot = new Bot(token)
    const sent = await bot.api.sendMessage(channelId, text)
    messageId = String(sent.message_id)
  } catch (err) {
    return NextResponse.json({ error: `TG send failed: ${err instanceof Error ? err.message : err}` }, { status: 502 })
  }

  await prisma.article.update({ where: { id }, data: { status: 'published' } })
  const pub = await prisma.publication.create({
    data: { articleId: id, channel: 'tg_daily', messageId, publishedAt: new Date() },
  })

  return NextResponse.json({ success: true, publication_id: pub.id, message_id: messageId })
}
