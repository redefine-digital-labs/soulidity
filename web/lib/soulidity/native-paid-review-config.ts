import {fromBase58,toBase58,normalizeStructTag} from '@mysten/sui/utils'
import type {CanonicalNativeWorkbenchTarget} from './canonical-native-workbench'
import type {EconomicsTarget} from './commerce/economics-read'
/** Explicit release pins only; never guesses a payment coin or Foundation
 * package from labels. Configuration is not source/permission evidence. */
export function parseNativePaidReviewEconomics(value:unknown,target:CanonicalNativeWorkbenchTarget):EconomicsTarget{
 const c=structuredClone(value) as EconomicsTarget
 const check=(v:unknown)=>{if(!v)throw Error('NATIVE_PAID_REVIEW_RELEASE_INVALID')}
 const keys=(v:object,k:string)=>check(v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join(',')===k)
 const id=(v:unknown)=>typeof v==='string'&&/^0x[0-9a-f]{64}$/.test(v)&&BigInt(v)!==0n
 keys(c,'chainIdentifier,coinType,configId,foundation');keys(c.foundation,'callableDigest,callablePackageId,originalPackageId')
 check(c.chainIdentifier===target.chainIdentifier&&c.configId===target.configId&&id(c.configId)&&id(c.foundation.originalPackageId)&&id(c.foundation.callablePackageId))
 check(typeof c.coinType==='string'&&normalizeStructTag(c.coinType)===c.coinType)
 check(typeof c.foundation.callableDigest==='string');const digest=fromBase58(c.foundation.callableDigest);check(digest.length===32&&toBase58(digest)===c.foundation.callableDigest)
 return c
}
