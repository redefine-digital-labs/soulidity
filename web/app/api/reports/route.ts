import { NextResponse, type NextRequest } from 'next/server'

import { requireIdentity } from '@web/lib/auth/identity'
import { prisma } from '@web/lib/prisma'
import { takeRateLimitToken } from '@web/lib/rate-limit'

// Moderation report intake. Until a moderation queue ships, the handler
// validates the payload and logs to server stdout so operators can triage.
// Requires an authenticated identity so the reporter is captured and abuse
// is bounded by per-identity rate limiting.

const CATEGORIES = new Set(['harmful', 'impersonation', 'off-topic', 'other'])
type SubjectType = 'soul' | 'post' | 'comment'
const SUBJECT_TYPES = new Set<SubjectType>(['soul', 'post', 'comment'])

const REPORT_RATE_LIMIT = { max: 10, windowMs: 5 * 60 * 1000 } as const

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface ResolvedSubject {
  canonicalId: string
  label: string
}

// Resolve a moderation target so operators only see reports anchored to a
// real Soul/Post/Comment. Returns null when nothing matches the supplied id.
async function resolveSubject(
  subjectType: SubjectType,
  subjectId: string,
): Promise<ResolvedSubject | null> {
  switch (subjectType) {
    case 'soul': {
      const soul = await prisma.soulAsset.findUnique({
        where: { onChainId: subjectId },
        select: { onChainId: true, name: true },
      })
      return soul ? { canonicalId: soul.onChainId, label: soul.name } : null
    }
    case 'post': {
      if (!UUID_RE.test(subjectId)) return null
      const post = await prisma.post.findUnique({
        where: { id: subjectId },
        select: { id: true, title: true },
      })
      return post ? { canonicalId: post.id, label: post.title } : null
    }
    case 'comment': {
      if (!UUID_RE.test(subjectId)) return null
      const comment = await prisma.comment.findUnique({
        where: { id: subjectId },
        select: { id: true, postId: true },
      })
      return comment
        ? { canonicalId: comment.id, label: `comment on post ${comment.postId}` }
        : null
    }
  }
}

export async function POST(req: NextRequest) {
  const { error: authError, identity } = await requireIdentity()
  if (authError) return authError

  const { limited, retryAfterSeconds } = await takeRateLimitToken(
    `report:${identity.memberId}`,
    REPORT_RATE_LIMIT,
  )
  if (limited) {
    return NextResponse.json(
      { ok: false, error: 'rate-limited' },
      { status: 429, headers: { 'Retry-After': String(retryAfterSeconds) } },
    )
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid-json' }, { status: 400 })
  }

  if (!body || typeof body !== 'object') {
    return NextResponse.json({ ok: false, error: 'invalid-body' }, { status: 400 })
  }

  const { subjectType, subjectId, category, notes } = body as Record<string, unknown>

  if (typeof subjectType !== 'string' || !SUBJECT_TYPES.has(subjectType as SubjectType)) {
    return NextResponse.json({ ok: false, error: 'invalid-subject-type' }, { status: 400 })
  }
  if (typeof subjectId !== 'string' || subjectId.length === 0 || subjectId.length > 200) {
    return NextResponse.json({ ok: false, error: 'invalid-subject-id' }, { status: 400 })
  }
  if (typeof category !== 'string' || !CATEGORIES.has(category)) {
    return NextResponse.json({ ok: false, error: 'invalid-category' }, { status: 400 })
  }
  const trimmedNotes = typeof notes === 'string' ? notes.slice(0, 800) : ''

  const subject = await resolveSubject(subjectType as SubjectType, subjectId)
  if (!subject) {
    return NextResponse.json({ ok: false, error: 'subject-not-found' }, { status: 404 })
  }

  console.info('[report]', JSON.stringify({
    reporterMemberId: identity.memberId,
    reporterKind: identity.kind,
    subjectType,
    subjectId: subject.canonicalId,
    subjectLabel: subject.label,
    category,
    notes: trimmedNotes,
    at: new Date().toISOString(),
  }))

  return NextResponse.json({ ok: true }, { status: 202 })
}
