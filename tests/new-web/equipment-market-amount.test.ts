import {expect,it} from 'vitest'
import {SOUL_PUBLIC_USDC_TYPE} from '@soulidity/sdk'
import {equipmentMarketCurrency,formatEquipmentMarketAmount} from '../../web/lib/animacraft/equipment-market-amount'
it('uses exact type identities, not a symbol or default six-decimal assumption',()=>{
  expect(formatEquipmentMarketAmount('1000000',SOUL_PUBLIC_USDC_TYPE)).toBe('1 USDC')
  expect(formatEquipmentMarketAmount('1000000000','0x2::sui::SUI')).toBe('1 SUI')
  expect(formatEquipmentMarketAmount('1000000','0x99::usdc::USDC')).toBe('1000000 atomic units')
  expect(equipmentMarketCurrency(null)).toEqual({decimals:0,label:'atomic units'})
})
