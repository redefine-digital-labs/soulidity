import { NextResponse } from 'next/server'

import { requireIdentity } from '@/lib/auth/identity'
import {
  completeDesktopDeviceSession,
  DesktopDeviceSessionConflictError,
} from '@/lib/desktop/device-session'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  let body: unknown

  try {
    body = await request.json()
  } catch {
    body = null
  }

  const userCode = body && typeof body === 'object' && 'userCode' in body && typeof body.userCode === 'string'
    ? body.userCode.trim().toUpperCase()
    : ''

  if (!userCode) {
    return NextResponse.json({ error: 'userCode is required' }, { status: 400 })
  }

  const { error, identity } = await requireIdentity()
  if (error) {
    return error
  }

  if (identity.kind !== 'human') {
    return NextResponse.json({ error: 'Only human accounts can confirm a desktop device' }, { status: 403 })
  }

  try {
    const result = await completeDesktopDeviceSession(userCode, identity.accountId)

    if (result.status === 'invalid_code') {
      return NextResponse.json(result, { status: 404 })
    }

    if (result.status === 'expired') {
      return NextResponse.json(result, { status: 410 })
    }

    // Strip desktop-only credentials from the browser response.
    // The desktop receives the bearer token through the poll channel instead.
    const { desktopAccessToken: _token, deviceCode: _code, ...browserResult } = result
    return NextResponse.json(browserResult)
  } catch (error) {
    if (error instanceof DesktopDeviceSessionConflictError) {
      return NextResponse.json({ error: error.message }, { status: 409 })
    }

    throw error
  }
}
