'use client'

import { useLayoutEffect, useRef, useState } from 'react'
import { useCurrentAccount, useCurrentWallet, useSignPersonalMessage, useSuiClient } from '@mysten/dapp-kit'
import type { SealCompatibleClient } from '@mysten/seal'
import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { toHex } from '@mysten/sui/utils'
import { Button } from '@/components/ui/button'
import type { EquipmentSnapshot } from '@/lib/animacraft/equipment-operation'
import { completeReadStep } from '@/lib/animacraft/native-complete-read-client'
import { renderNativeEquipmentScene } from '@/lib/animacraft/native-equipment-render-client'
import { getBrowserNativeArtworkConfig, getBrowserNativeProtectedArtworkConfig,
  readBrowserNativeEquipmentReadTarget, readBrowserNativeEquipmentRenderTarget } from '@/lib/animacraft/browser-native-artwork'

export function NativeEquipmentPreview({ snapshot }: { snapshot: EquipmentSnapshot }) {
  const identity = JSON.stringify([snapshot.soulId, snapshot.stateId, snapshot.owner, snapshot.ownershipEpoch,
    snapshot.equipment?.loadout.id, snapshot.equipment?.loadout.revision, snapshot.equipment?.loadout.commitment])
  return <EquipmentPreview key={identity} snapshot={snapshot} />
}

function EquipmentPreview({ snapshot }: { snapshot: EquipmentSnapshot }) {
  const account = useCurrentAccount(), client = useSuiClient()
  const { currentWallet: wallet } = useCurrentWallet()
  const { mutateAsync: signPersonalMessage } = useSignPersonalMessage()
  const address = account?.address ?? null
  const live = useRef({ address, client, wallet })
  useLayoutEffect(() => { live.current = { address, client, wallet } }, [address, client, wallet])
  const pending = useRef<AbortController | null>(null), imageUrl = useRef<string | null>(null)
  const [view, setView] = useState<{ address: string | null; client: typeof client; wallet: typeof wallet;
    busy?: boolean; url?: string; error?: string; empty?: boolean } | null>(null)
  const visible = view?.address === address && view.client === client && view.wallet === wallet ? view : null
  const [previousIdentity, setPreviousIdentity] = useState({ address, client, wallet })
  if (previousIdentity.address !== address || previousIdentity.client !== client || previousIdentity.wallet !== wallet) {
    setPreviousIdentity({ address, client, wallet }); setView(null)
  }
  const release = () => { if (imageUrl.current) URL.revokeObjectURL(imageUrl.current); imageUrl.current = null }
  useLayoutEffect(() => {
    return () => { pending.current?.abort(); pending.current = null; release() }
  }, [address, client, wallet])
  async function open() {
    if (!account || address !== snapshot.owner || !wallet || pending.current) return
    const controller = new AbortController(); pending.current = controller
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(120000)])
    const identity = { address, client, wallet }
    const matches = () => !controller.signal.aborted && pending.current === controller
      && live.current.address === address && live.current.client === client && live.current.wallet === wallet
    release(); setView({ ...identity, busy: true })
    try {
      const config = getBrowserNativeArtworkConfig()
      const grpc = (client as unknown as { grpc?: SuiGrpcClient }).grpc
      if (!grpc) throw new Error('Current wallet chain reader is unavailable. Please reconnect.')
      const subject = { soulId: snapshot.soulId, stateId: snapshot.stateId, signal }
      const readScene = () => readBrowserNativeEquipmentRenderTarget({ ...subject, config }, { client: () => grpc })
      const scene = await completeReadStep(signal, readScene)
      const loadout = snapshot.equipment?.loadout
      if (scene.soulId !== snapshot.soulId || scene.stateId !== snapshot.stateId || scene.owner !== snapshot.owner
        || scene.ownershipEpoch !== snapshot.ownershipEpoch
        || (loadout ? scene.snapshot?.loadoutId !== loadout.id || scene.snapshot.loadoutRevision !== loadout.revision
          || scene.snapshot.loadoutCommitment !== toHex(new Uint8Array(loadout.commitment))
          : scene.status !== 'NOT_CREATED')) throw new Error('Equipment changed. Refresh the wardrobe before viewing it.')
      signal.throwIfAborted()
      if (scene.status !== 'AVAILABLE') { if (matches()) setView({ ...identity, empty: true }); return }
      // Public equipment never requires Seal configuration. Protected layers resolve
      // their exact authority lazily inside the existing renderer.
      const blob = await completeReadStep(signal, () => renderNativeEquipmentScene(scene, {
        soulId: snapshot.soulId, owner: snapshot.owner, client: client as unknown as SealCompatibleClient, signal,
        getAddress: () => matches() ? live.current.address : null, readScene,
        readLayer: selectionIndex => readBrowserNativeEquipmentReadTarget({ ...subject, selectionIndex,
          config: getBrowserNativeProtectedArtworkConfig() }, { client: () => grpc }),
        signPersonalMessage: async message => {
          signal.throwIfAborted()
          if (!matches()) throw new Error('Equipment wallet session changed.')
          return (await signPersonalMessage({ message, account })).signature
        },
      }))
      signal.throwIfAborted()
      if (!(blob instanceof Blob) || blob.type !== 'image/png') throw new Error('Invalid equipment image response.')
      if (matches()) { const url = URL.createObjectURL(blob); imageUrl.current = url; setView({ ...identity, url }) }
    } catch (error) {
      if (matches()) setView({ ...identity, error: signal.aborted ? 'Equipment preview timed out. Please retry.'
        : error instanceof Error ? error.message : 'Unable to display current equipment.' })
    } finally { if (pending.current === controller) pending.current = null }
  }
  return <div aria-label="Current equipped appearance" className="rounded-xl border border-[var(--border-soft)] p-3">
    <h4 className="text-sm font-semibold">Current equipped appearance</h4>
    <p className="mt-1 text-xs text-muted">Only current equipment is shown. Empty Parts stay empty; the original artwork is separate. Protected layers may request temporary wallet read access, not a transaction.</p>
    <Button className="mt-2" disabled={address !== snapshot.owner || !wallet || visible?.busy} onClick={() => void open()}>
      {visible?.error ? 'Retry current appearance' : 'View current appearance'}
    </Button>
    {address !== snapshot.owner && <p className="mt-2 text-xs text-muted">Connect the current owner's wallet to render this equipment.</p>}
    {visible?.busy && <><p role="status">Verifying and rendering current equipment…</p>
      <Button onClick={() => { pending.current?.abort(); pending.current = null; setView({ address, client, wallet,
        error: 'Read cancelled. Dismiss any pending wallet prompt before retrying.' }) }}>Cancel equipment preview</Button></>}
    {visible?.empty && <p role="status">No items are equipped. The current appearance is empty.</p>}
    {visible?.error && <p role="alert" className="text-sm text-danger">{visible.error}</p>}
    {visible?.url && <img src={visible.url} alt="Current equipped Soul appearance" className="mt-3 max-h-96 w-full object-contain"
      onError={() => { if (imageUrl.current !== visible.url) return; release(); setView({ address, client, wallet,
        error: 'The equipment image could not be displayed. Please retry.' }) }} />}
  </div>
}
