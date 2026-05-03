import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

function readSource(relativePath: string) {
  return readFileSync(resolve(process.cwd(), relativePath), 'utf8')
}

describe('collection publish regression guards', () => {
  it('resolves the personal kiosk before the batched mint phase', () => {
    const source = readSource('web/lib/hooks/use-collection-publish.ts')

    // The hook now mints souls in chunked PTBs, so the kiosk only needs to be
    // resolved once per launch (right before the mint phase) — there is no
    // first-soul fallback. Guard against a regression that re-introduces
    // per-soul kiosk fetches mid-loop.
    expect(source).toContain('const personalKiosk = await resolvePersonalKiosk(authHeaders, walletAddress)')
    expect(source).not.toContain('if (!personalKiosk && i === 0)')
  })

  it('treats add-soul mirror failures as bind failures instead of recording success', () => {
    const source = readSource('web/lib/hooks/use-collection-publish.ts')

    expect(source).toContain('if (!addRes.ok)')
    expect(source).toContain('Failed to bind Soul')
  })

  it('guards downstream collection create routes against direct navigation with incomplete state', () => {
    const soulsSource = readSource('web/app/collections/create/souls/page.tsx')
    const previewSource = readSource('web/app/collections/create/preview/page.tsx')
    const successSource = readSource('web/app/collections/create/success/page.tsx')

    expect(soulsSource).toContain("router.replace('/collections/create')")
    expect(previewSource).toContain("router.replace('/collections/create/souls')")
    expect(successSource).toContain("router.replace('/collections/create')")
  })

  it('scopes collection publish state in sessionStorage and clears it on reset', () => {
    const providerSource = readSource('web/components/providers/create-collection-provider.tsx')
    const hookSource = readSource('web/lib/hooks/use-collection-publish.ts')
    const appProvidersSource = readSource('web/components/providers/app-providers.tsx')

    expect(providerSource).toContain("const PUBLISH_RESULT_KEY = 'collection-publish-result'")
    expect(providerSource).toContain('sessionStorage.removeItem(MINT_RECOVERY_KEY)')
    expect(providerSource).toContain('attachSoulidityDeploymentSignature')
    expect(hookSource).toContain('draftSignature')
    expect(hookSource).toContain('attachSoulidityDeploymentSignature')
    expect(appProvidersSource).toContain('syncSoulidityDeploymentSession')
    expect(appProvidersSource).toContain('window.location.reload()')
  })

  it('avoids collection preview success effect loops when the provider re-renders', () => {
    const source = readSource('web/app/collections/create/preview/page.tsx')

    expect(source).toContain('const completedDigestRef = useRef<string | null>(null)')
    expect(source).toContain('if (completedDigestRef.current === syncData.txDigest) return')
    expect(source).not.toContain('[status, syncData, ctx, router, showToast]')
    expect(source).toContain('[status, syncData, setPublishResult, name, floorPrice, extraRoyaltyBps, tradeable, collectionRightListingPrice, batchSouls, router, showToast]')
  })

  it('keeps collection create API errors generic for clients', () => {
    const source = readSource('web/app/api/collections/create/route.ts')

    expect(source).toContain("return NextResponse.json({ error: 'Failed to mirror Soulidity collection creation transaction' }, { status: 500 })")
    expect(source).not.toContain('Failed to mirror Soulidity collection creation transaction: ${message}')
  })

  it('keeps legacy collection mint-time private asset recoveries resumable', () => {
    const source = readSource('web/lib/hooks/use-collection-publish.ts')

    expect(source).toContain("from '@/lib/hooks/legacy-mint-asset-recovery'")
    expect(source).toContain('hasValidOptionalLegacyAssetsSealMaterial')
    expect(source).toContain('createLegacyInitialAssetSealSidecar')
    expect(source).toContain('const assetsSealSidecar = await createLegacyInitialAssetSealSidecar')
    expect(source).not.toContain('assetsSealSidecar: null')
  })

  it('bumps RECOVERY_VERSION when collection publish switches to the v12 fast-path schema (drops v11 drafts)', () => {
    const source = readSource('web/lib/hooks/use-collection-publish.ts')
    expect(source).toContain('const RECOVERY_VERSION = 12 as const')
    // v11 schema is incompatible with v12 — drafts must be dropped on hydrate.
    expect(source).toContain('// v11 (or earlier) drafts are discarded — schema is incompatible.')
  })

  it('includes maxSupply in the draft signature so a different cap invalidates an in-flight draft', () => {
    const source = readSource('web/lib/hooks/use-collection-publish.ts')
    expect(source).toMatch(/buildCollectionDraftSignature[\s\S]*maxSupply: params\.maxSupply \?\? null/)
  })

  it('persists maxSupply in collectionMeta recovery so refresh restores the supply selector', () => {
    const source = readSource('web/lib/hooks/use-collection-publish.ts')
    expect(source).toContain('maxSupply: params.maxSupply ?? null')
    expect(source).toContain('maxSupply: number | null')
  })

  it('persists floorPriceAtomic in collectionMeta recovery and hydrates from that meta snapshot', () => {
    const hookSource = readSource('web/lib/hooks/use-collection-publish.ts')
    const metaStart = hookSource.indexOf('interface CollectionRecoveryMeta')
    const metaBlock = hookSource.slice(metaStart, hookSource.indexOf('interface ChunkRecovery', metaStart))
    expect(metaBlock).toContain('floorPriceAtomic: string | null')

    const recoveryStart = hookSource.indexOf('collectionMeta: baseRecovery.collectionMeta ?? {')
    const recoveryBlock = hookSource.slice(recoveryStart, hookSource.indexOf('},', recoveryStart) + 2)
    expect(recoveryBlock).toContain('floorPriceAtomic: params.floorPriceAtomic ?? null')

    const providerSource = readSource('web/components/providers/create-collection-provider.tsx')
    const hydrateStart = providerSource.indexOf('// Hydrate draft inputs from recovery state')
    const hydrateBlock = providerSource.slice(hydrateStart, providerSource.indexOf('setIsHydrated(true)', hydrateStart))
    expect(hydrateBlock).toContain('meta.floorPriceAtomic')
    expect(hydrateBlock).not.toContain('recovery.floorPriceAtomic')
  })

  it('captures maxSupply / unlimited / emptyCollection in publish telemetry', () => {
    const source = readSource('web/lib/hooks/use-collection-publish.ts')
    expect(source).toContain('collection_publish_started')
    expect(source).toMatch(/maxSupply: params\.maxSupply \?\? null/)
    expect(source).toMatch(/unlimited: params\.maxSupply == null/)
    expect(source).toMatch(/emptyCollection: \(params\.souls\?\.length \?\? 0\) === 0/)
  })
})
