import { randomUUID } from 'node:crypto'

import { prisma } from '@/lib/prisma'
import {
  buildAgentJoinChallengeMessage,
  buildChallengeMessage,
  buildDesktopLinkChallengeMessage,
  cleanupStaleWalletChallengesBestEffort,
  getTrustedAppDomain,
  getWalletChallengeCleanupCutoff,
  normalizeSuiWalletAddress,
} from '@/lib/auth/challenge'
import { isUuid } from '@/lib/is-uuid'
import { verifyPersonalMessageSignature } from '@/lib/sui-verify'

export type WalletChallengePurpose = 'login' | 'agent-join' | 'desktop-link'

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
  if (purpose === 'desktop-link') {
    return buildDesktopLinkChallengeMessage(domain, address, nonce, expiresAt)
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
      purpose,
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

// zkLogin signatures (base64 JWT + proof + ephemeral key + sig) routinely run a
// few KB; 8192 bounds DB / verify cost without rejecting any legitimate signer.
const MAX_SIGNATURE_LENGTH = 8192
const MAX_NONCE_LENGTH = 128
const MAX_ADDRESS_LENGTH = 128

export interface ConsumeWalletChallengeFailure {
  reason:
    | 'invalid_nonce'
    | 'challenge_not_found'
    | 'challenge_expired'
    | 'challenge_used'
    | 'challenge_purpose_mismatch'
    | 'address_mismatch'
    | 'domain_missing'
    | 'signature_invalid'
    | 'signer_mismatch'
  /** Diagnostic string for server-side logs only; never returned to clients. */
  cause?: string
}

export type ConsumeWalletChallengeResult =
  | { ok: true; address: string }
  | ({ ok: false } & ConsumeWalletChallengeFailure)

export async function consumeWalletChallengeForPurpose(params: {
  nonce: string
  address: string
  purpose: WalletChallengePurpose
  signature: string
}): Promise<ConsumeWalletChallengeResult> {
  if (params.address.length === 0 || params.address.length > MAX_ADDRESS_LENGTH) {
    return { ok: false, reason: 'address_mismatch' }
  }
  if (params.nonce.length === 0 || params.nonce.length > MAX_NONCE_LENGTH) {
    return { ok: false, reason: 'invalid_nonce' }
  }
  if (params.signature.length === 0 || params.signature.length > MAX_SIGNATURE_LENGTH) {
    return { ok: false, reason: 'signature_invalid' }
  }

  const normalizedAddress = normalizeSuiWalletAddress(params.address)
  if (!normalizedAddress) {
    return { ok: false, reason: 'address_mismatch' }
  }

  if (!isUuid(params.nonce)) {
    return { ok: false, reason: 'invalid_nonce' }
  }

  const challenge = await prisma.walletChallenge.findUnique({
    where: { nonce: params.nonce },
  })
  if (!challenge) {
    return { ok: false, reason: 'challenge_not_found' }
  }

  if (challenge.purpose !== params.purpose) {
    return { ok: false, reason: 'challenge_purpose_mismatch' }
  }

  if (challenge.address !== normalizedAddress) {
    return { ok: false, reason: 'address_mismatch' }
  }

  if (challenge.usedAt) {
    return { ok: false, reason: 'challenge_used' }
  }

  if (challenge.expiresAt < new Date()) {
    return { ok: false, reason: 'challenge_expired' }
  }

  const challengeDomain = challenge.domain?.trim()
  if (!challengeDomain) {
    return { ok: false, reason: 'domain_missing' }
  }

  const expectedMessage = buildMessage(
    params.purpose,
    challengeDomain,
    normalizedAddress,
    params.nonce,
    challenge.expiresAt,
  )
  const messageBytes = new TextEncoder().encode(expectedMessage)

  let publicKey: Awaited<ReturnType<typeof verifyPersonalMessageSignature>>
  try {
    publicKey = await verifyPersonalMessageSignature(messageBytes, params.signature, {
      address: normalizedAddress,
    })
  } catch (error) {
    const cause = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
    return { ok: false, reason: 'signature_invalid', cause }
  }

  const recoveredAddress = normalizeSuiWalletAddress(publicKey.toSuiAddress())
  if (recoveredAddress !== normalizedAddress) {
    return { ok: false, reason: 'signer_mismatch' }
  }

  const consumed = await prisma.walletChallenge.updateMany({
    where: { nonce: params.nonce, usedAt: null },
    data: { usedAt: new Date() },
  })
  if (consumed.count === 0) {
    return { ok: false, reason: 'challenge_used' }
  }

  return { ok: true, address: normalizedAddress }
}
