import { invoke } from '@tauri-apps/api/core'

import {
  DESKTOP_DEVICE_CODE_HEADER,
  type DesktopCatalogSourceType,
  type DesktopMeResponse,
} from '../../../web/lib/types/desktop.ts'
import { getDesktopWebBaseUrl, isTauriRuntime } from './auth-runtime'

interface FetchLike {
  (input: RequestInfo | URL, init?: RequestInit): Promise<Response>
}

export interface FetchDesktopMeOptions {
  deviceCode: string
  fetchImpl?: FetchLike
  fetchInTauri?: (params: { deviceCode: string, webBaseUrl: string }) => Promise<DesktopMeResponse>
  runtime?: 'browser' | 'tauri'
  webBaseUrl?: string
}

export interface SyncDesktopActivePersonaOptions {
  deviceCode: string
  fetchImpl?: FetchLike
  runtime?: 'browser' | 'tauri'
  syncInTauri?: (params: {
    deviceCode: string
    sourceRef: string | null
    sourceType: DesktopCatalogSourceType | null
    webBaseUrl: string
  }) => Promise<DesktopMeResponse>
  webBaseUrl?: string
}

function normalizeDeviceCode(deviceCode: string) {
  const normalized = deviceCode.trim()
  if (!normalized) {
    throw new Error('deviceCode is required')
  }

  return normalized
}

function buildDesktopAuthHeaders(deviceCode: string, initHeaders?: HeadersInit) {
  const headers = new Headers(initHeaders)
  headers.set(DESKTOP_DEVICE_CODE_HEADER, normalizeDeviceCode(deviceCode))
  return headers
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
      : `Desktop profile request failed with status ${response.status}`
    throw new Error(errorMessage)
  }

  return body as T
}

export async function fetchDesktopMe(options: FetchDesktopMeOptions): Promise<DesktopMeResponse> {
  const runtime = options.runtime ?? (isTauriRuntime() ? 'tauri' : 'browser')
  const deviceCode = normalizeDeviceCode(options.deviceCode)
  const webBaseUrl = options.webBaseUrl ?? getDesktopWebBaseUrl()

  if (runtime === 'tauri') {
    const fetchInTauri = options.fetchInTauri ?? ((params: { deviceCode: string, webBaseUrl: string }) => (
      invoke<DesktopMeResponse>('fetch_desktop_me', params)
    ))

    return fetchInTauri({ deviceCode, webBaseUrl })
  }

  const fetchImpl = options.fetchImpl ?? fetch
  const response = await fetchImpl('/api/desktop/me', {
    headers: buildDesktopAuthHeaders(deviceCode),
    method: 'GET',
  })

  return parseJsonResponse<DesktopMeResponse>(response)
}

export async function syncDesktopActivePersona(
  params: {
    sourceRef: string | null
    sourceType: DesktopCatalogSourceType | null
  },
  options: SyncDesktopActivePersonaOptions,
): Promise<DesktopMeResponse> {
  const runtime = options.runtime ?? (isTauriRuntime() ? 'tauri' : 'browser')
  const deviceCode = normalizeDeviceCode(options.deviceCode)
  const webBaseUrl = options.webBaseUrl ?? getDesktopWebBaseUrl()

  if (runtime === 'tauri') {
    const syncInTauri = options.syncInTauri ?? ((input: {
      deviceCode: string
      sourceRef: string | null
      sourceType: DesktopCatalogSourceType | null
      webBaseUrl: string
    }) => (
      invoke<DesktopMeResponse>('sync_desktop_active_persona', input)
    ))

    return syncInTauri({
      deviceCode,
      sourceRef: params.sourceRef,
      sourceType: params.sourceType,
      webBaseUrl,
    })
  }

  const fetchImpl = options.fetchImpl ?? fetch
  const response = await fetchImpl('/api/desktop/me/active-persona', {
    body: JSON.stringify({
      sourceType: params.sourceType,
      sourceRef: params.sourceRef,
    }),
    headers: buildDesktopAuthHeaders(deviceCode, {
      'Content-Type': 'application/json',
    }),
    method: 'PUT',
  })

  return parseJsonResponse<DesktopMeResponse>(response)
}
