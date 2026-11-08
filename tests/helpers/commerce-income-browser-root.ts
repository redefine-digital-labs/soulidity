import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
const hash=(bytes:string|Uint8Array)=>crypto.createHash('sha256').update(bytes).digest('hex')
/** Test-only transport integration. Normal repository tests use their own actual
 * SPA with no overlay. Current-root integration requires three explicit pins;
 * no sibling directory, BASELINE file or implicit external helper is consulted. */
export function incomeBrowserRoot({candidate,overlayRoot,tuplePath,tupleSha256}:{candidate:string;overlayRoot?:string;tuplePath?:string;tupleSha256?:string}){
 const provided=[overlayRoot,tuplePath,tupleSha256].filter(value=>value!==undefined).length
 if(provided!==0&&provided!==3)throw Error('EXPLICIT_OVERLAY_ROOT_TUPLE_AND_SHA_REQUIRED')
 if(provided===0)return{root:candidate,web:path.join(candidate,'web'),plugin:{name:'income-browser-actual-repository'},loads:[] as unknown[],overlayFiles:[] as unknown[],mode:'REPOSITORY' as const,sourceTuple:null}
 if(!overlayRoot||!tuplePath||!tupleSha256||!path.isAbsolute(overlayRoot)||!path.isAbsolute(tuplePath)||!/^[0-9a-f]{64}$/.test(tupleSha256))throw Error('INVALID_EXPLICIT_OVERLAY_PINS')
 const bytes=fs.readFileSync(tuplePath)
 if(hash(bytes)!==tupleSha256)throw Error('OVERLAY_TUPLE_SHA_CHANGED')
 const tuple=JSON.parse(bytes.toString('utf8')),root=overlayRoot,web=path.join(root,'web')
 const map=new Map<string,{physical:string;code:string;sha256:string;owner:string}>(),loads:unknown[]=[]
 for(const row of tuple.production){
  if(typeof row.relative!=='string'||!row.relative.startsWith('web/')||row.relative.split('/').includes('..'))throw Error('OVERLAY_MUST_BE_FINITE_WEB_PATH')
  const physical=path.join(candidate,row.relative),logical=path.join(root,row.relative),bytes=fs.readFileSync(physical)
  if(hash(bytes)!==row.afterCandidateSha256)throw Error('OVERLAY_BYTES_CHANGED '+row.relative)
  const current=fs.existsSync(logical)?hash(fs.readFileSync(logical)):null
  if(current!==row.canonicalObservedSha256)throw Error('CANONICAL_BASE_CHANGED '+row.relative)
  if(map.has(logical))throw Error('DUPLICATE_OVERLAY_PATH')
  map.set(logical,{physical,code:bytes.toString('utf8'),sha256:row.afterCandidateSha256,owner:row.owner})
 }
 const plugin={name:'commerce-exact-current-root-overlay',enforce:'pre',
  resolveId(source:string,importer?:string){
   const question=source.indexOf('?'),clean=question<0?source:source.slice(0,question),query=question<0?'':source.slice(question)
   let absolute
   if(clean.startsWith('/@fs/'))absolute=clean.slice(4)
   else if(clean.startsWith(web+path.sep))absolute=clean
   else if(clean.startsWith('@/'))absolute=path.join(web,clean.slice(2))
   else if(clean.startsWith('@lib/'))absolute=path.join(web,'lib',clean.slice(5))
   else if(clean.startsWith('@web/'))absolute=path.join(web,clean.slice(5))
   else if(clean.startsWith('.')&&importer&&!importer.startsWith('\0'))absolute=path.resolve(path.dirname(importer.split('?')[0]),clean)
   else if(/^\/(lib|components|app|spa)\//.test(clean))absolute=path.join(web,clean.slice(1))
   if(!absolute)return
   for(const file of [absolute,...['.ts','.tsx','.mts','.js','.mjs','/index.ts','/index.tsx'].map(ext=>absolute+ext)])if(map.has(file))return file+query
  },
  load(id:string){const key=id.split('?')[0],row=map.get(key);if(row){loads.push({logical:key,physical:row.physical,sha256:row.sha256,owner:row.owner});return row.code}}
 }
 return{root,web,plugin,loads,mode:'CURRENT_ROOT_FINITE_OVERLAY' as const,sourceTuple:{path:tuplePath,sha256:tupleSha256},overlayFiles:[...map].map(([logical,row])=>({logical,physical:row.physical,sha256:row.sha256,owner:row.owner}))}
}
