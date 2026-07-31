import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const SOURCE = readFileSync('web/lib/hooks/use-animacraft-mint.ts', 'utf8')

describe('Animacraft commerce-v5 Complete preflight order', () => {
  it('quotes and checks USDC before paying Walrus, then re-quotes for the atomic PTB', () => {
    const preUploadQuote = SOURCE.indexOf(
      'const preUploadQuoteV5 = await simulateAnimacraftCompleteQuoteV5',
    )
    const preUploadBalance = SOURCE.indexOf(
      'requiredAmount: preUploadQuoteV5.totalDueAtomic',
      preUploadQuote,
    )
    const walrusUpload = SOURCE.indexOf(
      'prepared = await prepareSoulBlobsForBatchPublish',
      preUploadBalance,
    )
    const freshQuote = SOURCE.indexOf(
      'freshQuoteV5 = await simulateAnimacraftCompleteQuoteV5',
      walrusUpload,
    )
    const mintBuild = SOURCE.indexOf(
      'const tx = await buildMintAnimacraftSoulTx',
      freshQuote,
    )

    expect(preUploadQuote).toBeGreaterThanOrEqual(0)
    expect(preUploadBalance).toBeGreaterThan(preUploadQuote)
    expect(walrusUpload).toBeGreaterThan(preUploadBalance)
    expect(freshQuote).toBeGreaterThan(walrusUpload)
    expect(mintBuild).toBeGreaterThan(freshQuote)
  })
})
