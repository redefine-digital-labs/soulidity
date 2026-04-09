import { invoke } from '@tauri-apps/api/core'
import type {
  DesktopDevicePollResponse,
  DesktopDeviceStartResponse,
} from '../../../web/lib/types/desktop.ts'
import type { AuthSessionRecord } from './persistence'

const BROWSER_AUTH_SESSION_STORAGE_KEY = 'soulidity.desktop.auth-session'
const DEFAULT_DESKTOP_WEB_BASE_URL = 'http://localhost:3100'

function isBrowser() {
  return typeof window !== 'undefined'
}

export function isTauriRuntime() {
  if (!isBrowser()) {
    return false
  }

  return '__TAURI_INTERNALS__' in (window as Window & { __TAURI_INTERNALS__?: unknown })
}

export function getDesktopWebBaseUrl() {
  const configured = import.meta.env.VITE_DESKTOP_WEB_BASE_URL?.trim()
  if (configured) {
    return configured.replace(/\/+$/, '')
  }

  return DEFAULT_DESKTOP_WEB_BASE_URL
}

async function parseJsonResponse<T>(response: Response): Promise<T> {
  let body: unknown = null

  try {
    body = await response.json()
  } catch {
    body = null
  }

  if (!response.ok) {
    const errorMessage = body && typeof body === 'object' && 'error' in body && typeof body.error === 'string'
      ? body.error
      : `Desktop request failed with status ${response.status}`
    throw new Error(errorMessage)
  }

  return body as T
}

export async function startDesktopDeviceSessionTransport(): Promise<DesktopDeviceStartResponse> {
  if (isTauriRuntime()) {
    return invoke<DesktopDeviceStartResponse>('start_device_authorization', {
      webBaseUrl: getDesktopWebBaseUrl(),
    })
  }

  const response = await fetch('/api/desktop/device/start', {
    method: 'POST',
  })
  return parseJsonResponse<DesktopDeviceStartResponse>(response)
}

export async function pollDesktopDeviceSessionTransport(deviceCode: string): Promise<DesktopDevicePollResponse> {
  if (isTauriRuntime()) {
    return invoke<DesktopDevicePollResponse>('poll_device_authorization', {
      deviceCode,
      webBaseUrl: getDesktopWebBaseUrl(),
    })
  }

  const response = await fetch('/api/desktop/device/poll', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ deviceCode }),
  })

  return parseJsonResponse<DesktopDevicePollResponse>(response)
}

export async function openExternalUrl(url: string) {
  if (isTauriRuntime()) {
    const { openUrl } = await import('@tauri-apps/plugin-opener')
    await openUrl(url)
    return
  }

  if (!isBrowser()) {
    throw new Error('Cannot open external URLs outside a browser runtime')
  }

  window.open(url, '_blank', 'noopener,noreferrer')
}

function readBrowserAuthSession(): AuthSessionRecord | null {
  if (!isBrowser()) {
    return null
  }

  const rawValue = window.localStorage.getItem(BROWSER_AUTH_SESSION_STORAGE_KEY)
  if (!rawValue) {
    return null
  }

  try {
    return JSON.parse(rawValue) as AuthSessionRecord
  } catch {
    return null
  }
}

export async function loadPersistedAuthSession(): Promise<AuthSessionRecord | null> {
  if (isTauriRuntime()) {
    return invoke<AuthSessionRecord | null>('load_auth_session')
  }

  return readBrowserAuthSession()
}

export async function savePersistedAuthSession(session: AuthSessionRecord) {
  if (isTauriRuntime()) {
    await invoke('save_auth_session', { session })
    return
  }

  if (isBrowser()) {
    window.localStorage.setItem(BROWSER_AUTH_SESSION_STORAGE_KEY, JSON.stringify(session))
  }
}

export async function clearPersistedAuthSession() {
  if (isTauriRuntime()) {
    await invoke('clear_auth_session')
    return
  }

  if (isBrowser()) {
    window.localStorage.removeItem(BROWSER_AUTH_SESSION_STORAGE_KEY)
  }
}

export async function getCurrentDeepLinks() {
  if (!isTauriRuntime()) {
    return [] as string[]
  }

  const { getCurrent } = await import('@tauri-apps/plugin-deep-link')
  return (await getCurrent()) ?? []
}

export async function onDeepLinkOpen(handler: (urls: string[]) => void) {
  if (!isTauriRuntime()) {
    return () => {}
  }

  const { onOpenUrl } = await import('@tauri-apps/plugin-deep-link')
  return onOpenUrl(handler)
}
