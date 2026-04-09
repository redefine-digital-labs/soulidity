import { randomBytes } from 'node:crypto'

import { prisma } from '@web/lib/prisma'
import { isUniqueConstraintError } from '@shared/prisma-errors'
import type {
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
  const shouldExpire = session.status !== 'confirmed' && now >= session.expiresAt
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
