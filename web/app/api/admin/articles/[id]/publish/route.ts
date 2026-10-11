import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { Bot } from 'grammy'
import { formatArticle } from '@/lib/formatter'
import { requireAdmin } from '@/lib/auth/require-admin'
import { syncArticleToPost } from '@shared/sync-article-post'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error } = await requireAdmin({ mutation: request })
  if (error) return error

  const { id } = await params

  const article = await prisma.article.findUnique({
    where: { id },
    include: {
      rawItem: { select: { url: true } },
      publications: { select: { id: true }, take: 1 },
    },
  })
  if (!article) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  if (article.status === 'published' || article.publications.length > 0) {
    return NextResponse.json({ error: 'Article is already published' }, { status: 409 })
  }

  const token = process.env.TG_BOT_TOKEN
  const channelId = process.env.TG_CHANNEL_ID
  if (!token || !channelId) {
    return NextResponse.json({ error: 'TG_BOT_TOKEN or TG_CHANNEL_ID not configured' }, { status: 500 })
  }

  // Atomically claim the article — prevents concurrent double-publish
  const claimed = await prisma.article.updateMany({
    where: { id, status: { not: 'published' } },
    data: { status: 'published' },
  })
  if (claimed.count === 0) {
    return NextResponse.json({ error: 'Article is already published' }, { status: 409 })
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
    const sent = await bot.api.sendMessage(channelId, text, { parse_mode: 'HTML' })
    messageId = String(sent.message_id)
  } catch (err) {
    // Revert status on TG failure
    await prisma.article.update({ where: { id }, data: { status: article.status } })
    return NextResponse.json({ error: `TG send failed: ${err instanceof Error ? err.message : err}` }, { status: 502 })
  }

  let pub
  try {
    pub = await prisma.publication.create({
      data: { articleId: id, channel: 'tg_daily', messageId, publishedAt: new Date() },
    })
  } catch (err) {
    // Do NOT revert article status — TG message is already sent.
    // Reverting would allow a retry that sends a duplicate Telegram post.
    // Keep status as 'published' so the idempotency guard blocks retries.
    return NextResponse.json(
      { error: `Publication record failed (TG message ${messageId} was sent): ${err instanceof Error ? err.message : err}` },
      { status: 500 },
    )
  }

  // Sync to community news post (awaited to avoid orphaned promises)
  let newsPostSynced = false
  try {
    const syncResult = await syncArticleToPost(prisma, id)
    newsPostSynced = syncResult.synced
  } catch (err) {
    console.error(`Failed to sync article ${id} to community post:`, err)
  }

  return NextResponse.json({ success: true, publication_id: pub.id, message_id: messageId, news_post_synced: newsPostSynced })
}
