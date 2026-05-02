import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

function readSource(relativePath: string) {
  return readFileSync(resolve(process.cwd(), relativePath), 'utf8')
}

describe('memory encryption regressions', () => {
  it('keeps the create gas flow on encrypted founding memory via the batched upload pipeline', () => {
    const createGasSource = readSource('web/app/create/gas/page.tsx')
    const publishHookSource = readSource('web/lib/hooks/use-publish.ts')

    // The create flow batches all uploads through `prepareSoulBlobsForBatchPublish`.
    // Memory must enter the batch as `uploadType: 'encrypted'` and its Seal
    // material must thread to the publish hook so the memory sidecar still
    // gets created post-mint.
    expect(createGasSource).toContain('prepareSoulBlobsForBatchPublish')
    expect(createGasSource).toContain('file: withMime(ctx.memoryFile)')
    expect(createGasSource).toMatch(/uploadType:\s*'encrypted'/)
    expect(createGasSource).toContain('memorySealMaterial: memory.sealMaterial')

    expect(publishHookSource).toContain('memorySealMaterial?: PendingSealMaterial | null')
    expect(publishHookSource).toContain('createMemorySealSidecarFromMaterial')
  })

  it('keeps the import gas flow on encrypted founding memory with memory sidecars', () => {
    const importGasSource = readSource('web/app/import/gas/page.tsx')
    const importHookSource = readSource('web/lib/hooks/use-import.ts')

    expect(importGasSource).toContain("'uploading-memory'")
    expect(importGasSource).toContain('Encrypting & uploading memory')
    expect(importGasSource).toContain("results.memorySeed = await uploadFile(ctx.memoryFile!, 'encrypted', authHeaders, walletUpload, walletAddress)")
    expect(importGasSource).toContain('memorySealMaterial: results.memorySeed.sealMaterial ?? null')

    expect(importHookSource).toContain('memorySealMaterial?: PendingSealMaterial | null')
    expect(importHookSource).toContain('createMemorySealSidecarFromMaterial')
  })

  it('keeps wallet-paid gas page copy and import balance floor aligned with upload transaction count', () => {
    const createGasSource = readSource('web/app/create/gas/page.tsx')
    const importGasSource = readSource('web/app/import/gas/page.tsx')

    expect(createGasSource).not.toContain('Paid by publisher node')
    expect(importGasSource).not.toContain('Paid by publisher node')
    expect(createGasSource).toContain('Paid by connected wallet after cost review')
    expect(importGasSource).toContain('Paid by connected wallet after cost review')

    expect(importGasSource).toContain('minimumSuiBalanceForWalletTransactions(importWalletTransactionCount)')
    expect(importGasSource).toContain('const pendingImportUploadCount =')
    expect(importGasSource).toContain('formatBalance(minImportSuiBalance, 9)')
    expect(importGasSource).not.toContain('balances.sui < MIN_SUI_BALANCE')
  })

  it('keeps personal-join and collection mint flows on encrypted founding memory with mirrored recovery payloads', () => {
    const wrapHookSource = readSource('web/lib/hooks/use-wrap-publish.ts')
    const collectionHookSource = readSource('web/lib/hooks/use-collection-publish.ts')

    expect(wrapHookSource).toContain('memorySealSidecar: SealEnvelopeSidecar | null')
    expect(wrapHookSource).toContain("const memUpload = await uploadFile(params.memoryFile, 'encrypted', authHeaders, walletUpload, walletAddress)")
    expect(wrapHookSource).toContain('memorySealMaterial: memUpload.sealMaterial ?? null')
    expect(wrapHookSource).toContain('memorySealSidecar: params.material.memorySealMaterial && foundingMemory')

    expect(collectionHookSource).toContain('memorySealMaterial: PendingSealMaterial')
    expect(collectionHookSource).toContain("const memUpload = await uploadFile(memFile, 'encrypted', authHeaders, walletUpload, walletAddress)")
    expect(collectionHookSource).toContain('createMemorySealSidecarFromMaterial')
  })

  it('keeps collection batch persona sprites post-mint-only', () => {
    const collectionSoulsPageSource = readSource('web/app/collections/create/souls/page.tsx')
    const collectionPreviewSource = readSource('web/app/collections/create/preview/page.tsx')
    const collectionProviderSource = readSource('web/components/providers/create-collection-provider.tsx')
    const collectionHookSource = readSource('web/lib/hooks/use-collection-publish.ts')
    const collectionBatchUtilsSource = readSource('web/app/collections/create/souls/batch-utils.ts')

    expect(collectionSoulsPageSource).toContain('Persona sprites are added after mint')
    expect(collectionSoulsPageSource).not.toContain('persona-sprite.png ← sprite sheet')
    expect(collectionPreviewSource).toContain('Post-mint from each Soul detail page')
    expect(collectionProviderSource).not.toContain('spriteVisibility')
    expect(collectionBatchUtilsSource).not.toContain('spriteSheetFile')
    expect(collectionBatchUtilsSource).not.toContain('spriteConfigFile')
    expect(collectionHookSource).not.toContain('validatePersonaSpriteDraft')
    expect(collectionHookSource).not.toContain('initialSprite:')
    expect(collectionHookSource).not.toContain('assetBlobObjectId')
  })

  it('keeps native, import, and personal-join persona sprites post-mint-only', () => {
    const createProviderSource = readSource('web/components/providers/create-soul-provider.tsx')
    const importProviderSource = readSource('web/components/providers/import-soul-provider.tsx')
    const wrapProviderSource = readSource('web/components/providers/wrap-provider.tsx')
    const createGasSource = readSource('web/app/create/gas/page.tsx')
    const importGasSource = readSource('web/app/import/gas/page.tsx')
    const wrapPreviewSource = readSource('web/app/wrap-link/personal/preview/page.tsx')
    const publishHookSource = readSource('web/lib/hooks/use-publish.ts')
    const importHookSource = readSource('web/lib/hooks/use-import.ts')
    const wrapHookSource = readSource('web/lib/hooks/use-wrap-publish.ts')

    for (const source of [createProviderSource, importProviderSource, wrapProviderSource]) {
      expect(source).not.toContain('spriteSheetFile')
      expect(source).not.toContain('spriteConfigFile')
      expect(source).not.toContain('spriteVisibility')
    }

    for (const source of [createGasSource, importGasSource, wrapPreviewSource, publishHookSource, importHookSource, wrapHookSource]) {
      expect(source).not.toContain('validatePersonaSpriteDraft')
      expect(source).not.toContain('buildPersonaSpriteMoodMap')
      expect(source).not.toContain('assetsSealMaterial')
      expect(source).not.toContain('Persona sprite blob')
      expect(source).not.toContain('Wrapped persona sprite blob')
      expect(source).not.toContain('spriteSheetFile')
      expect(source).not.toContain('spriteConfigFile')
      expect(source).not.toContain('spriteVisibility')
      expect(source).not.toContain('initialSprite:')
    }

    expect(readSource('web/app/create/preview/page.tsx')).toMatch(/persona sprites are added after mint/i)
    expect(readSource('web/app/import/preview/page.tsx')).toMatch(/persona sprites are added after mint/i)
  })

  it('keeps provider upload state typed as encrypted for founding memory', () => {
    const createProviderSource = readSource('web/components/providers/create-soul-provider.tsx')
    const importProviderSource = readSource('web/components/providers/import-soul-provider.tsx')

    expect(createProviderSource).toContain('memorySeed?: EncryptedUploadResult')
    expect(importProviderSource).toContain('memorySeed?: EncryptedUploadResult')
  })

  it('uses the canonical testnet Seal key server in E2E mode', () => {
    const clientSealSource = readSource('web/lib/upload/client-seal.ts')

    expect(clientSealSource).toContain("process.env.NEXT_PUBLIC_E2E_TEST_MODE === '1'")
    expect(clientSealSource).toContain('DEFAULT_TESTNET_SEAL_SERVER_CONFIGS')
  })
})

describe('content format regressions', () => {
  it('routes create/import/wrap skills uploads through the zip-only contract', () => {
    const createContentSource = readSource('web/app/create/content/page.tsx')
    const importMapSource = readSource('web/app/import/map/page.tsx')
    const wrapConfigureSource = readSource('web/app/wrap-link/personal/configure/page.tsx')

    expect(createContentSource).toContain("from '@/lib/soulidity/content-templates'")
    expect(createContentSource).toContain('subtitle=".zip only • encrypted via Seal"')
    expect(createContentSource).toContain('accept=".zip,application/zip,application/x-zip-compressed"')

    expect(importMapSource).toContain("from '@/lib/soulidity/content-templates'")
    expect(importMapSource).toContain('sublabel=".zip only · encrypted via Seal"')
    expect(importMapSource).toContain('accept=".zip,application/zip,application/x-zip-compressed"')

    expect(wrapConfigureSource).toContain('accept=".zip,application/zip,application/x-zip-compressed"')
  })

  it('exposes the content format spec in docs and resources', () => {
    const specSource = readSource('docs/specs/soul-content-format.md')
    const resourcesSource = readSource('web/app/resources/page.tsx')
    const contentFormatSource = readSource('web/app/resources/content-format/page.tsx')
    const gettingStartedSource = readSource('web/app/resources/getting-started/page.tsx')
    const wrapLinkSource = readSource('web/app/resources/wrap-link/page.tsx')

    expect(specSource).toContain('fresh deploy')
    expect(specSource).toContain('Table<u64, ID>')
    expect(specSource).toContain('Table<String, vector<SkillSlot>>')
    expect(specSource).not.toContain('public struct MemoryEntry has key, store')
    expect(specSource).not.toContain('public struct SkillVersion has key, store')

    expect(resourcesSource).toContain("href: '/resources/content-format'")
    expect(contentFormatSource).toContain('Soul Content Format')
    expect(contentFormatSource).toContain("from '@/lib/soulidity/content-templates'")
    expect(contentFormatSource).toContain('SOUL_MD_TEMPLATE')
    expect(contentFormatSource).toContain('FOUNDING_MEMORY_MD_TEMPLATE')
    expect(contentFormatSource).toContain('soul.md')
    expect(contentFormatSource).toContain('skill.zip')
    expect(contentFormatSource).not.toContain('skills.zip')
    expect(resourcesSource).toContain('skill.zip')
    expect(resourcesSource).not.toContain('skills.zip')
    expect(gettingStartedSource).toContain('skill.zip')
    expect(gettingStartedSource).not.toContain('skills.zip')
    expect(wrapLinkSource).toContain('skill.zip')
    expect(wrapLinkSource).not.toContain('skills.zip')
  })
})
