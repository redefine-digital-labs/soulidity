import { afterEach, expect, it, vi } from 'vitest'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { soulAccessTransactionFixture } from './fixtures/soul-access-transaction'
import { soulAccessRawFixture } from './fixtures/soul-access-raw'
import { readSoulAccessState, prepareSoulAccessPlan } from '../../web/lib/soulidity/soul-access-state'
import { SoulPublicKioskBcs, SoulDetailStateBcs as D } from '@soulidity/sdk'
import { normalizeStructTag, toBase58, fromBase64, toBase64 } from '@mysten/sui/utils'
import { EncryptedObject } from '../../web/node_modules/@mysten/seal/dist/index.mjs'
import { EnvelopeConfigField } from './fixtures/content-envelope'
import { appendWireReplacer } from './fixtures/content-append-browser-runtime'
import { createMutationUiRuntime } from './fixtures/content-mutation-ui-runtime'
import { bcs } from '@mysten/sui/bcs'
afterEach(()=>vi.restoreAllMocks())
it.each(['grant-issue','grant-revoke-scope','grant-revoke','paid-configure','paid-update','paid-delete','paid-purchase','paid-renewal'] as const)('exports original %s with raw authorization readback', async scenario=>{
  const action=scenario==='paid-renewal'?'paid-purchase':scenario, purchase=action==='paid-purchase'
  const r=soulAccessRawFixture()
  r.market.legacy_config_id='0x'+'0'.repeat(64)
  const f=await soulAccessTransactionFixture({action,...(purchase?{entry:scenario==='paid-purchase'?'absent' as const:undefined,paymentBalances:['20000']}: {})},async f=>{
    r.raw.state.current_owner=f.state.current_owner; r.raw.putState()
    r.raw.grant.issued_by=f.state.current_owner; r.raw.putGrant()
    if(purchase) {
      Object.assign(r.raw.paidConfig,f.config);r.raw.putPaidConfig()
      if(f.entry) {
        // Keep the two unrelated buyers and give the visitor its own table.
        f.table!.id='0x'+(8063).toString(16).padStart(64,'0')
        const pkg=r.raw.deployment.originalPackageId
        r.raw.field(r.raw.paid.entries.id,'address',bcs.Address,f.author,`0x2::table::Table<u32,${pkg}::paid_access::KindPaidEntry>`,D.Table,f.table)
        r.raw.field(f.table!.id,'u32',bcs.u32(),3,`${pkg}::paid_access::KindPaidEntry`,D.PaidEntry,f.entry)
        r.raw.paid.entries.size='3';r.raw.putPaid()
      }
    }
    if(action==='paid-configure') {
      for(const field of r.raw.tables.get(r.raw.paid.kind_configs.id)??[])r.raw.rows.delete(field.fieldId)
      r.raw.tables.set(r.raw.paid.kind_configs.id,[]);r.raw.paid.kind_configs.size='0';r.raw.putPaid()
    } else if(f.config)Object.assign(f.config,r.raw.paidConfig)
    Object.assign(f.state,structuredClone(r.raw.state)); Object.assign(f.paid,structuredClone(r.raw.paid))
    Object.assign(f.market,r.market)
    if(action==='grant-issue')Object.assign(f.request,{scopeMask:5,expiresAtMs:null})
    f.observed=await readSoulAccessState({...r.params,author:f.author,...(action.startsWith('grant-')?{granteeAddress:f.grantee}:{kind:3})})
  })
  const {rows,tables}=r.domain(), deployment={originalPackageId:f.deployment.originalPackageId,chainIdentifier:f.deployment.chainIdentifier}
  const row=rows.get(r.raw.envelopeFieldId)!, field=EnvelopeConfigField.parse(row.contents.value)
  const envelope=JSON.parse(new TextDecoder().decode(new Uint8Array(field.value)))
  const encrypted=EncryptedObject.parse(fromBase64(envelope.sidecar.encryptedDek)); encrypted.packageId=deployment.originalPackageId
  envelope.sidecar.sealPackageId=deployment.originalPackageId; envelope.sidecar.encryptedDek=toBase64(EncryptedObject.serialize(encrypted).toBytes())
  field.value=[...new TextEncoder().encode(JSON.stringify(envelope))]; row.contents.value=EnvelopeConfigField.serialize(field).toBytes()
  rows.set(f.state.current_kiosk_id,{objectId:f.state.current_kiosk_id,objectType:normalizeStructTag('0x2::kiosk::Kiosk'),version:1n,
    digest:toBase58(new Uint8Array(32).fill(1)),owner:{kind:3,version:1n},contents:{value:SoulPublicKioskBcs.serialize({
      id:f.state.current_kiosk_id,profits:'0',owner:f.state.current_owner,item_count:1,allow_extensions:false}).toBytes()}})
  if(purchase)for(const row of f.rows.values())if(row.version===11n && row.owner?.kind===1 && row.owner.address===f.author && row.objectType.includes('::coin::Coin<'))rows.set(row.objectId,structuredClone(row))
  const data={access:true,rows:[...rows],tables:[...tables],historical:[...f.rows],prepared:await f.adapter.prepare(f.plan),signed:f.record,
    ledger:await f.client.ledgerService.getTransaction(),attributes:(await f.client.core.getProtocolConfig()).protocolConfig.attributes,
    deployment,listingDeployment:{...deployment,marketConfigId:f.deployment.marketConfigId,paymentCoinType:f.deployment.paymentCoinType},request:f.request}
  const runtime=await createMutationUiRuntime(data)
  const before=await runtime.detail()
  const actual=await prepareSoulAccessPlan({client:runtime.client,...f.deployment,deployment:f.deployment,soulId:f.plan.soulId,
    stateId:f.plan.stateId,contentId:f.plan.contentId,paidAccessListId:f.plan.paidAccessListId,author:f.author,request:purchase?{...f.request,paymentCoins:undefined}:f.request})
  expect(actual).toEqual(f.plan)
  const adapter=runtime.adapter({preflight:async()=>{}})
  await adapter.prepare(actual); await adapter.broadcast(f.record)
  expect((await adapter.query(f.record)).status).toBe('SUCCEEDED')
  const after=await runtime.detail()
  if(action.startsWith('grant-')) {
    expect(before.activeGrants.find(g=>g.granteeAddress===f.grantee)?.scopeMask).toBe(9)
    if(action==='grant-revoke')expect(after.activeGrants.find(g=>g.granteeAddress===f.grantee)).toBeUndefined()
    else expect(after.activeGrants.find(g=>g.granteeAddress===f.grantee)?.scopeMask).toBe(action==='grant-issue'?13:8)
  } else if(purchase) {
    expect(after.paidAccessEntries.find(e=>e.buyerAddress===f.author)).toMatchObject({expiresAtMs:scenario==='paid-purchase'?'4100':'5000',currentEpoch:true})
    expect(after.paidAccessEntries).toHaveLength(before.paidAccessEntries.length+(scenario==='paid-purchase'?1:0))
  } else if(action==='paid-delete') expect(after.paidAccessKindConfigs).toHaveLength(0)
  else expect(after.paidAccessKindConfigs[0]).toMatchObject({priceAtomic:'777',durationMs:'5000'})
  if(process.env.S3_CONTENT_BROWSER_DIR)await writeFile(path.join(process.env.S3_CONTENT_BROWSER_DIR,`mutation-${scenario}.json`),JSON.stringify(data,appendWireReplacer))
})
