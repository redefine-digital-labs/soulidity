import { readSoulDetailState, readSoulPublicSnapshotBySoulId, readSoulPublicListing } from '@soulidity/sdk'
import { bcs } from '@mysten/sui/bcs'
import { normalizeStructTag } from '@mysten/sui/utils'
import { MAINNET_GENESIS_DIGEST } from '../../../web/lib/animacraft/mainnet-chain'
import { composeChainSoulDetail } from '../../../web/lib/soulidity/soul-detail-model'
import { createContentMutationAdapter, parseContentMutationPlan } from '../../../web/lib/soulidity/content-mutation-transaction'
import { createSoulAccessAdapter } from '../../../web/lib/soulidity/soul-access-operation'
import { parseSoulAccessPlan } from '../../../web/lib/soulidity/soul-access-plan'
import { appendWireReviver } from './content-append-browser-runtime'

/** Original hooks/runner/store and raw readers; transport replays one exact test
 * transaction. It cannot sign user bytes or broadcast to any network. */
export async function createMutationUiRuntime(input?: any) {
  const data = input ?? JSON.parse(await (await fetch(`./mutation-${new URLSearchParams(location.search).get('mutation-success')}.json`)).text(), appendWireReviver)
  const rows = new Map<string, any>(data.rows), tables = new Map<string, any[]>(data.tables), historical = new Map<string, any>(data.historical)
  const plan = data.signed.plan, stats = { broadcasts: 0, confirmations: 0 }, account = { address: plan.author }
  let landed = false
  const client: any = { core: { getChainIdentifier: async () => ({ chainIdentifier: MAINNET_GENESIS_DIGEST }),
    getProtocolConfig: async()=>({protocolConfig:{attributes:data.attributes}}) },
    ledgerService: {
      getEpoch: async () => ({response:{epoch:{epoch:9n}}}),
      getObject: async ({objectId, version}: any) => ({ response: { object: structuredClone(version === undefined ? rows.get(objectId) : historical.get(data.access ? `${objectId}:${version}` : objectId)) } }),
      batchGetObjects: async ({requests}: any) => ({ response: { objects: requests.map(({objectId}: any) => ({result: rows.has(objectId)
        ? {oneofKind:'object',object:structuredClone(rows.get(objectId))} : {oneofKind:'error',error:{code:5}}})) } }),
      getTransaction: async ({digest}: any) => { if (!landed || digest !== data.signed.packet.digest) throw Object.assign(Error('Not found'), {code:'NOT_FOUND'}); return structuredClone(data.ledger) },
    }, transactionExecutionService: {simulateTransaction:async(input:any)=>({response:{transaction:{
      transaction:{bcs:{value:new Uint8Array(input.transaction.bcs.value)}},effects:{status:{success:true}}}}})},
    stateService: {
      listOwnedObjects: async ({owner,objectType}:any) => ({response:{objects:[...rows.values()].filter(row=>row.owner?.kind===1 && row.owner.address===owner && row.objectType===normalizeStructTag(objectType)).map(row=>({objectId:row.objectId}))}}),
      listDynamicFields: async ({parent}: any) => ({ response: { dynamicFields: structuredClone(tables.get(parent) ?? []) } }) } }
  client.grpc = client
  const config = { target: { soulidityOriginalPackageId: plan.deployment.originalPackageId, soulidityCallablePackageId: plan.deployment.callablePackageId }, kindRegistryId: plan.deployment.kindRegistryId }
  async function read(params: any = {}) {
    return { snapshot: await readSoulDetailState({ client, deployment: {...data.deployment, kindRegistryId: plan.deployment.kindRegistryId},
      stateId: plan.stateId, expectedState: {version:String(rows.get(plan.stateId).version),digest:rows.get(plan.stateId).digest},
      viewerAddresses: [plan.author], ...((params.kind ?? plan.kind) == null ? {} : {kindIds:[params.kind ?? plan.kind]}) }), soulId:plan.soulId,stateId:plan.stateId,contentId:plan.contentId,
      originalPackageId:plan.deployment.originalPackageId,callablePackageId:plan.deployment.callablePackageId,kindRegistryId:plan.deployment.kindRegistryId }
  }
  async function detail() {
    const asset = await readSoulPublicSnapshotBySoulId({client, deployment:data.deployment, soulId:plan.soulId})
    const state = (await read()).snapshot
    const listing = await readSoulPublicListing({client,deployment:data.listingDeployment,stateId:plan.stateId,listingId:null,
      expectedState:{version:asset.stateVersion,digest:asset.stateDigest}})
    return composeChainSoulDetail({originalPackageId:plan.deployment.originalPackageId,asset,state,listing,currentKioskCapId:null,viewerAddress:plan.author})
  }
  function adapter(params: any) {
    const canonical = (value: any): any => value && typeof value === 'object'
      ? Array.isArray(value) ? value.map(canonical) : Object.fromEntries(Object.keys(value).sort().map(key => [key,canonical(value[key])])) : value
    const evidence = (data.access ? createSoulAccessAdapter : createContentMutationAdapter)({client,getAddress:()=>plan.author,sign:async()=>{throw Error('No live wallet')},preflight:params.preflight})
    const parse = data.access ? parseSoulAccessPlan : parseContentMutationPlan
    return { ...evidence, prepare: async (requested: any) => {
      if (JSON.stringify(canonical(parse(requested))) !== JSON.stringify(canonical(parse(plan)))) throw Error('Unsupported fixture intent')
      return structuredClone(data.prepared)
    }, sign: async (record: any) => { if(record.packet.bytes !== data.signed.packet.bytes) throw Error('Changed fixture bytes'); return {bytes:record.packet.bytes,signature:data.signed.packet.signature} },
    broadcast: async (record: any) => {
      await evidence.verifySignature(record)
      if(record.packet.bytes !== data.signed.packet.bytes) throw Error('Changed fixture bytes')
      for (const [id,row] of historical) if(!data.access || row.version === 12n) rows.set(data.access ? row.objectId : id,structuredClone(row))
      const effects = bcs.TransactionEffects.parse(data.ledger.response.transaction.effects.bcs.value)
      const removed = new Set(effects.V2!.changedObjects.filter(([,change])=>change.outputState.$kind==='NotExist').map(([id])=>id))
      for(const id of removed) rows.delete(id)
      for(const [parent,fields] of tables) tables.set(parent,fields.filter(f=>!removed.has(f.fieldId)))
      if(data.access) for(const row of rows.values()) {
        if(row.version!==12n || row.owner?.kind!==2 || !row.objectType.includes('::dynamic_field::Field<')) continue
        const parts=row.objectType.split('::dynamic_field::Field<')[1].slice(0,-1), comma=parts.indexOf(',')
        const keyType=parts.slice(0,comma), valueType=parts.slice(comma+1)
        if(!['address','u32'].includes(keyType) && !keyType.endsWith('::object::ID'))throw Error('Unsupported access fixture field')
        const fields=tables.get(row.owner.address)??[]
        if(!fields.some(f=>f.fieldId===row.objectId))fields.push({fieldId:row.objectId,kind:1,name:{name:keyType,value:row.contents.value.slice(32,keyType==='u32'?36:64)},valueType})
        tables.set(row.owner.address,fields)
      }
      landed=true; stats.broadcasts++
    }, query: async(record:any)=> { const result=await evidence.query(record); if(result.status==='SUCCEEDED')stats.confirmations++; return result } }
  }
  return {client,account,config,read,detail,adapter,stats,plan,sealConfig:null}
}
