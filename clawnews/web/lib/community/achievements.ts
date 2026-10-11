import { prisma } from '@/lib/prisma'

/**
 * Evaluate and auto-award achievements for a member.
 * Called after post creation and other qualifying events.
 * Skips achievements with condition 'manual'.
 */
export async function evaluateAchievements(memberId: string): Promise<string[]> {
  const [achievements, existing, stats] = await Promise.all([
    prisma.achievement.findMany(),
    prisma.memberAchievement.findMany({
      where: { memberId },
      select: { achievementId: true },
    }),
    prisma.member.findUnique({
      where: { id: memberId },
      select: {
        _count: { select: { posts: true, comments: true } },
        posts: {
          where: { status: 'published' },
          orderBy: { createdAt: 'desc' },
          select: { createdAt: true },
        },
        comments: {
          where: { isAccepted: true },
          select: { id: true },
        },
      },
    }),
  ])

  if (!stats) return []

  const earnedIds = new Set(existing.map(e => e.achievementId))
  const postCount = stats._count.posts
  const commentCount = stats._count.comments
  const acceptedCommentCount = stats.comments.length
  const streak = calculateStreak(stats.posts.map(p => p.createdAt))

  const awarded: string[] = []

  for (const ach of achievements) {
    if (earnedIds.has(ach.id)) continue
    if (!ach.condition || ach.condition === 'manual') continue

    const qualified = evaluateCondition(ach.condition, {
      posts: postCount,
      comments: commentCount,
      accepted_comments: acceptedCommentCount,
      streak,
    })

    if (qualified) {
      try {
        await prisma.memberAchievement.create({
          data: { memberId, achievementId: ach.id },
        })
        awarded.push(ach.name)
      } catch {
        // Already earned (race condition), ignore
      }
    }
  }

  return awarded
}

function evaluateCondition(
  condition: string,
  ctx: { posts: number; comments: number; accepted_comments: number; streak: number },
): boolean {
  // Supported formats: "field >= N" or "field > N"
  const match = condition.match(/^(\w+)\s*(>=|>)\s*(\d+)$/)
  if (!match) return false

  const [, field, op, valueStr] = match
  const threshold = parseInt(valueStr, 10)

  const values: Record<string, number> = {
    posts: ctx.posts,
    comments: ctx.comments,
    accepted_comments: ctx.accepted_comments,
    streak: ctx.streak,
  }

  const actual = values[field]
  if (actual === undefined) return false

  return op === '>=' ? actual >= threshold : actual > threshold
}

/**
 * Calculate current consecutive-day streak from post dates.
 * A streak counts days with at least one post, going backwards from today.
 */
function calculateStreak(dates: Date[]): number {
  if (dates.length === 0) return 0

  const daySet = new Set(
    dates.map(d => {
      const local = new Date(d)
      return `${local.getFullYear()}-${local.getMonth()}-${local.getDate()}`
    }),
  )

  let streak = 0
  const now = new Date()

  for (let i = 0; i < 365; i++) {
    const check = new Date(now)
    check.setDate(check.getDate() - i)
    const key = `${check.getFullYear()}-${check.getMonth()}-${check.getDate()}`
    if (daySet.has(key)) {
      streak++
    } else if (i > 0) {
      // Allow today to not have a post yet (streak still alive from yesterday)
      break
    }
  }

  return streak
}
