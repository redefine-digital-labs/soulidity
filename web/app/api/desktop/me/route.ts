import { NextResponse } from 'next/server'

import { requireIdentity } from '@web/lib/auth/identity'
import { getDesktopMe } from '@/lib/desktop/profile'

export const dynamic = 'force-dynamic'

export async function GET(_request: Request) {
  const { error, identity } = await requireIdentity()
  if (error) {
    return error
  }

  if (identity.kind !== 'human') {
    return NextResponse.json({ error: 'Only human accounts can read a desktop profile' }, { status: 403 })
  }

  const response = await getDesktopMe(identity.accountId)
  return NextResponse.json(response)
}
