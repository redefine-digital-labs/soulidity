import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

function readSource(relativePath: string) {
  return readFileSync(resolve(process.cwd(), relativePath), 'utf8')
}

describe('sell flow regression guards', () => {
  it('redirects to sell success from a stable route id after listing completes', () => {
    const source = readSource('web/app/souls/[id]/sell/authorize/page.tsx')

    expect(source).toContain("if (status !== 'done') return")
    expect(source).toContain("router.replace(`/souls/${encodeURIComponent(id)}/sell/success?price=${encodeURIComponent(rawPrice)}`)")
    expect(source).not.toContain("if (status === 'done' && soul)")
  })

  it('blocks zero-price listings from reaching authorization from the sell page', () => {
    const source = readSource('web/app/souls/[id]/sell/page.tsx')

    expect(source).toContain('const invalidPrice = priceAtomic != null && priceAtomic <= 0n')
    expect(source).toContain('const authorizeHref = priceAtomic != null && priceAtomic > 0n && !belowFloor')
  })

  it('uses dedicated Animacraft v5 list and purchase transactions', () => {
    const listSource = readSource('web/lib/hooks/use-list-soul.ts')
    const purchaseSource = readSource('web/lib/hooks/use-purchase.ts')

    expect(listSource).toContain('buildListAnimacraftV5SoulTx')
    expect(listSource).toContain('frozenSoulCreatorRoyaltyBps: soul.creatorRoyaltyBps')
    expect(purchaseSource).toContain('buildBuyAnimacraftV5SoulTx')
    expect(purchaseSource).toContain('quoteAnimacraftV5SoulSale')
    expect(purchaseSource).toContain('requiredAtomic !== grossPriceAtomic')
    expect(purchaseSource).toContain('const coins = await suiClient.getCoins')
    expect(purchaseSource).not.toContain('selectCoinObjectIdsForAmountAcrossPages')
  })

  it('fails closed for collection-bound Animacraft v5 Souls without exposing removal', () => {
    const listSource = readSource('web/lib/hooks/use-list-soul.ts')
    const purchaseSource = readSource('web/lib/hooks/use-purchase.ts')
    const sellSource = readSource('web/app/souls/[id]/sell/page.tsx')
    const authorizeSource = readSource('web/app/souls/[id]/sell/authorize/page.tsx')
    const buySource = readSource('web/app/souls/[id]/buy/page.tsx')
    const detailSource = readSource('web/app/souls/[id]/page.tsx')

    expect(listSource).toContain('isAnimacraftV5 && soul.collectionOnChainId')
    expect(purchaseSource).toContain('isAnimacraftV5 && soul.collectionOnChainId')
    expect(sellSource).toContain('Collection-bound v5 Soul cannot be listed')
    expect(authorizeSource).toContain('Collection-bound v5 Soul cannot be authorized')
    expect(buySource).toContain('Animacraft v5 purchase blocked')
    expect(detailSource).toContain('Collection-bound Animacraft v5 Soul · secondary listing is blocked.')

    for (const source of [sellSource, authorizeSource, detailSource]) {
      expect(source).not.toContain('useRemoveSoulFromCollection')
      expect(source).not.toContain('removeFromCollection')
      expect(source).not.toContain('Open removal step')
    }
  })

  it('shows v5 gross-price fees and both frozen royalty roles', () => {
    const sellSource = readSource('web/app/souls/[id]/sell/page.tsx')
    const authorizeSource = readSource('web/app/souls/[id]/sell/authorize/page.tsx')
    const buySource = readSource('web/app/souls/[id]/buy/page.tsx')
    const detailSource = readSource('web/app/souls/[id]/page.tsx')

    expect(sellSource).toContain('ANIMACRAFT_V5_PROTOCOL_FEE_BPS')
    expect(sellSource).toContain('Animacraft v5 gross-price resale')
    expect(authorizeSource).toContain('market::list_animacraft_v5_soul_fixed_price_v2')
    expect(buySource).toContain('Gross sale price')
    expect(buySource).toContain('Maker-source royalty · included')
    expect(detailSource).toContain('Soul creator royalty')
    expect(detailSource).toContain('Maker-source royalty')
    expect(detailSource).toContain('{!v5CollectionBlocked && (')
    expect(detailSource).toContain('Update price')
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
})
