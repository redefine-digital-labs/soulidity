import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

function readSource(relativePath: string) {
  return readFileSync(resolve(process.cwd(), relativePath), 'utf8')
}

describe('batch-publish price guards', () => {
  it('rejects zero-price CSV rows before any transaction is built', () => {
    const source = readSource('scripts/batch-publish.ts')

    expect(source).toContain("const priceUsdc = parseRequiredPositiveNumber(fields[4]!, 'priceUsdc', i + 2)")
    expect(source).toContain('function parseRequiredPositiveNumber(raw: string, fieldName: string, csvRow: number): number')
    expect(source).toContain('must be greater than 0')
  })

  it('guards list transaction construction and removes free-listing copy', () => {
    const source = readSource('scripts/batch-publish.ts')

    expect(source).toContain("throw new Error('priceAtomic must be positive')")
    expect(source).not.toContain('(free listing)')
  })

  it('hard-disables non-dry-run execution to avoid orphaning minted Souls on the rejected sealSidecar string contract', () => {
    const source = readSource('scripts/batch-publish.ts')

    // The guard must run before the script touches CSV parsing, deployment
    // manifest, keypair env, or any side-effecting helper. The current sync
    // routes reject string `sealSidecar` payloads via parseProvidedSidecar,
    // so any non-dry-run execution would mint Souls then fail to mirror.
    expect(source).toContain('if (!args.dryRun) {')
    expect(source).toContain('scripts/batch-publish.ts is disabled')
    expect(source).toContain("Use the wallet-paid browser publish flow")

    const guardIndex = source.indexOf('scripts/batch-publish.ts is disabled')
    const csvParseIndex = source.indexOf('parseCSV(TEMPLATE_CSV)', source.indexOf('async function main'))
    const deploymentIndex = source.indexOf('getDeployment()', source.indexOf('async function main'))
    const keypairIndex = source.indexOf("loadKeypairFromEnv('BATCH_SIGNER_SECRET_KEY')")

    expect(guardIndex).toBeGreaterThan(-1)
    expect(csvParseIndex).toBeGreaterThan(guardIndex)
    expect(deploymentIndex).toBeGreaterThan(guardIndex)
    expect(keypairIndex).toBeGreaterThan(guardIndex)
  })
})
