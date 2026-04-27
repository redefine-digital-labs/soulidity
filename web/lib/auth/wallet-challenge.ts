import { randomUUID } from 'node:crypto'

import { prisma } from '@/lib/prisma'
import {
  buildAgentJoinChallengeMessage,
  buildChallengeMessage,
  cleanupStaleWalletChallengesBestEffort,
  getTrustedAppDomain,
  getWalletChallengeCleanupCutoff,
  normalizeSuiWalletAddress,
} from '@/lib/auth/challenge'

export type WalletChallengePurpose = 'login' | 'agent-join'

const CHALLENGE_TTL_MS = 5 * 60 * 1000 // 5 min — long enough for user to switch apps

export interface IssuedWalletChallenge {
  nonce: string
  message: string
  expiresAt: Date
  domain: string
  address: string
}

export class InvalidWalletAddressError extends Error {
  constructor(public readonly address: string) {
    super(`Invalid Sui wallet address: ${address}`)
    this.name = 'InvalidWalletAddressError'
  }
}

function buildMessage(
  purpose: WalletChallengePurpose,
  domain: string,
  address: string,
  nonce: string,
  expiresAt: Date,
): string {
  if (purpose === 'agent-join') {
    return buildAgentJoinChallengeMessage(domain, address, nonce, expiresAt)
  }
  return buildChallengeMessage(domain, address, nonce, expiresAt)
}

export async function issueWalletChallenge(
  rawAddress: string,
  purpose: WalletChallengePurpose = 'login',
): Promise<IssuedWalletChallenge> {
  const address = normalizeSuiWalletAddress(rawAddress)
  if (!address) {
    throw new InvalidWalletAddressError(rawAddress)
  }

  const domain = getTrustedAppDomain()
  const nonce = randomUUID()
  const expiresAt = new Date(Date.now() + CHALLENGE_TTL_MS)
  const message = buildMessage(purpose, domain, address, nonce, expiresAt)

  await prisma.walletChallenge.create({
    data: {
      address,
      nonce,
      domain,
      expiresAt,
    },
  })

  cleanupStaleWalletChallengesBestEffort(async () => {
    const cutoff = getWalletChallengeCleanupCutoff()
    await prisma.walletChallenge.deleteMany({
      where: { createdAt: { lt: cutoff } },
    })
  })

  return { nonce, message, expiresAt, domain, address }
}
