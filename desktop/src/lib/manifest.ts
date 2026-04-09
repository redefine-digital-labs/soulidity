import type {
  DesktopCatalogSourceType,
  DesktopPersonaManifest,
  DesktopPersonaManifestFile,
} from '../../../web/lib/types/desktop.ts'

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === 'object' && input !== null && !Array.isArray(input)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isDesktopCatalogSourceType(value: unknown): value is DesktopCatalogSourceType {
  return value === 'starter' || value === 'soul'
}

function isIsoDateString(value: unknown): value is string {
  if (!isNonEmptyString(value)) {
    return false
  }

  return !Number.isNaN(Date.parse(value))
}

function isUrlString(value: unknown): value is string {
  if (!isNonEmptyString(value)) {
    return false
  }

  try {
    new URL(value)
    return true
  } catch {
    return false
  }
}

function readNonEmptyString(record: Record<string, unknown>, key: string, message: string) {
  const value = record[key]
  if (!isNonEmptyString(value)) {
    throw new Error(message)
  }

  return value.trim()
}

function readUrlString(record: Record<string, unknown>, key: string, message: string) {
  const value = record[key]
  if (!isUrlString(value)) {
    throw new Error(message)
  }

  return value.trim()
}

function readIsoDateString(record: Record<string, unknown>, key: string, message: string) {
  const value = record[key]
  if (!isIsoDateString(value)) {
    throw new Error(message)
  }

  return new Date(value).toISOString()
}

function parseManifestFile(input: unknown, index: number): DesktopPersonaManifestFile {
  if (!isRecord(input)) {
    throw new Error(`files[${index}] must be an object`)
  }

  return {
    path: readNonEmptyString(input, 'path', `files[${index}].path must be a non-empty string`),
    url: readUrlString(input, 'url', `files[${index}].url must be an absolute URL`),
    checksum: readNonEmptyString(input, 'checksum', `files[${index}].checksum must be a non-empty string`),
  }
}

export function parseDesktopPersonaManifest(input: unknown): DesktopPersonaManifest {
  if (!isRecord(input)) {
    throw new Error('manifest must be an object')
  }

  if (!isDesktopCatalogSourceType(input.sourceType)) {
    throw new Error('sourceType must be "starter" or "soul"')
  }

  if (input.description !== null && input.description !== undefined && typeof input.description !== 'string') {
    throw new Error('description must be a string or null')
  }

  if (!Array.isArray(input.files) || input.files.length === 0) {
    throw new Error('files must be a non-empty array')
  }

  return {
    id: readNonEmptyString(input, 'id', 'id must be a non-empty string'),
    sourceType: input.sourceType,
    sourceRef: readNonEmptyString(input, 'sourceRef', 'sourceRef must be a non-empty string'),
    title: readNonEmptyString(input, 'title', 'title must be a non-empty string'),
    description: typeof input.description === 'string' ? input.description : null,
    coverImage: readUrlString(input, 'coverImage', 'coverImage must be an absolute URL'),
    thumbnail: readUrlString(input, 'thumbnail', 'thumbnail must be an absolute URL'),
    updatedAt: readIsoDateString(input, 'updatedAt', 'updatedAt must be an ISO-compatible date string'),
    version: readNonEmptyString(input, 'version', 'version must be a non-empty string'),
    checksum: readNonEmptyString(input, 'checksum', 'checksum must be a non-empty string'),
    files: input.files.map((file, index) => parseManifestFile(file, index)),
  }
}

export function isDesktopPersonaManifest(input: unknown): input is DesktopPersonaManifest {
  try {
    parseDesktopPersonaManifest(input)
    return true
  } catch {
    return false
  }
}
