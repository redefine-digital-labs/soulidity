import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { DesktopPersonaManifest } from '../../web/lib/types/desktop'

const persistenceModulePath = resolve(process.cwd(), 'desktop/src/lib/persistence.ts')
const manifestModulePath = resolve(process.cwd(), 'desktop/src/lib/manifest.ts')

describe('desktop persistence contract', () => {
  it('defines the phase-one storage layout and default persisted state records', async () => {
    expect(existsSync(persistenceModulePath)).toBe(true)

    const persistenceModule = await import('../../desktop/src/lib/persistence.ts')
    const rootDir = join(process.cwd(), 'tmp-desktop-root')

    expect(persistenceModule.desktopStateFileNames).toEqual({
      installedPersonas: 'installed_personas.json',
      activePersona: 'active_persona.json',
      catalogCache: 'catalog_cache.json',
      authSession: 'auth_session.json',
      downloadJobs: 'download_jobs.json',
    })

    expect(persistenceModule.resolveDesktopStorageLayout(rootDir)).toEqual({
      rootDir,
      stateDir: join(rootDir, 'state'),
      personasDir: join(rootDir, 'personas'),
      bundlesDir: join(rootDir, 'personas', 'bundles'),
      runtimeAssetsDir: join(rootDir, 'personas', 'runtime'),
      downloadsDir: join(rootDir, 'downloads'),
      tempDownloadsDir: join(rootDir, 'downloads', 'temp'),
      stateFiles: {
        installedPersonas: join(rootDir, 'state', 'installed_personas.json'),
        activePersona: join(rootDir, 'state', 'active_persona.json'),
        catalogCache: join(rootDir, 'state', 'catalog_cache.json'),
        authSession: join(rootDir, 'state', 'auth_session.json'),
        downloadJobs: join(rootDir, 'state', 'download_jobs.json'),
      },
    })

    expect(persistenceModule.createEmptyDesktopStateSnapshot()).toEqual({
      installedPersonas: [],
      activePersona: null,
      catalogCache: {
        syncedAt: null,
        items: [],
        manifestsById: {},
      },
      authSession: null,
      downloadJobs: [],
    })
  })

  it('parses valid desktop manifests and rejects malformed payloads before local persistence uses them', async () => {
    expect(existsSync(manifestModulePath)).toBe(true)

    const manifestModule = await import('../../desktop/src/lib/manifest.ts')
    const validManifest: DesktopPersonaManifest = {
      id: 'catalog-starter-aurora',
      sourceType: 'starter',
      sourceRef: 'aurora-starter',
      title: 'Aurora Starter',
      description: 'Starter persona for desktop bootstrap.',
      coverImage: 'https://cdn.example.com/aurora-cover.png',
      thumbnail: 'https://cdn.example.com/aurora-thumb.png',
      updatedAt: '2026-04-10T02:00:00.000Z',
      version: '2026.04.10',
      checksum: 'sha256:manifest-aurora',
      files: [
        {
          path: 'bundle/aurora.zip',
          url: 'https://cdn.example.com/aurora.zip',
          checksum: 'sha256:file-aurora',
        },
      ],
    }

    expect(manifestModule.parseDesktopPersonaManifest(validManifest)).toEqual(validManifest)
    expect(manifestModule.isDesktopPersonaManifest(validManifest)).toBe(true)
    expect(
      manifestModule.isDesktopPersonaManifest({
        ...validManifest,
        files: [],
      }),
    ).toBe(false)
    expect(() =>
      manifestModule.parseDesktopPersonaManifest({
        ...validManifest,
        sourceType: 'unknown',
      }),
    ).toThrow(/sourceType/i)
    expect(() =>
      manifestModule.parseDesktopPersonaManifest({
        ...validManifest,
        files: [
          {
            path: '',
            url: 'notaurl',
            checksum: '',
          },
        ],
      }),
    ).toThrow(/files/i)
  })
})
