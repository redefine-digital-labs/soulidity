// @vitest-environment jsdom
import React,{act,Suspense} from 'react'
import {createRoot,type Root} from 'react-dom/client'
import {beforeEach,afterEach,expect,it,vi} from 'vitest'
import Page from '../../web/app/souls/[id]/purchase/recovery/page'
import BuyPage from '../../web/app/souls/[id]/buy/native/page'
import { nativeSaleLifecycleWireFixture } from './fixtures/commerce-native-sale-lifecycle-wire'
import { browserNativeSaleCheckoutJournal, nativeSaleCheckoutKey } from '../../web/lib/soulidity/native-sale-checkout-journal'
import {purchaseRecoveryFixture} from './fixtures/commerce-purchase-recovery-original'
import {aid,adigest} from './fixtures/activity-transaction-evidence'
import {normalizeStructTag} from '@mysten/sui/utils'
import {serviceRecoveryCase} from './fixtures/commerce-paid-content-receipt'
const m=vi.hoisted(()=>({id:'',address:null as string|null,factory:vi.fn(),readCurrent:vi.fn(),openContent:vi.fn(),
 walletClient:{ledgerService:{}} as any,walletConnection:{},sign:vi.fn(),sealConfig:{} as any,incomeRegistry:vi.fn()}))
vi.mock('../../web/lib/hooks/use-wallet-sign',()=>({useWalletSign:()=>({
 suiWallet:m.address?{address:m.address}:null,walletAccount:m.address,currentWallet:m.walletConnection,
 suiGrpcClient:m.walletClient,getWalletAddress:()=>m.address,signPersonalMessage:m.sign,
})}))
vi.mock('../../web/lib/sui/package-object-client',async importOriginal=>{
 const actual=await importOriginal<typeof import('../../web/lib/sui/package-object-client')>()
 return {...actual,withPackageObjectIdentity:(client:Parameters<typeof actual.withPackageObjectIdentity>[0],signal?:AbortSignal)=>
  client===m.walletClient&&client.ledgerService.getCheckpoint?client:actual.withPackageObjectIdentity(client,signal)}
})
vi.mock('../../web/lib/soulidity/canonical-native-workbench',async importOriginal=>({
 ...await importOriginal<typeof import('../../web/lib/soulidity/canonical-native-workbench')>(),
 readCanonicalNativeWorkbench:m.readCurrent,
}))
vi.mock('../../web/lib/soulidity/canonical-native-content-open',()=>({openCanonicalNativeContent:m.openContent}))
vi.mock('../../web/lib/soulidity/browser-content-open',async importOriginal=>({
 ...await importOriginal<typeof import('../../web/lib/soulidity/browser-content-open')>(),
 getBrowserContentSealConfig:()=>m.sealConfig,
}))
// Replace only the transport factory; parser, page, consumer and all proofs run.
vi.mock('../../web/components/commerce/purchase-recovery-import',async importOriginal=>{
 const actual=await importOriginal<typeof import('../../web/components/commerce/purchase-recovery-import')>()
 return {...actual,PurchaseRecoveryImport:(props:any)=><actual.PurchaseRecoveryImport {...props} createReadOnlyClient={m.factory}/>}
})
vi.mock('../../web/lib/animacraft/native-receive',async importOriginal=>({
 ...await importOriginal<typeof import('../../web/lib/animacraft/native-receive')>(),
 createNativeReceiveClient:(signal:AbortSignal)=>m.factory(signal),
}))
vi.mock('../../web/lib/soulidity/configured-income-entry',async importOriginal=>{
 const actual=await importOriginal<typeof import('../../web/lib/soulidity/configured-income-entry')>()
 return {...actual,createConfiguredIncomeOriginalExecutionRegistry:()=>m.incomeRegistry()??actual.createConfiguredIncomeOriginalExecutionRegistry()}
})
vi.mock('../../web/lib/soulidity/native-public-read-paid-original-client-v2',()=>({
 createNativePublicReadPaidOriginalClientV2:(signal:AbortSignal)=>m.factory(signal),
}))
let host:HTMLDivElement,root:Root
const routeParams=new Map<string,Promise<{id:string}>>()
beforeEach(()=>{localStorage.clear();routeParams.clear();vi.stubGlobal('React',React);vi.stubEnv('NEXT_PUBLIC_SOULIDITY_NATIVE_WORKBENCH_TARGET_JSON',undefined);vi.stubEnv('NEXT_PUBLIC_SOULIDITY_NATIVE_PUBLIC_READ_V2_TARGET_JSON',undefined);m.address=null;m.walletClient={ledgerService:{}};m.sealConfig={};m.readCurrent.mockReset();m.openContent.mockReset();m.sign.mockReset();vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);vi.stubGlobal('Uint8Array',structuredClone(new Uint8Array()).constructor);m.factory.mockReset();m.incomeRegistry.mockReset();host=document.createElement('div');document.body.append(host);root=createRoot(host)})
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.restoreAllMocks();vi.unstubAllEnvs();vi.unstubAllGlobals()})
const render=async()=>{const params=routeParams.get(m.id)??Promise.resolve({id:m.id});routeParams.set(m.id,params);await act(async()=>{root.render(<Suspense fallback="Loading"><Page params={params}/></Suspense>);await new Promise(r=>setTimeout(r,20))});await act(async()=>{await new Promise(r=>setTimeout(r,10))})}
async function select(text:string){const file={name:'original.json',size:new TextEncoder().encode(text).length,text:async()=>text} as File;await act(async()=>{const input=host.querySelector('input[type=file]')!;Object.defineProperty(input,'files',{configurable:true,value:[file]});input.dispatchEvent(new Event('change',{bubbles:true}));await new Promise(r=>setTimeout(r,20))})}
async function click(label:string){await act(async()=>{const button=[...host.querySelectorAll('button')].find(b=>b.textContent===label);expect(button,host.textContent??'').toBeDefined();button!.click();await new Promise(r=>setTimeout(r,100))})}
function payload(){const a=host.querySelector('a[download]')!;expect(a).not.toBeNull();return decodeURIComponent(a.getAttribute('href')!.split(',').slice(1).join(','))}
it.each(['v1','v2'] as const)('actual anonymous route imports and queries %s original without wallet or journal',async kind=>{
 const x=await purchaseRecoveryFixture(kind);m.id=x.soulId;m.factory.mockReturnValue(x.client);await render();await select(x.text)
 expect(payload()).toBe(x.text);expect(m.factory).not.toHaveBeenCalled();expect(Boolean(host.querySelector(`a[href="/souls/${x.soulId}/read"]`))).toBe(kind==='v2');await click('查询原购买历史')
 expect(host.textContent).toContain(kind==='v1'?'原成交事件、资金变化及挂牌退出已核验':'原订阅回执、事件及资金变化已核验')
 expect(host.textContent).toContain('原协议收入（最小单位）：3');expect(payload()).toBe(x.text)
 expect(host.querySelector('[aria-label="当前交付与余额"]')?.textContent).toContain('尚未核验')
 expect(host.querySelector(`a[href="/souls/${x.soulId}"]`)).not.toBeNull()
 expect(m.factory).toHaveBeenCalledOnce()
})
it('rejects foreign Soul and invalid format on the actual route without RPC or retained download',async()=>{
 const x=await purchaseRecoveryFixture('v2');m.id=aid(999);await render();await select(x.text)
 expect(host.textContent).toContain('原购买不属于本页 Soul');expect(m.factory).not.toHaveBeenCalled();expect(host.querySelector('a[download]')).toBeNull()
 await select('{}');expect(host.textContent).toContain('原购买格式不受本入口支持')
})
it('actual route cold-remount can reimport the same original text and requery history',async()=>{
 const x=await purchaseRecoveryFixture('v2');m.id=x.soulId;m.factory.mockReturnValue(x.client);await render();await select(x.text);const saved=payload()
 await act(async()=>root.unmount());root=createRoot(host);await render();expect(host.querySelector('a[download]')).toBeNull()
 await select(saved);await click('查询原购买历史');expect(host.textContent).toContain('原订阅回执、事件及资金变化已核验');expect(payload()).toBe(saved)
})
it('stops delayed original query, preserves original and ignores old completion before another query',async()=>{
 const x=await purchaseRecoveryFixture('v1'),read=x.finality.client.ledgerService.getTransaction.getMockImplementation()!;let finish!:()=>void
 x.finality.client.ledgerService.getTransaction.mockImplementationOnce(async(...a:any[])=>{await new Promise<void>(r=>finish=r);return read(...a)})
 m.id=x.soulId;m.factory.mockReturnValue(x.client);await render();await select(x.text);await click('查询原购买历史');await click('停止本次查询')
 expect(payload()).toBe(x.text);expect(host.textContent).toContain('没有取消链上交易')
 await act(async()=>{finish();await new Promise(r=>setTimeout(r,20))});expect(host.querySelector('[aria-label="原付款历史"]')).toBeNull()
 await click('查询原购买历史');expect(host.textContent).toContain('原成交事件、资金变化及挂牌退出已核验')
})
it('route Soul change immediately clears the previous original and hides late success',async()=>{
 const x=await purchaseRecoveryFixture('v2'),read=x.finality.client.ledgerService.getTransaction.getMockImplementation()!;let finish!:()=>void
 x.finality.client.ledgerService.getTransaction.mockImplementationOnce(async(...a:any[])=>{await new Promise<void>(r=>finish=r);return read(...a)})
 m.id=x.soulId;m.factory.mockReturnValue(x.client);await render();await select(x.text);await click('查询原购买历史');m.id=aid(999);await render()
 expect(host.querySelector('a[download]')).toBeNull();await act(async()=>{finish();await new Promise(r=>setTimeout(r,20))});expect(host.querySelector('[aria-label="原付款历史"]')).toBeNull()
})
it.each(['invalid','0x0'])('invalid route Soul %s provides no import or RPC path',async id=>{m.id=id;await render();expect(host.textContent).toContain('Soul 身份无效');expect(host.querySelector('input[type=file]')).toBeNull();expect(m.factory).not.toHaveBeenCalled()})
it('invalid replacement removes prior proof and download immediately',async()=>{
 const x=await purchaseRecoveryFixture('v2');m.id=x.soulId;m.factory.mockReturnValue(x.client);await render();await select(x.text);await click('查询原购买历史');expect(host.querySelector('[aria-label="原付款历史"]')).not.toBeNull()
 await select('{}');expect(host.querySelector('a[download]')).toBeNull();expect(host.querySelector('[aria-label="原付款历史"]')).toBeNull();expect([...host.querySelectorAll('[aria-label="原购买恢复"] button')].some(b=>b.textContent==='查询原购买历史')).toBe(false)
 expect([...host.querySelectorAll('button')].some(b=>b.textContent==='重新发现本机原记录')).toBe(true)
})

it.each(['v1','v2'] as const)('actual route %s derives recipients from original proof and separately reads current funds and protocol income',async kind=>{
 const {purchaseRecoveryFundsFixture}=await import('./fixtures/commerce-purchase-recovery-funds'),x=await purchaseRecoveryFundsFixture(kind);m.id=x.soulId;m.factory.mockReturnValue(x.client);await render();await select(x.text)
 expect(host.querySelector('select')).toBeNull();await click('查询原购买历史');expect(x.client.stateService.getBalance).not.toHaveBeenCalled()
 const choose=host.querySelector('select')!;expect([...choose.options].filter(o=>o.value).map(o=>o.value)).toEqual([...new Set(x.payouts.map(p=>p.owner))])
 await act(async()=>{choose.value=x.first.owner;choose.dispatchEvent(new Event('change',{bubbles:true}))});await click('查询所选地址当前资金')
 expect(host.textContent).toContain(kind==='v1'?'原受款角色：卖方':'原受款角色：内容受款方');expect(host.querySelector('[aria-label="当前单币种余额"]')?.textContent).toContain('当前地址余额（最小单位）：7');expect(host.querySelector('[aria-label="当前 Coin 对象合计"]')).not.toBeNull();expect(host.querySelector('[aria-label="原收款 Coin 现状"]')?.textContent).toContain('当前仍由所选地址持有')
 expect(host.textContent).toContain('不是同一检查点快照');expect(payload()).toBe(x.text)
 await click('查询当前协议收入');expect(host.querySelector('[aria-label="当前协议收入"]')?.textContent).toContain('当前协议账本余额（最小单位）：3')
 expect(x.client.stateService.getBalance.mock.calls.every(([r]:any)=>r.owner===x.first.owner)).toBe(true)
})
it.each(['missing-payout','other-owner','balance-rpc','inventory-rpc','income-rpc'])('current %s cannot erase original proof or other completed observations',async variant=>{
 const {purchaseRecoveryFundsFixture}=await import('./fixtures/commerce-purchase-recovery-funds'),x=await purchaseRecoveryFundsFixture('v2',variant);m.id=x.soulId;m.factory.mockReturnValue(x.client);await render();await select(x.text);await click('查询原购买历史')
 const chooser=host.querySelector('select')!;await act(async()=>{chooser.value=x.first.owner;chooser.dispatchEvent(new Event('change',{bubbles:true}))});await click('查询所选地址当前资金')
 if(variant==='missing-payout')expect(host.textContent).toContain('当前不可查询；不代表余额为零或原付款失败')
 if(variant==='other-owner')expect(host.textContent).toContain('当前已不属于所选地址')
 if(variant==='balance-rpc'){expect(host.textContent).toContain('BALANCE_RPC_UNAVAILABLE');expect(host.querySelector('[aria-label="当前 Coin 对象合计"]')).not.toBeNull()}
 if(variant==='inventory-rpc'){expect(host.textContent).toContain('INVENTORY_RPC_UNAVAILABLE');expect(host.querySelector('[aria-label="当前单币种余额"]')).not.toBeNull()}
 await click('查询当前协议收入');if(variant==='income-rpc')expect(host.textContent).toContain('INCOME_RPC_UNAVAILABLE')
 expect(host.textContent).toContain('原订阅回执、事件及资金变化已核验');expect(payload()).toBe(x.text)
})
it('fast current observations publish before a slow address balance and survive stop while late data is ignored',async()=>{
 const {purchaseRecoveryFundsFixture}=await import('./fixtures/commerce-purchase-recovery-funds'),x=await purchaseRecoveryFundsFixture('v2'),read=x.client.stateService.getBalance.getMockImplementation()!;let finish!:()=>void
 x.client.stateService.getBalance.mockImplementationOnce(async(...a:any[])=>{await new Promise<void>(r=>finish=r);return read(...a)})
 m.id=x.soulId;m.factory.mockReturnValue(x.client);await render();await select(x.text);await click('查询原购买历史');const chooser=host.querySelector('select')!;await act(async()=>{chooser.value=x.first.owner;chooser.dispatchEvent(new Event('change',{bubbles:true}))});await click('查询所选地址当前资金')
 expect(host.querySelector('[aria-label="当前 Coin 对象合计"]')).not.toBeNull();expect(host.textContent).toContain('正在查询 Coin 与地址余额');expect(host.textContent).toContain('原订阅回执、事件及资金变化已核验')
 await click('停止当前资金查询');await act(async()=>{finish();await new Promise(r=>setTimeout(r,30))});expect(host.querySelector('[aria-label="当前单币种余额"]')).toBeNull();expect(host.querySelector('[aria-label="当前 Coin 对象合计"]')).not.toBeNull();expect(payload()).toBe(x.text)
 await click('查询所选地址当前资金');expect(host.querySelector('[aria-label="当前单币种余额"]')).not.toBeNull()
})
it('switching original recipient hides old late funds without affecting the original history',async()=>{
 const {purchaseRecoveryFundsFixture}=await import('./fixtures/commerce-purchase-recovery-funds'),x=await purchaseRecoveryFundsFixture('v1'),read=x.client.stateService.getBalance.getMockImplementation()!;let finish!:()=>void
 x.client.stateService.getBalance.mockImplementationOnce(async(...a:any[])=>{await new Promise<void>(r=>finish=r);return read(...a)})
 m.id=x.soulId;m.factory.mockReturnValue(x.client);await render();await select(x.text);await click('查询原购买历史');const chooser=host.querySelector('select')!
 await act(async()=>{chooser.value=x.first.owner;chooser.dispatchEvent(new Event('change',{bubbles:true}))});await click('查询所选地址当前资金');const next=x.payouts.find(p=>p.owner!==x.first.owner)!.owner
 await act(async()=>{chooser.value=next;chooser.dispatchEvent(new Event('change',{bubbles:true}));finish();await new Promise(r=>setTimeout(r,30))})
 expect(host.querySelector('[aria-label="当前单币种余额"]')).toBeNull();expect(host.querySelector('[aria-label="当前 Coin 对象合计"]')).toBeNull();expect(host.textContent).toContain('原成交事件、资金变化及挂牌退出已核验')
 await click('查询所选地址当前资金');expect(host.querySelector('[aria-label="当前单币种余额"]')).not.toBeNull();expect(x.client.stateService.getBalance.mock.calls.at(-1)[0].owner).toBe(next)
})

it('one original address with seller and author roles is listed once and keeps its authenticated combined proceeds',async()=>{
 const {purchaseRecoveryFundsFixture}=await import('./fixtures/commerce-purchase-recovery-funds'),x=await purchaseRecoveryFundsFixture('v1','','creator-seller');m.id=x.soulId;m.factory.mockReturnValue(x.client);await render();await select(x.text);await click('查询原购买历史')
 const chooser=host.querySelector('select')!;expect([...chooser.options].filter(o=>o.value===x.first.owner)).toHaveLength(1);await act(async()=>{chooser.value=x.first.owner;chooser.dispatchEvent(new Event('change',{bubbles:true}))});expect(host.textContent).toContain('原受款角色：卖方、原挂牌作者');await click('查询所选地址当前资金');expect(host.querySelector('[aria-label="当前单币种余额"]')).not.toBeNull()
})

it('current-content handoff uses only the bound Soul, clears on invalid replacement and never serializes original credentials',async()=>{
 const x=await purchaseRecoveryFixture('v2');m.id=x.soulId;m.factory.mockReturnValue(x.client);await render();await select(x.text)
 const link=[...host.querySelectorAll('a')].find(a=>a.textContent==='打开本 Soul 的当前内容')!
 expect(link.getAttribute('href')).toBe(`/souls/${x.soulId}/read`);expect(link.search).toBe('');expect(link.hash).toBe('');expect(m.factory).not.toHaveBeenCalled()
 expect(host.textContent).toContain('独立核对当前发布配置');await select('{}');expect(host.querySelector(`a[href="/souls/${x.soulId}/read"]`)).toBeNull()
})
it('actual V1 route strengthens original author identity and reads that author current funds without changing original download',async()=>{
 const {purchaseRecoveryAuthorFixture}=await import('./fixtures/commerce-purchase-recovery-author'),{purchaseRecoveryFundsFixture}=await import('./fixtures/commerce-purchase-recovery-funds')
 const source=await purchaseRecoveryAuthorFixture(),x=await purchaseRecoveryFundsFixture('v1','','',source);m.id=x.soulId;m.factory.mockReturnValue(x.client);await render();await select(x.text)
 expect(host.querySelector('[aria-label="原 Soul 作者与分账来源"]')).toBeNull();await click('查询原购买历史')
 expect(host.querySelector('[aria-label="已绑定原作者分账"]')).toBeNull();await click('核对原作者身份与来源')
 expect(host.querySelector('[aria-label="已绑定原作者分账"]')?.textContent).toContain('作者版税：3');expect(host.textContent).toContain('原总价（最小单位）：107')
 const author=x.proof.history.status==='SETTLEMENT_CONFIRMED'?x.proof.history.receipt.money.creator:'';expect(author).not.toBe('')
 const chooser=host.querySelector('select')!;await act(async()=>{chooser.value=author;chooser.dispatchEvent(new Event('change',{bubbles:true}))});expect(host.textContent).toContain('原受款角色：原 Soul 作者');await click('查询所选地址当前资金')
 expect(x.client.stateService.getBalance.mock.calls.at(-1)[0].owner).toBe(author);expect(host.querySelector('[aria-label="当前单币种余额"]')).not.toBeNull();expect(payload()).toBe(x.text)
})
it('source failure preserves authenticated money and completed public current funds instead of promoting Offer creator',async()=>{
 const {purchaseRecoveryAuthorFixture}=await import('./fixtures/commerce-purchase-recovery-author'),{purchaseRecoveryFundsFixture}=await import('./fixtures/commerce-purchase-recovery-funds')
 const x=await purchaseRecoveryFundsFixture('v1','','',await purchaseRecoveryAuthorFixture('module-minter'));m.id=x.soulId;m.factory.mockReturnValue(x.client);await render();await select(x.text);await click('查询原购买历史')
 const chooser=host.querySelector('select')!;await act(async()=>{chooser.value=x.first.owner;chooser.dispatchEvent(new Event('change',{bubbles:true}))});await click('查询所选地址当前资金');expect(host.querySelector('[aria-label="当前单币种余额"]')).not.toBeNull();await click('核对原作者身份与来源')
 expect(host.textContent).toContain('原作者来源核验未完成');expect(host.querySelector('[aria-label="已绑定原作者分账"]')).toBeNull();expect(host.querySelector('[aria-label="当前单币种余额"]')).not.toBeNull();expect(host.textContent).toContain('原成交事件、资金变化及挂牌退出已核验');expect(payload()).toBe(x.text)
})
it('same author/seller keeps the royalty component distinct from its combined payout after source binding',async()=>{
 const {purchaseRecoveryAuthorFixture}=await import('./fixtures/commerce-purchase-recovery-author'),{purchaseRecoveryFundsFixture}=await import('./fixtures/commerce-purchase-recovery-funds')
 const x=await purchaseRecoveryFundsFixture('v1','','',await purchaseRecoveryAuthorFixture('module-creator-seller'));m.id=x.soulId;m.factory.mockReturnValue(x.client);await render();await select(x.text);await click('查询原购买历史');await click('核对原作者身份与来源')
 expect(host.textContent).toContain('作者版税：3');expect(host.textContent).toContain('作者同时是卖方');expect(host.textContent).toContain('合并金额不全是版税');const chooser=host.querySelector('select')!;await act(async()=>{chooser.value=x.first.owner;chooser.dispatchEvent(new Event('change',{bubbles:true}))});expect(host.textContent).toContain('原受款角色：卖方、原 Soul 作者');expect(payload()).toBe(x.text)
})
it('stopped delayed source query cannot replace original evidence or existing current observations',async()=>{
 const {purchaseRecoveryAuthorFixture}=await import('./fixtures/commerce-purchase-recovery-author'),{purchaseRecoveryFundsFixture}=await import('./fixtures/commerce-purchase-recovery-funds')
 const x=await purchaseRecoveryFundsFixture('v1','','',await purchaseRecoveryAuthorFixture());m.id=x.soulId;m.factory.mockReturnValue(x.client);await render();await select(x.text);await click('查询原购买历史')
 const read=x.client.ledgerService.getObject.getMockImplementation()!;let finish!:()=>void,held=false
 x.client.ledgerService.getObject.mockImplementation(async(r:any,o:any)=>{if(!held&&r.objectId===x.soulId&&r.version!==undefined){held=true;await new Promise<void>(resolve=>finish=resolve)}return read(r,o)})
 await click('核对原作者身份与来源');expect(host.textContent).toContain('正在核对原作者');await click('停止作者来源查询');await act(async()=>{finish();await new Promise(r=>setTimeout(r,50))})
 expect(host.querySelector('[aria-label="已绑定原作者分账"]')).toBeNull();expect(host.textContent).toContain('作者来源查询已停止');expect(host.textContent).toContain('原成交事件、资金变化及挂牌退出已核验');expect(payload()).toBe(x.text)
})
it('failed source refresh preserves previously bound author proof and its completed current funds',async()=>{
 const {purchaseRecoveryAuthorFixture}=await import('./fixtures/commerce-purchase-recovery-author'),{purchaseRecoveryFundsFixture}=await import('./fixtures/commerce-purchase-recovery-funds')
 const x=await purchaseRecoveryFundsFixture('v1','','',await purchaseRecoveryAuthorFixture());m.id=x.soulId;m.factory.mockReturnValue(x.client);await render();await select(x.text);await click('查询原购买历史');await click('核对原作者身份与来源')
 const author=x.proof.history.status==='SETTLEMENT_CONFIRMED'?x.proof.history.receipt.money.creator:'',chooser=host.querySelector('select')!;await act(async()=>{chooser.value=author;chooser.dispatchEvent(new Event('change',{bubbles:true}))});await click('查询所选地址当前资金')
 const old=host.querySelector('[aria-label="当前单币种余额"]')!.textContent
 x.client.ledgerService.getTransaction=vi.fn(async()=>{throw {code:'NOT_FOUND'}});await click('核对原作者身份与来源')
 expect(host.textContent).toContain('本次未取得完整的原作者身份绑定');expect(host.querySelector('[aria-label="已绑定原作者分账"]')).not.toBeNull();expect(host.querySelector('[aria-label="当前单币种余额"]')?.textContent).toBe(old);expect(payload()).toBe(x.text)
})

async function verifiedSaleWithContent() {
 const {purchaseRecoveryCustodyFixture}=await import('./fixtures/commerce-purchase-recovery-custody')
 const fixture=await purchaseRecoveryCustodyFixture()
 const original=JSON.parse(fixture.text)
 original.context.target.content=original.context.target.standard
 m.id=fixture.soulId
 m.address=original.plan.buyer
 m.factory.mockReturnValue(fixture.client)
 return {...fixture,original,text:JSON.stringify(original),release:JSON.stringify(original.context.target)}
}
const currentRecord=(index:number, name:string, deleted=false)=>({
 index:String(index),kind:index===0?0:1,name,version:'2',ciphertextHash:'11'.repeat(32),readMask:'1',deleted,purged:false,
})
function currentDirectory(x:Pick<Awaited<ReturnType<typeof verifiedSaleWithContent>>,'soulId'|'original'>, owned=true) {
 return {
  soulId:x.soulId,
  custody:{ownerReadCandidate:owned,viewerMatchesOwner:owned,ownerAddress:owned?x.original.plan.buyer:aid(99),accountId:aid(67)},
  contentDirectory:{start:0,nextStart:25,records:[currentRecord(0,'soul'),currentRecord(1,'default'),currentRecord(2,'deleted',true)]},
 }
}

it.each(['text', 'file'])('opens %s for the original current buyer after original money and custody proof on the route',async mode=>{
 const x=await verifiedSaleWithContent()
 vi.stubEnv('NEXT_PUBLIC_SOULIDITY_NATIVE_WORKBENCH_TARGET_JSON',x.release)
 m.readCurrent.mockResolvedValue(currentDirectory(x))
 const bytes=new TextEncoder().encode('verified buyer plaintext')
 const binary = mode === 'file'
 const create = vi.fn((_blob: Blob) => 'blob:current-owner-file'), revoke = vi.fn()
 vi.stubGlobal('URL', class extends URL { static createObjectURL = create; static revokeObjectURL = revoke })
 m.openContent.mockResolvedValue({bytes,fileName:binary?'memory.bin':'memory.md',
  mimeType:binary?'application/octet-stream':'text/markdown',downloadAllowed:true})
 await render();await select(x.text);await click('查询原购买历史')
 expect(host.querySelector('[aria-label="原买家当前内容"]')).toBeNull()
 await click('核对原资产交接')
 expect(host.querySelector('[aria-label="已核验原资产交接"]')?.textContent).toContain(x.original.packet.digest)
 expect(m.readCurrent).not.toHaveBeenCalled()
 await click('核对当前托管和内容目录')
 expect(m.readCurrent).toHaveBeenCalledWith(expect.objectContaining({target:x.original.context.target,soulId:x.soulId,viewerAddress:x.original.plan.buyer,contentStart:0}))
 expect(host.textContent).not.toContain('deleted')
 expect(m.openContent).not.toHaveBeenCalled()
 await click('记忆 default · 版本 2 · 记录 1')
 await click('Read protected content')
 expect(m.openContent).toHaveBeenCalledWith(expect.objectContaining({
  soulId:x.soulId,viewerAddress:x.original.plan.buyer,recordIndex:1,
  expectedRecord:{version:'2',ciphertextHash:'11'.repeat(32)},
 }))
 if(binary){
  const link=host.querySelector('a[download="memory.bin"]')
  expect(link?.getAttribute('href')).toBe('blob:current-owner-file')
  expect(create.mock.calls[0][0].type).toBe('application/octet-stream')
 }else expect(host.textContent).toContain('verified buyer plaintext')
 expect(payload()).toBe(x.text)
 m.address=x.original.plan.seller??aid(99)
 await render()
 expect(host.textContent).not.toContain('verified buyer plaintext')
 expect(host.querySelector('a[download="memory.bin"]')).toBeNull()
 if(binary)expect(revoke).toHaveBeenCalledExactlyOnceWith('blob:current-owner-file')
 expect(bytes.every(byte=>byte===0)).toBe(true)
 expect(host.querySelector('[aria-label="已核验原资产交接"]')).not.toBeNull()
 expect(host.querySelector('[aria-label="原买家当前内容"] button')).toBeNull()
})

it('prefills the exact Offer and reopens buyer content directly after verifying the original in checkout',async()=>{
 const f=await nativeSaleLifecycleWireFixture()
 const original=JSON.parse(f.purchaseText),soulId=f.review.soulId
 m.id=soulId;m.address=f.plan.buyer;m.walletClient=f.client
 const held=new Set<string>()
 Object.defineProperty(navigator,'locks',{configurable:true,value:{request:async (key:string,_opts:unknown,run:(lock:unknown)=>unknown)=>{
  if(held.has(key))return run(null)
  held.add(key);try{return await run({name:key})}finally{held.delete(key)}
 }}})
 const scope={soulId,chainIdentifier:'35834a8a',author:f.plan.buyer},key=nativeSaleCheckoutKey(scope),journal=browserNativeSaleCheckoutJournal()
 const record={schema:'soulidity.native-sale-checkout.v1' as const,plan:{...scope,originalText:f.purchaseText,reviewedQuoteIdentity:'fixture'},packet:original.packet}
 await journal.exclusive(key,()=>journal.write(key,record))
 vi.stubEnv('NEXT_PUBLIC_SOULIDITY_NATIVE_WORKBENCH_TARGET_JSON',JSON.stringify(f.review.target))
 m.readCurrent.mockResolvedValue(currentDirectory({soulId,original}))
 m.openContent.mockResolvedValue({bytes:new TextEncoder().encode('exact buyer checkout content'),fileName:'soul.md',mimeType:'text/markdown',downloadAllowed:true})
 const params=Promise.resolve({id:soulId}),searchParams=Promise.resolve({offer:f.review.purchasedOfferId})
 const renderBuy=()=>act(async()=>{root.render(<Suspense fallback="Loading"><BuyPage params={params} searchParams={searchParams}/></Suspense>);await new Promise(r=>setTimeout(r,25))})
 await renderBuy()
 expect(host.querySelector('input')?.value).toBe(f.review.purchasedOfferId)
 await click('读取本机原购买')
 expect(host.querySelector('[aria-label="原买家当前内容"]')).toBeNull()
 await click('查询原摘要')
 expect(host.textContent).toContain('已核对原成交分账、托管交接和授权变化')
 await click('核对当前托管和内容目录');await click('Soul 原文 soul · 版本 2 · 记录 0');await click('Read protected content')
 expect(host.textContent).toContain('exact buyer checkout content')
 expect(m.openContent).toHaveBeenCalledWith(expect.objectContaining({soulId,viewerAddress:f.plan.buyer,recordIndex:0}))
 m.address=f.review.seller
 await renderBuy()
 expect(host.textContent).not.toContain('exact buyer checkout content')
})

it('keeps history visible if the configured release differs or the original buyer has resold the Soul',async()=>{
 const x=await verifiedSaleWithContent()
 const configured={...x.original.context.target,configId:aid(999)}
 vi.stubEnv('NEXT_PUBLIC_SOULIDITY_NATIVE_WORKBENCH_TARGET_JSON',JSON.stringify(configured))
 await render();await select(x.text);await click('查询原购买历史');await click('核对原资产交接')
 expect(host.querySelector('[aria-label="原买家当前内容"]')?.textContent).toContain('缺少与原文件完全匹配的发布配置')
 expect(m.readCurrent).not.toHaveBeenCalled()
 vi.stubEnv('NEXT_PUBLIC_SOULIDITY_NATIVE_WORKBENCH_TARGET_JSON',x.release)
 await render()
 m.readCurrent.mockResolvedValue(currentDirectory(x,false))
 await click('核对当前托管和内容目录')
 expect(host.textContent).toContain('原买家当前未通过此 Soul 的持有人与 Account 核对')
 expect(host.querySelector('[aria-label="原付款历史"]')).not.toBeNull()
 expect(host.querySelector('[aria-label="已核验原资产交接"]')).not.toBeNull()
 expect(m.openContent).not.toHaveBeenCalled()
})

it('discards late plaintext and unmounts the buyer reader when the imported original is replaced',async()=>{
 const x=await verifiedSaleWithContent()
 vi.stubEnv('NEXT_PUBLIC_SOULIDITY_NATIVE_WORKBENCH_TARGET_JSON',x.release)
 m.readCurrent.mockResolvedValue(currentDirectory(x))
 let finish!:(value:unknown)=>void
 m.openContent.mockImplementation(()=>new Promise(resolve=>{finish=resolve}))
 await render();await select(x.text);await click('查询原购买历史');await click('核对原资产交接')
 await click('核对当前托管和内容目录');await click('Soul 原文 soul · 版本 2 · 记录 0');await click('Read protected content')
 const signal=m.openContent.mock.calls[0][0].signal
 await select('{}')
 expect(signal.aborted).toBe(true)
 const bytes=new TextEncoder().encode('late private buyer plaintext')
 await act(async()=>finish({bytes,fileName:'late.txt',mimeType:'text/plain'}))
 expect(bytes.every(byte=>byte===0)).toBe(true)
 expect(host.textContent).not.toContain('late private buyer plaintext')
})

it('re-verifies the checkout handoff and reads original Coin, inventory and address balance for verified recipients',async()=>{
 const {marketBuyPurchaseFundsFixture}=await import('./fixtures/market-buy-purchase-funds')
 const {createMarketBuyFundsOriginal}=await import('../../web/lib/animacraft/market-buy-funds-original')
 const {MAINNET_GENESIS_DIGEST}=await import('../../web/lib/animacraft/mainnet-chain')
 const x=await marketBuyPurchaseFundsFixture({sameRoles:true})
 const file=createMarketBuyFundsOriginal(x.record),text=JSON.stringify(file),owner=x.s.seller,coinId=aid(210)
 const coin=x.coin(coinId,'23',owner,11)
 x.latest.set(coinId,coin)
 x.latest.set(aid(211),x.coin(aid(211),'25000',aid(99),11))
 x.missingLatest.add(aid(212));x.missingLatest.add(aid(213))
 vi.spyOn(x.client.core,'getChainIdentifier').mockResolvedValue({chainIdentifier:MAINNET_GENESIS_DIGEST})
 const inventory=vi.spyOn(x.client.core,'listOwnedObjects').mockResolvedValue({objects:[{objectId:coinId}],hasNextPage:false,cursor:null} as any)
 const balance=vi.spyOn(x.client.stateService,'getBalance').mockImplementation(req=>x.rpc(req,{
  balance:{coinType:x.s.release.paymentCoinType,coinBalance:23n,addressBalance:4n,balance:27n},
 }))
 m.id=x.s.soulId;m.factory.mockReturnValue(x.client)
 await render();await select(text)
 expect(host.querySelector('select')).toBeNull()
 await click('查询原购买历史')
 expect(host.querySelector('[aria-label="原 Soul 结账资金"]')?.textContent).toContain('原购买总额（最小单位）：1000000')
 expect(host.querySelector('[aria-label="当前协议收入"]')).toBeNull()
 const chooser=host.querySelector('select')!
 expect([...chooser.options].filter(o=>o.value).map(o=>o.value)).toEqual([owner])
 expect(balance).not.toHaveBeenCalled()
 await act(async()=>{chooser.value=owner;chooser.dispatchEvent(new Event('change',{bubbles:true}))})
 expect(host.textContent).toContain('原受款角色：卖方、Soul 作者、服务方、Maker 来源方')
 await click('查询所选地址当前资金')
 expect(balance).toHaveBeenCalledWith({owner,coinType:x.s.release.paymentCoinType},expect.anything())
 expect(inventory.mock.calls.every(([input])=>input.owner===owner)).toBe(true)
 const coins=host.querySelector('[aria-label="原收款 Coin 现状"]')?.textContent
 expect(coins).toContain('当前仍由所选地址持有，此 Coin 当前余额 23')
 expect(coins).toContain('当前已不属于所选地址')
 expect(coins).toContain('当前不可查询')
 expect(host.querySelector('[aria-label="当前 Coin 对象合计"]')?.textContent).toContain('23')
 expect(host.querySelector('[aria-label="当前单币种余额"]')?.textContent).toContain('当前该币种合计（最小单位）：27')
 expect(payload()).toBe(text)
 balance.mockImplementationOnce(req=>x.rpc(req,{balance:{coinType:x.s.release.paymentCoinType,coinBalance:23n,balance:23n}}))
 await click('查询所选地址当前资金')
 expect(host.textContent).toContain('ADDRESS_FUNDS_RAW_BALANCE_REQUIRED')
 expect(host.querySelector('[aria-label="当前单币种余额"]')).toBeNull()
 expect(host.querySelector('[aria-label="原 Soul 结账资金"]')?.textContent).toContain('原购买总额（最小单位）：1000000')
 expect(host.querySelector('[aria-label="原收款 Coin 现状"]')).not.toBeNull()
})

it.each([false,true])('uses the same cold checkout receipt to verify funds, original Soul delivery and a later holder (address gas %s)', async addressGas => {
 const {marketBuyPurchaseFundsFixture}=await import('./fixtures/market-buy-purchase-funds')
 const {createMarketBuyFundsOriginal}=await import('../../web/lib/animacraft/market-buy-funds-original')
 const {NativeSoulStateBcs}=await import('../../web/lib/animacraft/native-receive')
 const {deriveKioskItemFieldId,KIOSK_ITEM_FIELD_TYPE,KioskItemFieldBcs,SoulPublicKioskBcs}=await import('@soulidity/sdk')
 const x=await marketBuyPurchaseFundsFixture({handoff:true,addressGas}),target=x.handoff!.target
 const text=JSON.stringify(createMarketBuyFundsOriginal(x.record))
 vi.stubEnv('NEXT_PUBLIC_SUI_NETWORK','mainnet')
 vi.stubEnv('NEXT_PUBLIC_SOULIDITY_CALLABLE_PACKAGE_ID',target.soulidityCallablePackageId)
 vi.stubEnv('NEXT_PUBLIC_SOULIDITY_ORIGINAL_PACKAGE_ID',target.soulidityOriginalPackageId)
 vi.stubEnv('NEXT_PUBLIC_ANIMACRAFT_V8_RECEIVE_TARGET_JSON',JSON.stringify(target))
 const execute=vi.spyOn(x.client.core,'executeTransaction').mockRejectedValue(Error('Unexpected execution'))
 m.id=x.s.soulId;m.factory.mockReturnValue(x.client)
 await render();await select(text);await click('查询原购买历史')
 const action='核对原 Soul 交付与当前托管',custody=()=>host.querySelector('[aria-label="Soul 原交付与当前托管"]')?.textContent
 const history=()=>host.querySelector('[aria-label="原 Soul 结账资金"]')?.textContent
 expect(history(), host.textContent ?? '').toContain('原购买总额（最小单位）：1000000')
 expect(history()).toContain('原 SUI Gas（MIST）：3')
 expect(custody()).not.toContain('当前持有人')
 await click(action)
 expect(custody()).toContain(`原买家 ${x.s.buyer} 已在该检查点接收 Soul`)
 expect(custody()).toContain(`当前持有人 ${x.s.buyer}`)
 expect(custody()).toContain(`Kiosk ${x.s.buyerKioskId}`)

 const laterOwner=aid(201),laterKiosk=aid(202),itemId=deriveKioskItemFieldId(laterKiosk,x.s.soulId)
 const state=x.latest.get(x.s.stateId)!,soul=x.latest.get(x.s.soulId)!,next=NativeSoulStateBcs.parse(state.contents.value)
 Object.assign(next,{current_owner:laterOwner,current_kiosk_id:laterKiosk,ownership_epoch:'5'})
 const latest=[
  x.move(state.objectId,state.objectType,11,{Shared:{initialSharedVersion:'1'}},NativeSoulStateBcs.serialize(next).toBytes()),
  x.move(soul.objectId,soul.objectType,11,{ObjectOwner:itemId},soul.contents.value),
  x.move(itemId,KIOSK_ITEM_FIELD_TYPE,11,{ObjectOwner:laterKiosk},
   KioskItemFieldBcs.serialize({id:itemId,name:{name:{id:x.s.soulId}},value:x.s.soulId}).toBytes()),
  x.move(laterKiosk,'0x2::kiosk::Kiosk',11,{Shared:{initialSharedVersion:'11'}},
   SoulPublicKioskBcs.serialize({id:laterKiosk,owner:laterOwner,profits:'0',item_count:1,allow_extensions:true}).toBytes()),
 ]
 for(const row of latest)x.latest.set(row.objectId,row)
 x.latest.delete(deriveKioskItemFieldId(x.s.buyerKioskId!,x.s.soulId))
 await click(action)
 expect(custody()).toContain(`原买家 ${x.s.buyer} 已在该检查点接收 Soul`)
 expect(custody()).toContain(`当前持有人 ${laterOwner}`)
 expect(custody()).toContain('成交后托管或挂牌状态已有变化')
 expect(history(), host.textContent ?? '').toContain('原购买总额（最小单位）：1000000')

 x.latest.delete(itemId)
 await click(action)
 expect(custody()).toContain('Soul 托管核对未完成')
 expect(custody()).not.toContain('当前持有人')
 expect(history(), host.textContent ?? '').toContain('原购买总额（最小单位）：1000000')
 expect(payload()).toBe(text)
 expect(m.sign).not.toHaveBeenCalled()
 expect(execute).not.toHaveBeenCalled()

 x.latest.set(itemId,latest[2])
 const read=x.getObject.getMockImplementation()!
 let enter!:()=>void,release!:()=>void
 const entered=new Promise<void>(resolve=>{enter=resolve}),paused=new Promise<void>(resolve=>{release=resolve})
 x.getObject.mockImplementationOnce(req=>{
  enter()
  return x.rpc(req,paused.then(async()=>(await read(req,{})).response))
 })
 try {
  await act(async()=>{[...host.querySelectorAll('button')].find(button=>button.textContent===action)!.click();await entered})
  await select('{"unsupported":true}')
  expect(custody()).toBeUndefined()
  await act(async()=>{release();await new Promise(resolve=>setTimeout(resolve,30))})
  expect(custody()).toBeUndefined()
  expect(host.textContent).not.toContain(laterOwner)
 } finally { release() }
})

async function paidRecoveryPage() {
 const {coherentRecovery}=await import('./fixtures/commerce-paid-original-current'),f=await coherentRecovery(true)
 m.id=f.x.f.root.id;m.address=f.x.buyer;m.factory.mockReturnValue(f.client)
 m.walletClient=f.cryptoFixture.client;m.sealConfig=f.cryptoFixture.params.sealConfig;m.sign.mockImplementation(f.cryptoFixture.sign)
 vi.stubGlobal('fetch',f.fetcher)
 vi.stubEnv('NEXT_PUBLIC_SOULIDITY_NATIVE_PUBLIC_READ_V2_TARGET_JSON',JSON.stringify(f.qualification.target))
 return f
}
async function choosePaidRecoveryVersion(index:number) {
 await click('查找原订阅覆盖的当前版本')
 const picker=host.querySelector<HTMLSelectElement>('[aria-label="原订阅适用版本"]')!
 expect(Array.from(picker.options).filter(option=>option.value).map(option=>Number(option.value))).toContain(index)
 await act(async()=>{picker.value=String(index);picker.dispatchEvent(new Event('change',{bubbles:true}))})
 for(let i=0;i<50&&!paidOpen();i++)await act(async()=>{await new Promise(resolve=>setTimeout(resolve,25))})
 expect(paidOpen(),host.textContent??'').toBeDefined()
 return picker
}
async function waitForPaidOpen() {
 for(let i=0;i<50&&host.textContent?.includes('Opening protected content…');i++){
  await act(async()=>{await new Promise(resolve=>setTimeout(resolve,25))})
 }
 expect(host.textContent).not.toContain('Opening protected content…')
}
const paidOpen=()=>[...host.querySelectorAll('button')].find(b=>b.textContent==='用原买家钱包打开内容')
const paidPlaintext=()=>host.querySelector('[aria-label="Opened content content.txt"]')

it.each(['file','journal'] as const)('opens a later compatible version from a V2 original %s through the actual recovery page and real Seal/AES',async mode=>{
 const f=await paidRecoveryPage()
 const {appendPaidRecord}=await import('./fixtures/commerce-recovery-current-content')
 const outOfScope=appendPaidRecord(f.x,{scope:'2'}),wrongKind=appendPaidRecord(f.x,{kind:41})
 if(mode==='journal'){
  const {nativePublicReadPaidKeyV2,nativePublicReadPaidRecordFromOriginalV2}=await import('../../web/lib/soulidity/native-public-read-paid-journal-v2')
  const record=await nativePublicReadPaidRecordFromOriginalV2(f.originalText,m.id)
  localStorage.setItem(nativePublicReadPaidKeyV2(record.plan),JSON.stringify(record))
 }
 const storageBefore=Object.entries(localStorage)
 await render()
 if(mode==='file'){await select(f.originalText);await click('查询原购买历史')}
 else await click('查询本机原操作历史')
 expect(host.textContent).toContain(mode==='file'?'原协议收入（最小单位）：3':'原协议收入增加（最小单位）：3')
 const picker=await choosePaidRecoveryVersion(f.qualification.recordIndex)
 expect(Array.from(picker.options).map(option=>option.value)).not.toContain(String(outOfScope.index))
 expect(Array.from(picker.options).map(option=>option.value)).not.toContain(String(wrongKind.index))
 await click('用原买家钱包打开内容');await waitForPaidOpen()
 expect(paidPlaintext()?.textContent??'',host.textContent??'').toContain(new TextDecoder().decode(f.plaintext))
 expect(paidPlaintext()?.textContent).toContain('已使用原交易产生的订阅资格打开此版本。')
 expect(m.sign).toHaveBeenCalledOnce()
 expect(f.cryptoFixture.decryptCall).toHaveBeenCalledOnce()
 expect(f.fetcher).toHaveBeenCalledOnce()
 expect(payload()).toBe(f.originalText)
 expect(Object.entries(localStorage)).toEqual(storageBefore)
})

it.each([0, 1, 2])('honors verified download policy %i after real Seal/AES recovery for the paid buyer', async downloadPolicy => {
 const f = await paidRecoveryPage()
 f.envelope.mimeType = 'application/octet-stream'
 f.envelope.fileName = 'content.bin'
 f.x.record.download_policy = downloadPolicy
 f.x.record.envelope = new TextEncoder().encode(JSON.stringify(f.envelope))
 f.rewrite()
 const create = vi.fn((_blob: Blob) => 'blob:recovered-file'), revoke = vi.fn()
 vi.stubGlobal('URL', class extends URL { static createObjectURL = create; static revokeObjectURL = revoke })
 await render(); await select(f.originalText); await click('查询原购买历史'); await choosePaidRecoveryVersion(f.qualification.recordIndex)
 expect(host.querySelector('a[download="content.bin"]')).toBeNull()
 await click('用原买家钱包打开内容'); await waitForPaidOpen()
 const opened = host.querySelector('[aria-label="Opened content content.bin"]')
 expect(opened?.textContent).toContain('已使用原交易产生的订阅资格打开此版本。')
 if (downloadPolicy === 0) {
  expect(opened?.querySelector('a[download="content.bin"]')?.getAttribute('href')).toBe('blob:recovered-file')
  expect(create).toHaveBeenCalledOnce()
  const bytes = await new Promise<ArrayBuffer>((resolve, reject) => {
   const reader = new FileReader()
   reader.onerror = () => reject(reader.error)
   reader.onload = () => resolve(reader.result as ArrayBuffer)
   reader.readAsArrayBuffer(create.mock.calls[0][0])
  })
  expect([...new Uint8Array(bytes)]).toEqual([...f.plaintext])
 } else {
  expect(opened?.querySelector('a[download="content.bin"]')).toBeNull()
  expect(opened?.textContent).toContain('The current record restricts file downloads.')
  expect(create).not.toHaveBeenCalled()
 }
 expect(m.sign).toHaveBeenCalledOnce()
 expect(f.cryptoFixture.decryptCall).toHaveBeenCalledOnce()
 expect(payload()).toBe(f.originalText)
 await click('Close content')
 expect(host.querySelector('a[download="content.bin"]')).toBeNull()
 if(downloadPolicy===0)expect(revoke).toHaveBeenCalledExactlyOnceWith('blob:recovered-file')
 else expect(revoke).not.toHaveBeenCalled()
 expect(payload()).toBe(f.originalText)
})

it('a different wallet and expired current Entry cannot obtain plaintext from an otherwise settled original',async()=>{
 const f=await paidRecoveryPage()
 m.address=aid(999)
 await render();await select(f.originalText);await click('查询原购买历史');await choosePaidRecoveryVersion(f.qualification.recordIndex)
 expect(paidOpen()?.disabled).toBe(true)
 expect(m.sign).not.toHaveBeenCalled()
 m.address=f.x.buyer;await render()
 expect(paidOpen()?.disabled).toBe(false)
 f.x.clock(1100)
 await click('用原买家钱包打开内容');await waitForPaidOpen()
 expect(host.textContent).toContain('当前钱包已无可复用的读取资格')
 expect(host.textContent).toContain('原协议收入（最小单位）：3')
 expect(paidPlaintext()).toBeNull();expect(m.sign).not.toHaveBeenCalled();expect(f.fetcher).not.toHaveBeenCalled()
})

it.each(['wallet','file'] as const)('discard late protected content when the %s changes in the recovery page',async mode=>{
 const f=await paidRecoveryPage()
 await render();await select(f.originalText);await click('查询原购买历史');await choosePaidRecoveryVersion(f.qualification.recordIndex)
 const decrypt=f.cryptoFixture.decryptCall.getMockImplementation()!
 let release!:()=>void
 const gate=new Promise<void>(resolve=>release=resolve)
 f.cryptoFixture.decryptCall.mockImplementationOnce(async(...args)=>{
  const result=await decrypt(...args);await gate;return result
 })
 try{
  await click('用原买家钱包打开内容')
  for(let i=0;i<50&&!f.cryptoFixture.unwrapped.length;i++)await act(async()=>{await new Promise(r=>setTimeout(r,25))})
  expect(f.cryptoFixture.unwrapped.length).toBe(1)
  if(mode==='wallet'){m.address=aid(999);await render()}else await select('{}')
  await act(async()=>{release();await new Promise(resolve=>setTimeout(resolve,50))})
  expect(paidPlaintext()).toBeNull()
  expect(f.cryptoFixture.unwrapped[0].every(value=>value===0)).toBe(true)
  if(mode==='wallet')expect(host.textContent).toContain('原协议收入（最小单位）：3')
  else expect(host.querySelector('[aria-label="原订阅内容交付"]')).toBeNull()
 }finally{release()}
})

const cancelPanel = () => host.querySelector<HTMLElement>('[aria-label="原取消挂牌恢复"]')!
const cancelInput = () => cancelPanel().querySelector('input')!
const cancelProof = () => cancelPanel().querySelector('[aria-label="原取消证据"]')
async function setCancellationDigest(digest: string) {
 await act(async () => {
  const input = cancelInput()
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, digest)
  input.dispatchEvent(new Event('input', { bubbles: true }))
 })
}
async function nativeCancellationPage() {
 const { nativeSaleCancellationFixture } = await import('./fixtures/commerce-sale-cancellation')
 const x = await nativeSaleCancellationFixture()
 const pin = ({ originalPackageId, callablePackageId, callableDigest }: typeof x.params.native) => ({ originalPackageId, callablePackageId, callableDigest })
 const native = pin(x.params.native), custody = pin(x.params.custody)
 const target = { chainIdentifier: '35834a8a', native, custody, standard: native, configId: aid(72), registryId: aid(71) }
 vi.stubEnv('NEXT_PUBLIC_SOULIDITY_NATIVE_WORKBENCH_TARGET_JSON', JSON.stringify(target))
 m.id = x.intent.soulId
 m.factory.mockReturnValue(x.params.client)
 await render()
 return x
}

it('recovers an independent Commerce cancellation by original digest on the actual anonymous route', async () => {
 const x = await nativeCancellationPage()
 expect(m.factory).not.toHaveBeenCalled()
 await setCancellationDigest(x.params.packet.digest)
 await click('查询原取消交易')
 expect(cancelProof()?.textContent).toContain('原取消交易、原挂牌退出及 Gas 已核验。')
 expect(cancelProof()?.textContent).toContain(x.intent.offerId)
 expect(cancelProof()?.textContent).toContain('原 SUI Gas（MIST）3')
 expect(cancelProof()?.textContent).toContain('后续挂牌与当前权限由当前状态独立核对。')
 expect(x.f.client.ledgerService.getTransaction.mock.calls.every(([request]) => (request as { digest: string }).digest === x.params.packet.digest)).toBe(true)
 expect(localStorage.length).toBe(0)
 expect(m.sign).not.toHaveBeenCalled()
})

it('can stop a late cancellation lookup and immediately query the same original digest again', async () => {
 const x = await nativeCancellationPage(), reader = x.f.client.ledgerService.getTransaction
 const response = reader.getMockImplementation()!
 let release!: () => void
 const stalled = new Promise<void>(resolve => { release = resolve })
 reader.mockImplementationOnce(async (...args) => { await stalled; return response(...args) })
 try {
  await setCancellationDigest(x.params.packet.digest)
  await click('查询原取消交易')
  await click('停止取消历史查询')
  expect(cancelInput().value).toBe(x.params.packet.digest)
  expect(cancelProof()).toBeNull()
  await click('查询原取消交易')
  expect(cancelProof()?.textContent).toContain(x.intent.offerId)
  m.id = aid(99)
  await render()
  await act(async () => { release(); await new Promise(resolve => setTimeout(resolve, 15)) })
  expect(cancelProof()).toBeNull()
  expect(cancelInput().value).toBe('')
 } finally { release() }
})


const incomePanel = () => host.querySelector<HTMLElement>('[aria-label="原购买与原提款对账"]')!
const confirmedIncome = () => incomePanel()?.querySelector('[aria-label="已核验原购买和原提款"]')
const reconciledIncome = () => incomePanel()?.querySelector('[aria-label="已核验当前协议账本"]')
async function selectWithdrawal(text: string) {
 const file = { name: 'withdrawal.json', size: new TextEncoder().encode(text).length, text: async () => text } as File
 await act(async () => {
  const input = incomePanel().querySelector('input')!
  Object.defineProperty(input, 'files', { configurable: true, value: [file] })
  input.dispatchEvent(new Event('change', { bubbles: true }))
 })
}
async function paidIncomePage(interleaved = false, qualified = true, local = false) {
 const { paidIncomeReconciliationFixture } = await import('./fixtures/paid-income-ledger-reconciliation')
 const f = await paidIncomeReconciliationFixture(interleaved)
 if (qualified) m.incomeRegistry.mockReturnValue({ registry: f.executionRegistry, error: null })
 m.id = f.review.soulId
 m.factory.mockReturnValue(f.client)
 if (local) {
  const { nativePublicReadPaidKeyV2, nativePublicReadPaidRecordFromOriginalV2 } = await import('../../web/lib/soulidity/native-public-read-paid-journal-v2')
  const record = await nativePublicReadPaidRecordFromOriginalV2(f.purchaseText, m.id)
  localStorage.setItem(nativePublicReadPaidKeyV2(record.plan), JSON.stringify(record))
 }
 await render()
 if (local) await click('查询本机原操作历史')
 else { await select(f.purchaseText); await click('查询原购买历史') }
 for (let i = 0; i < 40 && !incomePanel(); i++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 25)) })
 expect(incomePanel()).not.toBeNull()
 return f
}
it.each([false, true])('reconciles original paid income and withdrawal on the real recovery page with interleaving %s', async interleaved => {
 const f = await paidIncomePage(interleaved, true, interleaved)
 const storageBefore = Object.entries(localStorage)
 await selectWithdrawal(f.withdrawalText)
 expect(f.client.ledgerService.getTransaction).toHaveBeenCalledTimes(1)
 await click('核对两笔原交易')
 for (let i = 0; i < 40 && !reconciledIncome(); i++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 25)) })
 const text = confirmedIncome()?.textContent
 expect(text, incomePanel().textContent ?? '').toContain('内容受款方 101 · 协议入账 3')
 expect(text).toContain('提款到账（最小单位）3')
 expect(text).toContain(f.withdrawal.payoutId)
 expect(text).toContain(interleaved ? '两笔之间另有入账 5 · 提款 2' : '本次费用可与原提款逐笔对应')
 expect(reconciledIncome()?.textContent).toContain(interleaved ? '账本余额（最小单位）3' : '账本余额（最小单位）0')
 expect(f.client.ledgerService.getTransaction.mock.calls.map(([request]) => request.digest)).toEqual([
  f.review.purchaseDigest, f.review.purchaseDigest, f.review.withdrawalDigest,
 ])
 expect(m.sign).not.toHaveBeenCalled()
 expect(Object.entries(localStorage)).toEqual(storageBefore)
 expect(payload()).toBe(f.purchaseText)
})
it('retains verified deposits and withdrawals during a failed or stopped current read and retries that read alone', async () => {
 const f = await paidIncomePage()
 const ledger = f.client.core.getChainIdentifier
 ledger.mockRejectedValueOnce(Error('Current ledger temporarily unavailable'))
 await selectWithdrawal(f.withdrawalText)
 await click('核对两笔原交易')
 expect(confirmedIncome()?.textContent).toContain(f.withdrawal.payoutId)
 expect(incomePanel().querySelector('[role="alert"]')?.textContent).toContain('当前协议账本暂不可读')
 expect(reconciledIncome()).toBeNull()

 let release!: () => void
 const stalled = new Promise<void>(resolve => { release = resolve })
 const readChain = ledger.getMockImplementation()!
 ledger.mockImplementationOnce(async () => { await stalled; return readChain() })
 try {
  await click('重新读取当前账本')
  await click('停止对账')
  expect(confirmedIncome()?.textContent).toContain(f.review.purchaseDigest)
  expect(incomePanel().querySelector('[role="status"]')?.textContent).toContain('已停止读取当前账本')
  await act(async () => { release(); await stalled })
  expect(reconciledIncome()).toBeNull()

  await click('重新读取当前账本')
  expect(reconciledIncome()?.textContent).toContain('账本余额（最小单位）0')
  expect(f.client.ledgerService.getTransaction.mock.calls.map(([request]) => request.digest)).toEqual([
   f.review.purchaseDigest, f.review.purchaseDigest, f.review.withdrawalDigest,
  ])
  expect(m.sign).not.toHaveBeenCalled()
 } finally { release() }
})

it('clears the confirmed pair and ignores a late current read when the withdrawal file changes', async () => {
 const f = await paidIncomePage()
 const ledger = f.client.core.getChainIdentifier, readChain = ledger.getMockImplementation()!
 let release!: () => void
 const stalled = new Promise<void>(resolve => { release = resolve })
 ledger.mockImplementationOnce(async () => { await stalled; return readChain() })
 try {
  await selectWithdrawal(f.withdrawalText)
  await click('核对两笔原交易')
  expect(confirmedIncome()?.textContent).toContain(f.review.withdrawalDigest)
  await selectWithdrawal('{}')
  expect(confirmedIncome()).toBeNull()
  await act(async () => { release(); await stalled })
  expect(confirmedIncome()).toBeNull()
  expect(reconciledIncome()).toBeNull()
  expect(incomePanel().querySelector('[role="alert"]')).not.toBeNull()
 } finally { release() }
})

it('preserves original paid evidence when withdrawal execution is unqualified and clears it only for a new purchase', async () => {
 const f = await paidIncomePage(false, false)
 await selectWithdrawal(f.withdrawalText)
 await click('核对两笔原交易')
 for (let i = 0; i < 40 && !incomePanel().textContent?.includes('已查到原提款终局执行'); i++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 25)) })
 expect(incomePanel().textContent).toContain('已查到原提款终局执行')
 expect(incomePanel().textContent).toContain(f.review.withdrawalDigest)
 expect(reconciledIncome()).toBeNull()
 expect(host.querySelector('[aria-label="原付款历史"]')?.textContent).toContain('原协议收入（最小单位）：3')
 await selectWithdrawal('{}')
 expect(incomePanel().textContent).not.toContain('已查到原提款终局执行')
 expect(payload()).toBe(f.purchaseText)
 await select('{}')
 expect(incomePanel()).toBeNull()
})

it('drops a late reconciliation when the withdrawal file is replaced', async () => {
 const f = await paidIncomePage()
 const reads = f.client.ledgerService.getTransaction, read = reads.getMockImplementation()!
 let release!: () => void
 const pending = new Promise<void>(resolve => { release = resolve })
 reads.mockImplementation(async request => {
  if (request.digest === f.review.withdrawalDigest) await pending
  return read(request)
 })
 try {
  await selectWithdrawal(f.withdrawalText)
  await click('核对两笔原交易')
  for (let i = 0; i < 40 && !reads.mock.calls.some(([request]) => request.digest === f.review.withdrawalDigest); i++) {
   await act(async () => { await new Promise(resolve => setTimeout(resolve, 25)) })
  }
  expect(reads.mock.calls.some(([request]) => request.digest === f.review.withdrawalDigest)).toBe(true)
  await selectWithdrawal('{}')
  await act(async () => { release(); await new Promise(resolve => setTimeout(resolve, 30)) })
  expect(reconciledIncome()).toBeNull()
  expect(incomePanel().textContent).not.toContain(f.review.withdrawalDigest)
  expect(host.querySelector('[aria-label="原付款历史"]')?.textContent).toContain('原协议收入（最小单位）：3')
 } finally { release() }
})

it('reads the original fee and pooled current balance on the recovery page before importing a withdrawal', async () => {
 const f=await paidIncomePage(true)
 const panel=incomePanel().querySelector('[aria-label="原付费入账与当前账本"]')!
 const read=f.client.core.getChainIdentifier
 read.mockRejectedValueOnce(Error('Current ledger temporarily unavailable'))
 const storageBefore=Object.entries(localStorage)
 await click('核对原购买与当前账本')
 expect(panel.querySelector('[aria-label="已核验原付费入账"]')?.textContent).toContain('原协议入账（最小单位）3')
 expect(panel.querySelector('[role="alert"]')?.textContent).toContain('当前协议账本暂不可读')
 await click('重新读取原购买对应的当前账本')
 const current=panel.querySelector('[aria-label="原购买对应的当前协议账本"]')
 expect(current?.textContent).toContain('当前账本余额（最小单位）3')
 expect(current?.textContent).toContain('原购买后共用账本新增入账 5 · 提款 5')
 expect(current?.querySelector('a')?.getAttribute('href')).toBe('/income')
 expect(f.client.ledgerService.getTransaction.mock.calls.map(([request])=>request.digest)).toEqual([
  f.review.purchaseDigest,f.review.purchaseDigest,
 ])
 expect(m.sign).not.toHaveBeenCalled()
 expect(Object.entries(localStorage)).toEqual(storageBefore)
})

it('keeps the original credit when stopping a slow current read and ignores the late balance', async () => {
 const f=await paidIncomePage()
 const panel=incomePanel().querySelector('[aria-label="原付费入账与当前账本"]')!
 const chain=f.client.core.getChainIdentifier
 let release!:()=>void
 const stalled=new Promise<void>(resolve=>{release=resolve})
 const read=chain.getMockImplementation()!
 chain.mockImplementationOnce(async()=>{await stalled;return read()})
 try {
  await click('核对原购买与当前账本')
  expect(panel.querySelector('[aria-label="已核验原付费入账"]')?.textContent).toContain(f.review.purchaseDigest)
  await click('停止原付费入账核对')
  await act(async()=>{release();await stalled})
  expect(panel.querySelector('[aria-label="原购买对应的当前协议账本"]')).toBeNull()
  expect(panel.querySelector('[role="status"]')?.textContent).toContain('已停止本次读取')
  expect(panel.querySelector('[aria-label="已核验原付费入账"]')?.textContent).toContain(f.review.purchaseDigest)
  expect(f.client.ledgerService.getTransaction.mock.calls.map(([request])=>request.digest)).toEqual([
   f.review.purchaseDigest,f.review.purchaseDigest,
  ])
 } finally {release()}
})

async function selectServiceFile(index: number, text: string) {
  const file = { name: index === 0 ? 'review.json' : 'payment.json', size: new TextEncoder().encode(text).length,
    text: async () => text } as File
  await act(async () => {
    const input = host.querySelectorAll('[aria-label="原 Native 服务收款恢复"] input[type=file]')[index]
    Object.defineProperty(input, 'files', { configurable: true, value: [file] })
    input.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

it('opens original service settlement on the anonymous route and retries current funds independently', async () => {
  const x = await serviceRecoveryCase()
  const readTransaction = vi.spyOn(x.f.client.ledgerService, 'getTransaction')
  const getBalance = x.f.client.stateService.getBalance
  getBalance.mockRejectedValueOnce({ code: 14 })
  m.id = x.f.soulId
  m.factory.mockReturnValue(x.f.client)
  await render()
  const files = x.files()
  await selectServiceFile(0, files.reviewText)
  await selectServiceFile(1, files.packetText)
  expect(m.factory).not.toHaveBeenCalled()

  await click('查询原服务收款')
  const original = host.querySelector('[aria-label="已核验原服务收款"]')
  expect(original?.textContent).toContain('原买方总额 104 · 原收款 101 · 原协议入账 3')
  expect(original?.textContent).toContain(x.packet.digest)
  expect(original?.textContent).toContain(x.review.beneficiary)
  expect(original?.textContent).toContain('确认检查点 100')
  expect(getBalance).not.toHaveBeenCalled()
  expect(x.f.client.core.listOwnedObjects).not.toHaveBeenCalled()
  const historicalReads = readTransaction.mock.calls.length

  await click('查询原服务受款地址当前资金')
  expect(host.textContent).toContain('当前 Coin 与地址余额暂不可用')
  expect(host.textContent).toContain('原收款 Coin 当前余额 101')
  expect(host.querySelector('[aria-label="已核验原服务收款"]')?.textContent).toContain(x.packet.digest)
  await click('查询原服务受款地址当前资金')
  expect(host.textContent).toContain('当前 Coin 余额 101 · 地址余额 7 · 币种合计 108')
  expect(readTransaction).toHaveBeenCalledTimes(historicalReads)
  expect(getBalance).toHaveBeenLastCalledWith({ owner: x.review.beneficiary, coinType: normalizeStructTag('0x2::sui::SUI') }, expect.anything())
  expect(m.sign).not.toHaveBeenCalled()
  expect(localStorage.length).toBe(0)
})

it('rejects a foreign Soul and a mismatched service packet on the anonymous route before reading the ledger', async () => {
  const x = await serviceRecoveryCase()
  const ledger = vi.spyOn(x.f.client.ledgerService, 'getServiceInfo')
  m.factory.mockReturnValue(x.f.client)
  m.id = aid(999)
  await render()
  const files = x.files()
  await selectServiceFile(0, files.reviewText)
  await selectServiceFile(1, files.packetText)
  await click('查询原服务收款')
  expect(host.textContent).toContain('原服务审查文件属于另一个 Soul')
  expect(ledger).not.toHaveBeenCalled()

  m.id = x.f.soulId
  await render()
  expect(host.textContent).not.toContain('review.json')
  await selectServiceFile(0, files.reviewText)
  await selectServiceFile(1, JSON.stringify({ ...x.packet, digest: adigest(91) }))
  await click('查询原服务收款')
  expect(host.textContent).toContain('PAID_SERVICE_RECOVERY_PACKET')
  expect(ledger).not.toHaveBeenCalled()
  expect(host.querySelector('[aria-label="已核验原服务收款"]')).toBeNull()
})

it('keeps the original service proof when stopping a current read and ignores late results after file replacement', async () => {
  const x = await serviceRecoveryCase()
  m.id = x.f.soulId
  m.factory.mockReturnValue(x.f.client)
  await render()
  const files = x.files()
  await selectServiceFile(0, files.reviewText)
  await selectServiceFile(1, files.packetText)
  await click('查询原服务收款')
  const getBalance = x.f.client.stateService.getBalance
  const currentBalance = getBalance.getMockImplementation()!
  let finish!: () => void
  getBalance.mockImplementationOnce(async () => {
    await new Promise<void>(resolve => { finish = resolve })
    return currentBalance()
  })
  await click('查询原服务受款地址当前资金')
  await click('停止服务收款查询')
  expect(host.textContent).toContain('已核验的原服务收款仍可查看')
  expect(host.querySelector('[aria-label="已核验原服务收款"]')?.textContent).toContain(x.packet.digest)
  await selectServiceFile(1, files.packetText)
  await act(async () => { finish(); await new Promise(resolve => setTimeout(resolve, 20)) })
  expect(host.querySelector('[aria-label="已核验原服务收款"]')).toBeNull()
  expect(host.querySelector('[aria-label="原服务受款地址当前资金"]')).toBeNull()
  await click('查询原服务收款')
  expect(host.querySelector('[aria-label="已核验原服务收款"]')?.textContent).toContain(x.packet.digest)
})
