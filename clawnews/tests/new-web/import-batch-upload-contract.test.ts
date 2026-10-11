import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

function readSource(relativePath: string) {
  return readFileSync(resolve(process.cwd(), relativePath), 'utf8')
}

describe('import batch upload contract', () => {
  it('uses one batched Walrus cost review for all import files', () => {
    const source = readSource('web/app/import/gas/page.tsx')
    const deployStart = source.indexOf('async function handleDeploy()')
    const deployEnd = source.indexOf('async function handleResume()', deployStart)
    expect(deployStart).toBeGreaterThanOrEqual(0)
    expect(deployEnd).toBeGreaterThan(deployStart)
    const handleDeploy = source.slice(deployStart, deployEnd)

    expect(handleDeploy).toContain('prepareSoulBlobsForBatchPublish({')
    expect(handleDeploy).toContain('confirmQuote: async (quote)')
    expect(handleDeploy).toContain('setUploadPhase(\'awaiting-register-signature\')')
    expect(handleDeploy).toContain('attachWalrusCertifyCalls: prepared.attachCertifyCalls')
    expect(handleDeploy).toContain('onImportTxExecuted: () => {')
    expect(handleDeploy).not.toContain('uploadFile(')
    expect(handleDeploy).not.toContain('uploadSoulPayload(')
  })

  it('marks the selected import royalty tier as pressed for browser automation and accessibility', () => {
    const source = readSource('web/app/import/map/page.tsx')

    expect(source).toContain('aria-pressed={ctx.royalty === opt.value}')
    expect(source).toContain("desc: '5%', recommended: true")
  })

  it('wires Walrus certify calls into the import mint PTB before signing', () => {
    const source = readSource('web/lib/hooks/use-import.ts')
    const buildStart = source.indexOf('const tx: Transaction = await buildImportSoulTx({')
    const signStart = source.indexOf('const result = await signAndExecute(tx)', buildStart)
    expect(buildStart).toBeGreaterThanOrEqual(0)
    expect(signStart).toBeGreaterThan(buildStart)
    const beforeSign = source.slice(buildStart, signStart)

    expect(source).toContain('attachWalrusCertifyCalls?: (tx: Transaction) => void | Promise<void>')
    expect(source).toContain('onImportTxExecuted?: () => void')
    expect(beforeSign).toContain('attachBeforeMint: params.attachWalrusCertifyCalls')
    expect(beforeSign).not.toContain('await params.attachWalrusCertifyCalls?.(tx)')
    expect(source).toContain('try { params.onImportTxExecuted?.() } catch { /* swallow callback errors */ }')
  })
})
