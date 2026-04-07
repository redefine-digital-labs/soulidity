import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@web/lib/prisma'
import { requireIdentity } from '@web/lib/auth/identity'
import { takeRateLimitToken } from '@web/lib/rate-limit'

const PROFILE_RATE_LIMIT = { max: 10, windowMs: 5 * 60 * 1000 } as const
const HANDLE_RE = /^[a-zA-Z0-9_]{3,30}$/
const ALLOWED_AVATARS = new Set(['🤖', '🦊', '👻', '📊', '💬', '⚙️', '🌸', '⚡'])

function isValidUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

export async function PATCH(request: NextRequest) {
  const { error, identity } = await requireIdentity()
  if (error) return error

  if (identity.kind !== 'human') {
    return NextResponse.json({ error: 'Only human accounts can update profile' }, { status: 403 })
  }

  const { limited, retryAfterSeconds } = await takeRateLimitToken(
    `profile-update:${identity.memberId}`,
    PROFILE_RATE_LIMIT,
  )
  if (limited) {
    return NextResponse.json(
      { error: 'Too many profile updates, try again later' },
      { status: 429, headers: { 'Retry-After': String(retryAfterSeconds) } },
    )
  }

  const body = await request.json()
  const updates: Record<string, string | null> = {}
  const errors: string[] = []

  // displayName
  if (body.displayName !== undefined) {
    if (body.displayName === null || body.displayName === '') {
      updates.displayName = null
    } else if (typeof body.displayName !== 'string' || body.displayName.trim().length === 0 || body.displayName.trim().length > 50) {
      errors.push('displayName must be 1-50 characters')
    } else {
      updates.displayName = body.displayName.trim()
    }
  }

  // avatar (emoji — restricted to allowed set)
  if (body.avatar !== undefined) {
    if (body.avatar === null || body.avatar === '') {
      updates.avatar = null
    } else if (typeof body.avatar !== 'string' || !ALLOWED_AVATARS.has(body.avatar)) {
      errors.push('avatar must be one of the allowed emojis')
    } else {
      updates.avatar = body.avatar
    }
  }

  // bio
  if (body.bio !== undefined) {
    if (body.bio === null || body.bio === '') {
      updates.bio = null
    } else if (typeof body.bio !== 'string' || body.bio.trim().length > 160) {
      errors.push('bio must be at most 160 characters')
    } else {
      updates.bio = body.bio.trim()
    }
  }

  // handle
  if (body.handle !== undefined) {
    if (body.handle === null || body.handle === '') {
      updates.handle = null
    } else if (typeof body.handle !== 'string' || !HANDLE_RE.test(body.handle)) {
      errors.push('handle must be 3-30 alphanumeric/underscore characters')
    } else {
      updates.handle = body.handle.toLowerCase()
    }
  }

  // twitterUrl
  if (body.twitterUrl !== undefined) {
    if (body.twitterUrl === null || body.twitterUrl === '') {
      updates.twitterUrl = null
    } else if (typeof body.twitterUrl !== 'string' || !isValidUrl(body.twitterUrl)) {
      errors.push('twitterUrl must be a valid URL')
    } else {
      updates.twitterUrl = body.twitterUrl.trim()
    }
  }

  // websiteUrl
  if (body.websiteUrl !== undefined) {
    if (body.websiteUrl === null || body.websiteUrl === '') {
      updates.websiteUrl = null
    } else if (typeof body.websiteUrl !== 'string' || !isValidUrl(body.websiteUrl)) {
      errors.push('websiteUrl must be a valid URL')
    } else {
      updates.websiteUrl = body.websiteUrl.trim()
    }
  }

  if (errors.length > 0) {
    return NextResponse.json({ error: errors.join('; ') }, { status: 400 })
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No fields to update' }, { status: 400 })
  }

  try {
    const member = await prisma.member.update({
      where: { id: identity.memberId },
      data: updates,
      select: {
        id: true,
        displayName: true,
        avatar: true,
        bio: true,
        handle: true,
        twitterUrl: true,
        websiteUrl: true,
      },
    })
    return NextResponse.json(member)
  } catch (err) {
    // Handle unique constraint violation (handle taken)
    if (typeof err === 'object' && err !== null && 'code' in err && (err as { code: string }).code === 'P2002') {
      return NextResponse.json({ error: 'This handle is already taken' }, { status: 409 })
    }
    throw err
  }
}
