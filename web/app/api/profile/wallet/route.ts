import { NextResponse } from 'next/server'

import { requireMutationIdentity } from '@/lib/auth/identity'
import { getMemberPrimarySuiWalletAddress } from '@/lib/auth/sui-wallet'

export const dynamic = 'force-dynamic'

// Returns the primary Sui wallet bound to the current human member. Wallet
// bindings are now established at wallet-login time; this route exists for
// clients that want to read or refresh the bound address.
export async function POST(request: Request) {
  const { error, identity } = await requireMutationIdentity(request)
  if (error) return error

  if (identity.kind !== 'human') {
    return NextResponse.json({ error: 'Only human accounts can link wallets' }, { status: 403 })
  }

  const primarySuiAddress = await getMemberPrimarySuiWalletAddress(identity.memberId)
  if (!primarySuiAddress) {
    return NextResponse.json(
      { error: 'No Sui wallet bound to this account. Sign in with a wallet to link one.' },
      { status: 409 },
    )
  }

  return NextResponse.json({ primarySuiAddress })
}
