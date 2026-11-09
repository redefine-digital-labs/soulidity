'use client'

import React, { lazy, Suspense, useLayoutEffect, useRef, useState } from 'react'
import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { parseCanonicalNativeWorkbenchTarget } from '../../lib/soulidity/canonical-native-workbench'
import { nativePublicOwnerSourceKeyV2, readNativePublicReadOverviewV2, readNativePublicReadRecordV2 } from '../../lib/soulidity/native-public-read-record-v2'
import { paidContentScopeCovers } from '../../lib/soulidity/commerce/paid-content-policy'
import type { PurchaseRecoveryOriginal, PurchaseRecoveryQuery } from '../../lib/soulidity/commerce/purchase-recovery-original'
const NativePublicPaidContentReaderV2 = lazy(() => import('../souls/native-public-paid-content-reader-v2')
  .then(module => ({ default: module.NativePublicPaidContentReaderV2 })))

type Original = Extract<PurchaseRecoveryOriginal, { kind: 'native-public-read-v2' }>['value']
type History = Extract<Extract<PurchaseRecoveryQuery, { kind: 'native-public-read-v2' }>['history'], { status: 'SUBSCRIPTION_RECORDED' }>
type Overview = Awaited<ReturnType<typeof readNativePublicReadOverviewV2>>
type Version = Overview['recordSummaries'][number]
type Selection = { record: Version; sourceKey: string; soulId: string; ownerAddress: string }
type Request = { recordStart: number } | { recordIndex: number; namespace?: string }

function selectionOf(view: Pick<Overview, 'soulId' | 'ownerAddress' | 'reception' | 'hostReference' | 'kioskReference' | 'libraryReference'>,
  record: Version): Selection {
  return { record, sourceKey: nativePublicOwnerSourceKeyV2(view, record), soulId: view.soulId, ownerAddress: view.ownerAddress }
}

export function PurchaseRecoveryPaidContent({ original, history, releaseJson, client }: {
  original: Original
  history: History
  releaseJson?: string
  client: SuiGrpcClient
}) {
  const digest = original.packet.digest, context = original.context.originalReceiptContext
  if (!releaseJson || !history.receipt.money || history.receipt.transactionDigest !== digest
    || history.receipt.money.transactionDigest !== digest || history.receipt.soulId !== context.soulId
    || history.receipt.hostId !== original.intent.host.objectId || history.receipt.ledgerId !== context.ledgerId) return null
  return <PaidContentVersions key={JSON.stringify([digest, releaseJson])}
    original={original} purchasedScope={history.receipt.entry.scope} releaseJson={releaseJson} client={client}/>
}

function PaidContentVersions({ original, purchasedScope, releaseJson, client }: {
  original: Original; purchasedScope: string; releaseJson: string; client: SuiGrpcClient
}) {
  const active = useRef<AbortController | null>(null)
  const [overview, setOverview] = useState<Overview | null>(null)
  const [selected, setSelected] = useState<Selection | null>(null)
  const [recordStart, setRecordStart] = useState(0)
  const [indexInput, setIndexInput] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useLayoutEffect(() => {
    // Clear the old client's content selection before allowing a new read.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOverview(null); setSelected(null); setRecordStart(0); setIndexInput(''); setPending(false); setError(null)
    return () => { active.current?.abort(); active.current = null }
  }, [client])

  const covers = (record: Version) => record.kind === original.intent.kind && !record.deleted && !record.purged
    && (BigInt(record.readMask) & 4n) !== 0n && paidContentScopeCovers(BigInt(purchasedScope), BigInt(record.scope))

  async function load(selection: Request) {
    if (active.current) return
    const request = new AbortController()
    active.current = request
    if ('recordStart' in selection) setRecordStart(selection.recordStart)
    else setIndexInput(String(selection.recordIndex))
    setPending(true); setSelected(null); setOverview(null); setError(null)
    try {
      const target = parseCanonicalNativeWorkbenchTarget(JSON.parse(releaseJson))
      const previous = original.context.target
      if (target.chainIdentifier !== previous.chainIdentifier || target.configId !== previous.configId
        || target.registryId !== previous.registryId || target.standard.originalPackageId !== previous.standard.originalPackageId
        || target.native.originalPackageId !== previous.native.originalPackageId
        || target.content?.originalPackageId !== previous.content?.originalPackageId) {
        throw Error('当前发布与原订阅的来源不一致。')
      }
      const input = { client, target, soulId: original.context.originalReceiptContext.soulId, signal: request.signal }
      const current = () => active.current === request && !request.signal.aborted
      function requireSameHost(view: Pick<Overview, 'hostId'>) {
        if (view.hostId !== original.intent.host.objectId) throw Error('当前内容库与原订阅的 Host 不一致。')
      }
      if ('recordStart' in selection) {
        const view = await readNativePublicReadOverviewV2({ ...input, recordStart: selection.recordStart })
        if (!current()) return
        requireSameHost(view)
        setOverview(view)
      } else {
        const view = await readNativePublicReadRecordV2({ ...input, recordIndex: selection.recordIndex })
        if (!current()) return
        requireSameHost(view)
        const r = view.record
        const record = { index: view.recordIndex, name: r.name, kind: r.kind, version: r.version, scope: r.scope,
          readMask: r.read_mask, deleted: r.deleted, purged: r.purged }
        if (!covers(record)) throw Error('此版本不在原订阅的内容类型、范围或付费读取策略内。')
        if (selection.namespace !== undefined && view.namespace !== selection.namespace) throw Error('此索引与原购买的内容 namespace 不一致。')
        setSelected(selectionOf(view, record))
      }
    } catch (cause) {
      if (active.current === request && !request.signal.aborted) setError(cause instanceof Error ? cause.message : '当前内容库无法核对。')
    } finally {
      if (active.current === request) { active.current = null; setPending(false) }
    }
  }
  const versions = overview?.recordSummaries.filter(covers) ?? []
  const index = /^(0|[1-9][0-9]{0,3})$/.test(indexInput) && Number(indexInput) < 4096 ? Number(indexInput) : null
  const guard = original.intent.recordGuard

  return <section aria-label="原订阅内容交付" className="space-y-2 rounded-xl border p-4">
    <h3 className="font-semibold">读取原订阅覆盖的当前内容</h3>
    <p>原交易证明订阅的内容类型和范围。选择此 Soul 的当前版本后，原买家钱包还需核对现有资格并请求 Seal 解密。</p>
    <button type="button" disabled={pending} onClick={() => void load({ recordStart })}>查找原订阅覆盖的当前版本</button>
    <div className="flex flex-wrap items-end gap-2">
      <label>内容记录索引（0–4095）
        <input className="block rounded border bg-background p-1" inputMode="numeric" maxLength={4} disabled={pending}
          value={indexInput} onChange={event => setIndexInput(event.currentTarget.value)}/>
      </label>
      <button type="button" disabled={pending || index === null} onClick={() => { if (index !== null) void load({ recordIndex: index }) }}>核对指定版本索引</button>
      {guard && <button type="button" disabled={pending} onClick={() => void load({ recordIndex: guard.index, namespace: guard.namespace })}>核对原购买版本</button>}
    </div>
    {pending && <p role="status">正在核对当前内容库…</p>}
    {error && <p role="alert">{error} 原付款记录仍可查询和下载。</p>}
    {overview && <>
      {versions.length ? <label>原订阅适用版本<select aria-label="原订阅适用版本" value={selected?.record.index ?? ''} onChange={event => {
        const record = versions.find(version => String(version.index) === event.currentTarget.value)
        setSelected(record ? selectionOf(overview, record) : null)
      }}>
        <option value="">选择版本</option>
        {versions.map(version => <option key={version.index} value={version.index}>索引 {version.index} · {version.name} · 版本 {version.version} · 范围 {version.scope}</option>)}
      </select></label> : <p>本页没有符合原订阅类型、范围和付费读取策略的当前版本。</p>}
      <nav aria-label="原订阅内容分页" className="flex gap-2">
        <button type="button" disabled={overview.recordStart === 0} onClick={() => void load({ recordStart: Math.max(0, overview.recordStart - 25) })}>上一页版本</button>
        <button type="button" disabled={overview.nextRecordStart === null} onClick={() => { if (overview.nextRecordStart !== null) void load({ recordStart: overview.nextRecordStart }) }}>下一页版本</button>
      </nav>
    </>}
    {selected && !overview && <p role="status">已核对索引 {selected.record.index} · {selected.record.name} · 版本 {selected.record.version} · 范围 {selected.record.scope}</p>}
    {selected && <Suspense fallback={<p role="status">正在加载内容读取器…</p>}><NativePublicPaidContentReaderV2 key={selected.sourceKey} soulId={selected.soulId} index={selected.record.index}
      releaseJson={releaseJson} sourceKey={selected.sourceKey} expectedOwnerSourceKey={selected.sourceKey} ownerAddress={selected.ownerAddress}
      paidRecovery={{ original, client, scope: selected.record.scope, kind: selected.record.kind }}/></Suspense>}
  </section>
}
