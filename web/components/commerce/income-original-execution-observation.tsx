'use client'
import React from 'react'
import { publicMutationCanonical } from '../../lib/sui/public-mutation-journal'
import type { incomeOriginalExecutionFacts } from '../../lib/soulidity/commerce/income-original-execution-facts'

/** Export authenticated original execution independently of business receipt
 * qualification. Importing this observation never installs source/model trust.
 */
export function IncomeOriginalExecutionObservation({ observation }: { observation: {
  status: 'FINALIZED_EXECUTION'; qualification: unknown; original: ReturnType<typeof incomeOriginalExecutionFacts>
} }) {
  const original = observation.original
  const text = publicMutationCanonical({ schema: 'soulidity.income-original-execution-observation.v1',
    status: observation.status, qualification: observation.qualification, original, completeBusinessOutputVerified: false })
  return <article aria-label="原交易执行事实" className="space-y-1 break-all text-sm">
    <p>原交易执行已确认：检查点 {original.checkpoint}，Epoch {original.epoch}。</p>
    <p>交易：{original.transactionDigest}</p>
    {original.decodedEvents.status === 'DECODED_UNQUALIFIED' && <p>已解码事件数：{original.decodedEvents.events.length}；事件含义与提款交付尚未完成核验。</p>}
    <a download={`income-original-execution-${original.transactionDigest}.json`} href={`data:application/json;charset=utf-8,${encodeURIComponent(text)}`}>下载原交易执行事实</a>
    <p>包含本次查询的原交易、执行结果和事件字节；不证明提款到账，不改变本机原件或来源资格。</p>
  </article>
}
