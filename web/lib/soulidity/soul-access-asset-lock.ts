/** Cross-format asset operation layer. Package/config namespaces remain inside
 * this scope; legacy Soulidity and Native original package IDs may differ. */
export interface SoulAccessAssetScope {chainIdentifier:string;soulId:string;author:string}
const claims=new Set<string>()
export function soulAccessAssetKey(scope:SoulAccessAssetScope){
 const values=[scope.chainIdentifier,scope.soulId,scope.author]
 if(!values.every(v=>typeof v==='string'&&v.length>0&&v.length<=256))throw Error('SOUL_ACCESS_ASSET_SCOPE')
 return 'soulidity.soul-access-asset-operation:'+values.map(encodeURIComponent).join(':')
}
export function withSoulAccessAssetLock<T>(input:SoulAccessAssetScope,work:()=>Promise<T>):Promise<T>{
 const key=soulAccessAssetKey({...input})
 if(typeof navigator==='undefined'||!navigator.locks?.request)return Promise.reject(Error('SOUL_ACCESS_ASSET_REQUIRES_WEB_LOCKS'))
 if(claims.has(key))return Promise.reject(Error('SOUL_ACCESS_ASSET_BUSY'))
 // Claim synchronously before request() or any await. Across realms/tabs the
 // actual Web Lock is authoritative. Never race work against cancellation:
 // an in-flight journal write must settle before either lock is released.
 claims.add(key)
 try{return Promise.resolve(navigator.locks.request(key,{mode:'exclusive',ifAvailable:true},async lock=>{
  if(!lock)throw Error('SOUL_ACCESS_ASSET_BUSY')
  return await work()
 })).finally(()=>claims.delete(key))}catch(error){claims.delete(key);return Promise.reject(error)}
}
