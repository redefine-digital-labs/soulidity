'use client'

import { useLayoutEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Modal } from '@/components/ui/modal'
import type { usePaidAccess } from '@/lib/hooks/use-paid-access'
import type { ChainSoulDetail } from '@/lib/soulidity/soul-detail-model'
import type { SoulAccessPlan } from '@/lib/soulidity/soul-access-plan'

export function accessUsdc(atomic: string) {
  const amount = BigInt(atomic), fraction = (amount % 1000000n).toString().padStart(6, '0').replace(/0+$/, '')
  return `${amount / 1000000n}${fraction ? `.${fraction}` : ''} USDC`
}
function priceAtomic(value: string) {
  if (!/^(0|[1-9][0-9]*)(\.[0-9]{1,6})?$/.test(value)) throw new Error('Enter a USDC price with at most 6 decimal places')
  const [whole, fraction = ''] = value.split('.')
  const result = BigInt(whole) * 1000000n + BigInt(fraction.padEnd(6, '0'))
  if (result > 18446744073709551615n) throw new Error('Price exceeds the contract limit')
  return result.toString()
}
export function PaidAccessQuote({ plan }: { plan: SoulAccessPlan }) {
  const q = plan.quote
  return <div className="space-y-2 text-xs">
    <p>Kind {plan.kind} · {plan.input.renew ? 'Explicit renewal' : 'New purchase'}</p>
    <p>Price: {accessUsdc(q.priceAtomic)} · Platform fee: {accessUsdc(q.feeAtomic)}</p>
    <p className="font-semibold">Total: {accessUsdc(q.totalAtomic)} + Sui network gas</p>
    <p>Duration: {q.durationMs === null ? 'No scheduled expiry' : `${q.durationMs} ms from execution, or added to the remaining same-epoch term`}</p>
    <p className="break-all">Price recipient: {plan.currentOwner}</p>
    <p className="break-all">Fee recipient: {q.feeRecipient}</p>
    <p className="text-danger">The owner can revoke access at any time without an on-chain refund. A Soul ownership change invalidates the entry. This buys read access, not the Soul or its copyright.</p>
  </div>
}

export function PaidAccessControls({ soul, canManage, access }: {
  soul: ChainSoulDetail; canManage: boolean; access: ReturnType<typeof usePaidAccess>
}) {
  const [kindText, setKindText] = useState('3'), [price, setPrice] = useState(''), [duration, setDuration] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const [quote, setQuote] = useState<{ plan: SoulAccessPlan; identity: string } | null>(null)
  const identity = useRef(access.identityKey)
  useLayoutEffect(() => { identity.current = access.identityKey }, [access.identityKey])
  const pending = access.pending !== null
  const formScope = access.identityKey
  const [previousFormScope, setPreviousFormScope] = useState(formScope)
  if (previousFormScope !== formScope) { setPreviousFormScope(formScope); setQuote(null); setFormError(null) }
  async function configure() {
    const started = identity.current
    setFormError(null)
    try {
      if (!/^(0|[1-9][0-9]*)$/.test(kindText) || BigInt(kindText) > 0xffffffffn) throw new Error('Enter a valid content kind ID')
      if (duration !== '' && (!/^(0|[1-9][0-9]*)$/.test(duration) || BigInt(duration) > 18446744073709551615n))
        throw new Error('Duration must be an exact non-negative number of milliseconds, or blank for no expiry')
      const kind = Number(kindText)
      await access.configurePaidAccess(kind, priceAtomic(price), duration || null, soul.paidAccessKindConfigs.some(c => c.kind === kind))
    } catch (e) { if (identity.current === started) setFormError(e instanceof Error ? e.message : 'Pricing failed') }
  }
  async function purchase(kind: number, renew: boolean) {
    setQuote(null); setFormError(null)
    const started = identity.current
    try { const plan = await access.preparePurchase(kind, renew); if (identity.current === started) setQuote({ plan, identity: started }) }
    catch (e) { if (identity.current === started) setFormError(e instanceof Error ? e.message : 'Quote unavailable') }
  }
  const shownQuote = quote?.identity === access.identityKey ? quote.plan : null
  return <div className="mb-4 space-y-3" data-paid-access-controls>
    {canManage && <div className="space-y-2 rounded-lg border border-[var(--border-soft)] p-3 text-xs">
      <h4 className="font-semibold">Configure paid read access</h4>
      <label className="block">Content kind ID<input aria-label="Paid content kind" inputMode="numeric" value={kindText} onChange={e => setKindText(e.target.value)} className="sd-grant-input" /></label>
      <label className="block">Price in USDC<input aria-label="Paid price USDC" inputMode="decimal" value={price} onChange={e => setPrice(e.target.value)} className="sd-grant-input" /></label>
      <label className="block">Duration in milliseconds (blank: no expiry)<input aria-label="Paid duration milliseconds" inputMode="numeric" value={duration} onChange={e => setDuration(e.target.value)} className="sd-grant-input" /></label>
      <p className="text-muted">The chain registry must allow paid reads for this kind. Zero price disables purchases; zero duration adds no time. Updating or removing a price does not revoke existing buyer entries.</p>
      <Button size="sm" variant="primary" disabled={pending} onClick={() => void configure()}>Save pricing</Button>
    </div>}
    {soul.paidAccessKindConfigs.filter(c => canManage || c.currentEpoch).map(config => {
      const owned = soul.paidAccessEntries.find(e => e.buyerAddress === access.author && e.kind === config.kind && e.currentEpoch)
      const lifetime = owned?.expiresAtMs === null, renew = Boolean(owned)
      return <div key={config.id} className="flex flex-wrap items-center gap-2 text-xs">
        <span>Kind {config.kind}{!config.currentEpoch ? ' · previous owner epoch' : ''}</span>
        {canManage ? <>
          <Button size="sm" variant="outline" disabled={pending} onClick={() => {
            setKindText(String(config.kind)); setPrice(accessUsdc(config.priceAtomic).replace(' USDC', '')); setDuration(config.durationMs ?? '')
          }}>Edit pricing</Button>
          <Button size="sm" variant="outline" disabled={pending} onClick={() => void access.deletePaidAccess(config.kind).catch(() => {})}>Remove pricing</Button>
        </> : <Button size="sm" variant="primary" disabled={pending || !access.author || lifetime || BigInt(config.priceAtomic) === 0n}
          onClick={() => void purchase(config.kind, renew)}>{lifetime ? 'No-expiry access held' : renew ? 'Review renewal' : 'Review purchase'}</Button>}
      </div>
    })}
    {formError && <p role="alert" className="text-xs text-danger">{formError}</p>}
    <Modal open={shownQuote !== null} onClose={() => { if (!pending) setQuote(null) }} title="Confirm paid access" maxWidth="md">
      {shownQuote && <>
        <PaidAccessQuote plan={shownQuote} />
        <p className="mt-3 text-xs text-muted">This exact price and payment are frozen. Configuration changes reject this attempt; they never silently raise the charge.</p>
        {access.error && <p role="alert" className="mt-2 text-xs text-danger">{access.error}</p>}
        <div className="mt-4 flex gap-2">
          <Button variant="outline" disabled={pending} onClick={() => setQuote(null)}>Close quote</Button>
          <Button variant="primary" disabled={pending} onClick={() => void access.execute(shownQuote).then(() => setQuote(null)).catch(() => {})}>Confirm {accessUsdc(shownQuote.quote.totalAtomic)}</Button>
        </div>
      </>}
    </Modal>
  </div>
}
