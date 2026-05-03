import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@mysten/dapp-kit', () => ({
  useSuiClient: () => null,
}))

import { attachSoulidityDeploymentSignature } from '@/lib/soulidity/client-session'
import { sanitizeSkillAppendRecoveryState } from '@/lib/hooks/use-skills'

function readSource(relativePath: string) {
  return readFileSync(resolve(process.cwd(), relativePath), 'utf8')
}

const skillsSidecar = {
  version: 1,
  mode: 'seal-envelope',
  documentId: '0xskill-doc',
  encryptedDek: 'skill-encrypted',
  iv: 'skill-iv',
}

const sealMaterial = {
  version: 1,
  dek: 'dek-base64',
  iv: 'iv-base64',
  contentHash: 'sha256:abc',
  mimeType: 'application/zip',
  fileName: 'skill.zip',
}

describe('sanitizeSkillAppendRecoveryState', () => {
  it('accepts a same-user, same-soul recovery payload with a synced sync body', () => {
    const raw = JSON.stringify(attachSoulidityDeploymentSignature({
      userId: 'member-1',
      soulOnChainId: '0xsoul-1',
      pendingSync: null,
      syncBody: { txDigest: 'AppendDigest', skillsSealSidecar: skillsSidecar },
    }))
    expect(sanitizeSkillAppendRecoveryState(raw, 'member-1', '0xsoul-1')).toEqual(expect.objectContaining({
      userId: 'member-1',
      soulOnChainId: '0xsoul-1',
      syncBody: { txDigest: 'AppendDigest', skillsSealSidecar: skillsSidecar },
    }))
  })

  it('accepts a recovery payload that only carries pendingSync seal material', () => {
    const raw = JSON.stringify(attachSoulidityDeploymentSignature({
      userId: 'member-1',
      soulOnChainId: '0xsoul-1',
      pendingSync: { txDigest: 'PendingDigest', sealMaterial },
      syncBody: null,
    }))
    expect(sanitizeSkillAppendRecoveryState(raw, 'member-1', '0xsoul-1')).toEqual(expect.objectContaining({
      pendingSync: { txDigest: 'PendingDigest', sealMaterial },
      syncBody: null,
    }))
  })

  it('rejects mismatched user, soul, or deployment signature', () => {
    const validForUser1 = JSON.stringify(attachSoulidityDeploymentSignature({
      userId: 'member-1',
      soulOnChainId: '0xsoul-1',
      pendingSync: { txDigest: 'PendingDigest', sealMaterial },
      syncBody: null,
    }))
    expect(sanitizeSkillAppendRecoveryState(validForUser1, 'member-2', '0xsoul-1')).toBeNull()
    expect(sanitizeSkillAppendRecoveryState(validForUser1, 'member-1', '0xsoul-other')).toBeNull()

    const staleSignature = JSON.stringify({
      ...attachSoulidityDeploymentSignature({}),
      deploymentSignature: 'testnet|0xstale',
      userId: 'member-1',
      soulOnChainId: '0xsoul-1',
      pendingSync: { txDigest: 'PendingDigest', sealMaterial },
      syncBody: null,
    })
    expect(sanitizeSkillAppendRecoveryState(staleSignature, 'member-1', '0xsoul-1')).toBeNull()
  })

  it('rejects payloads with no recoverable sync data', () => {
    const empty = JSON.stringify(attachSoulidityDeploymentSignature({
      userId: 'member-1',
      soulOnChainId: '0xsoul-1',
      pendingSync: null,
      syncBody: null,
    }))
    expect(sanitizeSkillAppendRecoveryState(empty, 'member-1', '0xsoul-1')).toBeNull()
  })
})

describe('skill append recovery regressions', () => {
  it('persists raw seal material before calling Seal key servers and rebuilds the sidecar on retry', () => {
    const source = readSource('web/lib/hooks/use-skills.ts')

    // Storage key prefix must be stable so the auto-resume effect can find
    // pending recoveries on remount.
    expect(source).toContain("const SKILL_APPEND_RECOVERY_KEY_PREFIX = 'soul-skill-append-recovery:'")

    // The persistence must happen BEFORE buildSkillAppendSyncBody (which
    // calls Seal key servers via createSkillSealSidecarFromMaterial). If
    // that call or the mirror POST fails, the auto-resume effect rebuilds
    // the sidecar from the persisted material instead of asking the user
    // to re-sign a new on-chain skill version.
    const appendFnStart = source.indexOf('async function appendSkillVersion')
    expect(appendFnStart).toBeGreaterThan(-1)
    const persistFirst = source.indexOf('persistSkillAppendRecovery(storageKey, recovery)', appendFnStart)
    const buildSidecar = source.indexOf('buildSkillAppendSyncBody({', appendFnStart)
    expect(persistFirst).toBeGreaterThan(appendFnStart)
    expect(buildSidecar).toBeGreaterThan(persistFirst)

    // The auto-resume effect must read pendingSync.sealMaterial via
    // suiClient.getTransactionBlock + extractSkillVersionAppendedEvent and
    // post the rebuilt syncBody to the mirror.
    expect(source).toContain('recovery.pendingSync')
    expect(source).toContain('suiClient.getTransactionBlock')
    expect(source).toContain('extractSkillVersionAppendedEvent')
    expect(source).toContain('createSkillSealSidecarFromMaterial')
    expect(source).toContain('postAppendMirror(soulOnChainId, syncBody)')

    // Successful mirror clears the recovery row.
    expect(source).toContain('persistSkillAppendRecovery(storageKey, null)')
  })

  it('routes first skills root plus N selected versions through the batch builder', () => {
    const source = readSource('web/lib/hooks/use-skills.ts')
    const panel = readSource('web/components/souls/skills-panel.tsx')

    expect(source).toContain('async function appendSkillVersions')
    expect(source).toContain('const uploadedVersions = await Promise.all(files.map((file) => uploadSkillFile(file, visibility)))')
    expect(source).toContain('additionalVersions: uploadedVersions.slice(1).map')
    expect(source).toContain('buildInitAndBatchAppendSkillsTx({')
    expect(panel).toContain('selectedFiles')
    expect(panel).toContain('onFilesSelect')
    expect(panel).toContain('appendSkillVersions(selectedFiles, visibility)')
  })

  it('rejects failed skill append digests before persisting recovery (R-001)', () => {
    // signAndExecute() returns the raw wallet execution result. If
    // effects.status.status === 'failure' (Move abort, stale skillsOnChainId,
    // bad root state), the recovery row would otherwise persist a non-success
    // digest and the auto-resume effect would replay a failed transaction
    // forever. Both single-version `appendSkillVersion` and batch
    // `appendSkillVersions` must call `assertSoulidityTxSucceeded(result, ...)`
    // BEFORE building `pendingSync` / persisting recovery / posting to the
    // mirror.
    const source = readSource('web/lib/hooks/use-skills.ts')

    expect(source).toContain("import { assertSoulidityTxSucceeded } from '@/lib/soulidity/market-errors'")

    // Single-append path
    const singleSignStart = source.indexOf(
      'const result = await signAndExecute(tx)',
      source.indexOf('async function appendSkillVersion(file: File'),
    )
    const singlePendingSync = source.indexOf('const pendingSync: SkillAppendSyncMaterial', singleSignStart)
    expect(singleSignStart).toBeGreaterThan(0)
    expect(singlePendingSync).toBeGreaterThan(singleSignStart)
    const singleGuardBlock = source.slice(singleSignStart, singlePendingSync)
    expect(singleGuardBlock).toContain("assertSoulidityTxSucceeded(result, 'Soul skill append transaction')")
    expect(singleGuardBlock).not.toContain('persistSkillAppendRecovery')
    expect(singleGuardBlock).not.toContain('postAppendMirror')

    // Batch path
    const batchSignStart = source.indexOf(
      'const result = await signAndExecute(tx)',
      source.indexOf('async function appendSkillVersions(files'),
    )
    const batchPendingSync = source.indexOf('const pendingSync: SkillAppendSyncMaterial', batchSignStart)
    expect(batchSignStart).toBeGreaterThan(singleSignStart)
    expect(batchPendingSync).toBeGreaterThan(batchSignStart)
    const batchGuardBlock = source.slice(batchSignStart, batchPendingSync)
    expect(batchGuardBlock).toContain("assertSoulidityTxSucceeded(result, 'Soul skill batch transaction')")
    expect(batchGuardBlock).not.toContain('persistSkillAppendRecovery')
    expect(batchGuardBlock).not.toContain('postAppendMirror')
  })
})
