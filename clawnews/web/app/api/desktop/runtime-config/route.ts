import { NextResponse } from 'next/server'

import { getDesktopRuntimeConfig } from '@/lib/desktop/runtime-config'

export const dynamic = 'force-dynamic'

export async function GET() {
  return NextResponse.json(getDesktopRuntimeConfig())
}
