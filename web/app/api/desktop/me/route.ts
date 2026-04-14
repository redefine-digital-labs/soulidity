import { NextResponse } from 'next/server'

import { requireDesktopIdentity } from '@/lib/desktop/auth'
import { getDesktopMe } from '@/lib/desktop/profile'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const auth = await requireDesktopIdentity(request)
  if (auth.error) {
    return auth.error
  }

  const response = await getDesktopMe(auth.accountId!)
  return NextResponse.json(response)
}
