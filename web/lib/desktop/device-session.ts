import { randomBytes } from 'node:crypto'

import { prisma } from '@/lib/prisma'
import type { Prisma } from '@db/prisma-client'
import { isUniqueConstraintError } from '@shared/prisma-errors'
import {
  generateAgentApiKeyForDeviceSession,
  generateDesktopAccessTokenForDeviceSession,
  type DesktopPetIdentity,
} from '@/lib/desktop/auth'
import type {
  DesktopDeviceCompleteResponse,
  DesktopDevicePollResponse,
  DesktopDeviceStartResponse,
} from '@/lib/types/desktop'

export const DESKTOP_DEVICE_POLL_INTERVAL_SECONDS = 5
export const DESKTOP_DEVICE_SESSION_TTL_MS = 10 * 60 * 1000

export const DEFAULT_DESKTOP_PET_LABEL = 'Desktop pet'

const DEVICE_CODE_BYTES = 24
const USER_CODE_LENGTH = 8
const USER_CODE_SEGMENT_LENGTH = 4
const USER_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const MAX_CODE_GENERATION_ATTEMPTS = 3

const deviceSessionStartSelect = {
  deviceCode: true,
  userCode: true,
  expiresAt: true,
  pollIntervalSeconds: true,
} as const

const deviceSessionPollSelect = {
  id: true,
  accountId: true,
  agentAddress: true,
  deviceCode: true,
  expiresAt: true,
  pollIntervalSeconds: true,
  status: true,
} as const

const deviceSessionPollResultSelect = {
  status: true,
  accountId: true,
  agentAddress: true,
  expiresAt: true,
  pollIntervalSeconds: true,
} as const

const deviceSessionCompleteSelect = {
  id: true,
  accountId: true,
  agentAddress: true,
  deviceCode: true,
  userCode: true,
  expiresAt: true,
  confirmedAt: true,
  pollIntervalSeconds: true,
  status: true,
} as const

const deviceSessionCompleteResultSelect = {
  accountId: true,
  agentAddress: true,
  deviceCode: true,
  userCode: true,
  expiresAt: true,
  confirmedAt: true,
  pollIntervalSeconds: true,
  status: true,
} as const

function asIso(value: Date) {
  return value.toISOString()
}

function createDeviceCode() {
  return randomBytes(DEVICE_CODE_BYTES).toString('hex')
}

function createUserCode() {
  const bytes = randomBytes(USER_CODE_LENGTH)
  const characters = Array.from(bytes, (value) => USER_CODE_ALPHABET[value % USER_CODE_ALPHABET.length])

  return [
    characters.slice(0, USER_CODE_SEGMENT_LENGTH).join(''),
    characters.slice(USER_CODE_SEGMENT_LENGTH).join(''),
  ].join('-')
}

function toStartResponse(session: {
  deviceCode: string
  userCode: string
  expiresAt: Date
  pollIntervalSeconds: number
}): DesktopDeviceStartResponse {
  return {
    deviceCode: session.deviceCode,
    userCode: session.userCode,
    expiresAt: asIso(session.expiresAt),
    pollInterval: session.pollIntervalSeconds,
  }
}

function toPollResponse(session: {
  status: string
  accountId: string | null
  expiresAt: Date
  pollIntervalSeconds: number
  desktopAccessToken?: string | null
  agentApiKey?: string | null
}): DesktopDevicePollResponse {
  const shared = {
    expiresAt: asIso(session.expiresAt),
    pollInterval: session.pollIntervalSeconds,
  }

  if (session.status === 'confirmed' && session.accountId) {
    return {
      status: 'confirmed',
      accountId: session.accountId,
      deepLink: null,
      ...(session.desktopAccessToken ? { desktopAccessToken: session.desktopAccessToken } : {}),
      ...(session.agentApiKey ? { agentApiKey: session.agentApiKey } : {}),
      ...shared,
    }
  }

  if (session.status === 'expired') {
    return {
      status: 'expired',
      ...shared,
    }
  }

  return {
    status: 'pending',
    ...shared,
  }
}

function toCompleteConfirmedResponse(session: {
  status: string
  accountId: string | null
  deviceCode: string
  userCode: string
  expiresAt: Date
  confirmedAt: Date | null
  pollIntervalSeconds: number
  petId?: string | null
  agentAddress?: string | null
}): DesktopDeviceCompleteResponse {
  if (session.status !== 'confirmed' || !session.accountId || !session.confirmedAt) {
    throw new Error('Desktop device session is not confirmed')
  }

  return {
    status: 'confirmed',
    accountId: session.accountId,
    deviceCode: session.deviceCode,
    userCode: session.userCode,
    deepLink: null,
    expiresAt: asIso(session.expiresAt),
    confirmedAt: asIso(session.confirmedAt),
    pollInterval: session.pollIntervalSeconds,
    petId: session.petId ?? null,
    agentAddress: session.agentAddress ?? null,
  }
}

/**
 * Resolve `(petId, agentAddress)` for a confirmed session. Same-account
 * replay must NOT rotate the pet credentials, so this only reads — it does
 * not create or update anything. Returns nulls when the session has no
 * `agentAddress` (legacy device-start without wallet sig) or the pet row
 * was already revoked between confirm and replay.
 */
async function lookupConfirmedPetSummary(params: {
  accountId: string | null
  agentAddress: string | null
}): Promise<{ petId: string | null; agentAddress: string | null }> {
  if (!params.accountId || !params.agentAddress) {
    return { petId: null, agentAddress: params.agentAddress ?? null }
  }
  const pet = await prisma.desktopPet.findUnique({
    where: {
      accountId_agentAddress: {
        accountId: params.accountId,
        agentAddress: params.agentAddress,
      },
    },
    select: { id: true },
  })
  return { petId: pet?.id ?? null, agentAddress: params.agentAddress }
}

function toStatusResponse(session: {
  status: string
  expiresAt: Date
  pollIntervalSeconds: number
}) {
  return {
    status: 'expired' as const,
    expiresAt: asIso(session.expiresAt),
    pollInterval: session.pollIntervalSeconds,
  }
}

export class DesktopDeviceSessionConflictError extends Error {
  constructor(message = 'This desktop device was already confirmed by another account') {
    super(message)
    this.name = 'DesktopDeviceSessionConflictError'
  }
}

/**
 * Thrown when the requested `agentAddress` is already bound (via
 * `WalletBinding`) to a different account or to a non-pet (`kind='human'`)
 * member. Surfaced as 409 by the `/complete` route.
 */
export class DesktopPetAddressConflictError extends Error {
  constructor(message = 'This desktop pet address is already bound to another account') {
    super(message)
    this.name = 'DesktopPetAddressConflictError'
  }
}

export interface PersistedDesktopPetCredentials {
  desktopAccessToken: string
  agentApiKey: string
}

export type { DesktopPetIdentity }

interface PersistConfirmedDesktopPetParams {
  accountId: string
  sessionId: string
  deviceCode: string
  agentAddress: string
  now: Date
}

/**
 * Idempotent persist of a confirmed desktop pet. Runs inside the
 * `completeDesktopDeviceSession` transaction.
 *
 * Branch matrix (matches the plan §B contract):
 *
 * 1. `WalletBinding(chain='sui', address=agentAddress)` does not exist →
 *    create a new `Member(kind='agent')` with the deterministic apiKey hash,
 *    create the wallet binding, create the `DesktopPet` row.
 * 2. Binding exists, member is a `kind='agent'` belonging to the same
 *    account → reuse the member, refresh `apiKeyHash`, set
 *    `agentStatus='active'`, clear all rotation fields, upsert the pet.
 * 3. Binding exists, member is a `kind='agent'` on a different account →
 *    throw `DesktopPetAddressConflictError`.
 * 4. Binding exists but member is a `kind='human'` → throw
 *    `DesktopPetAddressConflictError` (someone else owns this address).
 * 5. A `DesktopPet` row already exists for `(accountId, agentAddress)` →
 *    update the token hash / issued-at / agent-member binding without
 *    creating a duplicate. The `label` is preserved; the default is only
 *    applied to brand-new rows.
 */
export async function persistConfirmedDesktopPet(
  tx: Prisma.TransactionClient,
  params: PersistConfirmedDesktopPetParams,
): Promise<{ desktopPetId: string; agentMemberId: string; tokenHash: string; agentApiKeyHash: string }> {
  const { accountId, agentAddress, now } = params
  const tokenSeeds = generateDesktopAccessTokenForDeviceSession(params.deviceCode)
  const apiKeySeeds = generateAgentApiKeyForDeviceSession(params.deviceCode)

  const binding = await tx.walletBinding.findUnique({
    where: { chain_address: { chain: 'sui', address: agentAddress } },
    select: {
      id: true,
      memberId: true,
      member: {
        select: {
          id: true,
          accountId: true,
          kind: true,
        },
      },
    },
  })

  let agentMemberId: string

  if (!binding) {
    // Branch 1: create fresh agent member + wallet binding.
    const agentMember = await tx.member.create({
      data: {
        accountId,
        kind: 'agent',
        agentStatus: 'active',
        apiKey: null,
        apiKeyHash: apiKeySeeds.hash,
        apiKeyRotationId: null,
        pendingApiKeyHash: null,
        pendingApiKeyRotationId: null,
        pendingApiKeyRotationExpiresAt: null,
      },
      select: { id: true },
    })
    agentMemberId = agentMember.id

    await tx.walletBinding.create({
      data: {
        memberId: agentMemberId,
        chain: 'sui',
        address: agentAddress,
        isPrimary: true,
        verifiedAt: now,
      },
    })
  } else if (binding.member.kind !== 'agent' || binding.member.accountId !== accountId) {
    // Branch 3 + 4: binding belongs to a human, or to an agent on a
    // different account. Either way the address is owned elsewhere.
    throw new DesktopPetAddressConflictError()
  } else {
    // Branch 2: revive the existing same-account agent member. Refresh hash,
    // flip status back to active, clear all rotation breadcrumbs.
    agentMemberId = binding.member.id
    await tx.member.update({
      where: { id: agentMemberId },
      data: {
        agentStatus: 'active',
        apiKey: null,
        apiKeyHash: apiKeySeeds.hash,
        apiKeyRotationId: null,
        pendingApiKeyHash: null,
        pendingApiKeyRotationId: null,
        pendingApiKeyRotationExpiresAt: null,
      },
    })
  }

  // Branch 5 (folded into upsert): pet row already exists for
  // (accountId, agentAddress). The unique `(accountId, agentAddress)` index
  // makes upsert atomic; the `agentMemberId` unique on `Member` makes the
  // member-side reuse safe.
  const existingPet = await tx.desktopPet.findUnique({
    where: {
      accountId_agentAddress: {
        accountId,
        agentAddress,
      },
    },
    select: { id: true, label: true },
  })

  let desktopPetId: string

  if (existingPet) {
    const updated = await tx.desktopPet.update({
      where: { id: existingPet.id },
      data: {
        agentMemberId,
        desktopAccessTokenHash: tokenSeeds.hash,
        desktopAccessTokenIssuedAt: now,
      },
      select: { id: true },
    })
    desktopPetId = updated.id
  } else {
    try {
      const created = await tx.desktopPet.create({
        data: {
          accountId,
          agentAddress,
          agentMemberId,
          label: DEFAULT_DESKTOP_PET_LABEL,
          desktopAccessTokenHash: tokenSeeds.hash,
          desktopAccessTokenIssuedAt: now,
        },
        select: { id: true },
      })
      desktopPetId = created.id
    } catch (error) {
      // Race: a concurrent confirm landed first. Re-read and update so the
      // transaction is idempotent.
      if (isUniqueConstraintError(error)) {
        const racePet = await tx.desktopPet.findUnique({
          where: {
            accountId_agentAddress: {
              accountId,
              agentAddress,
            },
          },
          select: { id: true },
        })
        if (!racePet) {
          throw error
        }
        const updated = await tx.desktopPet.update({
          where: { id: racePet.id },
          data: {
            agentMemberId,
            desktopAccessTokenHash: tokenSeeds.hash,
            desktopAccessTokenIssuedAt: now,
          },
          select: { id: true },
        })
        desktopPetId = updated.id
      } else {
        throw error
      }
    }
  }

  // Expire only sibling sessions that target the *same* (accountId,
  // agentAddress). Other pets owned by the same account stay valid.
  await tx.desktopDeviceSession.updateMany({
    where: {
      accountId,
      agentAddress,
      status: 'confirmed',
      id: { not: params.sessionId },
    },
    data: {
      status: 'expired',
    },
  })

  return {
    desktopPetId,
    agentMemberId,
    tokenHash: tokenSeeds.hash,
    agentApiKeyHash: apiKeySeeds.hash,
  }
}

export async function startDesktopDeviceSession(
  options: { now?: Date; agentAddress?: string } = {},
): Promise<DesktopDeviceStartResponse> {
  const now = options.now ?? new Date()
  const expiresAt = new Date(now.getTime() + DESKTOP_DEVICE_SESSION_TTL_MS)

  for (let attempt = 0; attempt < MAX_CODE_GENERATION_ATTEMPTS; attempt += 1) {
    try {
      const session = await prisma.desktopDeviceSession.create({
        data: {
          deviceCode: createDeviceCode(),
          userCode: createUserCode(),
          agentAddress: options.agentAddress ?? null,
          status: 'pending',
          pollIntervalSeconds: DESKTOP_DEVICE_POLL_INTERVAL_SECONDS,
          expiresAt,
        },
        select: deviceSessionStartSelect,
      })

      return toStartResponse(session)
    } catch (error) {
      if (isUniqueConstraintError(error) && attempt < MAX_CODE_GENERATION_ATTEMPTS - 1) {
        continue
      }

      throw error
    }
  }

  throw new Error('Failed to create desktop device session')
}

export async function pollDesktopDeviceSession(
  deviceCode: string,
  options: { now?: Date } = {},
): Promise<DesktopDevicePollResponse> {
  const session = await prisma.desktopDeviceSession.findUnique({
    where: { deviceCode },
    select: deviceSessionPollSelect,
  })

  if (!session) {
    return {
      status: 'invalid_code',
      expiresAt: null,
      pollInterval: DESKTOP_DEVICE_POLL_INTERVAL_SECONDS,
    }
  }

  const now = options.now ?? new Date()
  const shouldExpire = session.status === 'pending' && now >= session.expiresAt
  const updatedSession = await prisma.desktopDeviceSession.update({
    where: { id: session.id },
    data: shouldExpire
      ? {
          status: 'expired',
          lastPolledAt: now,
        }
      : {
          lastPolledAt: now,
        },
    select: deviceSessionPollResultSelect,
  })

  if (updatedSession.status === 'confirmed' && updatedSession.accountId) {
    const tokenSeeds = generateDesktopAccessTokenForDeviceSession(session.deviceCode)
    const apiKeySeeds = generateAgentApiKeyForDeviceSession(session.deviceCode)

    // Only surface the deterministic agent API key while it still matches
    // the on-chain hash. Once the desktop calls the rotate endpoint,
    // `Member.apiKeyHash` diverges and we MUST stop returning the stale key
    // to anyone polling.
    let agentApiKey: string | null = null
    if (updatedSession.agentAddress) {
      const pet = await prisma.desktopPet.findUnique({
        where: {
          accountId_agentAddress: {
            accountId: updatedSession.accountId,
            agentAddress: updatedSession.agentAddress,
          },
        },
        select: {
          agentMember: {
            select: { apiKeyHash: true },
          },
        },
      })
      if (pet?.agentMember?.apiKeyHash === apiKeySeeds.hash) {
        agentApiKey = apiKeySeeds.apiKey
      }
    }

    return toPollResponse({
      ...updatedSession,
      desktopAccessToken: tokenSeeds.token,
      agentApiKey,
    })
  }

  return toPollResponse(updatedSession)
}

export async function completeDesktopDeviceSession(
  userCode: string,
  accountId: string,
  options: { now?: Date } = {},
): Promise<
  DesktopDeviceCompleteResponse
  | {
      status: 'expired'
      expiresAt: string
      pollInterval: number
    }
  | {
      status: 'invalid_code'
      expiresAt: null
      pollInterval: number
    }
> {
  const session = await prisma.desktopDeviceSession.findUnique({
    where: { userCode },
    select: deviceSessionCompleteSelect,
  })

  if (!session) {
    return {
      status: 'invalid_code',
      expiresAt: null,
      pollInterval: DESKTOP_DEVICE_POLL_INTERVAL_SECONDS,
    }
  }

  const now = options.now ?? new Date()
  const shouldExpire = session.status === 'pending' && now >= session.expiresAt

  if (session.status === 'expired' || shouldExpire) {
    const expiredSession = session.status === 'expired'
      ? session
      : await prisma.desktopDeviceSession.update({
          where: { id: session.id },
          data: {
            status: 'expired',
          },
          select: deviceSessionCompleteResultSelect,
        })

    return toStatusResponse(expiredSession)
  }

  if (session.status === 'confirmed') {
    if (session.accountId && session.accountId !== accountId) {
      throw new DesktopDeviceSessionConflictError()
    }

    // Idempotent same-account replay. The original confirm transaction
    // already wrote the pet/member rows, so re-running `persistConfirmedDesktopPet`
    // here would unconditionally rewrite `Member.apiKeyHash` back to the
    // deterministic device-session seed and clear `apiKeyRotationId` /
    // pending rotation fields — silently invalidating any agent API key
    // rotated through `/api/desktop/me/agent-key/rotate`. Confirmed sessions
    // are read-only after the initial confirm; a new `userCode` must be
    // started for a fresh link.
    const replaySummary = await lookupConfirmedPetSummary({
      accountId: session.accountId,
      agentAddress: session.agentAddress,
    })
    return toCompleteConfirmedResponse({
      status: session.status,
      accountId: session.accountId ?? accountId,
      deviceCode: session.deviceCode,
      userCode: session.userCode,
      expiresAt: session.expiresAt,
      confirmedAt: session.confirmedAt ?? now,
      pollIntervalSeconds: session.pollIntervalSeconds,
      petId: replaySummary.petId,
      agentAddress: replaySummary.agentAddress,
    })
  }

  const transactionResult = await prisma.$transaction(async (tx) => {
    const current = await tx.desktopDeviceSession.findUnique({
      where: { id: session.id },
      select: { status: true, accountId: true },
    })

    if (!current || current.status !== 'pending') {
      if (current?.accountId && current.accountId !== accountId) {
        throw new DesktopDeviceSessionConflictError()
      }
      if (!current || current.status === 'expired') {
        return { confirmed: null, desktopPetId: null as string | null }
      }
      const replay = await tx.desktopDeviceSession.findUnique({
        where: { id: session.id },
        select: deviceSessionCompleteResultSelect,
      })
      return { confirmed: replay, desktopPetId: null as string | null }
    }

    const confirmed = await tx.desktopDeviceSession.update({
      where: { id: session.id },
      data: {
        accountId,
        status: 'confirmed',
        confirmedAt: now,
      },
      select: deviceSessionCompleteResultSelect,
    })

    let desktopPetId: string | null = null
    if (session.agentAddress) {
      const persisted = await persistConfirmedDesktopPet(tx, {
        accountId,
        sessionId: session.id,
        deviceCode: session.deviceCode,
        agentAddress: session.agentAddress,
        now,
      })
      desktopPetId = persisted.desktopPetId
    }

    return { confirmed, desktopPetId }
  })

  const confirmedSession = transactionResult.confirmed
  if (!confirmedSession || confirmedSession.status === 'expired') {
    return toStatusResponse(session)
  }

  let petId = transactionResult.desktopPetId
  let agentAddress = confirmedSession.agentAddress ?? null
  if (!petId && agentAddress && confirmedSession.accountId) {
    // Replay landed mid-transaction (current.status was 'confirmed') — the
    // pet row already exists; surface its id so the browser can open the
    // authorize step on the rerun.
    const summary = await lookupConfirmedPetSummary({
      accountId: confirmedSession.accountId,
      agentAddress,
    })
    petId = summary.petId
    agentAddress = summary.agentAddress
  }

  return toCompleteConfirmedResponse({
    ...confirmedSession,
    petId,
    agentAddress,
  })
}
