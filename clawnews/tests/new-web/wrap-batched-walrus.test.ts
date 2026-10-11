import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

function readSource(relativePath: string) {
  return readFileSync(resolve(process.cwd(), relativePath), 'utf8')
}

describe('wrap Personal Join batched Walrus contract', () => {
  it('lets Personal Join attach Walrus certify calls before mint_joined', () => {
    const source = readSource('packages/soulidity-sdk/src/tx/personal-join.ts')

    expect(source).toContain('attachBeforeMint?: (tx: Transaction) => void | Promise<void>')

    const attachIdx = source.indexOf('await params.attachBeforeMint(tx)')
    const mintIdx = source.indexOf('target: `${packageId}::market::mint_joined_in_personal_kiosk`')

    expect(attachIdx).toBeGreaterThanOrEqual(0)
    expect(mintIdx).toBeGreaterThan(attachIdx)
  })

  it('uses the batch Walrus helper instead of per-file uploadSoulPayload', () => {
    const source = readSource('web/lib/hooks/use-wrap-publish.ts')

    expect(source).toContain('prepareSoulBlobsForBatchPublish')
    expect(source).toContain('prepared.attachCertifyCalls')
    expect(source).toContain('prepared.clearBatchRecovery()')
    expect(source).not.toContain('uploadSoulPayload')
    expect(source).not.toContain('async function uploadFile')
  })

  it('keeps Personal Join on the wrap mirror route', () => {
    const source = readSource('web/lib/hooks/use-wrap-publish.ts')

    expect(source).toContain("fetch('/api/wrap-link/personal'")
    expect(source).not.toContain("fetch('/api/souls/publish'")
    expect(source).not.toContain('buildPublishSoulTx')
    expect(source).not.toContain('buildPublishSoulWithBindTx')
  })

  it('caches the prepared batch across mint-signature retries', () => {
    const source = readSource('web/lib/hooks/use-wrap-publish.ts')

    expect(source).toContain('preparedBatchRef')
    expect(source).toContain('buildBatchFingerprint')
    expect(source).toContain('cachedBatch.walletAddress === walletAddress')
    expect(source).toContain('cachedBatch.fingerprint === fingerprint')
  })
})
