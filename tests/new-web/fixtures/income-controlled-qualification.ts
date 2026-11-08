import { bcs } from '@mysten/sui/bcs'
import { toHex } from '@mysten/sui/utils'
import { sha256 } from '@noble/hashes/sha2.js'
import { vi,expect } from 'vitest'
import { MAINNET_GENESIS_DIGEST } from '../../../web/lib/animacraft/mainnet-chain'
import { publicMutationCanonical } from '../../../web/lib/sui/public-mutation-journal'
import { historicalExecutionModelDocumentHashV1, HISTORICAL_EXECUTION_MODEL_ASSUMPTIONS_V1 } from '../../../web/lib/sui/historical-execution-frame-v1'
import { incomeSourceManifestHash } from '../../../web/lib/soulidity/commerce/income-source-qualification'
import { createIncomeExecutionRegistryV1 } from '../../../web/lib/soulidity/commerce/income-execution-source-v1'
import type { EconomicsTarget } from '../../../web/lib/soulidity/commerce/economics-read'

/** Test-owned synthetic acceptance only. No compiled production catalog entry,
 * genuine source audit, Move verifier/VM execution, BLS or mainnet authority. */
export function controlledIncomeExecutionModel(model: 'STORAGE_TOP_LEVEL_MOVE_CALL' | 'RUNTIME_TOP_LEVEL_MOVE_CALL' = 'STORAGE_TOP_LEVEL_MOVE_CALL') {
 const manifestText=publicMutationCanonical({schema:'soulidity.historical-event-execution-model.v1',genesisDigest:MAINNET_GENESIS_DIGEST,
  checkpointRange:{first:'0',last:'100000000'},protocolVersionRange:{first:'99',last:'99'},model,
  relocateEventModule:{presence:'EXPLICIT',value:model==='STORAGE_TOP_LEVEL_MOVE_CALL'},
  executionSource:{revision:'a'.repeat(40),artifacts:[{path:'controlled/execution.rs',sha256:'b'.repeat(64)}]}})
 const acceptedManifestSha256=historicalExecutionModelDocumentHashV1(manifestText)
 const auditDocumentText=publicMutationCanonical({schema:'soulidity.historical-event-execution-model-audit.v1',manifestSha256:acceptedManifestSha256,
  assumptions:HISTORICAL_EXECUTION_MODEL_ASSUMPTIONS_V1,evidence:Object.fromEntries(HISTORICAL_EXECUTION_MODEL_ASSUMPTIONS_V1.map(key=>[key,'c'.repeat(64)]))})
 return{manifestText,acceptedManifestSha256,auditDocumentText,acceptedAuditDocumentSha256:historicalExecutionModelDocumentHashV1(auditDocumentText)}
}
/** Build the controlled profile from already-created fixture bytes. No RPC
 * is performed by fixture setup, preserving tests of zero query side effects. */
export function controlledFoundationIncomeQualification(target:EconomicsTarget,packageObject:Uint8Array){
 const pkg=bcs.Object.parse(packageObject).data.Package!
 const manifestText=publicMutationCanonical({schema:'soulidity.foundation-income-source.v1',genesisDigest:MAINNET_GENESIS_DIGEST,target,configSchema:3,
  configInitialSharedVersion:'1',packageVersion:pkg.version,
  moduleHashes:[...pkg.moduleMap].map(([name,bytes])=>({name,sha256:toHex(sha256(bytes)),byteLength:String(bytes.length)})).sort((a,b)=>a.name<b.name?-1:1),
  typeOrigins:pkg.typeOriginTable.map(row=>({name:`${row.moduleName}::${row.datatypeName}`,packageId:row.package})).sort((a,b)=>a.name<b.name?-1:1),
  linkage:[...pkg.linkageTable].map(([originalPackageId,row])=>({originalPackageId,...row})).sort((a,b)=>a.originalPackageId<b.originalPackageId?-1:1),
  source:{commitSha:'a'.repeat(40),treeSha256:'b'.repeat(64),buildSha256:'c'.repeat(64),dependencyLockSha256:'d'.repeat(64),sourceAuditSha256:'e'.repeat(64)}})
 const installation={manifestText,acceptedManifestSha256:incomeSourceManifestHash(manifestText),acceptedSourceAuditSha256:'e'.repeat(64)}
 const executionModels=[controlledIncomeExecutionModel()]
 return{installation,executionModels,executionRegistry:createIncomeExecutionRegistryV1({models:executionModels,foundationSources:[installation]})}
}
export function attachControlledIncomeProtocol(f:{checkpoint:any},client:any){
 f.checkpoint.signature={epoch:5n,signature:new Uint8Array(48).fill(1),bitmap:new Uint8Array([1])}
 client.ledgerService.getServiceInfo=vi.fn(async()=>({response:{chainId:MAINNET_GENESIS_DIGEST,epoch:5n,checkpointHeight:100n}}))
 client.ledgerService.getEpoch=vi.fn(async(request:any)=>{
  if(request.epoch!==undefined){expect(request.epoch).toBe(5n);expect(request.readMask.paths).toEqual(['epoch','protocol_config'])}
  else expect(request.readMask.paths).toEqual(expect.arrayContaining(['epoch','reference_gas_price']))
  return{response:{epoch:{epoch:5n,referenceGasPrice:1n,protocolConfig:{protocolVersion:99n,featureFlags:{relocate_event_module:true}}}}}
 })
}
