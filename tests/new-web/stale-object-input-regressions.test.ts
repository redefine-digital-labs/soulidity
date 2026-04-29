import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

function readSource(relativePath: string) {
  return readFileSync(resolve(process.cwd(), relativePath), 'utf8')
}

describe('stale object input regression guards', () => {
  it('routes the create flow through the batched upload + mint pipeline', () => {
    // Create flow upgraded to one register PTB + one certify+mint PTB so N
    // encrypted files cost 2 wallet signatures total. Stale cached blob
    // re-validation (findMissingObjectIds) is no longer applicable because
    // every Deploy attempt re-runs the full batch.
    const createGas = readSource('web/app/create/gas/page.tsx')

    expect(createGas).toContain('prepareSoulBlobsForBatchPublish')
    expect(createGas).toContain('attachBeforeMint: prepared.attachCertifyCalls')
    expect(createGas).toContain('uploadType: \'encrypted\'')
  })

  it('revalidates cached encrypted blob inputs before import mint transactions', () => {
    const importGas = readSource('web/app/import/gas/page.tsx')

    expect(importGas).toContain('findMissingObjectIds')
    expect(importGas).toContain('results.charFile = undefined')
    expect(importGas).toContain('results.memorySeed = undefined')
  })

  it('drops cached collection soul uploads whose blob objects no longer exist', () => {
    const source = readSource('web/lib/hooks/use-collection-publish.ts')

    expect(source).toContain('findMissingObjectIds')
    expect(source).toContain('soulState.uploads = null')
  })

  it('preflights mint transaction object inputs after upload resolution', () => {
    const publish = readSource('web/lib/hooks/use-publish.ts')
    const importHook = readSource('web/lib/hooks/use-import.ts')
    const wrapPublish = readSource('web/lib/hooks/use-wrap-publish.ts')
    const collectionPublish = readSource('web/lib/hooks/use-collection-publish.ts')

    expect(publish).toContain('assertObjectInputsExist')
    expect(importHook).toContain('assertObjectInputsExist')
    expect(wrapPublish).toContain('assertObjectInputsExist')
    expect(collectionPublish).toContain('assertObjectInputsExist')
  })

  it('clears a selected wrap NFT when it is no longer present in the connected wallet', () => {
    const selectPage = readSource('web/app/wrap-link/personal/page.tsx')
    const configurePage = readSource('web/app/wrap-link/personal/configure/page.tsx')
    const previewPage = readSource('web/app/wrap-link/personal/preview/page.tsx')

    expect(selectPage).toContain('ctx.setSelectedNft(null)')
    expect(configurePage).toContain('ctx.setSelectedNft(null)')
    expect(previewPage).toContain('ctx.setSelectedNft(null)')
  })

  it('preflights market and grant transaction object inputs before signing', () => {
    const listSoul = readSource('web/lib/hooks/use-list-soul.ts')
    const purchase = readSource('web/lib/hooks/use-purchase.ts')
    const collections = readSource('web/lib/hooks/use-collections.ts')
    const skills = readSource('web/lib/hooks/use-skills.ts')
    const grant = readSource('web/lib/hooks/use-grant.ts')
    const listingModals = readSource('web/components/souls/listing-modals.tsx')

    expect(listSoul).toContain('assertObjectInputsExist')
    expect(purchase).toContain('assertObjectInputsExist')
    expect(collections).toContain('assertObjectInputsExist')
    expect(skills).toContain('assertObjectInputsExist')
    expect(grant).toContain('assertObjectInputsExist')
    expect(listingModals).toContain('assertObjectInputsExist')
  })
})
