import { prisma } from '@/lib/prisma'
import { normalizeSuiWalletAddress } from '@/lib/auth/challenge'
import { consumeWalletChallengeForPurpose } from '@/lib/auth/wallet-challenge'
import { isUniqueConstraintError } from '@shared/prisma-errors'
import { allocateUniqueHandle, resolveHandleSeed } from '@/lib/handle'
import { captureServerEvent, captureServerException } from '@/lib/observability/posthog-server'

export type WalletLoginErrorReason =
  | 'invalid_address'
  | 'invalid_nonce'
  | 'challenge_not_found'
  | 'challenge_expired'
  | 'challenge_used'
  | 'address_mismatch'
  | 'domain_missing'
  | 'signature_invalid'
  | 'signer_mismatch'
  | 'wallet_bound_elsewhere'
  | 'tg_attach_failed'

export class WalletLoginError extends Error {
  constructor(public readonly reason: WalletLoginErrorReason, message?: string) {
    super(message ?? reason)
    this.name = 'WalletLoginError'
  }
}

export interface WalletLoginInput {
  address: string
  signature: string
  nonce: string
  /**
   * Optional verified Telegram context. When set, the login will attach the
   * wallet to the existing tgId account/member instead of creating a fresh
   * wallet-owned account. Only callers that have already verified the TG
   * identity (e.g. via signed bot link) should pass this.
   */
  verifiedTgContext?: {
    tgId: string
    tgName?: string | null
  }
}

export interface WalletLoginResult {
  accountId: string
  memberId: string
  walletAddress: string
}

export async function loginWithWalletSignature(
  input: WalletLoginInput,
): Promise<WalletLoginResult> {
  const startedAt = Date.now()
  const distinctId = normalizeSuiWalletAddress(input.address) ?? 'anonymous'
  captureServerEvent('wallet_login_started', {
    distinctId,
    properties: { hasTgContext: Boolean(input.verifiedTgContext?.tgId) },
  })
  try {
    const result = await loginWithWalletSignatureImpl(input)
    captureServerEvent('wallet_login_succeeded', {
      distinctId: result.memberId,
      properties: {
        walletAddress: result.walletAddress,
        elapsedMs: Date.now() - startedAt,
      },
    })
    return result
  } catch (err) {
    if (err instanceof WalletLoginError) {
      captureServerEvent('wallet_login_failed', {
        distinctId,
        properties: {
          errorReason: err.reason,
          elapsedMs: Date.now() - startedAt,
        },
      })
    } else {
      captureServerException(err, {
        distinctId,
        properties: {
          scope: 'wallet_login',
          elapsedMs: Date.now() - startedAt,
        },
      })
    }
    throw err
  }
}

async function loginWithWalletSignatureImpl(
  input: WalletLoginInput,
): Promise<WalletLoginResult> {
  const normalizedAddress = normalizeSuiWalletAddress(input.address)
  if (!normalizedAddress) {
    throw new WalletLoginError('invalid_address')
  }

  // zkLogin signatures (base64-encoded JWT + proof + ephemeral key + sig) routinely
  // exceed 2KB; cap is to bound DB / verify cost, not protocol-correct length.
  if (input.signature.length === 0 || input.signature.length > 8192) {
    throw new WalletLoginError('signature_invalid')
  }

  const consumeResult = await consumeWalletChallengeForPurpose({
    nonce: input.nonce,
    address: normalizedAddress,
    purpose: 'login',
    signature: input.signature,
  })
  if (!consumeResult.ok) {
    if (consumeResult.reason === 'signature_invalid') {
      console.error('[wallet-login] verify failed', {
        addr: normalizedAddress,
        sigPrefix: input.signature.slice(0, 8),
        sigLen: input.signature.length,
        ...(consumeResult.cause ? { cause: consumeResult.cause } : {}),
      })
    }
    // `challenge_purpose_mismatch` is functionally indistinguishable from
    // `challenge_not_found` for a confused caller — collapse it to keep the
    // existing WalletLoginError union surface stable.
    const reason = consumeResult.reason === 'challenge_purpose_mismatch'
      ? 'challenge_not_found'
      : consumeResult.reason
    throw new WalletLoginError(reason)
  }

  // Lookup #1 — wallet binding (most common path, user already exists)
  const existingBinding = await prisma.walletBinding.findUnique({
    where: { chain_address: { chain: 'sui', address: normalizedAddress } },
    select: {
      member: {
        select: { id: true, accountId: true, kind: true },
      },
    },
  })
  if (existingBinding?.member?.accountId && existingBinding.member.kind === 'human') {
    return {
      accountId: existingBinding.member.accountId,
      memberId: existingBinding.member.id,
      walletAddress: normalizedAddress,
    }
  }
  if (existingBinding?.member?.kind === 'agent') {
    throw new WalletLoginError('wallet_bound_elsewhere', 'Wallet is bound to an agent member')
  }

  // Lookup #2 — denormalized walletAddress on Account
  const accountByAddress = await prisma.account.findUnique({
    where: { walletAddress: normalizedAddress },
    select: {
      id: true,
      members: {
        where: { kind: 'human' },
        select: { id: true },
        orderBy: { joinedAt: 'asc' },
        take: 1,
      },
    },
  })
  if (accountByAddress?.members[0]) {
    await ensureWalletBinding(accountByAddress.members[0].id, normalizedAddress)
    return {
      accountId: accountByAddress.id,
      memberId: accountByAddress.members[0].id,
      walletAddress: normalizedAddress,
    }
  }

  // Optional TG-attach branch
  const tgContext = input.verifiedTgContext
  if (tgContext?.tgId) {
    const tgAccount = await prisma.account.findUnique({
      where: { tgId: tgContext.tgId },
      select: {
        id: true,
        walletAddress: true,
        tgName: true,
        members: {
          where: { kind: 'human' },
          select: { id: true },
          orderBy: { joinedAt: 'asc' },
          take: 1,
        },
      },
    })

    if (tgAccount) {
      if (tgAccount.walletAddress && tgAccount.walletAddress !== normalizedAddress) {
        throw new WalletLoginError(
          'wallet_bound_elsewhere',
          'This Telegram account is already linked to a different wallet',
        )
      }

      const member = tgAccount.members[0] ?? await createMemberForAccount(tgAccount.id, {
        tgName: tgContext.tgName ?? tgAccount.tgName ?? null,
      })
      await Promise.all([
        prisma.account.update({
          where: { id: tgAccount.id },
          data: {
            walletAddress: normalizedAddress,
            ...(tgContext.tgName && tgAccount.tgName !== tgContext.tgName ? { tgName: tgContext.tgName } : {}),
          },
        }),
        ensureWalletBinding(member.id, normalizedAddress),
      ])
      return {
        accountId: tgAccount.id,
        memberId: member.id,
        walletAddress: normalizedAddress,
      }
    }

    // No tgAccount yet — try a pending member that was bot-bound earlier
    const pendingMember = await prisma.member.findFirst({
      where: { tgId: tgContext.tgId, kind: 'human', accountId: null },
      select: { id: true, handle: true, displayName: true, tgName: true },
    })
    if (pendingMember) {
      return await prisma.$transaction(async (tx) => {
        const account = await tx.account.create({
          data: {
            walletAddress: normalizedAddress,
            tgId: tgContext.tgId,
            tgName: tgContext.tgName ?? pendingMember.tgName ?? null,
          },
        })
        const handleSeed = resolveHandleSeed({
          displayName: pendingMember.displayName,
          tgName: pendingMember.tgName ?? tgContext.tgName ?? null,
        })
        const handle = pendingMember.handle
          ?? await allocateUniqueHandle(handleSeed, pendingMember.id, async (candidate) => {
            const existing = await tx.member.findUnique({ where: { handle: candidate }, select: { id: true } })
            return !!existing
          })
        await tx.member.update({
          where: { id: pendingMember.id },
          data: { accountId: account.id, handle },
        })
        await tx.walletBinding.create({
          data: { memberId: pendingMember.id, chain: 'sui', address: normalizedAddress, isPrimary: true },
        })
        return {
          accountId: account.id,
          memberId: pendingMember.id,
          walletAddress: normalizedAddress,
        }
      })
    }
  }

  // Default — create a fresh wallet-owned account + human member
  return await prisma.$transaction(async (tx) => {
    const accountData: { walletAddress: string; tgId?: string; tgName?: string } = {
      walletAddress: normalizedAddress,
    }
    if (tgContext?.tgId) accountData.tgId = tgContext.tgId
    if (tgContext?.tgName) accountData.tgName = tgContext.tgName

    let account: { id: string }
    try {
      account = await tx.account.create({ data: accountData })
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        // Race condition — another concurrent login created the account
        const conflict = await tx.account.findUnique({
          where: { walletAddress: normalizedAddress },
          select: {
            id: true,
            members: {
              where: { kind: 'human' },
              select: { id: true },
              orderBy: { joinedAt: 'asc' },
              take: 1,
            },
          },
        })
        if (conflict?.members[0]) {
          await ensureWalletBindingTx(tx, conflict.members[0].id, normalizedAddress)
          return {
            accountId: conflict.id,
            memberId: conflict.members[0].id,
            walletAddress: normalizedAddress,
          }
        }
      }
      throw error
    }

    const provisional = await tx.member.create({
      data: { accountId: account.id, kind: 'human' },
      select: { id: true },
    })
    const handleSeed = resolveHandleSeed({ tgName: tgContext?.tgName ?? null })
    const handle = await allocateUniqueHandle(handleSeed, provisional.id, async (candidate) => {
      const existing = await tx.member.findUnique({ where: { handle: candidate }, select: { id: true } })
      return !!existing
    })
    await tx.member.update({ where: { id: provisional.id }, data: { handle } })

    await tx.walletBinding.create({
      data: { memberId: provisional.id, chain: 'sui', address: normalizedAddress, isPrimary: true },
    })

    return {
      accountId: account.id,
      memberId: provisional.id,
      walletAddress: normalizedAddress,
    }
  })
}

async function ensureWalletBinding(memberId: string, address: string): Promise<void> {
  return ensureWalletBindingTx(prisma, memberId, address)
}

async function ensureWalletBindingTx(
  client: { walletBinding: typeof prisma.walletBinding },
  memberId: string,
  address: string,
): Promise<void> {
  const existing = await client.walletBinding.findFirst({
    where: { memberId, chain: 'sui' },
    select: { id: true, address: true },
  })
  if (existing && existing.address === address) return

  if (existing) {
    // Member already has a binding to a different address — we don't auto-replace.
    // Single-wallet-per-chain DB constraint prevents creating a second binding.
    throw new WalletLoginError(
      'wallet_bound_elsewhere',
      'Member already has a different Sui wallet bound',
    )
  }

  try {
    await client.walletBinding.create({
      data: { memberId, chain: 'sui', address, isPrimary: true },
    })
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw new WalletLoginError('wallet_bound_elsewhere')
    }
    throw error
  }
}

async function createMemberForAccount(
  accountId: string,
  options: { tgName?: string | null },
): Promise<{ id: string }> {
  return prisma.$transaction(async (tx) => {
    const provisional = await tx.member.create({
      data: { accountId, kind: 'human' },
      select: { id: true },
    })
    const handleSeed = resolveHandleSeed({ tgName: options.tgName ?? null })
    const handle = await allocateUniqueHandle(handleSeed, provisional.id, async (candidate) => {
      const existing = await tx.member.findUnique({ where: { handle: candidate }, select: { id: true } })
      return !!existing
    })
    await tx.member.update({ where: { id: provisional.id }, data: { handle } })
    return provisional
  })
}
