import { NextResponse } from 'next/server'
import { requireIdentity } from '@web/lib/auth/identity'
import { SOUL_RELEASE_DISABLED_MESSAGE } from '@web/lib/souls/publish-status'

export async function POST() {
  const { error } = await requireIdentity()
  if (error) return error

  return NextResponse.json({ error: SOUL_RELEASE_DISABLED_MESSAGE }, { status: 409 })
}
