import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

function readText(relativePath: string) {
  return readFileSync(resolve(process.cwd(), relativePath), 'utf8')
}

describe('desktop auth flow contract', () => {
  it('starts device binding by opening the browser confirmation page for the issued user code', async () => {
    const authModule = await import('../../desktop/src/lib/auth.ts')
    const openedUrls: string[] = []

    const pendingSession = await authModule.startDesktopDeviceAuthorization({
      now: () => new Date('2026-04-10T03:00:00.000Z'),
      openBrowser: async (url: string) => {
        openedUrls.push(url)
      },
      startSession: async () => ({
        deviceCode: 'device-code-123',
        userCode: 'ABCD-EFGH',
        expiresAt: '2026-04-10T03:10:00.000Z',
        pollInterval: 5,
      }),
      webBaseUrl: 'http://localhost:3100',
    })

    expect(openedUrls).toEqual([
      'http://localhost:3100/desktop/device?userCode=ABCD-EFGH',
    ])
    expect(pendingSession).toEqual({
      deviceCode: 'device-code-123',
      userCode: 'ABCD-EFGH',
      expiresAt: '2026-04-10T03:10:00.000Z',
      pollInterval: 5,
      confirmationUrl: 'http://localhost:3100/desktop/device?userCode=ABCD-EFGH',
      startedAt: '2026-04-10T03:00:00.000Z',
    })
  })

  it('handles a confirmed soulidity deep link, persists the local auth session, and restores it after restart', async () => {
    const authModule = await import('../../desktop/src/lib/auth.ts')
    const persistedSessions: unknown[] = []

    const authSession = await authModule.completeDesktopDeviceAuthorizationFromDeepLink(
      'soulidity://auth/device?deviceCode=device-code-123&status=confirmed',
      {
        now: () => new Date('2026-04-10T03:04:00.000Z'),
        pendingSession: {
          deviceCode: 'device-code-123',
          userCode: 'ABCD-EFGH',
          expiresAt: '2026-04-10T03:10:00.000Z',
          pollInterval: 5,
          confirmationUrl: 'http://localhost:3100/desktop/device?userCode=ABCD-EFGH',
          startedAt: '2026-04-10T03:00:00.000Z',
        },
        pollSession: async (deviceCode: string) => {
          expect(deviceCode).toBe('device-code-123')
          return {
            status: 'confirmed' as const,
            accountId: 'acct-123',
            deepLink: null,
            expiresAt: '2026-04-10T03:10:00.000Z',
            pollInterval: 5,
          }
        },
        saveSession: async (session) => {
          persistedSessions.push(session)
        },
      },
    )

    expect(authSession).toEqual({
      accountId: 'acct-123',
      deviceCode: 'device-code-123',
      userCode: 'ABCD-EFGH',
      confirmedAt: '2026-04-10T03:04:00.000Z',
      expiresAt: '2026-04-10T03:10:00.000Z',
    })
    expect(persistedSessions).toEqual([authSession])

    expect(
      authModule.restoreDesktopAuthSession(authSession, {
        now: new Date('2026-04-10T03:05:00.000Z'),
      }),
    ).toEqual(authSession)

    expect(
      authModule.restoreDesktopAuthSession(authSession, {
        now: new Date('2026-04-10T03:11:00.000Z'),
      }),
    ).toBeNull()
  })

  it('registers desktop deep links, browser opener support, and auth session persistence commands in the Tauri shell', () => {
    const desktopPackage = readText('desktop/package.json')
    const cargoToml = readText('desktop/src-tauri/Cargo.toml')
    const tauriConfig = readText('desktop/src-tauri/tauri.conf.json')
    const capability = readText('desktop/src-tauri/capabilities/default.json')
    const tauriLib = readText('desktop/src-tauri/src/lib.rs')
    const appSource = readText('desktop/src/App.tsx')

    expect(desktopPackage).toContain('@tauri-apps/plugin-deep-link')
    expect(desktopPackage).toContain('@tauri-apps/plugin-opener')
    expect(cargoToml).toContain('tauri-plugin-deep-link')
    expect(cargoToml).toContain('tauri-plugin-opener')
    expect(cargoToml).toContain('tauri-plugin-single-instance')
    expect(tauriConfig).toContain('"deep-link"')
    expect(tauriConfig).toContain('"soulidity"')
    expect(capability).toContain('core:event:default')
    expect(capability).toContain('deep-link:default')
    expect(capability).toContain('opener:default')
    expect(tauriLib).toContain('load_auth_session')
    expect(tauriLib).toContain('save_auth_session')
    expect(tauriLib).toContain('clear_auth_session')
    expect(tauriLib).toContain('tauri_plugin_deep_link')
    expect(tauriLib).toContain('tauri_plugin_opener')
    expect(appSource).toContain('Start browser sign-in')
    expect(appSource).toContain('getCurrentDeepLinks')
    expect(appSource).toContain('loadPersistedAuthSession')
  })
})
