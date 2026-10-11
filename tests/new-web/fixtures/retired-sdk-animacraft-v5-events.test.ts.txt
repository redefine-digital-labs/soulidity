import { describe, expect, it } from 'vitest'
import {
  extractAnimacraftOutputProvenanceV5CreatedEvent,
  extractAnimacraftV5SoulPurchasedEvent,
  tryExtractAnimacraftOutputProvenanceV5CreatedEvent,
  tryExtractAnimacraftV5SoulPurchasedEvent,
} from '@soulidity/sdk'

const id = (character: string) => `0x${character.repeat(64)}`
const PACKAGE_ID = id('1')

describe('Animacraft v5 settlement event parser', () => {
  it('keeps the provenance Maker-source bps beside the paid amount', () => {
    const parsed = extractAnimacraftV5SoulPurchasedEvent({
      events: [{
        type: `${PACKAGE_ID}::market::AnimacraftV5SoulPurchased`,
        parsedJson: {
          listing_id: id('2'),
          soul_id: id('3'),
          provenance_id: id('4'),
          seller: id('5'),
          buyer: id('6'),
          maker_source_recipient: id('7'),
          price: '1000000',
          seller_payout: '920000',
          protocol_fee: '25000',
          soul_creator_royalty_bps: '250',
          soul_creator_royalty: '25000',
          maker_source_royalty_bps: '300',
          maker_source_royalty: '30000',
        },
      }],
    }, PACKAGE_ID)

    expect(parsed.makerSourceRoyaltyBps).toBe(300)
    expect(parsed.makerSourceRoyaltyAtomic).toBe(30_000n)
    expect(parsed.makerSourceRecipientAddress).toBe(id('7'))
    expect(parsed.sellerPayoutAtomic).toBe(920_000n)
  })

  it('returns null from the optional extractor when the transaction is not v5', () => {
    expect(tryExtractAnimacraftV5SoulPurchasedEvent({
      events: [],
    }, PACKAGE_ID)).toBeNull()
  })
})

describe('Animacraft v5 completed-output provenance event parser', () => {
  it('returns every immutable edge used by Soulidity Seal approval', () => {
    const sealId = Array.from({ length: 32 }, (_, index) => index)
    const parsed = extractAnimacraftOutputProvenanceV5CreatedEvent({
      events: [{
        type:
          `${PACKAGE_ID}::animacraft_output_provenance_v5::AnimacraftOutputProvenanceV5Created`,
        parsedJson: {
          output_provenance_id: id('2'),
          base_provenance_id: id('3'),
          soul_id: id('4'),
          state_id: id('5'),
          maker_root_id: id('6'),
          complete_output_seal_id: sealId,
        },
      }],
    }, PACKAGE_ID)

    expect(parsed).toMatchObject({
      outputProvenanceId: id('2'),
      baseProvenanceId: id('3'),
      soulId: id('4'),
      stateId: id('5'),
      makerRootId: id('6'),
    })
    expect(Array.from(parsed.completeOutputSealId)).toEqual(sealId)
  })

  it('does not accept an event emitted by an unrelated package', () => {
    expect(tryExtractAnimacraftOutputProvenanceV5CreatedEvent({
      events: [{
        type:
          `${id('9')}::animacraft_output_provenance_v5::AnimacraftOutputProvenanceV5Created`,
        parsedJson: {},
      }],
    }, PACKAGE_ID, [PACKAGE_ID])).toBeNull()
  })

  it('rejects a companion event whose Seal ID is not exactly 32 bytes', () => {
    expect(() => extractAnimacraftOutputProvenanceV5CreatedEvent({
      events: [{
        type:
          `${PACKAGE_ID}::animacraft_output_provenance_v5::AnimacraftOutputProvenanceV5Created`,
        parsedJson: {
          output_provenance_id: id('2'),
          base_provenance_id: id('3'),
          soul_id: id('4'),
          state_id: id('5'),
          maker_root_id: id('6'),
          complete_output_seal_id: Array.from({ length: 31 }, () => 0),
        },
      }],
    }, PACKAGE_ID)).toThrow('must be exactly 32 bytes')
  })
})
