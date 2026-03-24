import { NextResponse } from 'next/server'

import { prisma } from '@web/lib/prisma'
import {
  buildChallengeMessage,
  getTrustedAppDomain,
  normalizeSuiWalletAddress,
} from '@web/lib/auth/challenge'
import { isUuid } from '@web/lib/is-uuid'
import { getRequestHeaders } from '@web/lib/request-headers'
import { getRequestIp, takeRateLimitToken } from '@web/lib/rate-limit'
import { verifyPersonalMessageSignature } from '@web/lib/sui-verify'
import {
  getSuiWalletSyncCacheEntry,
  SUI_WALLET_SYNC_IN_FLIGHT_TIMEOUT_MS,
  setSuiWalletSyncCacheEntry,
  SUI_WALLET_SYNC_TTL_MS,
} from '@web/lib/auth/sui-wallet-sync-cache'

import { privy } from './privy'
import { resolveAgentByApiKey } from './resolve-agent'
import { isUniqueConstraintError } from '@shared/prisma-errors'

export interface Identity {
  accountId: string
  memberId: string
  ownerMemberId?: string
  kind: 'human' | 'agent'
}

type HumanAccountLookup = { privyDid: string } | { tgId: string } | { email: string }

type HumanAccountIdentityRecord = {
  id: string
  privyDid: string | null
  tgName: string | null
  email: string | null
  members: Array<{
    id: string
    kind: string
  }>
}

type PrivyUserWithLinkedAccounts = {
  linkedAccounts: Array<{
    type: string
    chainType?: string
    address?: string
  }>
}

const WALLET_IDENTITY_RATE_LIMIT = {
  max: 10,
  windowMs: 60 * 1000,
} as const

async function findHumanAccount(where: HumanAccountLookup): Promise<HumanAccountIdentityRecord | null> {
  return prisma.account.findUnique({
    where,
    include: {
      members: {
        where: { kind: 'human' },
        select: { id: true, kind: true },
        orderBy: { joinedAt: 'asc' },
        take: 1,
      },
    },
  })
}

function toHumanIdentity(account: HumanAccountIdentityRecord): Identity | null {
  const member = account.members[0]
  if (!member) {
    return null
  }

  return {
    accountId: account.id,
    memberId: member.id,
    kind: 'human',
  }
}

function getSuiWalletAddress(user: PrivyUserWithLinkedAccounts): string | null {
  const wallet = user.linkedAccounts.find(
    (account): account is PrivyUserWithLinkedAccounts['linkedAccounts'][number] & {
      type: 'wallet'
      chainType: 'sui'
      address: string
    } =>
      account.type === 'wallet'
      && account.chainType === 'sui'
      && typeof account.address === 'string'
      && account.address.length > 0,
  )

  return normalizeSuiWalletAddress(wallet?.address)
}

function redactWalletAddress(address: string): string {
  if (address.length <= 14) {
    return address
  }

  return `${address.slice(0, 10)}...${address.slice(-4)}`
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null

  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(new Error(message))
        }, timeoutMs)
      }),
    ])
  } finally {
    if (timeoutId != null) {
      clearTimeout(timeoutId)
    }
  }
}

async function ensureCanonicalSuiWalletBinding(memberId: string): Promise<boolean> {
  const existingBinding = await prisma.walletBinding.findFirst({
    where: { memberId, chain: 'sui' },
    orderBy: [
      { isPrimary: 'desc' },
      { createdAt: 'asc' },
    ],
    select: {
      id: true,
      address: true,
    },
  })
  if (!existingBinding) {
    return false
  }

  const normalizedAddress = normalizeSuiWalletAddress(existingBinding.address)
  if (!normalizedAddress) {
    console.warn('Stored Sui wallet binding has invalid address', {
      memberId,
      address: existingBinding.address,
    })
    return false
  }

  if (normalizedAddress !== existingBinding.address) {
    try {
      await prisma.walletBinding.update({
        where: { id: existingBinding.id },
        data: { address: normalizedAddress },
      })
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        const conflict = await prisma.walletBinding.findUnique({
          where: { chain_address: { chain: 'sui', address: normalizedAddress } },
          select: { memberId: true },
        })
        if (conflict?.memberId === memberId) {
          console.info('Removed duplicate non-canonical Sui wallet binding after canonicalization', {
            memberId,
            address: redactWalletAddress(normalizedAddress),
          })
          await prisma.walletBinding.deleteMany({
            where: { id: existingBinding.id },
          })
        } else if (conflict?.memberId) {
          console.warn('Canonical Sui wallet binding already belongs to another member', {
            address: redactWalletAddress(normalizedAddress),
          })
          return false
        } else {
          throw error
        }
      } else {
        throw error
      }
    }
  }

  return true
}

async function syncSuiWalletBinding(
  privyUserId: string,
  memberId: string,
  existingUser?: PrivyUserWithLinkedAccounts,
): Promise<void> {
  if (await ensureCanonicalSuiWalletBinding(memberId)) {
    return
  }

  const user = existingUser ?? await privy.getUser(privyUserId)
  let suiWalletAddress = getSuiWalletAddress(user)

  if (!suiWalletAddress) {
    const updated = await privy.createWallets({
      userId: privyUserId,
      wallets: [{ chainType: 'sui', policyIds: [] }],
    })
    suiWalletAddress = getSuiWalletAddress(updated)
  }

  if (!suiWalletAddress) {
    return
  }

  const existingAddressBinding = await prisma.walletBinding.findUnique({
    where: { chain_address: { chain: 'sui', address: suiWalletAddress } },
    select: { memberId: true },
  })
  if (existingAddressBinding) {
    if (existingAddressBinding.memberId !== memberId) {
      console.warn('Privy Sui wallet is already bound to another member', {
        address: redactWalletAddress(suiWalletAddress),
      })
    }
    return
  }

  try {
    await prisma.walletBinding.create({
      data: {
        memberId,
        chain: 'sui',
        address: suiWalletAddress,
      },
    })
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      const conflict = await prisma.walletBinding.findUnique({
        where: { chain_address: { chain: 'sui', address: suiWalletAddress } },
        select: { memberId: true },
      })
      if (conflict?.memberId && conflict.memberId !== memberId) {
        console.warn('Privy Sui wallet is already bound to another member', {
          address: redactWalletAddress(suiWalletAddress),
        })
        return
      }
    } else {
      throw error
    }
  }
}

async function ensureSuiWallet(
  privyUserId: string,
  memberId: string,
  existingUser?: PrivyUserWithLinkedAccounts,
): Promise<void> {
  const currentState = getSuiWalletSyncCacheEntry(memberId)
  const now = Date.now()

  if (currentState?.inFlight) {
    await currentState.inFlight
    return
  }

  if (currentState && now - currentState.lastAttemptAt < SUI_WALLET_SYNC_TTL_MS) {
    return
  }

  const inFlight = (async () => {
    try {
      await withTimeout(
        syncSuiWalletBinding(privyUserId, memberId, existingUser),
        SUI_WALLET_SYNC_IN_FLIGHT_TIMEOUT_MS,
        'Sui wallet sync timed out',
      )
    } catch (error) {
      console.error('Failed to sync Privy Sui wallet binding', {
        privyUserId,
        memberId,
        error,
      })
    }
  })()
  setSuiWalletSyncCacheEntry(memberId, {
    inFlight,
    lastAttemptAt: currentState?.lastAttemptAt ?? 0,
  })

  try {
    await inFlight
  } finally {
    setSuiWalletSyncCacheEntry(memberId, {
      inFlight: null,
      lastAttemptAt: Date.now(),
    })
  }
}

export async function resolvePrivyIdentity(token: string): Promise<Identity | null> {
  let claims: Awaited<ReturnType<typeof privy.verifyAuthToken>>
  try {
    claims = await privy.verifyAuthToken(token)
  } catch (error) {
    console.warn('Privy token verification failed', { error })
    return null
  }

  const linkedAccount = await findHumanAccount({ privyDid: claims.userId })
  if (linkedAccount) {
    const identity = toHumanIdentity(linkedAccount)
    if (identity) {
      void ensureSuiWallet(claims.userId, identity.memberId).catch((error) => {
        console.error('Failed to schedule Privy Sui wallet sync', {
          privyUserId: claims.userId,
          memberId: identity.memberId,
          error,
        })
      })
    }
    return identity
  }

  const privyUser = await privy.getUser(claims.userId)
  const telegramTgId = privyUser.telegram?.telegramUserId
  const tgId = telegramTgId !== undefined && telegramTgId !== null
    ? String(telegramTgId)
    : null
  const email = privyUser.email?.firstVerifiedAt
    ? privyUser.email.address.trim().toLowerCase()
    : null
  const tgName = privyUser.telegram?.username?.trim() || null

  const candidates: HumanAccountLookup[] = []
  if (tgId) {
    candidates.push({ tgId })
  }
  if (email) {
    candidates.push({ email })
  }

  for (const candidate of candidates) {
    const legacyAccount = await findHumanAccount(candidate)
    if (!legacyAccount) {
      continue
    }
    if (legacyAccount.privyDid && legacyAccount.privyDid !== claims.userId) {
      continue
    }

    const updateData: {
      privyDid?: string
      email?: string
      tgName?: string
    } = {}

    if (legacyAccount.privyDid !== claims.userId) {
      updateData.privyDid = claims.userId
    }
    if (email && legacyAccount.email !== email) {
      updateData.email = email
    }
    if (tgName && legacyAccount.tgName !== tgName) {
      updateData.tgName = tgName
    }

    if (Object.keys(updateData).length > 0) {
      try {
        await prisma.account.update({
          where: { id: legacyAccount.id },
          data: updateData,
        })
      } catch (error) {
        if (isUniqueConstraintError(error) && updateData.email) {
          // Email already claimed by another account — link privyDid/tgName
          // without the email so the user can still log in
          const { email: _, ...safeData } = updateData
          if (Object.keys(safeData).length > 0) {
            await prisma.account.update({
              where: { id: legacyAccount.id },
              data: safeData,
            })
          }
        } else {
          throw error
        }
      }
    }

    const identity = toHumanIdentity(legacyAccount)
    if (identity) {
      void ensureSuiWallet(claims.userId, identity.memberId, privyUser).catch((error) => {
        console.error('Failed to schedule Privy Sui wallet sync', {
          privyUserId: claims.userId,
          memberId: identity.memberId,
          error,
        })
      })
    }
    return identity
  }

  return null
}

export async function resolveIdentity(): Promise<Identity | null> {
  const headerStore = await getRequestHeaders()

  // Wallet signature path (for agents)
  const agentAddress = headerStore.get('x-agent-address')
  const agentSignature = headerStore.get('x-agent-signature')
  const agentMessage = headerStore.get('x-agent-message')
  if (agentAddress && agentSignature && agentMessage) {
    return resolveWalletIdentity(agentAddress, agentSignature, agentMessage, headerStore)
  }

  const authHeader = headerStore.get('authorization')
  if (!authHeader) return null
  if (!authHeader.startsWith('Bearer ')) return null

  const token = authHeader.slice(7).trim()
  if (token.length === 0) return null

  // API Key path
  if (token.startsWith('sk-')) {
    if (token.length < 10) {
      return null
    }
    const agent = await resolveAgentByApiKey(token)
    if (!agent) return null

    return {
      accountId: agent.accountId,
      memberId: agent.agentMemberId,
      ownerMemberId: agent.ownerMemberId,
      kind: 'agent',
    }
  }

  // Privy token path
  try {
    return await resolvePrivyIdentity(token)
  } catch (error) {
    console.warn('Privy token verification failed', { error })
    return null
  }
}

async function resolveWalletIdentity(
  address: string,
  signature: string,
  nonce: string,
  requestHeaders: Awaited<ReturnType<typeof getRequestHeaders>>,
): Promise<Identity | null> {
  if (address.length > 128 || nonce.length > 128 || signature.length > 512) return null
  if (!isUuid(nonce)) return null

  const normalizedAddress = normalizeSuiWalletAddress(address)
  if (!normalizedAddress) return null

  const requestIp = getRequestIp(requestHeaders)
  if (!requestIp) {
    console.warn('Wallet auth requires a trusted client IP; check proxy forwarding or TRUST_PROXY_HEADERS', {
      address: redactWalletAddress(normalizedAddress),
    })
    return null
  }

  const ipRateLimit = takeRateLimitToken(`wallet-auth-ip:${requestIp}`, WALLET_IDENTITY_RATE_LIMIT)
  if (ipRateLimit.limited) return null

  const addressRateLimitKey = `wallet-auth:${requestIp}:${normalizedAddress}`
  const addressRateLimit = takeRateLimitToken(addressRateLimitKey, WALLET_IDENTITY_RATE_LIMIT)
  if (addressRateLimit.limited) return null

  try {
    // Look up the challenge by nonce first — need expiresAt to reconstruct the message
    const challenge = await prisma.walletChallenge.findUnique({
      where: { nonce },
    })
    if (!challenge) return null
    if (challenge.address !== normalizedAddress) return null
    if (challenge.usedAt) return null
    if (challenge.expiresAt < new Date()) return null

    const challengeDomain = challenge.domain?.trim()
    if (!challengeDomain) {
      console.warn('Wallet challenge missing stored domain, rejecting challenge', { nonce })
      return null
    }

    const expectedMessage = buildChallengeMessage(
      challengeDomain,
      normalizedAddress,
      nonce,
      challenge.expiresAt,
    )
    // Verify Sui signature against the reconstructed message
    const msg = new TextEncoder().encode(expectedMessage)
    let publicKey: Awaited<ReturnType<typeof verifyPersonalMessageSignature>>
    try {
      publicKey = await verifyPersonalMessageSignature(msg, signature)
    } catch {
      return null
    }

    if (normalizeSuiWalletAddress(publicKey.toSuiAddress()) !== normalizedAddress) {
      return null
    }

    // Mark the challenge as used (atomic: prevents concurrent replay)
    const result = await prisma.walletChallenge.updateMany({
      where: { nonce, usedAt: null },
      data: { usedAt: new Date() },
    })
    if (result.count === 0) return null

    // Find the wallet binding and its member
    const binding = await prisma.walletBinding.findFirst({
      where: { chain: 'sui', address: normalizedAddress },
      select: {
        member: {
          select: { id: true, accountId: true, kind: true },
        },
      },
    })
    if (!binding?.member || !binding.member.accountId) return null

    const kind = binding.member.kind
    if (kind !== 'human' && kind !== 'agent') return null

    return {
      accountId: binding.member.accountId,
      memberId: binding.member.id,
      kind,
    }
  } catch (error) {
    console.error('Unexpected wallet identity resolution failure', {
      address: redactWalletAddress(normalizedAddress),
      nonce,
      error,
    })
    return null
  }
}

export async function requireIdentity(): Promise<
  { error: NextResponse; identity: null } | { error: null; identity: Identity }
> {
  const identity = await resolveIdentity()
  if (!identity) {
    return {
      error: NextResponse.json({ error: '请先登录' }, { status: 401 }),
      identity: null,
    }
  }
  return { error: null, identity }
}
