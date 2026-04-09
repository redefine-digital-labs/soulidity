import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { DesktopMeResponse, DesktopPersonaManifest } from '../../web/lib/types/desktop'

function readText(relativePath: string) {
  return readFileSync(resolve(process.cwd(), relativePath), 'utf8')
}

const installedStarterManifest: DesktopPersonaManifest = {
  id: 'starter-aurora',
  sourceType: 'starter',
  sourceRef: 'starter-aurora',
  title: 'Aurora Starter',
  description: 'Starter persona for desktop install and sync.',
  coverImage: 'https://cdn.example.com/starters/aurora/cover.png',
  thumbnail: 'https://cdn.example.com/starters/aurora/thumb.png',
  version: '2026.04.10',
  checksum: 'sha256:aurora-manifest',
  files: [
    {
      path: 'bundle/aurora.zip',
      url: 'https://cdn.example.com/starters/aurora.zip',
      checksum: 'sha256:aurora-zip',
    },
  ],
  updatedAt: '2026-04-10T08:00:00.000Z',
}

describe('desktop profile sync transport', () => {
  it('fetches desktop account sync state with the desktop device header in browser preview mode', async () => {
    const profileModule = await import('../../desktop/src/lib/profile.ts')
    const { DESKTOP_DEVICE_CODE_HEADER } = await import('../../web/lib/types/desktop.ts')

    const responseBody: DesktopMeResponse = {
      profile: {
        accountId: 'account-123',
        activeSourceType: 'starter',
        activeSourceRef: 'starter-aurora',
        preferences: { dock: 'compact' },
        lastSyncedAt: '2026-04-10T08:10:00.000Z',
        updatedAt: '2026-04-10T08:10:00.000Z',
      },
      activePersona: installedStarterManifest,
    }

    let receivedHeader: string | null = null
    const result = await profileModule.fetchDesktopMe({
      runtime: 'browser',
      deviceCode: 'device-code-123',
      fetchImpl: async (_input, init) => {
        receivedHeader = new Headers(init?.headers).get(DESKTOP_DEVICE_CODE_HEADER)
        return new Response(JSON.stringify(responseBody), {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
          },
        })
      },
    })

    expect(receivedHeader).toBe('device-code-123')
    expect(result).toEqual(responseBody)
  })

  it('syncs the current device persona to the desktop profile API in browser preview mode', async () => {
    const profileModule = await import('../../desktop/src/lib/profile.ts')
    const { DESKTOP_DEVICE_CODE_HEADER } = await import('../../web/lib/types/desktop.ts')

    let requestMethod: string | undefined
    let requestHeader: string | null = null
    let requestBody: unknown = null

    await profileModule.syncDesktopActivePersona(
      {
        sourceType: 'starter',
        sourceRef: 'starter-aurora',
      },
      {
        runtime: 'browser',
        deviceCode: 'device-code-123',
        fetchImpl: async (_input, init) => {
          requestMethod = init?.method
          requestHeader = new Headers(init?.headers).get(DESKTOP_DEVICE_CODE_HEADER)
          requestBody = init?.body ? JSON.parse(String(init.body)) : null

          return new Response(JSON.stringify({
            profile: {
              accountId: 'account-123',
              activeSourceType: 'starter',
              activeSourceRef: 'starter-aurora',
              preferences: null,
              lastSyncedAt: '2026-04-10T08:15:00.000Z',
              updatedAt: '2026-04-10T08:15:00.000Z',
            },
            activePersona: installedStarterManifest,
          } satisfies DesktopMeResponse), {
            status: 200,
            headers: {
              'Content-Type': 'application/json',
            },
          })
        },
      },
    )

    expect(requestMethod).toBe('PUT')
    expect(requestHeader).toBe('device-code-123')
    expect(requestBody).toEqual({
      sourceType: 'starter',
      sourceRef: 'starter-aurora',
    })
  })
})

describe('desktop local active persona workflow', () => {
  it('stores and restores the current local active persona from installed records in browser preview mode', async () => {
    const runtimeModule = await import('../../desktop/src/lib/persona-runtime.ts')

    const storage = new Map<string, string>()
    const browserStorage = {
      getItem(key: string) {
        return storage.get(key) ?? null
      },
      setItem(key: string, value: string) {
        storage.set(key, value)
      },
    }

    const installedPersonas = [
      {
        personaId: installedStarterManifest.id,
        sourceType: installedStarterManifest.sourceType,
        sourceRef: installedStarterManifest.sourceRef,
        version: installedStarterManifest.version,
        checksum: installedStarterManifest.checksum,
        manifest: installedStarterManifest,
        bundlePath: '/browser-preview/soulidity-desktop/personas/bundles/starter-aurora/2026.04.10',
        runtimeAssetsPath: '/browser-preview/soulidity-desktop/personas/runtime/starter-aurora/2026.04.10',
        installedAt: '2026-04-10T08:05:00.000Z',
      },
    ]

    const activePersona = await runtimeModule.setDesktopActivePersona(installedStarterManifest.id, {
      runtime: 'browser',
      storage: browserStorage,
      now: () => new Date('2026-04-10T08:20:00.000Z'),
      loadStoredInstalledPersonas: async () => installedPersonas,
    })

    expect(activePersona).toEqual({
      personaId: installedStarterManifest.id,
      sourceType: 'starter',
      sourceRef: 'starter-aurora',
      activatedAt: '2026-04-10T08:20:00.000Z',
    })

    await expect(runtimeModule.loadDesktopActivePersona({
      runtime: 'browser',
      storage: browserStorage,
    })).resolves.toEqual(activePersona)

    await expect(runtimeModule.setDesktopActivePersona('missing-persona', {
      runtime: 'browser',
      storage: browserStorage,
      loadStoredInstalledPersonas: async () => installedPersonas,
    })).rejects.toThrow(/installed/i)
  })

  it('wires library/settings/account-sync UI surfaces plus smoke documentation for phase one', () => {
    const appSource = readText('desktop/src/App.tsx')
    const tauriLib = readText('desktop/src-tauri/src/lib.rs')
    const smokeDoc = readText('docs/desktop-phase-one-smoke.md')

    expect(appSource).toContain('Set as active on this device')
    expect(appSource).toContain('Sync current device persona to account')
    expect(appSource).toContain('Account sync status')
    expect(appSource).toContain('Current local active persona')
    expect(tauriLib).toContain('fetch_desktop_me')
    expect(tauriLib).toContain('sync_desktop_active_persona')
    expect(smokeDoc).toContain('macOS smoke path')
    expect(smokeDoc).toContain('Windows fallback strategy')
  })
})
