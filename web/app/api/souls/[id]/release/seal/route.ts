import { NextResponse } from 'next/server'
import { requireIdentity } from '@web/lib/auth/identity'
import { SOUL_RELEASE_FLOW_DISABLED_MESSAGE } from '@web/lib/souls/publish-status'

export const dynamic = 'force-dynamic'

export async function PATCH() {
  const { error } = await requireIdentity()
  if (error) return error
  // Re-enablement checklist:
  // 1. Verify the submitted tx digest and mutated release object on chain.
  // 2. Verify sender wallet / author ownership against the Soul series on chain.
  // 3. Verify the release mutation came from the expected Soul package.
  // 4. Add route-specific rate limiting before any DB or chain work.
  return NextResponse.json({ error: SOUL_RELEASE_FLOW_DISABLED_MESSAGE }, { status: 409 })
}
