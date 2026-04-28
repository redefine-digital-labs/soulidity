import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

function readSource(relativePath: string) {
  return readFileSync(resolve(process.cwd(), relativePath), 'utf8')
}

describe('memory encryption regressions', () => {
  it('keeps create and import gas flows on encrypted founding memory with memory sidecars', () => {
    const createGasSource = readSource('web/app/create/gas/page.tsx')
    const importGasSource = readSource('web/app/import/gas/page.tsx')
    const publishHookSource = readSource('web/lib/hooks/use-publish.ts')
    const importHookSource = readSource('web/lib/hooks/use-import.ts')

    expect(createGasSource).toContain("'uploading-memory'")
    expect(createGasSource).toContain('Encrypting & uploading memory')
    expect(createGasSource).toContain("results.memorySeed = await uploadFile(ctx.memoryFile!, 'encrypted', authHeaders, walletUpload, walletAddress)")
    expect(createGasSource).toContain('memorySealMaterial: results.memorySeed.sealMaterial ?? null')

    expect(importGasSource).toContain("'uploading-memory'")
    expect(importGasSource).toContain('Encrypting & uploading memory')
    expect(importGasSource).toContain("results.memorySeed = await uploadFile(ctx.memoryFile!, 'encrypted', authHeaders, walletUpload, walletAddress)")
    expect(importGasSource).toContain('memorySealMaterial: results.memorySeed.sealMaterial ?? null')

    expect(publishHookSource).toContain('memorySealMaterial?: PendingSealMaterial | null')
    expect(publishHookSource).toContain('createMemorySealSidecarFromMaterial')

    expect(importHookSource).toContain('memorySealMaterial?: PendingSealMaterial | null')
    expect(importHookSource).toContain('createMemorySealSidecarFromMaterial')
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
