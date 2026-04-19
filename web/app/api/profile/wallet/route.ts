import { NextResponse } from 'next/server'

import { requireIdentity, syncHumanMemberSuiWallet } from '@web/lib/auth/identity'

export const dynamic = 'force-dynamic'

export async function POST(_request: Request) {
  const { error, identity } = await requireIdentity()
  if (error) return error

  if (identity.kind !== 'human') {
    return NextResponse.json({ error: 'Only human accounts can link wallets' }, { status: 403 })
  }

  const primarySuiAddress = await syncHumanMemberSuiWallet(identity.accountId, identity.memberId)
  if (!primarySuiAddress) {
    return NextResponse.json(
      { error: 'Unable to provision a Sui wallet for this account yet. Please try again.' },
      { status: 409 },
    )
  }

  return NextResponse.json({ primarySuiAddress })
}
