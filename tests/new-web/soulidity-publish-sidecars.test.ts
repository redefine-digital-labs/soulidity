import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = process.cwd()
const SMOKE_MATRIX_PATH = 'scripts/scenarios/soulidity-smoke-matrix.example.json'

const LEGACY_SIDECAR_REQUEST_FIELDS = [
  'sealSidecar',
  'memorySealSidecar',
  'skillsSealSidecar',
  'assetsSealSidecar',
] as const

function readSource(path: string) {
  return readFileSync(join(ROOT, path), 'utf8')
}

function parseSmokeMatrix() {
  return JSON.parse(readSource(SMOKE_MATRIX_PATH)) as {
    rows: Array<{
      name: string
      steps: Array<{
        mirror?: MirrorRequest | MirrorRequest[]
      }>
    }>
  }
}

interface MirrorRequest {
  path: string
  body?: Record<string, unknown>
}

function collectMirrorRequests(matrix: ReturnType<typeof parseSmokeMatrix>): MirrorRequest[] {
  const mirrors: MirrorRequest[] = []
  for (const row of matrix.rows) {
    for (const step of row.steps) {
      if (!step.mirror) continue
      mirrors.push(...(Array.isArray(step.mirror) ? step.mirror : [step.mirror]))
    }
  }
  return mirrors
}

function collectLegacySidecarMentions(value: unknown, path = '$'): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => collectLegacySidecarMentions(item, `${path}[${index}]`))
  }
  if (value && typeof value === 'object') {
    const hits: string[] = []
    for (const [key, item] of Object.entries(value)) {
      if ((LEGACY_SIDECAR_REQUEST_FIELDS as readonly string[]).includes(key)) {
        hits.push(`${path}.${key}`)
      }
      hits.push(...collectLegacySidecarMentions(item, `${path}.${key}`))
    }
    return hits
  }
  if (typeof value === 'string') {
    return LEGACY_SIDECAR_REQUEST_FIELDS
      .filter((field) => value.includes(field))
      .map((field) => `${path} contains ${field}`)
  }
  return []
}

function expectInitialContentSidecars(value: unknown, context: string) {
  expect(Array.isArray(value), `${context} must include contentSidecars[]`).toBe(true)
  const entries = value as Array<Record<string, unknown>>
  const keys = entries.map((entry) => `${entry.kind}::${entry.name}::${entry.versionIndex}`)
  expect(keys, `${context} must include the Soul document sidecar entry`).toContain('0::soul::0')
  expect(keys, `${context} must include the default memory sidecar entry`).toContain('1::default::0')
  for (const [index, entry] of entries.entries()) {
    expect(typeof entry.kind, `${context}.contentSidecars[${index}].kind`).toBe('number')
    expect(typeof entry.name, `${context}.contentSidecars[${index}].name`).toBe('string')
    expect(typeof entry.versionIndex, `${context}.contentSidecars[${index}].versionIndex`).toBe('number')
    expect(Object.prototype.hasOwnProperty.call(entry, 'sidecar'), `${context}.contentSidecars[${index}].sidecar`).toBe(true)
  }
}

describe('Soulidity publish content sidecars', () => {
  it('single-soul create publish sync sends Phase 2 contentSidecars', () => {
    const source = readSource('web/lib/hooks/use-publish.ts')

    expect(source).toContain('contentSidecars: ContentSidecarRequestEntry[]')
    expect(source).toContain('buildContentSidecarsForVersionsWithSuiClient')
    expect(source).toContain('extractAllContentVersionAppendedEvents')
    expect(source).not.toContain('PHASE2_PENDING_SIDECAR')
    for (const field of LEGACY_SIDECAR_REQUEST_FIELDS) {
      expect(source).not.toContain(`${field}:`)
      expect(source).not.toContain(`.${field}`)
      expect(source).not.toContain(`'${field}'`)
      expect(source).not.toContain(`"${field}"`)
    }
  })

  it('collection publish sync bodies also use Phase 2 contentSidecars', () => {
    const source = readSource('web/lib/hooks/use-collection-publish.ts')

    expect(source).toContain('contentSidecars: ContentSidecarRequestEntry[]')
    expect(source).toContain('buildContentSidecarsForVersionsWithSuiClient')
    expect(source).toContain('extractAllContentVersionAppendedEvents')
    expect(source).not.toContain('PHASE2_PENDING_SIDECAR')
    for (const field of LEGACY_SIDECAR_REQUEST_FIELDS) {
      expect(source).not.toContain(`${field}:`)
      expect(source).not.toContain(`.${field}`)
      expect(source).not.toContain(`'${field}'`)
      expect(source).not.toContain(`"${field}"`)
    }
  })

  it('collection recovery preserves legacy private sprite material as a content sidecar', () => {
    const source = readSource('web/lib/hooks/use-collection-publish.ts')

    expect(source).toContain('assetsSealMaterial?: PendingSealMaterial | null')
    expect(source).toContain('hasValidOptionalLegacyAssetsSealMaterial')
    expect(source).toContain('!hasValidOptionalLegacyAssetsSealMaterial(soul.uploads.assetsSealMaterial)')
    expect(source).toContain('spriteMaterial: params.uploads.assetsSealMaterial ?? null')
    expect(source).toContain('spriteName: legacySpriteVersion?.name ?? null')
  })

  it('smoke matrix mirrors the contentSidecars request contract', () => {
    const raw = readSource(SMOKE_MATRIX_PATH)
    expect(() => JSON.parse(raw)).not.toThrow()

    const matrix = parseSmokeMatrix()
    expect(collectLegacySidecarMentions(matrix)).toEqual([])

    const mirrors = collectMirrorRequests(matrix)
    const publishMirrors = mirrors.filter((mirror) => mirror.path === '/api/souls/publish')
    expect(publishMirrors.length).toBeGreaterThan(0)
    for (const [index, mirror] of publishMirrors.entries()) {
      expectInitialContentSidecars(mirror.body?.contentSidecars, `/api/souls/publish mirror ${index}`)
    }

    const batchMirrors = mirrors.filter((mirror) => mirror.path === '/api/souls/publish/batch')
    expect(batchMirrors.length).toBeGreaterThan(0)
    for (const [mirrorIndex, mirror] of batchMirrors.entries()) {
      expect(Array.isArray(mirror.body?.syncBodies), `/api/souls/publish/batch mirror ${mirrorIndex}`).toBe(true)
      for (const [bodyIndex, syncBody] of (mirror.body?.syncBodies as Array<Record<string, unknown>>).entries()) {
        expectInitialContentSidecars(
          syncBody.contentSidecars,
          `/api/souls/publish/batch mirror ${mirrorIndex} syncBodies[${bodyIndex}]`,
        )
      }
    }
  })

  it('smoke matrix does not advertise non-existent first-party skills/assets mirror routes', () => {
    const mirrors = collectMirrorRequests(parseSmokeMatrix())
    const paths = mirrors.map((mirror) => mirror.path)

    expect(paths).not.toContain('/api/souls/__SOUL_ON_CHAIN_ID__/skills')
    expect(paths).not.toContain('/api/souls/__SOUL_ON_CHAIN_ID__/assets')
  })
})
