import type {
  DesktopDevicePollResponse,
  DesktopDeviceStartResponse,
} from '../../../web/lib/types/desktop.ts'
import type { AuthSessionRecord } from './persistence'

export interface PendingDesktopAuthSession extends DesktopDeviceStartResponse {
  confirmationUrl: string
  startedAt: string
}

export interface StartDesktopDeviceAuthorizationOptions {
  now?: () => Date
  openBrowser: (url: string) => Promise<void>
  startSession: () => Promise<DesktopDeviceStartResponse>
  webBaseUrl: string
}

export interface CompleteDesktopDeviceAuthorizationOptions {
  now?: () => Date
  pendingSession?: PendingDesktopAuthSession | null
  pollSession: (deviceCode: string) => Promise<DesktopDevicePollResponse>
  saveSession: (session: AuthSessionRecord) => Promise<void>
}

function asIso(value: Date) {
  return value.toISOString()
}

function normalizeBaseUrl(baseUrl: string) {
  const trimmed = baseUrl.trim()
  if (!trimmed) {
    throw new Error('Desktop web base URL is required')
  }

  return trimmed.replace(/\/+$/, '')
}

export function buildDesktopDeviceConfirmationUrl(baseUrl: string, userCode: string) {
  const confirmationUrl = new URL('/desktop/device', `${normalizeBaseUrl(baseUrl)}/`)
  confirmationUrl.searchParams.set('userCode', userCode.trim().toUpperCase())
  return confirmationUrl.toString()
}

export function parseDesktopAuthDeepLink(input: string) {
  const deepLink = new URL(input)

  if (deepLink.protocol !== 'soulidity:' || deepLink.host !== 'auth' || deepLink.pathname !== '/device') {
    throw new Error('Deep link must use soulidity://auth/device')
  }

  const deviceCode = deepLink.searchParams.get('deviceCode')?.trim() ?? ''
  if (!deviceCode) {
    throw new Error('Deep link is missing deviceCode')
  }

  const status = deepLink.searchParams.get('status')?.trim() ?? ''
  if (!status) {
    throw new Error('Deep link is missing status')
  }

  return {
    deviceCode,
    status,
  }
}

export async function startDesktopDeviceAuthorization(
  options: StartDesktopDeviceAuthorizationOptions,
): Promise<PendingDesktopAuthSession> {
  const now = options.now ?? (() => new Date())
  const session = await options.startSession()
  const pendingSession: PendingDesktopAuthSession = {
    ...session,
    confirmationUrl: buildDesktopDeviceConfirmationUrl(options.webBaseUrl, session.userCode),
    startedAt: asIso(now()),
  }

  await options.openBrowser(pendingSession.confirmationUrl)
  return pendingSession
}

export async function completeDesktopDeviceAuthorizationFromDeepLink(
  deepLinkUrl: string,
  options: CompleteDesktopDeviceAuthorizationOptions,
): Promise<AuthSessionRecord> {
  const now = options.now ?? (() => new Date())
  const parsed = parseDesktopAuthDeepLink(deepLinkUrl)

  if (parsed.status !== 'confirmed') {
    throw new Error(`Unsupported desktop auth status "${parsed.status}"`)
  }

  const pollResult = await options.pollSession(parsed.deviceCode)
  if (pollResult.status !== 'confirmed') {
    throw new Error(`Desktop auth session resolved to "${pollResult.status}"`)
  }

  const authSession: AuthSessionRecord = {
    accountId: pollResult.accountId,
    deviceCode: parsed.deviceCode,
    userCode: options.pendingSession?.deviceCode === parsed.deviceCode
      ? options.pendingSession.userCode
      : null,
    confirmedAt: asIso(now()),
    expiresAt: pollResult.expiresAt,
  }

  await options.saveSession(authSession)
  return authSession
}

export function restoreDesktopAuthSession(
  session: AuthSessionRecord | null,
  options: { now?: Date } = {},
) {
  if (!session) {
    return null
  }

  if (!session.expiresAt) {
    return session
  }

  const now = options.now ?? new Date()
  return now < new Date(session.expiresAt) ? session : null
}
