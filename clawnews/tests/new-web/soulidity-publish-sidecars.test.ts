import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  generateContentDocumentIdHex,
  isContentDocumentIdForVersion,
} from '../../packages/soulidity-sdk/src/content-document-id'

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
        label: string
        mirror?: MirrorRequest | MirrorRequest[]
        assertEvents?: {
          contentVersions?: Array<{
            kind?: number
            name?: string
            versionIndex?: number
            count: number
          }>
        }
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

  it('content sidecar document ids are validated against the version tuple and reused for access approval', () => {
    const contentObjectId = `0x${'11'.repeat(32)}`
    const documentId = generateContentDocumentIdHex({
      contentObjectId,
      kind: 2,
      name: 'skill-default',
      versionIndex: 4,
      nonce: new Uint8Array(16).fill(7),
    })

    expect(isContentDocumentIdForVersion(documentId, {
      contentObjectId,
      kind: 2,
      name: 'skill-default',
      versionIndex: 4,
    })).toBe(true)
    expect(isContentDocumentIdForVersion(documentId, {
      contentObjectId: `0x${'22'.repeat(32)}`,
      kind: 2,
      name: 'skill-default',
      versionIndex: 4,
    })).toBe(false)
    expect(isContentDocumentIdForVersion(documentId, {
      contentObjectId,
      kind: 3,
      name: 'skill-default',
      versionIndex: 4,
    })).toBe(false)
    expect(isContentDocumentIdForVersion(documentId, {
      contentObjectId,
      kind: 2,
      name: 'other-skill',
      versionIndex: 4,
    })).toBe(false)
    expect(isContentDocumentIdForVersion(documentId, {
      contentObjectId,
      kind: 2,
      name: 'skill-default',
      versionIndex: 5,
    })).toBe(false)

    const mirrorGate = readSource('web/lib/soulidity/mirror/build-seal-sidecars.ts')
    expect(mirrorGate).toContain('isContentDocumentIdForVersion')
    expect(mirrorGate).toContain('contentObjectId: input.contentObjectId')
    expect(mirrorGate).not.toContain('isValidContentDocumentId')

    const accessResolver = readSource('web/lib/soulidity/access.ts')
    expect(accessResolver).toContain('documentIdHex: params.version.sealSidecar.documentId')
    expect(accessResolver).not.toContain('generateContentDocumentIdHex')
  })

  it('mirror gate reports malformed sidecar envelopes as sync config errors', async () => {
    const { buildSyncSealSidecars, SealSidecarSyncConfigError } = await import('../../web/lib/soulidity/mirror/build-seal-sidecars')

    expect(() => buildSyncSealSidecars({
      contentObjectId: `0x${'11'.repeat(32)}`,
      entries: [{
        kind: 0,
        name: 'soul',
        versionIndex: 0,
        sealEncrypted: true,
        sidecar: {
          version: 1,
          mode: 'seal-envelope',
          documentId: '0x1234',
          encryptedDek: 'ZW5jcnlwdGVk',
          iv: 'AAAAAAAAAAAAAAAA',
          cipher: 'AES-GCM-256',
          mimeType: 'text/markdown',
          fileName: 'soul.md',
          contentHash: 'a'.repeat(64),
        },
      }],
    })).toThrow(SealSidecarSyncConfigError)
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

  it('PTB-only skills/assets smoke rows assert emitted content-version events', () => {
    const matrix = parseSmokeMatrix()
    const skillsRow = matrix.rows.find((row) => row.name === 'first-skills-root-plus-three-versions')
    const skillsStep = skillsRow?.steps.find((step) => step.label === 'ptb2-init-and-append-skills')
    expect(skillsStep?.mirror).toBeUndefined()
    expect(skillsStep?.assertEvents?.contentVersions).toEqual([{ kind: 2, count: 3 }])

    const assetsRow = matrix.rows.find((row) => row.name === 'first-assets-root-plus-three-sprite-versions')
    const assetsStep = assetsRow?.steps.find((step) => step.label === 'ptb2-init-and-append-assets')
    expect(assetsStep?.mirror).toBeUndefined()
    expect(assetsStep?.assertEvents?.contentVersions).toEqual([{ kind: 3, count: 3 }])

    const harness = readSource('scripts/smoke-soulidity.ts')
    expect(harness).toContain('extractAllContentVersionAppendedEvents')
    expect(harness).toContain('assertSmokeEvents')
    expect(harness).toContain('step.assertEvents')
  })
})
