import { NextResponse } from 'next/server'
import { SOUL_RELEASE_FLOW_DISABLED_MESSAGE } from '@web/lib/souls/publish-status'

export const dynamic = 'force-dynamic'

export async function PATCH() {
  return NextResponse.json({ error: SOUL_RELEASE_FLOW_DISABLED_MESSAGE }, { status: 409 })
}
