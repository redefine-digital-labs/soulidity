import type {
  DesktopCatalogItem,
  DesktopCatalogSourceType,
  DesktopPersonaManifest,
} from '../../../web/lib/types/desktop.ts'

export interface InstalledPersonaRecord {
  personaId: string
  sourceType: DesktopCatalogSourceType
  sourceRef: string
  version: string
  checksum: string
  manifest: DesktopPersonaManifest
  bundlePath: string
  runtimeAssetsPath: string
  installedAt: string
}

export interface ActivePersonaRecord {
  personaId: string
  sourceType: DesktopCatalogSourceType
  sourceRef: string
  activatedAt: string
}

export interface CatalogCacheRecord {
  syncedAt: string | null
  items: DesktopCatalogItem[]
  manifestsById: Record<string, DesktopPersonaManifest>
}

export interface AuthSessionRecord {
  accountId: string
  deviceCode: string
  userCode: string | null
  confirmedAt: string
  expiresAt: string | null
}

export type DownloadJobStatus = 'queued' | 'downloading' | 'verifying' | 'completed' | 'failed'

export interface DownloadJobRecord {
  jobId: string
  personaId: string
  status: DownloadJobStatus
  manifest: DesktopPersonaManifest
  tempFilePath: string
  targetBundlePath: string
  targetRuntimePath: string
  bytesDownloaded: number
  error: string | null
  createdAt: string
  updatedAt: string
}

export interface DesktopStateSnapshot {
  installedPersonas: InstalledPersonaRecord[]
  activePersona: ActivePersonaRecord | null
  catalogCache: CatalogCacheRecord
  authSession: AuthSessionRecord | null
  downloadJobs: DownloadJobRecord[]
}

export const desktopStateFileNames = {
  installedPersonas: 'installed_personas.json',
  activePersona: 'active_persona.json',
  catalogCache: 'catalog_cache.json',
  authSession: 'auth_session.json',
  downloadJobs: 'download_jobs.json',
} as const

export interface DesktopStorageLayout {
  rootDir: string
  stateDir: string
  personasDir: string
  bundlesDir: string
  runtimeAssetsDir: string
  downloadsDir: string
  tempDownloadsDir: string
  stateFiles: Record<keyof typeof desktopStateFileNames, string>
}

function detectPathSeparator(rootDir: string) {
  return rootDir.includes('\\') ? '\\' : '/'
}

function normalizeRootDir(rootDir: string) {
  const trimmed = rootDir.trim()
  if (!trimmed) {
    throw new Error('rootDir must be a non-empty string')
  }

  return trimmed.replace(/[\\/]+$/, '')
}

function joinLayoutPath(rootDir: string, ...segments: string[]) {
  const separator = detectPathSeparator(rootDir)
  const normalizedRootDir = normalizeRootDir(rootDir)
  const normalizedSegments = segments
    .map((segment) => segment.trim().replace(/^[\\/]+|[\\/]+$/g, ''))
    .filter(Boolean)

  return [normalizedRootDir, ...normalizedSegments].join(separator)
}

export function resolveDesktopStorageLayout(rootDir: string): DesktopStorageLayout {
  const normalizedRootDir = normalizeRootDir(rootDir)
  const stateDir = joinLayoutPath(normalizedRootDir, 'state')
  const personasDir = joinLayoutPath(normalizedRootDir, 'personas')
  const downloadsDir = joinLayoutPath(normalizedRootDir, 'downloads')

  return {
    rootDir: normalizedRootDir,
    stateDir,
    personasDir,
    bundlesDir: joinLayoutPath(personasDir, 'bundles'),
    runtimeAssetsDir: joinLayoutPath(personasDir, 'runtime'),
    downloadsDir,
    tempDownloadsDir: joinLayoutPath(downloadsDir, 'temp'),
    stateFiles: {
      installedPersonas: joinLayoutPath(stateDir, desktopStateFileNames.installedPersonas),
      activePersona: joinLayoutPath(stateDir, desktopStateFileNames.activePersona),
      catalogCache: joinLayoutPath(stateDir, desktopStateFileNames.catalogCache),
      authSession: joinLayoutPath(stateDir, desktopStateFileNames.authSession),
      downloadJobs: joinLayoutPath(stateDir, desktopStateFileNames.downloadJobs),
    },
  }
}

export function createEmptyDesktopStateSnapshot(): DesktopStateSnapshot {
  return {
    installedPersonas: [],
    activePersona: null,
    catalogCache: {
      syncedAt: null,
      items: [],
      manifestsById: {},
    },
    authSession: null,
    downloadJobs: [],
  }
}
