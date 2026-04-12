import { randomBytes } from 'node:crypto'

import { prisma } from '@web/lib/prisma'
import { isUniqueConstraintError } from '@shared/prisma-errors'
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

function buildDesktopDeviceDeepLink(deviceCode: string) {
  const deepLink = new URL('soulidity://auth/device')
  deepLink.searchParams.set('deviceCode', deviceCode)
  deepLink.searchParams.set('status', 'confirmed')
  return deepLink.toString()
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
}): DesktopDeviceCompleteResponse {
  if (session.status !== 'confirmed' || !session.accountId || !session.confirmedAt) {
    throw new Error('Desktop device session is not confirmed')
  }

  return {
    status: 'confirmed',
    accountId: session.accountId,
    deviceCode: session.deviceCode,
    userCode: session.userCode,
    deepLink: buildDesktopDeviceDeepLink(session.deviceCode),
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

export async function startDesktopDeviceSession(
  options: { now?: Date } = {},
): Promise<DesktopDeviceStartResponse> {
  const now = options.now ?? new Date()
  const expiresAt = new Date(now.getTime() + DESKTOP_DEVICE_SESSION_TTL_MS)

  for (let attempt = 0; attempt < MAX_CODE_GENERATION_ATTEMPTS; attempt += 1) {
    try {
      const session = await prisma.desktopDeviceSession.create({
        data: {
          deviceCode: createDeviceCode(),
          userCode: createUserCode(),
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
  const shouldExpire = session.status !== 'expired' && now >= session.expiresAt
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
  const shouldExpire = session.status !== 'expired' && now >= session.expiresAt

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

    return toCompleteConfirmedResponse({
      ...session,
      accountId,
      confirmedAt: session.confirmedAt ?? now,
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

    return tx.desktopDeviceSession.update({
      where: { id: session.id },
      data: {
        accountId,
        status: 'confirmed',
        confirmedAt: now,
      },
      select: deviceSessionCompleteResultSelect,
    })
  })

  if (!confirmedSession || confirmedSession.status === 'expired') {
    return toStatusResponse(session)
  }

  return toCompleteConfirmedResponse(confirmedSession)
}
