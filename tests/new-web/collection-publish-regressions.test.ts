import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

function readSource(relativePath: string) {
  return readFileSync(resolve(process.cwd(), relativePath), 'utf8')
}

describe('collection publish regression guards', () => {
  it('re-resolves the personal kiosk after the first soul mint when the batch started without one', () => {
    const source = readSource('web/lib/hooks/use-collection-publish.ts')

    expect(source).toContain('let personalKiosk = await resolvePersonalKiosk(authHeaders, walletAddress)')
    expect(source).toContain('if (!personalKiosk && i === 0)')
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
    expect(source).toContain('[status, syncData, setPublishResult, name, floorPrice, extraRoyaltyBps, tradeable, batchSouls, router, showToast]')
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
})
