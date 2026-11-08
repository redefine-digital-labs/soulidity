'use client'

import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { bindNativePublicReadPaidOriginalOutcomeV2 } from '../../lib/soulidity/commerce/native-public-read-paid-original-outcome-v2'
import { PurchaseRecoveryPaidContent } from './purchase-recovery-paid-content'
import { PaidIncomeReconciliation } from './paid-income-reconciliation'
import { PurchaseRecoveryFunds } from './purchase-recovery-funds'

type Request = Parameters<typeof bindNativePublicReadPaidOriginalOutcomeV2>[0]
type Bound = Extract<Awaited<ReturnType<typeof bindNativePublicReadPaidOriginalOutcomeV2>>, { status: 'ORIGINAL_MONEY_BOUND' }>

/** Actual parent original history remains the authority for historical money.
 * Current funds and the optional wallet-backed content open remain separate actions.
 */
export function NativePublicReadPaidOriginalOutcomeV2({ record, history, client, publicReadReleaseJson }: Request & { client: SuiGrpcClient; publicReadReleaseJson?: string }) {
  const scope = JSON.stringify([record, history], (_key, value) => typeof value === 'bigint' ? { bigint: String(value) } : value)
  const current = useRef({ scope, client })
  useLayoutEffect(() => { current.current = { scope, client } }, [scope, client])
  const serial = useRef(0), [state, setState] = useState({ scope, client, bound: null as Bound | null, error: null as string | null })
  useEffect(() => {
    const id = ++serial.current
    const valid = () => serial.current === id && current.current.scope === scope && current.current.client === client
    const publish = (bound: Bound | null, error: string | null) => setState(previous => valid() ? { scope, client, bound, error } : previous)
    publish(null, null)
    void bindNativePublicReadPaidOriginalOutcomeV2({ record, history }).then(result => publish(result.status === 'ORIGINAL_MONEY_BOUND' ? result : null, null))
      .catch(error => publish(null, error instanceof Error ? error.message : '原收款证据尚未核对完成。'))
    return () => { serial.current++ }
  }, [scope, client])
  const visible = state.scope === scope && state.client === client ? state : null, bound = visible?.bound
  if (visible?.error) return <p role="alert">原收款衔接未完成：{visible.error}。保留原件；这不改变原查询结果，也不表示可以重新付款。</p>
  if (!bound) return null
  return <section aria-label="本机原购买收款与当前资金" className="space-y-4">
    <article aria-label="本机原购买资金变化" className="space-y-2 break-all">
      <h3>原购买资金变化</h3>
      <p>原确认检查点：{bound.query.history.checkpoint}</p>
      <p>原购买总额（最小单位）：{bound.money.buyerGrossDebit} · 币种：{bound.money.coinType}</p>
      <p>原内容直接收款：{bound.money.payout.amount} · 受款地址：{bound.money.payout.owner}</p>
      <p>原协议收入增加（最小单位）：{bound.money.protocolIncome}</p>
      <p>原 Gas 净费用（SUI 最小单位）：{bound.money.netGasCharge}</p>
      <p>这些是原交易核验的资金变化。原订阅完整业务证明与当前内容访问仍需分别核对。</p>
    </article>
    {bound.original.kind === 'native-public-read-v2' && <PurchaseRecoveryPaidContent original={bound.original.value}
      history={bound.query.history} releaseJson={publicReadReleaseJson} client={client}/>}
    <PurchaseRecoveryFunds original={bound.query} record={bound.original} client={client}/>
    {bound.money.protocolIncome !== '0' && <PaidIncomeReconciliation soulId={record.plan.soulId}
      purchaseText={record.plan.originalText} client={client}/>}
  </section>
}
