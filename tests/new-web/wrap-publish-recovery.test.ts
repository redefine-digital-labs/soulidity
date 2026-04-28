import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@mysten/dapp-kit', () => ({
  useSuiClient: () => null,
}))

import { attachSoulidityDeploymentSignature } from '@/lib/soulidity/client-session'
import { sanitizeWrapRecoveryState } from '@/lib/hooks/use-wrap-publish'

function readSource(relativePath: string) {
  return readFileSync(resolve(process.cwd(), relativePath), 'utf8')
}

const soulSidecar = { version: 1, mode: 'seal-envelope', documentId: '0xsoul-doc', encryptedDek: 'soul-encrypted', iv: 'soul-iv' }
const memorySidecar = { version: 1, mode: 'seal-envelope', documentId: '0xmemory-doc', encryptedDek: 'memory-encrypted', iv: 'memory-iv' }

describe('sanitizeWrapRecoveryState', () => {
  it('accepts a same-user recovery payload with matching sync digest', () => {
    expect(sanitizeWrapRecoveryState(JSON.stringify(attachSoulidityDeploymentSignature({
      userId: 'member-1',
      txDigest: '5YzRecoveryDigest',
      syncBody: {
        txDigest: '5YzRecoveryDigest',
        sealSidecar: soulSidecar,
        memorySealSidecar: memorySidecar,
        skillsSealSidecar: null,
        assetsSealSidecar: null,
      },
    })), 'member-1')).toEqual(expect.objectContaining({
      userId: 'member-1',
      txDigest: '5YzRecoveryDigest',
      syncBody: {
        txDigest: '5YzRecoveryDigest',
        sealSidecar: soulSidecar,
        memorySealSidecar: memorySidecar,
        skillsSealSidecar: null,
        assetsSealSidecar: null,
      },
    }))
  })

  it('rejects recovery state from a different user, mismatched deployment, or mismatched sync body', () => {
    expect(sanitizeWrapRecoveryState(JSON.stringify(attachSoulidityDeploymentSignature({
      userId: 'member-2',
      txDigest: '5YzRecoveryDigest',
      syncBody: {
        txDigest: '5YzRecoveryDigest',
        sealSidecar: soulSidecar,
        memorySealSidecar: memorySidecar,
        skillsSealSidecar: null,
        assetsSealSidecar: null,
      },
    })), 'member-1')).toBeNull()

    expect(sanitizeWrapRecoveryState(JSON.stringify({
      ...attachSoulidityDeploymentSignature({}),
      deploymentSignature: 'testnet|0xstale',
      userId: 'member-1',
      txDigest: '5YzRecoveryDigest',
      syncBody: {
        txDigest: '5YzRecoveryDigest',
        category: 'personal-join',
        sealSidecar: 'char-envelope',
        memorySealSidecar: 'memory-envelope',
        skillsSealSidecar: null,
        assetsSealSidecar: null,
      },
    }), 'member-1')).toBeNull()

    expect(sanitizeWrapRecoveryState(JSON.stringify(attachSoulidityDeploymentSignature({
      userId: 'member-1',
      txDigest: '5YzRecoveryDigest',
      syncBody: {
        txDigest: 'DifferentDigest',
        sealSidecar: soulSidecar,
        memorySealSidecar: memorySidecar,
        skillsSealSidecar: null,
        assetsSealSidecar: null,
      },
    })), 'member-1')).toBeNull()
  })
})

describe('wrap publish recovery regressions', () => {
  it('persists pending sync recovery before retrying the wrap mirror', () => {
    const source = readSource('web/lib/hooks/use-wrap-publish.ts')

    expect(source).toContain("const WRAP_MINT_RECOVERY_KEY = 'soul-wrap-personal-recovery'")
    expect(source).toContain('const syncBody = recoveryRef.current?.txDigest === digest ? recoveryRef.current.syncBody : null')
    expect(source).toContain('sessionStorage.setItem(WRAP_MINT_RECOVERY_KEY, JSON.stringify(recovery))')
  })

  it('keeps the preview page in recovery mode when the draft was lost but a pending digest exists', () => {
    const source = readSource('web/app/wrap-link/personal/preview/page.tsx')

    expect(source).toContain('const isRecoveryMode = hasPendingRecovery && (missingStep1 || missingStep2)')
    expect(source).toContain("if ((missingStep1 || missingStep2) && !hasPendingRecovery) return null")
    expect(source).toContain('await publish()')
    expect(source).toContain('Resume sync for the already-minted Soul')
  })
})
