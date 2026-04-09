import { NextResponse } from 'next/server'

import { requireIdentity } from '@web/lib/auth/identity'
import {
  DesktopActivePersonaNotFoundError,
  setDesktopActivePersona,
} from '@/lib/desktop/profile'
import type { DesktopCatalogSourceType } from '@/lib/types/desktop'

export const dynamic = 'force-dynamic'

function normalizeSourceType(value: unknown): DesktopCatalogSourceType | null | 'invalid' {
  if (value == null) {
    return null
  }

  return value === 'starter' || value === 'soul' ? value : 'invalid'
}

function normalizeSourceRef(value: unknown): string | null | 'invalid' {
  if (value == null) {
    return null
  }

  if (typeof value !== 'string') {
    return 'invalid'
  }

  const normalized = value.trim()
  return normalized.length > 0 ? normalized : 'invalid'
}

export async function PUT(request: Request) {
  const { error, identity } = await requireIdentity()
  if (error) {
    return error
  }

  if (identity.kind !== 'human') {
    return NextResponse.json({ error: 'Only human accounts can sync a desktop active persona' }, { status: 403 })
  }

  let body: unknown

  try {
    body = await request.json()
  } catch {
    body = null
  }

  const sourceType = normalizeSourceType(
    body && typeof body === 'object' && 'sourceType' in body ? body.sourceType : null,
  )
  const sourceRef = normalizeSourceRef(
    body && typeof body === 'object' && 'sourceRef' in body ? body.sourceRef : null,
  )

  if (sourceType === 'invalid') {
    return NextResponse.json({ error: 'sourceType must be "starter" or "soul"' }, { status: 400 })
  }

  if (sourceRef === 'invalid') {
    return NextResponse.json({ error: 'sourceRef must be a non-empty string' }, { status: 400 })
  }

  if ((sourceType === null) !== (sourceRef === null)) {
    return NextResponse.json({ error: 'sourceType and sourceRef must both be provided' }, { status: 400 })
  }

  try {
    const response = await setDesktopActivePersona(identity.accountId, {
      sourceType,
      sourceRef,
    })

    return NextResponse.json(response)
  } catch (error) {
    if (error instanceof DesktopActivePersonaNotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 })
    }

    throw error
  }
}
