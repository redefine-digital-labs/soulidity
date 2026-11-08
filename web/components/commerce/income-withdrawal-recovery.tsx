'use client'

import React, { useLayoutEffect, useRef } from 'react'
import { useCommittedSession, useSessionState } from '../../lib/hooks/use-committed-session'
import { createConfiguredIncomeOriginalExecutionRegistry } from '../../lib/soulidity/configured-income-entry'
import type { IncomeExecutionRegistryV1 } from '../../lib/soulidity/commerce/income-execution-source-v1'
import { IncomeOriginalExecutionObservation } from './income-original-execution-observation'
import {IncomeWithdrawalAddressFunds} from './income-withdrawal-address-funds'
import type { SuiGrpcClient } from '@mysten/sui/grpc'
import type { PublicMutationPacket } from '../../lib/sui/public-mutation-journal'
import { readEconomicsIncome, type EconomicsTarget } from '../../lib/soulidity/commerce/economics-read'
import { readIncomeWithdrawalHistory, type WithdrawalIntent } from '../../lib/soulidity/commerce/income-withdrawal-history'
import {createIncomeWithdrawalRecoveryRecord,exportIncomeWithdrawalRecoveryRecord} from '../../lib/soulidity/commerce/income-withdrawal-recovery-record'
import { readCommerceOwnedCoinInventory } from '../../lib/soulidity/commerce/owned-coin-inventory'
import { readCommercePayoutCoins } from '../../lib/soulidity/commerce/payout-coins'

type History = Awaited<ReturnType<typeof readIncomeWithdrawalHistory>>
type Income = Awaited<ReturnType<typeof readEconomicsIncome>>
type Outcome<T> = { value: T; error?: never } | { error: string; value?: never } | null
type Payouts = Awaited<ReturnType<typeof readCommercePayoutCoins>>
type Inventory = Awaited<ReturnType<typeof readCommerceOwnedCoinInventory>>
interface View { qualificationError?:string|null; stopped?:boolean; client: unknown; scope: string; pending: boolean; history: Outcome<History>; income: Outcome<Income>; payouts: Outcome<Payouts>; inventory: Outcome<Inventory> }

/** Query-only consumer for an existing durable original record. Original
 * payout proof and latest protocol funds are independent observations. A
 * missing/failed/unknown query never authorizes a replacement withdrawal.
 */
export function IncomeWithdrawalRecovery({ client, target, packet, intent, viewerAddress, executionRegistry }: {
  client: SuiGrpcClient | ((signal: AbortSignal) => SuiGrpcClient); target: EconomicsTarget;
  packet: PublicMutationPacket; intent: WithdrawalIntent; viewerAddress: string | null; executionRegistry?: IncomeExecutionRegistryV1
}) {
  const scope = JSON.stringify([target, packet, intent])
  const session = useCommittedSession(scope, viewerAddress, client, executionRegistry)
  const serial = useRef(0), active = useRef<AbortController | null>(null)
  const empty: View = { client, scope, pending: false, history: null, income: null, payouts: null, inventory: null }
  const [state, setState] = useSessionState(session, empty)
  useLayoutEffect(() => () => { serial.current++; active.current?.abort() }, [session])
  function stopQuery(){
    if(!session.matches())return
    serial.current++;active.current?.abort()
    setState(before=>before.scope===scope&&before.client===client?{...before,pending:false,stopped:true}:before)
  }
  async function refresh() {
    if(!session.matches())return
    active.current?.abort(); const controller = new AbortController(); active.current = controller
    const selected = scope, request = ++serial.current, frozen = structuredClone({ target, packet, intent })
    setState({ client, scope: selected, pending: true, history: null, income: null, payouts: null, inventory: null })
    let reader: SuiGrpcClient
    try { reader = typeof client === 'function' ? client(controller.signal) : client }
    catch (error) { setState({ client, scope: selected, pending: false, history: { error: error instanceof Error ? error.message : '读取服务暂不可用。' }, income: null, payouts: null, inventory: null }); return }
    const valid=()=>!controller.signal.aborted&&serial.current===request&&session.matches()
    const publish=(patch:Partial<View>)=>{if(valid())setState(before=>valid()&&before.scope===selected&&before.client===client?{...before,...patch}:before)}
    const observe=async<T,>(work:()=>Promise<T>,update:(result:Outcome<T>)=>Partial<View>):Promise<Outcome<T>>=>{
      let result:Outcome<T>
      try{result={value:await work()}}catch(error){result={error:error instanceof Error?error.message:'查询未完成，请重试原查询。'}}
      publish(update(result));return result
    }
    const configuredRegistry=executionRegistry?{registry:executionRegistry,error:null}:createConfiguredIncomeOriginalExecutionRegistry()
    publish({qualificationError:configuredRegistry.error})
    const originalTask=async()=>{
      const original=await observe(()=>readIncomeWithdrawalHistory({client:reader,...frozen,signal:controller.signal,executionRegistry:configuredRegistry.registry}),history=>({history}))
      if(!valid()||original?.value?.status!=='WITHDRAWAL_EVIDENCE_CONFIRMED'||original.value.receipt.receipt.recipient!==viewerAddress)return
      const receipt=original.value.receipt
      await Promise.all([
        observe(()=>readCommercePayoutCoins({client:reader,owner:receipt.receipt.recipient,coinType:receipt.coinType,
          payouts:[{coinId:receipt.paymentCoinId,amount:receipt.receipt.amount}],getViewerAddress:()=>valid()?viewerAddress:null,signal:controller.signal}),payouts=>({payouts})),
        observe(()=>readCommerceOwnedCoinInventory({client:reader,owner:receipt.receipt.recipient,coinType:receipt.coinType,
          getViewerAddress:()=>valid()?viewerAddress:null,signal:controller.signal}),inventory=>({inventory})),
      ])
    }
    await Promise.all([
      originalTask(),
      observe(()=>readEconomicsIncome({client:reader,target:frozen.target,signal:controller.signal}),income=>({income})),
    ])
    publish({pending:false})
  }
  const view = state
  const history = view.history?.value, income = view.income?.value
  const confirmed = history?.status === 'WITHDRAWAL_EVIDENCE_CONFIRMED' ? history : null
  let portable:string|null=null
  try{portable=exportIncomeWithdrawalRecoveryRecord(createIncomeWithdrawalRecoveryRecord({target,packet,intent}))}catch{/* Existing original queries remain independent of optional portable export. */}
  return <section aria-label="原提款恢复" className="space-y-3 rounded-xl border p-4">
    <h3 className="font-medium">原提款记录</h3>
    <p className="break-all text-sm">交易：{packet.digest}</p>
    <button type="button" disabled={view.pending} onClick={() => void refresh()} className="rounded border px-3 py-1">查询原提款与协议余额</button>
    {portable&&<div className="space-y-1 text-sm"><a download={`income-withdrawal-${packet.digest}.json`} href={`data:application/json;charset=utf-8,${encodeURIComponent(portable)}`}>下载原提款恢复文件</a><p>文件保留原交易字节、身份和状态；不包含本次查询结果或当前余额。请自行保存文件，关闭页面后可在原提款恢复页重新导入。下载不代表提款已确认或可以重新提款。</p></div>}
    {view.pending && <><p role="status">正在核对原提款和当前协议余额…</p><button type="button" onClick={stopQuery}>停止本次查询</button></>}
    {view.stopped&&<p role="status">本次查询已停止，已显示结果保留供核对；未完成结果仍未知。这没有取消链上提款，也不授权重新提款。可继续查询同一原交易。</p>}
    {view.qualificationError && <p role="alert">{view.qualificationError}</p>}
    {view.history?.error && <p role="alert">原提款证据查询未完成：{view.history.error}。保留原记录，暂不重新提款。</p>}
    {history && !confirmed && <p>{history.status === 'FAILED' ? '原提款交易已失败。请核对失败原因与最新账本，再决定新操作。'
      : history.status === 'FINALIZED_EXECUTION' ? '原交易已终局执行成功，但来源或执行模型尚未获资格，提款到账证据尚未确认。请保留原记录并继续核验，不能据此重新提款。'
      : history.status === 'PENDING' ? '原提款仍待确认，请继续查询，暂不重新提款。'
        : '尚未查到原提款；这不表示可以重新提款，请保留原记录并继续查询。'}</p>}
    {history?.status === 'FINALIZED_EXECUTION' && <IncomeOriginalExecutionObservation observation={history}/>}
    {confirmed && <article aria-label="原提款资金证据" className="space-y-1 break-all text-sm">
      <p>原提款的账本变化、收款 Coin 和 Gas 已核验。</p>
      <p>收款人：{confirmed.receipt.receipt.recipient}</p>
      <p>已支付金额（最小单位）：{confirmed.receipt.receipt.amount}</p>
      <p>币种：{confirmed.receipt.coinType}</p>
      <p>原收款 Coin：{confirmed.receipt.paymentCoinId}</p>
      {confirmed.receipt.gas?.netGasCharge!==undefined&&<p>原 Gas 净费用（SUI 最小单位）：{confirmed.receipt.gas.netGasCharge}</p>}
      <p>原交易后协议余额：{confirmed.receipt.receipt.balance}</p>
      <p>确认检查点：{confirmed.checkpoint}</p>
      <p>以上证明原交易支付，不代表收款人当前钱包余额。</p>
    </article>}
    {confirmed&&<IncomeWithdrawalAddressFunds original={confirmed} client={client} viewerAddress={viewerAddress}/>}
    {view.income?.error && <p role="alert">当前协议余额查询未完成：{view.income.error}</p>}
    {view.payouts?.error && <p role="alert">原收款 Coin 现状查询未完成：{view.payouts.error}</p>}
    {view.payouts?.value && <article aria-label="原收款 Coin 现状" className="space-y-1 text-sm">
      {view.payouts.value.observations.map(coin => <p key={coin.coinId}>{coin.status === 'CURRENTLY_OWNED'
        ? `原收款 Coin 当前仍由收款钱包持有；该 Coin 当前余额（最小单位）：${coin.currentCoinBalance}`
        : coin.status === 'OTHER_OWNER' ? '原收款 Coin 当前已不属于收款钱包。'
          : '原收款 Coin 当前不可查询；不能据此认定余额为零或原提款失败。'}</p>)}
      <p>Coin 可能已合并、拆分或转出；此处不代表钱包总余额，也不追踪原收入剩余金额。</p>
    </article>}
    {view.inventory?.error && <p role="alert">当前收款钱包 Coin 对象查询未完成：{view.inventory.error}。不据此认定余额为零或原提款失败。</p>}
    {view.inventory?.value && <article aria-label="当前收款钱包 Coin 对象" className="space-y-1 break-all text-sm">
      <p>当前收款钱包 Coin 对象合计（最小单位）：{view.inventory.value.observedCoinBalance}</p>
      <p>币种：{view.inventory.value.coinType} · Coin 对象数：{view.inventory.value.coins.length}</p>
      <p>仅统计本次核对的 Coin 对象，不包含地址余额等其他资金形式，不代表钱包总余额；也不追踪本次提款收入还剩多少。</p>
      <p>此合计不代表协议可提款额度，不授权重新提款。</p>
    </article>}
    {income && <article aria-label="当前协议余额" className="space-y-1 break-all text-sm">
      <p>当前协议余额（最小单位）：{income.ledger.balance}</p>
      <p>币种：{income.coinType}</p><p>账本版本：{income.ledger.revision} · 对象版本：{income.object.version}</p>
      <p>累计收入：{income.ledger.collected} · 累计提款：{income.ledger.withdrawn}</p>
      <p>协议余额不代表当前钱包可提款额度；作者和卖方的直接收款不在此账本中。</p>
    </article>}
  </section>
}
