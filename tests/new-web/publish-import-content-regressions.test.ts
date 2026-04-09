import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

function readSource(relativePath: string) {
  return readFileSync(resolve(process.cwd(), relativePath), 'utf8')
}

describe('memory encryption regressions', () => {
  it('keeps create and import gas flows on encrypted founding memory with memory sidecars', () => {
    const createGasSource = readSource('new-web/app/create/gas/page.tsx')
    const importGasSource = readSource('new-web/app/import/gas/page.tsx')
    const publishHookSource = readSource('new-web/lib/hooks/use-publish.ts')
    const importHookSource = readSource('new-web/lib/hooks/use-import.ts')

    expect(createGasSource).toContain("'uploading-memory'")
    expect(createGasSource).toContain('Encrypting & uploading memory')
    expect(createGasSource).toContain("results.memorySeed = await uploadFile(ctx.memoryFile!, 'encrypted', authHeaders, walletAddress)")
    expect(createGasSource).toContain('memorySealSidecar: results.memorySeed.sealDekEnvelope ?? null')

    expect(importGasSource).toContain("'uploading-memory'")
    expect(importGasSource).toContain('Encrypting & uploading memory')
    expect(importGasSource).toContain("results.memorySeed = await uploadFile(ctx.memoryFile!, 'encrypted', authHeaders, walletAddress)")
    expect(importGasSource).toContain('memorySealSidecar: results.memorySeed.sealDekEnvelope ?? null')

    expect(publishHookSource).toContain('memorySealSidecar?: string | null')
    expect(publishHookSource).toContain('memorySealSidecar: params.memorySealSidecar ?? null')

    expect(importHookSource).toContain('memorySealSidecar?: string | null')
    expect(importHookSource).toContain('memorySealSidecar: params.memorySealSidecar ?? null')
  })

  it('keeps personal-join and collection mint flows on encrypted founding memory with mirrored recovery payloads', () => {
    const wrapHookSource = readSource('new-web/lib/hooks/use-wrap-publish.ts')
    const collectionHookSource = readSource('new-web/lib/hooks/use-collection-publish.ts')

    expect(wrapHookSource).toContain('memorySealSidecar: string | null')
    expect(wrapHookSource).toContain("const memUpload = await uploadFile(params.memoryFile, 'encrypted', authHeaders, walletAddress)")
    expect(wrapHookSource).toContain("memorySealSidecar: typeof memUpload.sealDekEnvelope === 'string' ? memUpload.sealDekEnvelope : null")

    expect(collectionHookSource).toContain('memorySealDekEnvelope: string')
    expect(collectionHookSource).toContain("const memUpload = await uploadFile(memFile, 'encrypted', authHeaders, walletAddress)")
    expect(collectionHookSource).toContain('memorySealSidecar: soulState.uploads.memorySealDekEnvelope')
  })

  it('keeps provider upload state typed as encrypted for founding memory', () => {
    const createProviderSource = readSource('new-web/components/providers/create-soul-provider.tsx')
    const importProviderSource = readSource('new-web/components/providers/import-soul-provider.tsx')

    expect(createProviderSource).toContain('memorySeed?: EncryptedUploadResult')
    expect(importProviderSource).toContain('memorySeed?: EncryptedUploadResult')
  })
})

describe('content format regressions', () => {
  it('routes create/import/wrap skills uploads through the zip-only contract', () => {
    const createContentSource = readSource('new-web/app/create/content/page.tsx')
    const importMapSource = readSource('new-web/app/import/map/page.tsx')
    const wrapConfigureSource = readSource('new-web/app/wrap-link/personal/configure/page.tsx')

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
    const resourcesSource = readSource('new-web/app/resources/page.tsx')
    const contentFormatSource = readSource('new-web/app/resources/content-format/page.tsx')

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
    expect(contentFormatSource).toContain('skills.zip')
  })
})
