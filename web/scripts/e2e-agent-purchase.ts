/**
 * E2E Test: Agent Purchase via Soulidity two-step deferred signing
 *
 * 1. POST /api/agent/souls/{id}/purchase → unsigned txBytes + preparedPurchaseId
 * 2. Sign txBytes locally with agent Ed25519 keypair
 * 3. POST /api/agent/souls/{id}/purchase/execute → submit signature
 * 4. GET /api/agent/souls/{id}/access → verify owner access
 *
 * The server handles quoting, coin selection, and TX building.
 * The agent only signs and submits.
 *
 * Usage:
 *   AGENT_MNEMONIC="..." AGENT_API_KEY="sk-..." SOUL_ID="..." \
 *   [BASE_URL=http://localhost:3100] \
 *   npx tsx web/scripts/e2e-agent-purchase.ts
 */

import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography'
import { normalizeSuiAddress } from '@mysten/sui/utils'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'

type PreparedPurchase = { preparedPurchaseId:string;txBytes:string;context:{
  soulOnChainId:string;agentAddress?:string;royaltySource?:string;digest?:string;phase?:string;recoveryRequired?:boolean
} }
/** Only one signing/submission attempt. Ambiguous native outcomes are checked
 * using the saved id; never prepare again or sign again to recover them. */
export async function executePreparedAgentPurchase(input:{
  prepared:PreparedPurchase;agentAddress:string;baseUrl:string;headers:Record<string,string>
  sign:(bytes:Uint8Array)=>Promise<{signature:string}>
  fetcher?:typeof fetch;sleep?:(ms:number)=>Promise<void>;maxChecks?:number
}):Promise<Record<string,unknown>>{
  const prepared=structuredClone(input.prepared)
  const native=prepared.context.royaltySource==='animacraft-maker'
  const maxChecks=input.maxChecks??10
  if(!Number.isInteger(maxChecks)||maxChecks<1||maxChecks>10)throw new Error('Invalid bounded recovery count')
  if(!prepared.preparedPurchaseId||!prepared.txBytes||!prepared.context.soulOnChainId
    ||native&&(!prepared.context.digest||!prepared.context.phase||prepared.context.agentAddress!==input.agentAddress))
    throw new Error('Invalid prepared purchase identity')
  const fetcher=input.fetcher??fetch
  const pause=input.sleep??(ms=>new Promise(r=>setTimeout(r,ms)))
  const url=`${input.baseUrl}/api/agent/souls/${encodeURIComponent(prepared.context.soulOnChainId)}/purchase/execute`
  async function request(body:Record<string,unknown>){
    const controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined
    try{return await Promise.race([(async()=>{
      const response=await fetcher(url,{method:'POST',headers:input.headers,body:JSON.stringify({preparedPurchaseId:prepared.preparedPurchaseId,...body}),signal:controller.signal})
      return {status:response.status,body:await response.json() as Record<string,unknown>}
    })(),new Promise<never>((_resolve,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new Error(`Purchase response unknown; retain prepared id ${prepared.preparedPurchaseId} and check it without signing again`))},25_000)})])}
    finally{clearTimeout(timer)}
  }
  let result
  if(native&&prepared.context.recoveryRequired)result=await request({action:'check'})
  else{
    const {signature}=await input.sign(Buffer.from(prepared.txBytes,'base64'))
    result=await request({...(native?{action:'execute'}:{}),signature})
  }
  for(let checks=0;;checks++){
    const {status,body}=result
    const identity=body.soulOnChainId===prepared.context.soulOnChainId&&body.currentOwnerAddress===input.agentAddress&&body.listingStatus==='held'
    const confirmed=native
      ?status===200&&body.phase==='SUCCEEDED'&&body.outcome==='SUCCEEDED'&&body.onChainSuccess===true
        &&body.syncStatus==='COMPLETE'&&body.dbSynced===true&&body.digest===prepared.context.digest&&identity
      :status===200&&typeof body.digest==='string'&&body.digest.length>0&&identity
        &&typeof body.currentKioskId==='string'&&body.currentKioskId.length>0
    if(confirmed)return body
    if(native&&(status===202||status===207)&&checks<maxChecks){
      if(body.digest!==prepared.context.digest)throw new Error('Recovery response differs from the saved transaction digest')
      await pause(2000);result=await request({action:'check'});continue
    }
    throw new Error(`Purchase not confirmed (${status}, ${String(body.syncStatus??body.phase??'unknown')}); retain prepared id ${prepared.preparedPurchaseId}. Do not prepare or sign a replacement.`)
  }
}

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3100'
const AGENT_MNEMONIC = process.env.AGENT_MNEMONIC
const AGENT_PRIVATE_KEY = process.env.AGENT_PRIVATE_KEY // suiprivkey1... format
const AGENT_API_KEY = process.env.AGENT_API_KEY!
const SOUL_ID = process.env.SOUL_ID!

function authHeaders() {
  return {
    'Authorization': `Bearer ${AGENT_API_KEY}`,
    'Content-Type': 'application/json',
    'x-forwarded-for': '127.0.0.1',
  }
}

async function main() {
  if ((!AGENT_MNEMONIC && !AGENT_PRIVATE_KEY) || !AGENT_API_KEY || !SOUL_ID) {
    console.error('Usage: AGENT_MNEMONIC=... (or AGENT_PRIVATE_KEY=suiprivkey1...) AGENT_API_KEY=... SOUL_ID=... npx tsx web/scripts/e2e-agent-purchase.ts')
    process.exit(1)
  }

  const keypair = AGENT_PRIVATE_KEY
    ? Ed25519Keypair.fromSecretKey(decodeSuiPrivateKey(AGENT_PRIVATE_KEY).secretKey)
    : Ed25519Keypair.deriveKeypair(AGENT_MNEMONIC!)
  const agentAddress = normalizeSuiAddress(keypair.toSuiAddress())
  console.log(`Agent address: ${agentAddress}`)
  console.log(`Target: ${BASE_URL}`)

  // Step 1: Prepare purchase TX (server builds TX, returns unsigned bytes)
  console.log('\n--- Step 1: Prepare purchase TX ---')
  const prepRes = await fetch(`${BASE_URL}/api/agent/souls/${encodeURIComponent(SOUL_ID)}/purchase`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({}),
  })

  const prepBody = await prepRes.json()
  if (!prepRes.ok) {
    console.error(`Prepare failed (${prepRes.status}):`, prepBody)
    process.exit(1)
  }

  console.log('Prepared purchase:')
  console.log(`  Soul: ${prepBody.context.soulOnChainId}`)
  console.log(`  Price: ${prepBody.context.priceAtomic} atomic`)
  console.log(`  Total: ${prepBody.context.totalAtomic} atomic`)
  console.log(`  Expires: ${prepBody.context.expiresAt}`)
  console.log(`  TX bytes: ${prepBody.txBytes.length} chars (base64)`)

  console.log('\n--- Steps 2–3: Execute or check saved purchase ---')
  const execBody=await executePreparedAgentPurchase({prepared:prepBody,agentAddress,baseUrl:BASE_URL,
    headers:authHeaders(),sign:bytes=>keypair.signTransaction(bytes)})

  console.log(`\n✅ Purchase TX confirmed: ${execBody.digest}`)
  console.log(`  Owner: ${execBody.currentOwnerAddress}`)
  // Native success promises current held proof, not a kiosk-id response field.
  if(typeof execBody.currentKioskId==='string')console.log(`  Kiosk: ${execBody.currentKioskId}`)
  console.log(`  Status: ${execBody.listingStatus}`)

  // Step 4: Verify access
  console.log('\n--- Step 4: Verify access ---')
  for (let attempt = 1; attempt <= 10; attempt++) {
    await new Promise(r => setTimeout(r, 2000))
    const accessRes = await fetch(`${BASE_URL}/api/agent/souls/${encodeURIComponent(SOUL_ID)}/access`, {
      headers: {
        'Authorization': `Bearer ${AGENT_API_KEY}`,
        'x-forwarded-for': '127.0.0.1',
      },
    })

    if (accessRes.ok) {
      const accessBody = await accessRes.json()
      console.log(`\n✅ Agent access verified (attempt ${attempt})`)
      console.log(`  Access kind: ${accessBody.accessKind}`)
      console.log(`  Policy: ${accessBody.accessPolicy?.functionName}`)
      console.log(`  Blob URL: ${accessBody.artifact?.walrusBlobUrl}`)
      return
    }

    const errBody = await accessRes.json().catch(() => ({}))
    console.log(`  Attempt ${attempt}: ${accessRes.status} — ${errBody.error || 'waiting...'}`)
  }

  console.log('\n⚠️ Access not available after 10 attempts.')
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main().catch((err) => {
  console.error('Fatal:', err)
  process.exit(1)
})
