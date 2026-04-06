import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

function readSource(relativePath: string) {
  return readFileSync(resolve(process.cwd(), relativePath), 'utf8')
}

describe('collection publish regression guards', () => {
  it('re-resolves the personal kiosk after the first soul mint when the batch started without one', () => {
    const source = readSource('new-web/lib/hooks/use-collection-publish.ts')

    expect(source).toContain('let personalKiosk = await resolvePersonalKiosk(authHeaders, walletAddress)')
    expect(source).toContain('if (!personalKiosk && i === 0)')
  })

  it('treats add-soul mirror failures as bind failures instead of recording success', () => {
    const source = readSource('new-web/lib/hooks/use-collection-publish.ts')

    expect(source).toContain('if (!addRes.ok)')
    expect(source).toContain('Failed to bind Soul')
  })

  it('guards downstream collection create routes against direct navigation with incomplete state', () => {
    const soulsSource = readSource('new-web/app/collections/create/souls/page.tsx')
    const previewSource = readSource('new-web/app/collections/create/preview/page.tsx')
    const successSource = readSource('new-web/app/collections/create/success/page.tsx')

    expect(soulsSource).toContain("router.replace('/collections/create')")
    expect(previewSource).toContain("router.replace('/collections/create/souls')")
    expect(successSource).toContain("router.replace('/collections/create')")
  })

  it('scopes collection publish state in sessionStorage and clears it on reset', () => {
    const providerSource = readSource('new-web/components/providers/create-collection-provider.tsx')
    const hookSource = readSource('new-web/lib/hooks/use-collection-publish.ts')

    expect(providerSource).toContain("const PUBLISH_RESULT_KEY = 'collection-publish-result'")
    expect(providerSource).toContain('sessionStorage.removeItem(MINT_RECOVERY_KEY)')
    expect(hookSource).toContain('draftSignature')
  })

  it('keeps collection create API errors generic for clients', () => {
    const source = readSource('new-web/app/api/collections/create/route.ts')

    expect(source).toContain("return NextResponse.json({ error: 'Failed to mirror Soulidity collection creation transaction' }, { status: 500 })")
    expect(source).not.toContain('Failed to mirror Soulidity collection creation transaction: ${message}')
  })
})
