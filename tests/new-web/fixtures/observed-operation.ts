/** Observe rejection immediately, and fail a deferred-gate test with the
 * original early error instead of leaking rejection or waiting for a timeout. */
export function observeOperation<T>(pending:Promise<T>){
 const settled=pending.then(value=>({ok:true as const,value}),error=>({ok:false as const,error}))
 return{settled,async waitForGate(gate:Promise<unknown>){
  const first=await Promise.race([gate.then(()=>({kind:'gate' as const})),settled.then(result=>({kind:'settled' as const,result}))])
  if(first.kind==='settled'){if(!first.result.ok)throw first.result.error;throw Error('OPERATION_SETTLED_BEFORE_REQUIRED_GATE')}
 },async result(){const result=await settled;if(!result.ok)throw result.error;return result.value}}
}
