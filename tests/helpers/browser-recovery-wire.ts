// Transport-only reversible codec, not an effects/proof constructor.
export function browserRecoveryWire(v:any):any{
 if(typeof v==='bigint')return{$browserWire:'bigint',value:String(v)}
 if(v instanceof Uint8Array)return{$browserWire:'bytes',value:Buffer.from(v).toString('base64')}
 if(v===undefined)return{$browserWire:'undefined'}
 if(Array.isArray(v))return v.map(browserRecoveryWire)
 if(v&&typeof v==='object')return Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b)).map(([k,x])=>[k,browserRecoveryWire(x)]))
 return v
}
export function browserRecoveryUnwire(v:any):any{
 if(v?.$browserWire==='bigint')return BigInt(v.value)
 if(v?.$browserWire==='bytes')return Uint8Array.from(Buffer.from(v.value,'base64'))
 if(v?.$browserWire==='undefined')return undefined
 if(Array.isArray(v))return v.map(browserRecoveryUnwire)
 if(v&&typeof v==='object')return Object.fromEntries(Object.entries(v).map(([k,x])=>[k,browserRecoveryUnwire(x)]))
 return v
}
