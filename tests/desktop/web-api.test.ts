import { describe, expect, it } from 'vitest'

import {
  DEFAULT_WEB_BASE_URL,
  getDesktopWebBaseUrl,
  readDesktopJsonResponse,
} from '../../desktop/apps/desktop/src/main/web-api'

describe('desktop web api response parser', () => {
  it('uses SOULIDITY_WEB_URL when configured', () => {
    expect(getDesktopWebBaseUrl({ SOULIDITY_WEB_URL: ' https://desktop.example ' } as NodeJS.ProcessEnv))
      .toBe('https://desktop.example')
  })

  it('falls back to the default desktop web URL', () => {
    expect(getDesktopWebBaseUrl({} as NodeJS.ProcessEnv)).toBe(DEFAULT_WEB_BASE_URL)
  })

  it('returns parsed JSON for successful JSON responses', async () => {
    const response = new Response(JSON.stringify({
      deviceCode: 'device-code',
      userCode: 'ABCD-EFGH',
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    })

    await expect(readDesktopJsonResponse(response, {
      action: 'Start desktop link',
      baseUrl: DEFAULT_WEB_BASE_URL,
      pathname: '/api/desktop/device/start',
    })).resolves.toEqual({
      deviceCode: 'device-code',
      userCode: 'ABCD-EFGH',
    })
  })

  it('surfaces API errors from JSON responses', async () => {
    const response = new Response(JSON.stringify({ error: 'Too many requests' }), {
      status: 429,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    })

    await expect(readDesktopJsonResponse(response, {
      action: 'Start desktop link',
      baseUrl: DEFAULT_WEB_BASE_URL,
      pathname: '/api/desktop/device/start',
    })).rejects.toThrow('Too many requests')
  })

  it('turns HTML 404 pages into an actionable configuration error', async () => {
    const createHtml404Response = () => new Response('<!DOCTYPE html><html><body>404</body></html>', {
      status: 404,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    })

    await expect(readDesktopJsonResponse(createHtml404Response(), {
      action: 'Start desktop link',
      baseUrl: DEFAULT_WEB_BASE_URL,
      pathname: '/api/desktop/device/start',
    })).rejects.toThrow(
      'returned HTML (404) instead of JSON',
    )

    await expect(readDesktopJsonResponse(createHtml404Response(), {
      action: 'Start desktop link',
      baseUrl: DEFAULT_WEB_BASE_URL,
      pathname: '/api/desktop/device/start',
    })).rejects.toThrow('/api/desktop/device/start')

    await expect(readDesktopJsonResponse(createHtml404Response(), {
      action: 'Start desktop link',
      baseUrl: DEFAULT_WEB_BASE_URL,
      pathname: '/api/desktop/device/start',
    })).rejects.toThrow('Use a deployed web app')
  })
})
