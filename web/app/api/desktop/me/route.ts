import { NextResponse } from 'next/server'

import { requireDesktopIdentity } from '@/lib/desktop/auth'
import { DesktopPetNotFoundError, getDesktopMe } from '@/lib/desktop/profile'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const auth = await requireDesktopIdentity(request)
  if (auth.error) {
    return auth.error
  }

  if (!auth.desktopPet) {
    return NextResponse.json({ error: 'Desktop pet identity required' }, { status: 403 })
  }

  try {
    const response = await getDesktopMe({
      accountId: auth.accountId,
      desktopPetId: auth.desktopPet.id,
    })
    return NextResponse.json(response)
  } catch (error) {
    if (error instanceof DesktopPetNotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 })
    }
    throw error
  }
}
