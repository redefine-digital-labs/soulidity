import { NextResponse } from 'next/server'

import { pollDesktopDeviceSession } from '@/lib/desktop/device-session'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  let body: unknown

  try {
    body = await request.json()
  } catch {
    body = null
  }

  const deviceCode = body && typeof body === 'object' && 'deviceCode' in body && typeof body.deviceCode === 'string'
    ? body.deviceCode.trim()
    : ''

  if (!deviceCode) {
    return NextResponse.json({ error: 'deviceCode is required' }, { status: 400 })
  }

  const response = await pollDesktopDeviceSession(deviceCode)
  return NextResponse.json(response)
}
