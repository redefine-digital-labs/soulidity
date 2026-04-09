import { NextResponse } from 'next/server'

import { getDesktopMe } from '@/lib/desktop/profile'
import { requireDesktopAccountAccess } from '@/lib/desktop/request-auth'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const { accountId, error } = await requireDesktopAccountAccess(request)
  if (error) {
    return error
  }

  const response = await getDesktopMe(accountId)
  return NextResponse.json(response)
}
