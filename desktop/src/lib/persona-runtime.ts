import { invoke } from '@tauri-apps/api/core'
import type { DesktopPersonaManifest } from '../../../web/lib/types/desktop.ts'
import { isTauriRuntime } from './auth-runtime'
import type { InstalledPersonaRecord } from './persistence'
import { resolveDesktopStorageLayout } from './persistence'

export interface InstallDesktopPersonaOptions {
  installInTauri?: (manifest: DesktopPersonaManifest) => Promise<InstalledPersonaRecord>
  loadStoredInstalledPersonas?: () => Promise<InstalledPersonaRecord[]> | InstalledPersonaRecord[]
  now?: () => Date
  runtime?: 'browser' | 'tauri'
  saveStoredInstalledPersonas?: (records: InstalledPersonaRecord[]) => Promise<void> | void
  storage?: KeyValueStorage | null
}

export interface KeyValueStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

const BROWSER_INSTALLED_PERSONAS_STORAGE_KEY = 'soulidity.desktop.installed-personas'
const BROWSER_PREVIEW_STORAGE_ROOT = '/browser-preview/soulidity-desktop'

function sanitizeStorageSegment(value: string) {
  const sanitized = value
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')

  return sanitized || 'item'
}

function getDefaultStorage(storage?: KeyValueStorage | null) {
  if (storage) {
    return storage
  }

  if (typeof window === 'undefined') {
    return null
  }

  return window.localStorage
}

export function loadInstalledPersonasFromStorage(storage?: KeyValueStorage | null): InstalledPersonaRecord[] {
  const resolvedStorage = getDefaultStorage(storage)
  if (!resolvedStorage) {
    return []
  }

  const rawValue = resolvedStorage.getItem(BROWSER_INSTALLED_PERSONAS_STORAGE_KEY)
  if (!rawValue) {
    return []
  }

  try {
    const records = JSON.parse(rawValue) as InstalledPersonaRecord[]
    return Array.isArray(records) ? records : []
  } catch {
    return []
  }
}

export function saveInstalledPersonasToStorage(records: InstalledPersonaRecord[], storage?: KeyValueStorage | null) {
  const resolvedStorage = getDefaultStorage(storage)
  if (!resolvedStorage) {
    return
  }

  resolvedStorage.setItem(BROWSER_INSTALLED_PERSONAS_STORAGE_KEY, JSON.stringify(records))
}

function buildPreviewInstalledPersonaRecord(
  manifest: DesktopPersonaManifest,
  now: Date,
): InstalledPersonaRecord {
  const layout = resolveDesktopStorageLayout(BROWSER_PREVIEW_STORAGE_ROOT)
  const personaSegment = sanitizeStorageSegment(manifest.id)
  const versionSegment = sanitizeStorageSegment(manifest.version)

  return {
    personaId: manifest.id,
    sourceType: manifest.sourceType,
    sourceRef: manifest.sourceRef,
    version: manifest.version,
    checksum: manifest.checksum,
    manifest,
    bundlePath: `${layout.bundlesDir}/${personaSegment}/${versionSegment}`,
    runtimeAssetsPath: `${layout.runtimeAssetsDir}/${personaSegment}/${versionSegment}`,
    installedAt: now.toISOString(),
  }
}

export async function loadDesktopInstalledPersonas(
  options: { runtime?: 'browser' | 'tauri', storage?: KeyValueStorage | null } = {},
) {
  const runtime = options.runtime ?? (isTauriRuntime() ? 'tauri' : 'browser')

  if (runtime === 'tauri') {
    return invoke<InstalledPersonaRecord[]>('load_installed_personas')
  }

  return loadInstalledPersonasFromStorage(options.storage)
}

export async function installDesktopPersona(
  manifest: DesktopPersonaManifest,
  options: InstallDesktopPersonaOptions = {},
): Promise<InstalledPersonaRecord> {
  if (manifest.sourceType !== 'starter') {
    throw new Error('Anonymous desktop installs are only available for starter personas')
  }

  const runtime = options.runtime ?? (isTauriRuntime() ? 'tauri' : 'browser')

  if (runtime === 'tauri') {
    const installInTauri = options.installInTauri ?? ((inputManifest: DesktopPersonaManifest) => (
      invoke<InstalledPersonaRecord>('install_persona', { manifest: inputManifest })
    ))

    return installInTauri(manifest)
  }

  const now = options.now ?? (() => new Date())
  const loadStoredInstalledPersonas = options.loadStoredInstalledPersonas
    ?? (() => loadInstalledPersonasFromStorage(options.storage))
  const saveStoredInstalledPersonas = options.saveStoredInstalledPersonas
    ?? ((records: InstalledPersonaRecord[]) => saveInstalledPersonasToStorage(records, options.storage))
  const currentRecords = await loadStoredInstalledPersonas()
  const nextRecord = buildPreviewInstalledPersonaRecord(manifest, now())
  const nextRecords = [
    ...currentRecords.filter((record) => record.personaId !== manifest.id),
    nextRecord,
  ]

  await saveStoredInstalledPersonas(nextRecords)
  return nextRecord
}
