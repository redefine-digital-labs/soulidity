import { NextResponse } from 'next/server'
import { requireIdentity } from '@web/lib/auth/identity'
import { getMemberSuiWalletAddresses } from '@web/lib/auth/sui-wallet'
import { isMultipleSuiWalletBindingsError } from '@web/lib/auth/sui-wallet-errors'
import { requireDesktopIdentity } from '@web/lib/desktop/auth'
import { prisma } from '@web/lib/prisma'
import { sameSuiValue } from '@/lib/soulidity/queries'

export async function requireHumanWalletIdentity() {
  const { error, identity } = await requireIdentity()
  if (error) {
    return { error }
  }

  if (identity.kind !== 'human') {
    return {
      error: NextResponse.json({ error: 'Only human accounts can use the Soulidity market' }, { status: 403 }),
    }
  }

  let walletAddresses: string[]
  try {
    walletAddresses = await getMemberSuiWalletAddresses(identity.memberId)
  } catch (walletError) {
    if (isMultipleSuiWalletBindingsError(walletError)) {
      return { error: NextResponse.json({ error: walletError.message }, { status: 409 }) }
    }
    throw walletError
  }

  if (walletAddresses.length === 0) {
    return {
      error: NextResponse.json({ error: 'Bind a Sui wallet before using the Soulidity market' }, { status: 403 }),
    }
  }

  return {
    identity,
    walletAddresses,
  }
}

async function resolveHumanMemberIdForAccount(accountId: string) {
  const member = await prisma.member.findFirst({
    where: {
      accountId,
      kind: 'human',
    },
    orderBy: { joinedAt: 'asc' },
    select: { id: true },
  })

  return member?.id ?? null
}

export async function requireSoulCreateWalletIdentity(request: Request) {
  const auth = await requireDesktopIdentity(request)
  if (auth.error) {
    return { error: auth.error }
  }

  const memberId = auth.identity?.memberId ?? await resolveHumanMemberIdForAccount(auth.accountId!)
  if (!memberId) {
    return {
      error: NextResponse.json(
        { error: 'Only human accounts can use the Soulidity market' },
        { status: 403 },
      ),
    }
  }

  let walletAddresses: string[]
  try {
    walletAddresses = await getMemberSuiWalletAddresses(memberId)
  } catch (walletError) {
    if (isMultipleSuiWalletBindingsError(walletError)) {
      return { error: NextResponse.json({ error: walletError.message }, { status: 409 }) }
    }
    throw walletError
  }

  if (walletAddresses.length === 0) {
    return {
      error: NextResponse.json({ error: 'Bind a Sui wallet before using the Soulidity market' }, { status: 403 }),
    }
  }

  return {
    identity: {
      accountId: auth.accountId!,
      memberId,
      kind: 'human' as const,
    },
    walletAddresses,
    primarySuiAddress: walletAddresses[0] ?? null,
  }
}

export function assertTransactionSender(senderAddress: string | null, walletAddresses: string[]) {
  if (!senderAddress) {
    return NextResponse.json({ error: 'Transaction sender is missing from chain data' }, { status: 422 })
  }

  if (!walletAddresses.some((walletAddress) => sameSuiValue(walletAddress, senderAddress))) {
    return NextResponse.json({ error: 'Transaction sender does not match the signed-in wallet' }, { status: 403 })
  }

  return null
}
