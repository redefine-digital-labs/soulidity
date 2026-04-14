import { NextResponse } from 'next/server'

import { requireDesktopIdentity } from '@web/lib/desktop/auth'
import {
  createDesktopPrivyCustomAuthToken,
  getDesktopPrivyCustomAuthState,
} from '@/lib/desktop/privy-custom-auth'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const auth = await requireDesktopIdentity(request)
  if (auth.error) {
    return auth.error
  }

  try {
    const state = await getDesktopPrivyCustomAuthState(auth.accountId!)
    if (!state.ok) {
      return NextResponse.json({ error: state.error }, { status: 409 })
    }

    if (!state.alreadyLinked && !auth.identity) {
      return NextResponse.json(
        { error: 'Desktop wallet auth is not linked yet. Re-link this device from the web app first.' },
        { status: 409 },
      )
    }

    const jwt = await createDesktopPrivyCustomAuthToken(auth.accountId!)

    return NextResponse.json({
      jwt,
      alreadyLinked: state.alreadyLinked,
    })
  } catch (error) {
    console.error('[desktop-privy-token] Failed to mint desktop custom auth JWT', {
      accountId: auth.accountId,
      error,
    })
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to create desktop wallet auth token' },
      { status: 500 },
    )
  }
}
