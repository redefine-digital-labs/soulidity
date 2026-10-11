import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  generateContentDocumentIdHex,
  isContentDocumentIdForVersion,
} from '../../packages/soulidity-sdk/src/content-document-id'

const ROOT = process.cwd()
const ORIGINAL_SEAL_PACKAGE_ID = `0x${'22'.repeat(32)}`
const CALLABLE_PACKAGE_ID = `0x${'44'.repeat(32)}`

function fakeSealEncryptedObject(packageId: string, documentId: string) {
  const packageBytes = Buffer.from(packageId.slice(2).padStart(64, '0'), 'hex')
  const idBytes = Buffer.from(documentId.slice(2), 'hex')
  if (idBytes.length >= 128) throw new Error('Test document id is too long')
  return new Uint8Array([
    0,
    ...packageBytes,
    idBytes.length,
    ...idBytes,
    0,
    1,
    0,
    ...new Uint8Array(96),
    0,
    ...new Uint8Array(32),
    2,
  ])
}

const LEGACY_SIDECAR_REQUEST_FIELDS = [
  'sealSidecar',
  'memorySealSidecar',
  'skillsSealSidecar',
  'assetsSealSidecar',
] as const

function readSource(path: string) {
  return readFileSync(join(ROOT, path), 'utf8')
}

describe('Soulidity publish content sidecars', () => {
  it('requires the exact selected Soul event slots before mirror writes', async () => {
    const { parseContentSidecars, assertExactContentSidecarSlots } = await import('../../web/lib/soulidity/mirror/parse-content-sidecars')
    const slots = [
      { kind: 0, name: 'soul', versionIndex: 0, sidecar: null, sealEncrypted: true },
      { kind: 1, name: 'default', versionIndex: 0, sidecar: null, sealEncrypted: true },
    ]
    const parsed = parseContentSidecars(slots, 'contentSidecars')
    expect(() => assertExactContentSidecarSlots(parsed, slots.toReversed())).not.toThrow()
    expect(() => assertExactContentSidecarSlots(parsed, slots.slice(0, 1))).toThrow('unexpected')
    expect(() => assertExactContentSidecarSlots(parseContentSidecars([], 'contentSidecars'), slots)).toThrow('missing')
    expect(() => assertExactContentSidecarSlots(parsed, [...slots, slots[0]])).toThrow('duplicate')
    expect(() => parseContentSidecars([...slots, slots[0]], 'contentSidecars')).toThrow('duplicate')
    const publicSlots = slots.map(slot => ({ ...slot, sealEncrypted: false }))
    expect(() => assertExactContentSidecarSlots(parseContentSidecars(undefined, 'contentSidecars'), publicSlots)).not.toThrow()
    expect(() => assertExactContentSidecarSlots(parsed, publicSlots)).not.toThrow()
    expect(() => assertExactContentSidecarSlots(parseContentSidecars([slots[0]], 'contentSidecars'), [slots[0], publicSlots[1]])).not.toThrow()
    expect(() => assertExactContentSidecarSlots(parsed, [publicSlots[0]])).toThrow('unexpected')
    for (const changed of [
      { ...slots[0], kind: 2 }, { ...slots[0], name: 'other-soul' }, { ...slots[0], versionIndex: 1 },
    ]) {
      expect(() => assertExactContentSidecarSlots(parsed, [changed, slots[1]])).toThrow('missing')
    }
    const source = readSource('web/app/api/souls/publish/route.ts')
    const guard = source.indexOf('assertExactContentSidecarSlots(contentSidecars, versionsForSoul)')
    expect(guard).toBeGreaterThan(source.indexOf('allContentVersions.filter'))
    expect(guard).toBeLessThan(source.indexOf('await syncSoulProjectionFromChain('))
    expect(guard).toBeLessThan(source.indexOf('await syncContentVersionProjectionFromChain('))
  })

  it('single-soul creation prepares durable encrypted content before constructing its wallet execution', () => {
    const source = readSource('web/lib/hooks/use-publish.ts')

    const prepare = source.lastIndexOf('await prepareSoulAuthoring(')
    expect(prepare).toBeGreaterThan(0)
    expect(source.indexOf('createSoulAuthoringWallet({')).toBeGreaterThan(prepare)
    expect(source).toContain("uploadType: 'encrypted', kind: 'soul-content'")
    expect(source).not.toContain('buildContentSidecarsForVersionsWithSuiClient')
    expect(source).not.toContain('/api/souls/publish')
    expect(source).not.toContain('PHASE2_PENDING_SIDECAR')
    for (const field of LEGACY_SIDECAR_REQUEST_FIELDS) {
      expect(source).not.toContain(`${field}:`)
      expect(source).not.toContain(`.${field}`)
      expect(source).not.toContain(`'${field}'`)
      expect(source).not.toContain(`"${field}"`)
    }
  })

  it('Collection uses pre-payment encrypted authoring and has no plaintext mirror recovery', () => {
    const source = readSource('web/lib/hooks/use-collection-publish.ts')
    expect(source).toContain("useSingleSoulAuthoring(approve, 'COLLECTION')")
    expect(source).not.toContain('PendingSealMaterial')
    expect(source).not.toContain('sessionStorage')
    expect(source).not.toContain('/api/')
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
    expect(accessResolver).toContain('documentIdHex: sealSidecar.documentId')
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

  it('migrates a legacy sidecar by inferring its original Seal namespace', async () => {
    const { buildSyncSealSidecars } = await import('../../web/lib/soulidity/mirror/build-seal-sidecars')
    const contentObjectId = `0x${'11'.repeat(32)}`
    const documentId = generateContentDocumentIdHex({
      contentObjectId,
      kind: 0,
      name: 'soul',
      versionIndex: 0,
      nonce: new Uint8Array(16).fill(7),
    })
    const result = buildSyncSealSidecars({
      contentObjectId,
      sealPackageId: ORIGINAL_SEAL_PACKAGE_ID,
      entries: [{
        kind: 0,
        name: 'soul',
        versionIndex: 0,
        sealEncrypted: true,
        sidecar: {
          version: 1,
          mode: 'seal-envelope',
          documentId,
          encryptedDek: Buffer.from(fakeSealEncryptedObject(
            ORIGINAL_SEAL_PACKAGE_ID,
            documentId,
          )).toString('base64'),
          iv: 'AAAAAAAAAAAAAAAA',
          cipher: 'AES-GCM-256',
          mimeType: 'text/markdown',
          fileName: 'soul.md',
          contentHash: 'a'.repeat(64),
        },
      }],
    })

    expect(result.validatedEntries[0]?.validatedSidecar?.sealPackageId)
      .toBe(ORIGINAL_SEAL_PACKAGE_ID)
  })

  it('rejects a sidecar encrypted under the upgraded callable package', async () => {
    const { buildSyncSealSidecars, SealSidecarSyncConfigError } = await import('../../web/lib/soulidity/mirror/build-seal-sidecars')
    const contentObjectId = `0x${'11'.repeat(32)}`
    const documentId = generateContentDocumentIdHex({
      contentObjectId,
      kind: 0,
      name: 'soul',
      versionIndex: 0,
      nonce: new Uint8Array(16).fill(8),
    })

    expect(() => buildSyncSealSidecars({
      contentObjectId,
      sealPackageId: ORIGINAL_SEAL_PACKAGE_ID,
      entries: [{
        kind: 0,
        name: 'soul',
        versionIndex: 0,
        sealEncrypted: true,
        sidecar: {
          version: 1,
          mode: 'seal-envelope',
          sealPackageId: CALLABLE_PACKAGE_ID,
          documentId,
          encryptedDek: Buffer.from(fakeSealEncryptedObject(
            CALLABLE_PACKAGE_ID,
            documentId,
          )).toString('base64'),
          iv: 'AAAAAAAAAAAAAAAA',
          cipher: 'AES-GCM-256',
          mimeType: 'text/markdown',
          fileName: 'soul.md',
          contentHash: 'a'.repeat(64),
        },
      }],
    })).toThrow(SealSidecarSyncConfigError)
  })

})
