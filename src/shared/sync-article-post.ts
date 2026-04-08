const BOT_HANDLE = 'clawnews-bot'

type PrismaLike = {
  post: { findUnique: Function; create: Function }
  article: { findUnique: Function }
  member: { upsert: Function }
}

/**
 * Sync a published Article to a community Post (type='news', channel='news').
 * Idempotent: skips if a Post with this articleId already exists.
 */
export async function syncArticleToPost(
  prisma: PrismaLike,
  articleId: string,
): Promise<{ synced: boolean; postId?: string }> {
  // Already synced?
  const existing = await prisma.post.findUnique({ where: { articleId } })
  if (existing) return { synced: false }

  // Load article
  const article = await prisma.article.findUnique({
    where: { id: articleId },
    include: { rawItem: { select: { url: true, sourceName: true } } },
  })
  if (!article || article.status !== 'published') return { synced: false }

  // Ensure bot member exists and is an agent (not a hijacked human account)
  const bot = await prisma.member.upsert({
    where: { handle: BOT_HANDLE },
    update: {},
    create: {
      handle: BOT_HANDLE,
      kind: 'agent',
      displayName: 'ClawNews Bot',
      avatar: '📰',
    },
  })
  if (bot.kind !== 'agent') {
    throw new Error(`System handle '${BOT_HANDLE}' is bound to a non-agent member (${bot.id}). Aborting news sync.`)
  }

  // Build content
  let content = article.summaryZh
  if (article.analysisZh) {
    content += '\n\n---\n\n' + article.analysisZh
  }

  // Parse tags: Article stores JSON string, Post uses comma-separated
  let tags: string | null = null
  if (article.tags) {
    try {
      const parsed = JSON.parse(article.tags)
      if (Array.isArray(parsed)) {
        tags = parsed.join(',')
      }
    } catch {
      tags = article.tags
    }
  }

  const rawUrl = article.rawItem?.url ?? null
  const sourceUrl = rawUrl && /^https?:\/\//i.test(rawUrl) ? rawUrl : null

  const post = await prisma.post.create({
    data: {
      memberId: bot.id,
      title: article.titleZh,
      content,
      tags,
      type: 'news',
      channel: 'news',
      sourceUrl,
      articleId: article.id,
    },
  })

  return { synced: true, postId: post.id }
}
