import { it,expect } from 'vitest'
import { MAINNET_GENESIS_DIGEST } from '../../web/lib/animacraft/mainnet-chain'
import { makerProductIncomeControllerFixture } from './fixtures/maker-product-income'
import { incomeEntryFixture } from './fixtures/income-entry'
import { makerProductIncomeBrowser } from './fixtures/maker-product-income-browser'
import { incomeEntryBrowser } from './fixtures/income-entry-browser'
const cleanup={chromeExited:true,serverClosed:true,profileDeleted:true}
async function click(b:any,text:string){await b.run(({text}:any)=>{const button=[...document.querySelectorAll('button')].find(x=>x.textContent===text);if(!button||button.disabled)throw Error('MISSING_ENABLED_BUTTON '+text);button.click()},{text})}
async function until(b:any,expression:string){for(let i=0;i<500;i++){if(await b.expression(expression))return;await new Promise(resolve=>setTimeout(resolve,25))}throw Error('BROWSER_CONDITION '+expression+' '+await b.run(()=>document.body.textContent))}
for(const domain of ['Product','Foundation'] as const){
 it(`${domain}: current actual route preserves finalized unqualified original and freshly downloads raw execution across cold reload and wallet change`,async()=>{
  const x:any=domain==='Product'?await makerProductIncomeControllerFixture():await incomeEntryFixture()
  const b:any=domain==='Product'?await makerProductIncomeBrowser(x,{missingModels:true}):await incomeEntryBrowser(x,{missingModels:true})
  try{
   await until(b,'Boolean(globalThis.__walletConnected)')
   const saved=await b.seed(),raw=await b.run(({key}:any)=>localStorage.getItem(key),{key:saved.key})
   await b.run(({path}:any)=>{const link=document.querySelector(`a[href="${path}"]`)as HTMLAnchorElement;if(!link)throw Error('MISSING_RECOVERY_ROUTE');link.click()},{path:domain==='Product'?'/income/maker/recovery':'/income/recovery'})
   await b.wait(domain==='Product'?'载入时本机阶段：PREPARED':'本机保存阶段：PREPARED')
   expect(await b.download()).toBe(saved.text)
   await b.run(()=>{(globalThis as any).__incomeMode='confirmed'})
   const start=b.requests.length
   await click(b,domain==='Product'?'查询 Product 原提款':'查询原提款与协议余额');await b.wait('原交易已终局执行成功')
   expect(await b.run(()=>document.body.textContent!.includes('提款到账证据尚未确认'))).toBe(true)
   expect(await b.run(()=>document.body.textContent!.includes('已支付金额（最小单位）'))).toBe(false)
   const facts=JSON.parse(await b.downloadExecutionFacts()),original=JSON.parse(saved.text)
   expect(facts).toMatchObject({schema:'soulidity.income-original-execution-observation.v1',status:'FINALIZED_EXECUTION',qualification:{reason:'EXECUTION_MODEL_NOT_INSTALLED'},completeBusinessOutputVerified:false})
   expect(facts.original.transactionBytes).toBe(original.packet.bytes);expect(facts.original.transactionDigest).toBe(saved.digest)
   expect(facts.original.eventsBytes).toBe(Buffer.from(x.f.ledger.events.bcs.value).toString('base64'))
   expect(facts.original.effectsBytes).toBe(Buffer.from(x.f.ledger.effects.bcs.value).toString('base64'))
   expect(facts.original.genesisDigest).toBe(MAINNET_GENESIS_DIGEST);expect(facts.original.checkpoint).toBe(String(x.f.ledger.checkpoint));expect(facts.original.epoch).toBe(String(x.f.effectsData.V2.executedEpoch))
   expect(facts.original.executionStatus).toBe('SUCCESS');expect(facts.original.decodedEvents.status).toBe('DECODED_UNQUALIFIED')
   const queried=b.requests.slice(start);expect(queried.filter((r:any)=>r.method==='getTransaction').map((r:any)=>r.digest)).toEqual([saved.digest]);expect(queried.some((r:any)=>['simulateTransaction','getEpoch'].includes(r.method))).toBe(false)
   expect(await b.run(({key}:any)=>localStorage.getItem(key),{key:saved.key})).toBe(raw)
   await b.reload(b.primary,domain==='Product'?'恢复 Maker／Pack Product 原提款':'恢复原提款查询')
   expect(await b.download()).toBe(saved.text);await b.run(()=>{(globalThis as any).__incomeMode='confirmed'})
   await click(b,domain==='Product'?'查询 Product 原提款':'查询原提款与协议余额');await b.wait('原交易已终局执行成功')
   expect(JSON.parse(await b.downloadExecutionFacts()).original.transactionBytes).toBe(original.packet.bytes)
   await b.run(()=>{(globalThis as any).__changeReviewWallet('0x'+'9'.repeat(64))})
   await until(b,'!document.querySelector(\'[aria-label="原交易执行事实"]\')')
   expect(await b.download()).toBe(saved.text);expect(await b.run(({key}:any)=>localStorage.getItem(key),{key:saved.key})).toBe(raw)
   expect(await b.run(()=>(globalThis as any).__walletSigns)).toBe(0)
  }finally{expect(await b.close()).toEqual(cleanup)}
 },180000)
 it(`${domain}: current actual recovery confirms the qualified original only through full ledger receipt and leaves the saved head unchanged`,async()=>{
  const x:any=domain==='Product'?await makerProductIncomeControllerFixture():await incomeEntryFixture()
  const b:any=domain==='Product'?await makerProductIncomeBrowser(x):await incomeEntryBrowser(x)
  try{
   await until(b,'Boolean(globalThis.__walletConnected)')
   const saved=await b.seed(),raw=await b.run(({key}:any)=>localStorage.getItem(key),{key:saved.key})
   await b.run(({path}:any)=>{const link=document.querySelector(`a[href="${path}"]`)as HTMLAnchorElement;if(!link)throw Error('MISSING_RECOVERY_ROUTE');link.click()},{path:domain==='Product'?'/income/maker/recovery':'/income/recovery'})
   await b.wait(domain==='Product'?'载入时本机阶段：PREPARED':'本机保存阶段：PREPARED');await b.run(()=>{(globalThis as any).__incomeMode='confirmed'})
   const start=b.requests.length;await click(b,domain==='Product'?'查询 Product 原提款':'查询原提款与协议余额')
   await b.wait(domain==='Product'?'原交易核对状态：WITHDRAWAL_EVIDENCE_CONFIRMED':'原提款的账本变化、收款 Coin 和 Gas 已核验')
   const reads=b.requests.slice(start);expect(reads.filter((r:any)=>r.method==='getTransaction').map((r:any)=>r.digest)).toEqual([saved.digest]);expect(reads.some((r:any)=>r.method==='getEpoch')).toBe(true);expect(reads.some((r:any)=>r.method==='simulateTransaction')).toBe(false)
   expect(await b.run(()=>Boolean(document.querySelector('[aria-label="原交易执行事实"]')))).toBe(false)
   if(domain==='Product'){
    const payout=await b.run(()=>document.querySelector('[aria-label="原 Product 提款资金证据"]')?.textContent)
    expect(payout).toContain(x.payoutId);expect(payout).toContain('实收金额（最小单位）：50')
    expect(payout).toContain('原交易后账本余额：100')
    await click(b,'读取当前 Product 账本');await b.wait('当前账本余额（最小单位）')
    expect(await b.run(()=>Boolean(document.querySelector('[aria-label="已读取当前 Product 账本"]')))).toBe(true)
   }
   expect(await b.run(({key}:any)=>localStorage.getItem(key),{key:saved.key})).toBe(raw);expect(await b.download()).toBe(saved.text)
   expect(await b.run(()=>(globalThis as any).__walletSigns)).toBe(0)
  }finally{expect(await b.close()).toEqual(cleanup)}
 },180000)
}
