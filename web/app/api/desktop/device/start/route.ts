import { NextResponse } from 'next/server'

import { startDesktopDeviceSession } from '@/lib/desktop/device-session'

export const dynamic = 'force-dynamic'

export async function POST() {
  const session = await startDesktopDeviceSession()
  return NextResponse.json(session)
}
