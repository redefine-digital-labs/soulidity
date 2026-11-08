import type {SuiGrpcClient} from '@mysten/sui/grpc'
import {normalizeStructTag} from '@mysten/sui/utils'
import {MAINNET_GENESIS_DIGEST} from '../../animacraft/mainnet-chain'
import {profileReadStep} from '@soulidity/sdk'
import {commerceCheck,commerceId} from './economics-read'

/** Public address observation in one currency, not revenue attribution or
 * wallet/withdrawal authority. Read raw optional protobuf fields: the SDK core
 * convenience method maps absent balances to zero, which is unsafe here. */
export async function readCommerceAddressFunds(input:{client:SuiGrpcClient;owner:string;coinType:string;getObservedAddress:()=>string|null;signal:AbortSignal}){
 const owner=input.owner,coinType=normalizeStructTag(input.coinType),getObservedAddress=input.getObservedAddress
 const signal=AbortSignal.any([input.signal,AbortSignal.timeout(30000)])
 commerceCheck(commerceId(owner),'ADDRESS_FUNDS_OWNER')
 const getServiceInfo=input.client.ledgerService.getServiceInfo.bind(input.client.ledgerService)
 const state=input.client.stateService
 commerceCheck(typeof state?.getBalance==='function','ADDRESS_FUNDS_READER_UNAVAILABLE')
 const getBalance=state.getBalance.bind(state)
 const guard=()=>{signal.throwIfAborted();commerceCheck(getObservedAddress()===owner,'ADDRESS_FUNDS_SCOPE_CHANGED')}
 guard();const info=await profileReadStep(signal,()=>getServiceInfo({},{abort:signal}));guard()
 commerceCheck(info.response.chainId===MAINNET_GENESIS_DIGEST,'ADDRESS_FUNDS_CHAIN')
 const response=await profileReadStep(signal,()=>getBalance({owner,coinType},{abort:signal}));guard()
 const row=structuredClone(response.response.balance),uint=(v:unknown):v is bigint=>typeof v==='bigint'&&v>=0n&&v<=(1n<<64n)-1n
 commerceCheck(row&&typeof row.coinType==='string'&&normalizeStructTag(row.coinType)===coinType&&uint(row.balance)&&uint(row.coinBalance)&&uint(row.addressBalance),'ADDRESS_FUNDS_RAW_BALANCE_REQUIRED')
 commerceCheck(row.balance===row.coinBalance+row.addressBalance,'ADDRESS_FUNDS_SUM')
 guard();return {proof:'current-grpc-address-and-coin-balance-observation-only' as const,owner,coinType,balance:String(row.balance),coinBalance:String(row.coinBalance),addressBalance:String(row.addressBalance),
  notRevenueAttribution:true as const,notWalletOrWithdrawalAuthority:true as const,notAllCurrencies:true as const,notAtomicWithOtherObservations:true as const,notOriginalPaymentProof:true as const}
}
