import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

function readSource(relativePath: string) {
  return readFileSync(resolve(process.cwd(), relativePath), 'utf8')
}

describe('sell flow regression guards', () => {
  it('explains atomic selected-Soul-only selling instead of manual equipment removal',()=>{
    for(const path of ['web/app/souls/[id]/sell/page.tsx','web/app/souls/[id]/sell/authorize/page.tsx']){
      const source=readSource(path)
      expect(source).toContain('snapshot?.equipmentSale')
      expect(source).toContain('For sale: 1 Animacraft Soul only')
      expect(source).toContain('Equipment is not for sale')
      expect(source).toContain('nativeCanList')
      expect(source).not.toContain('Remove equipped components and close the empty equipment setup on the Soul page before listing.')
      expect(source).toContain('NativeListingRecovery')
    }
    const authorize=readSource('web/app/souls/[id]/sell/authorize/page.tsx')
    expect(authorize).toContain('equipmentSale.removals.map')
    expect(authorize).toContain('Cancelling a successful listing does not re-equip anything')
  })
  it('redirects to sell success from a stable route id after listing completes', () => {
    const source = readSource('web/app/souls/[id]/sell/authorize/page.tsx')

    expect(source).toContain("if (status !== 'done' || native) return")
    expect(source).toContain("router.replace(`/souls/${encodeURIComponent(id)}/sell/success?price=${encodeURIComponent(rawPrice)}`)")
    expect(source).not.toContain("if (status === 'done' && soul)")
  })

  it('blocks zero-price listings from reaching authorization from the sell page', () => {
    const source = readSource('web/app/souls/[id]/sell/page.tsx')

    expect(source).toContain('const invalidPrice = priceAtomic != null && priceAtomic <= 0n')
    expect(source).toContain('const authorizeHref = priceAtomic != null && priceAtomic > 0n && !belowFloor')
  })

  it('routes native checkout through the current durable purchase without old transaction selectors', () => {
    const listSource = readSource('web/lib/hooks/use-list-soul.ts')
    const purchaseSource = readSource('web/lib/hooks/use-purchase.ts')

    expect(listSource).toContain('useNativeMarketListActions')
    expect(listSource).not.toContain('buildListAnimacraftV5SoulTx')
    expect(purchaseSource).toContain('useNativeMarketBuyActions')
    expect(purchaseSource).toContain("soul?.provenanceKind === 'animacraft'")
    for (const obsolete of ['buildBuyAnimacraftSoulTx','buildBuyAnimacraftV5SoulTx','buildBuyAnimacraftV6SoulTx',
      'buildBuyAnimacraftV7SoulTx','getAnimacraftAppearanceV6Id','physicalWardrobeV7RuntimeFromPublicEnv']) {
      expect(purchaseSource).not.toContain(obsolete)
    }
    expect(purchaseSource).toContain('const coins = await suiClient.getCoins')
    expect(purchaseSource).not.toContain('selectCoinObjectIdsForAmountAcrossPages')
  })

  it('removes obsolete native list and reprice selectors from the original callers', () => {
    const sources = [
      readSource('web/lib/hooks/use-list-soul.ts'),
      readSource('web/components/souls/listing-modals.tsx'),
      readSource('web/app/souls/[id]/sell/page.tsx'),
      readSource('web/app/souls/[id]/sell/authorize/page.tsx'),
    ]
    for (const source of sources) for (const obsolete of ['isAnimacraftV5','buildListAnimacraftV5SoulTx',
      'buildListAnimacraftV6SoulTx','buildListAnimacraftV7SoulTx','getAnimacraftAppearanceV6Id','getAnimacraftWardrobeV7Id']) {
      expect(source).not.toContain(obsolete)
    }
    expect(sources[1]).toContain('<NativeUpdatePriceModal {...props} />')
    expect(sources[3]).toContain('market::list_animacraft_v8_soul_fixed_price')
  })

  it('uses verified native gross quotes and preserves listing recovery outside owner/listed gates', () => {
    const sell = readSource('web/app/souls/[id]/sell/page.tsx')
    const authorize = readSource('web/app/souls/[id]/sell/authorize/page.tsx')
    const success = readSource('web/app/souls/[id]/sell/success/page.tsx')
    const detail = readSource('web/app/souls/[id]/page.tsx')
    for (const source of [sell, authorize]) expect(source).toContain('NativeListingQuote')
    for (const source of [sell, authorize, success]) expect(source).toContain('NativeListingRecovery')
    expect(success).toContain('A saved receipt or a price in this URL is not proof')
    expect(detail).toContain('Listing / price update recovery')
    expect(detail).toContain("soul.provenanceKind === 'animacraft' || (soul.isOwner && soul.chainListingStatus === 'LISTED')")
    expect(readSource('web/components/souls/native-listing-quote.tsx')).toContain('quoteAnimacraftV8SoulSale')
  })

  it('treats 0 as an invalid price on the authorize page', () => {
    const source = readSource('web/app/souls/[id]/sell/authorize/page.tsx')

    expect(source).toContain('if (priceAtomic == null || priceAtomic <= 0n || priceError)')
  })

  it('blocks zero-price repricing in the listing modal before signing', () => {
    const source = readSource('web/components/souls/listing-modals.tsx')

    expect(source).toContain('const invalidPrice = priceAtomic != null && priceAtomic <= 0n')
    expect(source).toContain('if (priceAtomic == null || priceAtomic <= 0n || !soul.listingObjectOnChainId) return')
    expect(source).toContain('Listing price must be greater than 0')
    expect(source).toContain("disabled={priceAtomic == null || invalidPrice || !!priceError || samePrice || belowFloor || status !== 'idle'}")
  })

  it('reprices and delists souls with the soul kiosk instead of resolving a wallet kiosk', () => {
    const source = readSource('web/components/souls/listing-modals.tsx')

    expect(source).not.toContain('/api/souls/personal-kiosk')
    expect(source).not.toContain('fetchPersonalKiosk')
    expect(source).toContain('const soulKioskId = soul.currentKioskId')
    expect(source).toContain('const soulKioskCapId = soul.currentKioskCapOnChainId')
    expect(source).toContain("throw new Error('Soul kiosk info is missing")
    expect(source).toContain("'Soul kiosk': soulKioskId")
    expect(source).toContain("'Soul kiosk capability': soulKioskCapId")
    expect(source).toContain('currentKioskId: soulKioskId')
    expect(source).toContain('currentKioskCapOnChainId: soulKioskCapId')
  })

  it('routes native cancellation to durable signing and removes obsolete delist builders', () => {
    const modalSource = readSource('web/components/souls/listing-modals.tsx')

    expect(modalSource).toContain("props.soul.provenanceKind === 'animacraft'")
    expect(modalSource).toContain('<NativeDelistModal {...props} />')
    expect(modalSource).not.toContain('buildDelistAnimacraftV6SoulTx')
    expect(modalSource).not.toContain('buildDelistAnimacraftV7SoulTx')
    expect(modalSource).not.toContain('getAnimacraftPhysicalProfileV7Id')
    expect(readSource('web/app/souls/[id]/page.tsx')).toContain("soul.provenanceKind === 'animacraft' || (soul.isOwner && soul.chainListingStatus === 'LISTED')")
  })

  it('recovers native cancellation from exact live evidence without obsolete appearance or market config branches', () => {
    const routeSource = readSource('web/app/api/souls/[id]/delist/route.ts')

    expect(routeSource).toContain('extractSoulListingCancelledEvent')
    expect(routeSource).toContain('verifyNativeMarketCancellation')
    expect(routeSource).toContain('expectedNativeHeldState')
    expect(routeSource).not.toContain('extractAnimacraftV6SoulListingCancelledEvent')
    expect(routeSource).not.toContain('getAnimacraftAppearanceV6Id')
    expect(routeSource).not.toContain('NEXT_PUBLIC_SOULIDITY_MARKET_CONFIG_V6_PACKAGE_ID')
  })

  it('quotes fresh ordinary sales from the initialized V2 config and native detail from verified provenance', () => {
    const sources = [
      readSource('web/app/api/agent/souls/[id]/purchase/route.ts'),
      readSource('web/app/api/agent/souls/[id]/route.ts'),
    ]

    for (const source of sources) {
      expect(source).toContain('getMarketConfigV2')
      expect(source).toContain('NEXT_PUBLIC_SOULIDITY_MARKET_CONFIG_V2_ID')
    }
    const nativeDetail = readSource('web/lib/soulidity/browser-soul-detail.ts')
    expect(nativeDetail).toContain('resolveBrowserNativeListingDeployment')
    expect(nativeDetail).toContain('readSoulPublicListing')
    expect(nativeDetail).not.toContain('getMarketConfigV6')
    expect(nativeDetail).not.toContain('quoteAnimacraftV5SoulSale')
  })
})
