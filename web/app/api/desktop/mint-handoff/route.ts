import { randomBytes } from 'node:crypto'
import { NextResponse } from 'next/server'

import { prisma } from '@/lib/prisma'
import { requireDesktopIdentity } from '@/lib/desktop/auth'
import { takeRateLimitToken } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

const HANDOFF_TTL_MS = 5 * 60 * 1000 // 5 minutes
const MAX_PAYLOAD_BYTES = 5 * 1024 * 1024 // 5 MB hard cap; covers <=1MB cover + skills.zip
const TOKEN_PREFIX = 'mh_'

// Per-account mutation rate limit. Without this, a linked desktop token can
// loop near-5MB payloads at request speed and force the database to store one
// JSONB row per request for the full TTL window — turning the 5MB cap into a
// storage amplification primitive instead of an effective route bound. The
// bucket is keyed on the desktop account because pet rows already share an
// accountId and the row's accountId is the cleanup key.
const HANDOFF_RATE_LIMIT = { max: 10, windowMs: 60_000 }

interface HandoffPayload {
  name: string
  description: string
  tags: string[]
  royaltyBps: number
  soulMarkdown: string
  memoryMarkdown: string
  coverImageDataUrl: string
  coverImageFileName: string
  coverImageMimeType: string
  coverImagePrompt: string
  characterType: string
  extraDescription: string
  skillsArchive: {
    fileName: string
    mimeType: string
    dataBase64: string
  } | null
}

function fail(status: number, message: string) {
  return NextResponse.json({ error: message }, { status })
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string')
}

function validate(raw: unknown): HandoffPayload | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (typeof r.name !== 'string' || !r.name.trim()) return null
  if (typeof r.description !== 'string') return null
  if (!isStringArray(r.tags)) return null
  if (typeof r.royaltyBps !== 'number' || !Number.isFinite(r.royaltyBps)) return null
  if (typeof r.soulMarkdown !== 'string') return null
  if (typeof r.memoryMarkdown !== 'string') return null
  if (typeof r.coverImageDataUrl !== 'string') return null
  if (typeof r.coverImageFileName !== 'string') return null
  if (typeof r.coverImageMimeType !== 'string') return null
  if (typeof r.coverImagePrompt !== 'string') return null
  if (typeof r.characterType !== 'string') return null
  if (typeof r.extraDescription !== 'string') return null

  // Cover image is required: hand-off only makes sense once the user has
  // uploaded a real cover image (per product decision — desktop SVG placeholder
  // is dropped before the hand-off so the web side never has to surface a
  // throwaway cover that the user must immediately replace).
  if (!r.coverImageDataUrl.startsWith('data:') || r.coverImageMimeType === 'image/svg+xml') {
    return null
  }

  let skillsArchive: HandoffPayload['skillsArchive'] = null
  if (r.skillsArchive !== null && r.skillsArchive !== undefined) {
    const s = r.skillsArchive as Record<string, unknown>
    if (
      typeof s.fileName !== 'string'
      || typeof s.mimeType !== 'string'
      || typeof s.dataBase64 !== 'string'
    ) {
      return null
    }
    skillsArchive = {
      fileName: s.fileName,
      mimeType: s.mimeType,
      dataBase64: s.dataBase64,
    }
  }

  return {
    name: r.name,
    description: r.description,
    tags: r.tags,
    royaltyBps: Math.max(0, Math.min(2500, Math.round(r.royaltyBps))),
    soulMarkdown: r.soulMarkdown,
    memoryMarkdown: r.memoryMarkdown,
    coverImageDataUrl: r.coverImageDataUrl,
    coverImageFileName: r.coverImageFileName,
    coverImageMimeType: r.coverImageMimeType,
    coverImagePrompt: r.coverImagePrompt,
    characterType: r.characterType,
    extraDescription: r.extraDescription,
    skillsArchive,
  }
}

export async function POST(request: Request) {
  const auth = await requireDesktopIdentity(request, { mutation: true })
  if (auth.error) return auth.error

  // Per-account mutation rate limit. Runs before parsing or persisting so the
  // 5MB JSONB write path is unreachable in a tight loop, and fires after auth
  // so the bucket key is bound to the authenticated account instead of an
  // attacker-controlled header.
  const rateBucket = await takeRateLimitToken(
    `desktop-mint-handoff:${auth.accountId}`,
    HANDOFF_RATE_LIMIT,
  )
  if (rateBucket.limited) {
    return NextResponse.json(
      { error: 'Too many requests' },
      { status: 429, headers: { 'Retry-After': String(rateBucket.retryAfterSeconds) } },
    )
  }

  const contentLengthHeader = request.headers.get('content-length')
  if (contentLengthHeader) {
    const length = Number(contentLengthHeader)
    if (Number.isFinite(length) && length > MAX_PAYLOAD_BYTES) {
      return fail(413, 'Payload too large')
    }
  }

  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    return fail(400, 'Invalid JSON')
  }

  const payload = validate(raw)
  if (!payload) {
    return fail(400, 'Invalid hand-off payload')
  }

  // Enforce the 5MB cap on the validated payload too — content-length is a
  // client-supplied hint and request.json() will happily inflate a missing
  // header. Re-stringifying once is cheap relative to the DB write that
  // follows and gives us a deterministic gate.
  const serializedSize = Buffer.byteLength(JSON.stringify(payload), 'utf8')
  if (serializedSize > MAX_PAYLOAD_BYTES) {
    return fail(413, 'Payload too large')
  }

  const token = `${TOKEN_PREFIX}${randomBytes(32).toString('hex')}`
  const now = Date.now()
  const expiresAt = new Date(now + HANDOFF_TTL_MS)

  // Single-active-handoff per account: drop every prior row (expired,
  // consumed, or live) before inserting the new one. Only the most recent
  // unexpired row is meaningful for a hand-off, so superseding it is
  // semantically correct and prevents the storage-amplification path even if
  // the rate limit is bypassed by a fallback. Failure here must not block the
  // new hand-off — the read path still gates on `expires_at`/`consumed_at`.
  try {
    await prisma.desktopMintHandoff.deleteMany({
      where: { accountId: auth.accountId },
    })
  } catch {
    /* swallow — cleanup is opportunistic */
  }

  const row = await prisma.desktopMintHandoff.create({
    data: {
      token,
      accountId: auth.accountId,
      payload: payload as unknown as object,
      expiresAt,
    },
    select: { token: true, expiresAt: true },
  })

  return NextResponse.json({ token: row.token, expiresAt: row.expiresAt.toISOString() })
}
