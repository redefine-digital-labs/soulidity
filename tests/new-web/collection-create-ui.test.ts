import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

function readSource(relativePath: string) {
  return readFileSync(resolve(process.cwd(), relativePath), 'utf8')
}

describe('web collection create regression guards', () => {
  it('keeps the collection create hook pointed at the dedicated sync route', () => {
    const source = readSource('web/lib/hooks/use-collections.ts')

    expect(source).toContain("fetch('/api/collections/create'")
    expect(source).not.toContain("fetch('/api/collections', {")
  })

  it('keeps the desktop create menu pointed at /collections/create', () => {
    const source = readSource('web/components/nav/nav-create-menu.tsx')

    expect(source).toContain("label: 'Create Collection'")
    expect(source).toContain("href: '/collections/create'")
  })

  it('keeps the mobile nav exposing the collection create entry', () => {
    const source = readSource('web/components/nav/navbar.tsx')

    expect(source).toContain("href: '/collections/create'")
    expect(source).toContain("label: 'Create Collection'")
  })

  it('keeps the collection create route behind an AuthGate layout', () => {
    const source = readSource('web/app/collections/create/_shell.tsx')

    expect(source).toContain('<AuthGate')
    expect(source).toContain('label="Sign in to create a Collection"')
  })

  it('exposes a Skip-for-now CTA on Step 2 so empty collections can launch', () => {
    const source = readSource('web/app/collections/create/souls/page.tsx')
    // Page now renders the Batch Upload flow directly with a dynamic CTA:
    // - no batch loaded → primary "Skip for now" button
    // - valid batch loaded → primary "Continue with N Souls" + secondary skip link
    expect(source).toContain('Skip for now')
    // Skip path must drive the preview's empty-flow detection by setting
    // addSoulsMethod = 'skip' (preview reads `addSoulsMethod === 'skip'`).
    expect(source).toContain("setAddSoulsMethod('skip')")
    expect(source).toContain("setAddSoulsMethod('batch-upload')")
  })

  it('still drives preview empty-flow detection via addSoulsMethod === skip', () => {
    const preview = readSource('web/app/collections/create/preview/page.tsx')
    expect(preview).toContain("addSoulsMethod === 'skip'")
  })

  it('keeps null = "method not picked" semantics while adding skip + batch-upload', () => {
    const provider = readSource('web/components/providers/create-collection-provider.tsx')
    expect(provider).toContain("'batch-upload' | 'skip' | null")
  })

  it('rewires Step 1 supply cap to a required, on-chain field with an unlimited toggle', () => {
    const page = readSource('web/app/collections/create/page.tsx')
    expect(page).toContain('Unlimited (no on-chain cap)')
    expect(page).toContain('ctx.unlimitedSupply')
    expect(page).not.toContain('template validation only')
    expect(page).not.toContain('Leave blank for unlimited')
  })

  it('passes maxSupply through to the publish flow + telemetry from preview', () => {
    const source = readSource('web/app/collections/create/preview/page.tsx')
    expect(source).toContain('maxSupply: maxSupplyParam')
    expect(source).toContain('emptyCollection: batchSouls.length === 0')
  })

  it('hydrates collection v12 recovery from collectionPtb1Digest instead of the removed txDigest field', () => {
    const provider = readSource('web/components/providers/create-collection-provider.tsx')
    const hydrateStart = provider.indexOf('// Hydrate draft inputs from recovery state')
    expect(hydrateStart).toBeGreaterThanOrEqual(0)
    const block = provider.slice(hydrateStart, provider.indexOf('setIsHydrated(true)', hydrateStart))

    expect(block).toContain('recovery.collectionPtb1Digest')
    expect(block).toContain('recovery.collectionRightListing')
    expect(block).toContain('setListCollectionRightOnLaunch(true)')
    expect(block).not.toContain('recovery.txDigest')
  })

  it('does not enforce a stale supply cap while unlimited mode is active', () => {
    const source = readSource('web/app/collections/create/souls/page.tsx')
    expect(source).toContain('ctx.unlimitedSupply ? undefined : parseCollectionSupplyCapInput(ctx.supplyCap)')
    expect(source).not.toContain('parseInt(ctx.supplyCap')
  })

  it('uses one shared supply-cap parser across Step 1, Step 2, and Preview', () => {
    const step1 = readSource('web/app/collections/create/page.tsx')
    const step2 = readSource('web/app/collections/create/souls/page.tsx')
    const preview = readSource('web/app/collections/create/preview/page.tsx')

    expect(step1).toContain('parseCollectionSupplyCapInput(ctx.supplyCap)')
    expect(step2).toContain('parseCollectionSupplyCapInput(ctx.supplyCap)')
    expect(preview).toContain('parseCollectionSupplyCapInput(ctx.supplyCap)')
  })

  it('renders a capacity progress chip on the success page when a cap is set', () => {
    const source = readSource('web/app/collections/create/success/page.tsx')
    expect(source).toContain("`0 now · capacity ${capacityLabel}`")
    expect(source).toContain("'Collection created. Add Souls when ready.'")
  })

  it('reflects collection-right listing outcome on the collection success page', () => {
    const source = readSource('web/app/collections/create/success/page.tsx')
    expect(source).toContain('const collectionRightListed = result.listingStatus ===')
    expect(source).toContain('Tradeable · Listed')
    expect(source).toContain('Collection-right listed in launch PTB')
    expect(source).toContain('!collectionRightListed')
  })

  it('reflects soul listing outcome on the single-soul success page', () => {
    const provider = readSource('web/components/providers/create-soul-provider.tsx')
    const success = readSource('web/app/create/success/page.tsx')

    expect(provider).toContain('listingTxDigest?: string | null')
    expect(provider).toContain('listingObjectOnChainId?: string | null')
    expect(provider).toContain('listedPriceAtomic?: string | null')
    expect(success).toContain("const isListed = ctx.publishResult.listingStatus === 'listed'")
    expect(success).toContain('Listed on marketplace')
    expect(success).toContain('Bound and listed')
    expect(success).toContain('!isListed')
  })

  it('routes collection Add Soul through the same-PTB mint+bind builder (no second signature)', () => {
    const detailSource = readSource('web/app/collections/[id]/page.tsx')
    const createSource = readSource('web/app/create/page.tsx')
    const gasSource = readSource('web/app/create/gas/page.tsx')
    const providerSource = readSource('web/components/providers/create-soul-provider.tsx')
    const publishHookSource = readSource('web/lib/hooks/use-publish.ts')

    expect(detailSource).not.toContain('href="/publish"')
    expect(detailSource).toContain('/create?collectionId=${encodeURIComponent(collection.onChainId)}')
    expect(createSource).toContain('useSearchParams')
    expect(createSource).toContain('setCollectionBindTarget(')
    expect(providerSource).toContain("const COLLECTION_BIND_TARGET_KEY = 'soul-create-collection-bind-target'")
    expect(gasSource).toContain('collectionBindTarget: ctx.collectionBindTarget')
    // Bind now lives in the same PTB as mint via buildPublishSoulWithBindTx /
    // buildPublishSoulWithCollectionAndListTx — there is no separate add-soul
    // signAndExecute branch in use-publish anymore.
    expect(publishHookSource).toContain('buildPublishSoulWithBindTx')
    expect(publishHookSource).toContain('buildPublishSoulWithCollectionAndListTx')
    // Mirror still uses the add-soul route, but with txDigest = mint digest.
    expect(publishHookSource).toContain('/api/collections/${encodeURIComponent(recoveredBindOnChainId)}/add-soul')
    // Critical regression guard: only one signAndExecute per publish() call.
    const signAndExecuteOccurrences = (publishHookSource.match(/await signAndExecute\(/g) ?? []).length
    expect(signAndExecuteOccurrences).toBe(1)
  })

  it('preflights collection bind target before the paid Soul mint transaction', () => {
    const source = readSource('web/lib/hooks/use-publish.ts')
    const preflightIdx = source.indexOf('await preflightCollectionBindTarget(authHeaders, collectionBindOnChainId)')
    // Builder selection happens after preflight; check the publish-soul builder
    // family is present and runs after the preflight.
    const builderIdx = source.indexOf('buildPublishSoulTx(baseBuilderParams)')

    expect(preflightIdx).toBeGreaterThanOrEqual(0)
    expect(builderIdx).toBeGreaterThan(preflightIdx)
  })

  it('preflights collection bind target before paid Walrus upload preparation', () => {
    const source = readSource('web/app/create/gas/page.tsx')
    const preflightIdx = source.indexOf('await preflightCollectionBindTarget(preflightAuthHeaders, ctx.collectionBindTarget.collectionOnChainId)')
    const uploadIdx = source.indexOf('prepared = await prepareSoulBlobsForBatchPublish')

    expect(preflightIdx).toBeGreaterThanOrEqual(0)
    expect(uploadIdx).toBeGreaterThan(preflightIdx)
  })
})
