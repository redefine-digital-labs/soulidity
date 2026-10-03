import { existsSync, readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import * as sdk from '@soulidity/sdk'

const retired = [
  'buildMintAnimacraftSoulTx', 'appendAnimacraftSoulMintAuthorization',
  'appendAnimacraftCommerceV5Authorization', 'simulateAnimacraftCompleteQuoteV5',
  'buildAnimacraftCompleteOutputSealApprovalTx', 'buildBuyAnimacraftSoulTx',
  'buildListAnimacraftV5SoulTx', 'buildBuyAnimacraftV5SoulTx', 'quoteAnimacraftV5SoulSale',
  'buildListAnimacraftV6SoulTx', 'buildBuyAnimacraftV6SoulTx', 'buildDelistAnimacraftV6SoulTx',
  'buildListAnimacraftV7SoulTx', 'buildBuyAnimacraftV7SoulTx', 'buildDelistAnimacraftV7SoulTx',
  'getMarketConfigV6', 'quoteAnimacraftSoulPurchase', 'getAnimacraftProvenanceId',
  'getAnimacraftProvenanceObject', 'getAnimacraftProvenanceForState', 'getAnimacraftProvenanceStructType',
  'extractAnimacraftV5SoulPurchasedEvent', 'tryExtractAnimacraftV5SoulPurchasedEvent',
  'extractAnimacraftOutputProvenanceV5CreatedEvent', 'tryExtractAnimacraftOutputProvenanceV5CreatedEvent',
  'extractAnimacraftV6SoulListedEvent', 'extractAnimacraftV6SoulPurchasedEvent', 'extractAnimacraftV6SoulListingCancelledEvent',
  'hashAnimacraftRecipe', 'hashAnimacraftCompleteSelectionV5',
]
it('does not export retired issuer, market, read, recipe or event compatibility functions', () => {
  for (const name of retired) expect(sdk, name).not.toHaveProperty(name)
  for (const path of ['packages/soulidity-sdk/src/tx/animacraft.ts', 'packages/soulidity-sdk/src/animacraft-recipe.ts', 'web/lib/animacraft/handoff.ts']) expect(existsSync(path), path).toBe(false)
})
it('preserves ordinary Soul/Collection/grant and current native public functions', () => {
  for (const name of ['getSoulStateObject', 'getSoulObject', 'getMarketConfigV2',
    'quoteSoulPurchase', 'quoteCollectionPurchase', 'buildListSoulTx', 'buildBuySoulTx',
    'buildDelistSoulTx', 'buildDelistCollectionTx', 'buildDeleteSoulListingTx', 'buildDeleteCollectionListingTx',
    'extractSoulPurchasedEvent', 'extractSoulListedEvent', 'extractSoulGrantIssuedEvent',
    'extractCollectionPurchasedEvent', 'buildAnimacraftNativeCompleteApprovalV8',
    'buildBuyAnimacraftV8SoulTx', 'buildListAnimacraftV8SoulTx', 'buildCancelAnimacraftV8SoulListingTx',
    'extractAnimacraftV8SoulPurchasedEvent', 'quoteAnimacraftV8SoulSale']) {
    expect(sdk, name).toHaveProperty(name, expect.any(Function))
  }
})
it('preserves retired economic and equipped/collection evidence without calling it native acceptance', () => {
  const old = readFileSync('tests/new-web/fixtures/retired-sdk-animacraft-builders.test.ts.txt', 'utf8')
  for (const title of ['uses the collection-aware entry when a collection is supplied',
    'never sends the frozen creator royalty as a seller-controlled listing argument',
    'keeps cancellation config-free for emergency recovery']) expect(old).toContain(title)
  // Solo native economics/receipt/expiry and Complete proofs are executable in
  // sdk-animacraft-v8-purchase-events, market-*-operation, native-purchase-route,
  // sdk-animacraft-native-read-v8 and native-complete-read-client suites.
  // Native collection resale and nonempty-equipment ownership transition are
  // still open, not replaced by ordinary Collection or empty-equipment tests.
})
