'use client'

import React from 'react'
import { useCommittedSession, useSessionState } from '@/lib/hooks/use-committed-session'
import { useWalletSign } from '@/lib/hooks/use-wallet-sign'
import { withPackageObjectIdentity } from '@/lib/sui/package-object-client'
import { publicMutationCanonical } from '@/lib/sui/public-mutation-journal'
import { parseCanonicalNativeWorkbenchTarget, readCanonicalNativeWorkbench, type CanonicalNativeWorkbenchTarget } from '@/lib/soulidity/canonical-native-workbench'
import { CanonicalNativeContentReader } from '@/components/souls/canonical-native-content-reader'

type Props = {
  releaseJson?: string
  savedTarget: CanonicalNativeWorkbenchTarget
  soulId: string
  buyer: string
  digest: string
}

export function PurchaseRecoverySaleDelivery({ releaseJson, savedTarget, soulId, buyer, digest }: Props) {
  let target: CanonicalNativeWorkbenchTarget | null = null
  if (releaseJson) {
    try {
      const configured = parseCanonicalNativeWorkbenchTarget(JSON.parse(releaseJson))
      if (configured.content && configured.custody
        && publicMutationCanonical(configured) === publicMutationCanonical(savedTarget)) target = configured
    } catch { /* Current content requires an exact configured release. */ }
  }

  return <section aria-label="原买家当前内容" className="space-y-2 rounded border p-3">
    <h4 className="font-medium">重开已购 Soul 的内容</h4>
    {target && releaseJson
      ? <CurrentBuyerContent target={target} releaseJson={releaseJson} soulId={soulId} buyer={buyer} digest={digest} />
      : <p>当前内容入口缺少与原文件完全匹配的发布配置。已核验的原付款与资产交接仍可查看。</p>}
  </section>
}

type Directory = NonNullable<Awaited<ReturnType<typeof readCanonicalNativeWorkbench>>['contentDirectory']>

function CurrentBuyerContent({ target, releaseJson, soulId, buyer, digest }: Omit<Props, 'savedTarget' | 'releaseJson'> & {
  target: CanonicalNativeWorkbenchTarget
  releaseJson: string
}) {
  const wallet = useWalletSign()
  const scope = JSON.stringify([releaseJson, soulId, digest, buyer])
  const session = useCommittedSession(scope, wallet.walletAccount, wallet.suiGrpcClient, wallet.currentWallet)
  const [view, setView] = useSessionState(session, {
    directory: null as Directory | null, selected: null as Directory['records'][number] | null,
    pending: false, error: null as string | null,
  })
  const eligible = wallet.suiWallet?.address === buyer && Boolean(wallet.suiGrpcClient)

  async function load(start = 0) {
    const lease = session.capture(), client = wallet.suiGrpcClient
    if (!eligible || !client || !lease?.matches() || lease.isRunning() || wallet.getWalletAddress() !== buyer) return
    const controller = new AbortController()
    lease.requests.add(controller)
    lease.setRunning(true)
    setView({ directory: null, selected: null, pending: true, error: null })
    const current = () => lease.matches() && !controller.signal.aborted && wallet.getWalletAddress() === buyer
    try {
      const result = await readCanonicalNativeWorkbench({
        client: withPackageObjectIdentity(client, controller.signal), target, soulId,
        viewerAddress: buyer, contentStart: start, signal: controller.signal,
      })
      if (!current()) return
      const custody = result.custody
      if (result.soulId !== soulId || !custody?.ownerReadCandidate || !custody.viewerMatchesOwner
        || custody.ownerAddress !== buyer || !custody.accountId || !result.contentDirectory) {
        throw Error('原买家当前未通过此 Soul 的持有人与 Account 核对。')
      }
      setView({ directory: result.contentDirectory, selected: null, pending: false, error: null })
    } catch (error) {
      if (current()) setView({ directory: null, selected: null, pending: false,
        error: error instanceof Error ? error.message : '当前内容目录暂不可用。' })
    } finally {
      lease.requests.delete(controller)
      lease.setRunning(false)
    }
  }

  if (!eligible) return <p>连接原买家钱包后，可以核对当前托管和可读内容。</p>
  const { directory, pending, error, selected } = view
  const records = directory?.records.filter(record => !record.deleted && !record.purged && (BigInt(record.readMask) & 1n) !== 0n) ?? []
  return <>
    <button type="button" disabled={pending} onClick={() => void load()}>核对当前托管和内容目录</button>
    {pending && <p role="status">正在核对当前托管和内容目录…</p>}
    {error && <p role="alert">{error} 已核验的原成交记录仍可查看。</p>}
    {directory && <>
      {records.length === 0 && <p>本页没有当前持有人可读的内容版本。</p>}
      <ul>{records.map(record => <li key={record.index}>
        <button type="button" aria-pressed={selected?.index === record.index} onClick={() => setView({ ...view, selected: record })}>
          {record.kind === 0 ? 'Soul 原文' : record.kind === 1 ? '记忆' : '内容'} {record.name} · 版本 {record.version} · 记录 {record.index}
        </button>
      </li>)}</ul>
      {directory.start > 0 && <button type="button" onClick={() => void load(Math.max(0, directory.start - 25))}>上一页内容</button>}
      {directory.nextStart !== null && <button type="button" onClick={() => void load(directory.nextStart!)}>下一页内容</button>}
    </>}
    {selected && <CanonicalNativeContentReader
      key={JSON.stringify([scope, selected.index, selected.version, selected.ciphertextHash])}
      sourceKey={scope} soulId={soulId} index={Number(selected.index)} releaseJson={releaseJson}
      requiredViewerAddress={buyer} expectedRecord={{ version: selected.version, ciphertextHash: selected.ciphertextHash }}
    />}
  </>
}
