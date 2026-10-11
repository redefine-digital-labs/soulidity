import {SOUL_PUBLIC_USDC_TYPE,formatAtomicAmountForDisplay} from '@soulidity/sdk'
import {normalizeStructTag} from '@mysten/sui/utils'
/** Do not guess decimals from an untrusted symbol or Maker metadata. Unknown
 * coin types remain usable through explicitly labelled exact atomic units. */
export function equipmentMarketCurrency(type:string|null){
  if(type&&normalizeStructTag(type)===SOUL_PUBLIC_USDC_TYPE)return {decimals:6,label:'USDC'}
  if(type&&normalizeStructTag(type)===normalizeStructTag('0x2::sui::SUI'))return {decimals:9,label:'SUI'}
  return {decimals:0,label:'atomic units'}
}
export function formatEquipmentMarketAmount(value:string,type:string){
  const currency=equipmentMarketCurrency(type)
  return formatAtomicAmountForDisplay(value,{decimals:currency.decimals,symbol:currency.label})
}
