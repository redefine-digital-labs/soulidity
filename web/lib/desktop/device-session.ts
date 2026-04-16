import { randomBytes } from 'node:crypto'

import { prisma } from '@web/lib/prisma'
import type { Prisma } from '@db/prisma-client'
import { isUniqueConstraintError } from '@shared/prisma-errors'
import { generateDesktopAccessTokenForDeviceSession } from '@/lib/desktop/auth'
import type {
  DesktopDeviceCompleteResponse,
  DesktopDevicePollResponse,
  DesktopDeviceStartResponse,
} from '@/lib/types/desktop'

export const DESKTOP_DEVICE_POLL_INTERVAL_SECONDS = 5
export const DESKTOP_DEVICE_SESSION_TTL_MS = 10 * 60 * 1000

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
  deviceCode: true,
  expiresAt: true,
  pollIntervalSeconds: true,
  status: true,
} as const

const deviceSessionPollResultSelect = {
  status: true,
  accountId: true,
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
  desktopAccessToken?: string
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
    ...(session.desktopAccessToken ? { desktopAccessToken: session.desktopAccessToken } : {}),
    expiresAt: asIso(session.expiresAt),
    confirmedAt: asIso(session.confirmedAt),
    pollInterval: session.pollIntervalSeconds,
  }
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

async function persistConfirmedDesktopSession(
  tx: Prisma.TransactionClient,
  params: {
    accountId: string
    sessionId: string
    deviceCode: string
    agentAddress?: string | null
    now: Date
  },
) {
  const { hash } = generateDesktopAccessTokenForDeviceSession(params.deviceCode)
  const existingProfile = await tx.desktopProfile.findUnique({
    where: { accountId: params.accountId },
    select: { desktopAccessTokenHash: true },
  })

  const sharedUpdate = {
    ...(params.agentAddress ? { agentAddress: params.agentAddress } : {}),
    desktopAccessTokenHash: hash,
  }

  await tx.desktopProfile.upsert({
    where: { accountId: params.accountId },
    create: {
      accountId: params.accountId,
      ...sharedUpdate,
      desktopAccessTokenIssuedAt: params.now,
    },
    update: {
      ...sharedUpdate,
      ...(existingProfile?.desktopAccessTokenHash !== hash
        ? { desktopAccessTokenIssuedAt: params.now }
        : {}),
    },
  })

  await tx.desktopDeviceSession.updateMany({
    where: {
      accountId: params.accountId,
      status: 'confirmed',
      id: { not: params.sessionId },
    },
    data: {
      status: 'expired',
    },
  })
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
    const { token } = generateDesktopAccessTokenForDeviceSession(session.deviceCode)
    return toPollResponse({ ...updatedSession, desktopAccessToken: token })
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

    const confirmedSession = await prisma.$transaction(async (tx) => {
      await persistConfirmedDesktopSession(tx, {
        accountId,
        sessionId: session.id,
        deviceCode: session.deviceCode,
        agentAddress: session.agentAddress,
        now,
      })

      return tx.desktopDeviceSession.findUnique({
        where: { id: session.id },
        select: deviceSessionCompleteResultSelect,
      })
    })

    if (!confirmedSession || confirmedSession.status === 'expired') {
      return toStatusResponse(session)
    }

    return toCompleteConfirmedResponse({
      ...confirmedSession,
      accountId,
      confirmedAt: confirmedSession.confirmedAt ?? now,
    })
  }

  const confirmedSession = await prisma.$transaction(async (tx) => {
    const current = await tx.desktopDeviceSession.findUnique({
      where: { id: session.id },
      select: { status: true, accountId: true },
    })

    if (!current || current.status !== 'pending') {
      if (current?.accountId && current.accountId !== accountId) {
        throw new DesktopDeviceSessionConflictError()
      }
      if (!current || current.status === 'expired') {
        return null
      }
      return tx.desktopDeviceSession.findUnique({
        where: { id: session.id },
        select: deviceSessionCompleteResultSelect,
      })
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

    await persistConfirmedDesktopSession(tx, {
      accountId,
      sessionId: session.id,
      deviceCode: session.deviceCode,
      agentAddress: session.agentAddress,
      now,
    })

    return confirmed
  })

  if (!confirmedSession || confirmedSession.status === 'expired') {
    return toStatusResponse(session)
  }

  return toCompleteConfirmedResponse(confirmedSession)
}
