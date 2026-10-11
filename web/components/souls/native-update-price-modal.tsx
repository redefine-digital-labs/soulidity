'use client'

import type { ChainSoulDetail } from '@/lib/soulidity/soul-detail-model'

import { useState } from 'react'
import { formatAtomicAmountForDisplay, parseDisplayAmountToAtomic } from '@soulidity/sdk'
import { Modal } from '@/components/ui/modal'
import { Button } from '@/components/ui/button'
import { useNativeMarketListActions } from '@/lib/hooks/use-native-market-list-actions'
import { NativeListingRecovery } from './native-listing-recovery'
import { NativeListingQuote } from './native-listing-quote'

export function NativeUpdatePriceModal({soul,open,onClose}:{soul:ChainSoulDetail;open:boolean;onClose:()=>void}) {
  const actions=useNativeMarketListActions({soulId:soul.onChainId,stateId:soul.stateOnChainId,listingId:soul.listingObjectOnChainId??null})
  const [price,setPrice]=useState('')
  const formScope = soul.onChainId
  const [previousFormScope, setPreviousFormScope] = useState(formScope)
  if (previousFormScope !== formScope) { setPreviousFormScope(formScope); setPrice('') }
  let priceAtomic:bigint|null=null,priceError:string|null=null
  if(price.trim())try {priceAtomic=parseDisplayAmountToAtomic(price);if(priceAtomic<=0n)priceError='Listing price must be greater than 0'}
  catch(cause){priceError=cause instanceof Error?cause.message:'Invalid amount'}
  if(priceAtomic!=null && priceAtomic>18446744073709551615n)priceError='Listing price exceeds the supported maximum'
  const snapshot=actions.snapshot
  const samePrice=priceAtomic!=null && snapshot?.priceAtomic!=null && priceAtomic===BigInt(snapshot.priceAtomic)
  return <Modal open={open} onClose={onClose} maxWidth="sm" title="Update Listing Price" subtitle={soul.name} className="max-h-[calc(100dvh-2rem)] overflow-y-auto">
    {snapshot?.priceAtomic && <div className="rounded-xl border border-border bg-card2/60 px-4 py-3 mb-4">
      <p className="text-[10px] font-bold text-muted uppercase tracking-[0.1em] mb-1">Current Price</p>
      <p className="text-lg font-bold text-gold">{formatAtomicAmountForDisplay(snapshot.priceAtomic)}</p>
    </div>}
    <div className="mb-4">
      <label htmlFor="native-listing-price" className="block text-[10px] font-bold text-muted uppercase tracking-[0.1em] mb-1.5">New Price (USDC)</label>
      <input id="native-listing-price" type="text" inputMode="decimal" value={price} onChange={event=>setPrice(event.target.value)} disabled={actions.busy}
        placeholder="0.00" className="w-full rounded-lg border border-border bg-card2 px-3 py-2.5 text-sm text-foreground placeholder:text-muted/50 outline-none focus:border-gold disabled:opacity-40" />
      {priceError && <p role="alert" className="mt-1 text-xs text-danger">{priceError}</p>}
      {samePrice && <p className="mt-1 text-xs text-muted">Same as current price</p>}
    </div>
    <NativeListingQuote snapshot={snapshot} priceAtomic={priceAtomic}/>
    <p className="text-[11px] text-muted my-5">This cancels the old listing and creates a new listing in one transaction. If it fails, the old listing remains unchanged.</p>
    {!actions.canReprice && <p className="text-xs text-muted mb-3">{snapshot?.equipmentId
      ? 'Remove equipped components and close the empty equipment setup on the Soul page before listing.'
      : !snapshot ? 'Refresh the current listing before signing. Saved transactions remain recoverable below.'
      : !snapshot.release.writesEnabled ? 'Native market signing is not enabled for this release.'
      : 'A price update requires the current owner, an available active listing and no pending saved request.'}</p>}
    <Button variant="gold" full disabled={!actions.canReprice||priceAtomic==null||!!priceError||samePrice}
      onClick={()=>{if(priceAtomic!=null)void actions.start(priceAtomic,'reprice')}}>
      {actions.busy?'Checking transaction…':'Update Price'}
    </Button>
    <NativeListingRecovery actions={actions}/>
  </Modal>
}
