import { expect, it } from 'vitest'
import { extractAnimacraftV8SoulPurchasedEvent, tryExtractAnimacraftV8SoulPurchasedEvent } from '@soulidity/sdk'
const id = (n: number) => `0x${n.toString(16).padStart(64, '0')}`
const fields = { listing_id: id(1), soul_id: id(2), provenance_id: id(3), seller: id(4), buyer: id(5),
  maker_source_recipient: id(6), price: '10000', seller_payout: '9000', protocol_fee: '250',
  soul_creator_royalty_bps: '250', soul_creator_royalty: '250', maker_source_royalty_bps: '500', maker_source_royalty: '500' }
const event = (changes = {}, type = `${id(7)}::market::AnimacraftV8SoulPurchased`) => ({ type, parsedJson: { ...fields, ...changes } })
it('parses exact native provenance and gross-price allocation through the public SDK export', () => {
  expect(extractAnimacraftV8SoulPurchasedEvent({ events: [event()] }, id(7))).toMatchObject({
    provenanceId: id(3), priceAtomic: 10000n, sellerPayoutAtomic: 9000n, makerSourceRoyaltyBps: 500,
  })
})
it.each([`${id(8)}::market::AnimacraftV8SoulPurchased`, `${id(7)}::wrong::AnimacraftV8SoulPurchased`,
  `${id(7)}::market::AnimacraftV5SoulPurchased`, `${id(7)}::market::SoulPurchased`,
  `${id(7)}::market::AnimacraftV8SoulPurchased<0x2::sui::SUI>`])('does not reinterpret %s as native', type => {
  expect(tryExtractAnimacraftV8SoulPurchasedEvent({events:[event({},type)]},id(7))).toBeNull()
})
it.each([-1, -1n, 0.5, Number.MAX_SAFE_INTEGER + 1, '18446744073709551616', '01', ' 10000', '1e4', null])('rejects malformed u64 %s', price => {
  expect(() => extractAnimacraftV8SoulPurchasedEvent({events:[event({price})]},id(7))).toThrow()
})
it.each([{ buyer: 'not-an-address' }, { soul_creator_royalty_bps: '10001' }, { seller_payout: '9001' }])('rejects malformed identity or settlement %j', changes => {
  expect(() => extractAnimacraftV8SoulPurchasedEvent({events:[event(changes)]},id(7))).toThrow()
})
it('rejects missing, duplicate and malformed exact events without falling back', () => {
  expect(() => extractAnimacraftV8SoulPurchasedEvent({events:[]},id(7))).toThrow('missing')
  expect(() => extractAnimacraftV8SoulPurchasedEvent({events:[event(),event()]},id(7))).toThrow('ambiguous')
  expect(() => extractAnimacraftV8SoulPurchasedEvent({events:[{...event(),parsedJson:null}]},id(7))).toThrow('malformed')
})
it.each([[250,750],[0,1000],[1000,0]])('accepts exact Core creator/source caps %i/%i', (creator,source)=>{
  const changes={soul_creator_royalty_bps:String(creator),soul_creator_royalty:String(creator),
    maker_source_royalty_bps:String(source),maker_source_royalty:String(source),seller_payout:'8750'}
  expect(extractAnimacraftV8SoulPurchasedEvent({events:[event(changes)]},id(7)).priceAtomic).toBe(10000n)
})
it.each([
  {protocol_fee:'251',seller_payout:'8999'},
  {soul_creator_royalty:'251',seller_payout:'8999'},
  {maker_source_royalty:'501',seller_payout:'8999'},
  {soul_creator_royalty_bps:'251'}, {maker_source_royalty_bps:'501'},
  {soul_creator_royalty_bps:'550',maker_source_royalty_bps:'500'},
  {soul_creator_royalty_bps:'1050'}, {maker_source_royalty_bps:'1050'},
  {price:'0',seller_payout:'0',protocol_fee:'0',soul_creator_royalty:'0',maker_source_royalty:'0'},
])('rejects sum-preserving wrong fee, invalid Core rate or zero price %j', changes=>{
  expect(()=>extractAnimacraftV8SoulPurchasedEvent({events:[event(changes)]},id(7))).toThrow()
})
it('uses independent integer floor amounts for sub-unit royalties',()=>{
  const parsed=extractAnimacraftV8SoulPurchasedEvent({events:[event({price:'39',seller_payout:'38',
    protocol_fee:'0',soul_creator_royalty:'0',maker_source_royalty:'1'})]},id(7))
  expect(parsed.sellerPayoutAtomic).toBe(38n)
})
