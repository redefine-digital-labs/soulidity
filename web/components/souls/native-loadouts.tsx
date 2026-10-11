'use client'

import { useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useNativeLoadouts } from '@/lib/hooks/use-native-loadouts'
import { NAMED_LOADOUT_LIMIT, normalizeNamedLoadoutName } from '@/lib/animacraft/named-loadout'
import type { NamedLoadoutContent, NamedLoadoutSlot } from '@/lib/animacraft/named-loadout'
import type { EquipmentSnapshot } from '@/lib/animacraft/equipment-operation'

const short = (id: string) => `${id.slice(0, 6)}…${id.slice(-4)}`
const labels: Record<NamedLoadoutSlot['kind'], string> = {
  'base-selection': 'Base selection', 'pack-selection': 'Pack selection',
  'base-item': 'Base item', 'external-item': 'External item',
}

interface LoadoutsProps {
  snapshot: EquipmentSnapshot; blocked?: boolean; canApply: boolean
  onApply: (content: NamedLoadoutContent) => Promise<unknown>
}
export function NativeLoadouts({ snapshot, blocked = false,canApply,onApply }: LoadoutsProps) {
  return <Loadouts key={JSON.stringify([snapshot.soulId, snapshot.stateId, snapshot.owner, snapshot.ownershipEpoch])}
    snapshot={snapshot} blocked={blocked} canApply={canApply} onApply={onApply} />
}

function Loadouts({ snapshot, blocked = false,canApply,onApply }: LoadoutsProps) {
  const actions = useNativeLoadouts({ snapshot, blocked })
  return <LoadoutControls key={actions.privacyKey} snapshot={snapshot} blocked={blocked} canApply={canApply} onApply={onApply} actions={actions} />
}
function LoadoutControls({ snapshot, blocked = false, canApply, onApply, actions }: LoadoutsProps & { actions: ReturnType<typeof useNativeLoadouts> }) {
  const [name, setName] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  const [rename, setRename] = useState('')
  const [localError, setLocalError] = useState<string | null>(null)
  const locked = blocked || actions.busy || actions.pending || actions.loading || actions.historyBusy
  const editLocked = locked || !actions.writesEnabled || !actions.unlocked
  const manage = actions.canManage
  const index = manage ? actions.index : null
  const selected = manage && index?.loadouts.some(row => row.id === actions.selected?.id) ? actions.selected : null
  const invoke = async (operation: () => void | Promise<unknown>) => {
    setLocalError(null)
    try { await operation() } catch (error) {
      setLocalError(error instanceof Error ? error.message : 'Unable to update loadouts. Please retry.')
    }
  }
  const save = () => {
    if (editLocked || !actions.canSave) return
    void invoke(() => actions.save(normalizeNamedLoadoutName(name)))
  }
  const submitRename = (id: string) => {
    if (editLocked || !manage) return
    void invoke(() => actions.rename(id, normalizeNamedLoadoutName(rename)))
  }
  return <section aria-label="Named loadouts" className="space-y-3 border-t border-[var(--border-soft)] pt-4">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h4 className="text-sm font-semibold">Named loadouts</h4>
      {manage && !actions.pending && <Button size="sm" variant="outline" disabled={actions.busy || actions.loading || actions.historyBusy}
        onClick={() => void invoke(actions.refresh)}>Refresh loadouts</Button>}
    </div>
    <p className="text-xs text-muted">Private saved references for this Soul. Saving does not change equipment or grant access to content.</p>
    {!manage && <p className="text-sm text-muted">Connect the current Soul owner's wallet</p>}
    {actions.connected && <details className="space-y-2 text-xs text-muted">
      <summary className="cursor-pointer">Previous ownership transaction queries</summary>
      <p>After a transfer, the preparing wallet can still query its original public transactions. This does not unlock a previous owner's library or authorize new payments.</p>
      {actions.historicalScopes.map(row => <Button key={row.ownershipEpoch} size="sm" variant="outline"
        disabled={actions.busy || actions.loading || actions.historyBusy} onClick={() => void invoke(() => actions.queryHistory(row))}>
        Query ownership epoch {row.ownershipEpoch}
      </Button>)}
      <label className="block">Query an encrypted previous request
        <input type="file" accept="application/json,.json" className="mt-1 block max-w-full"
          disabled={actions.busy || actions.loading || actions.historyBusy} onChange={event => {
            const file = event.target.files?.[0]; event.target.value = ''; if (!file) return
            void invoke(async () => { if (file.size > 30 * 1024 * 1024) throw new Error('Encrypted recovery file is too large.')
              await actions.queryHistory(await file.text()) })
          }} />
      </label>
      {actions.historyBusy && <p role="status">Querying the original transaction…</p>}
      {actions.historicalResult && <p role="status" className="break-words">{actions.historicalResult}</p>}
    </details>}
    {actions.loading && <p role="status" className="text-sm text-muted">Loading saved loadouts…</p>}
    {(actions.error || localError) && <p role="alert" className="break-words text-sm text-danger">{actions.error || localError}</p>}
    {actions.notice && <p role="status" className="text-sm text-muted">{actions.notice}</p>}
    {actions.approval && <div role="dialog" aria-modal="true" aria-label={actions.approval.title}
      className="space-y-2 rounded-xl border border-[var(--border-soft)] p-3 text-sm">
      <h5 className="font-semibold">{actions.approval.title}</h5>
      {actions.approval.lines.map((line, i) => <p key={i}>{line}</p>)}
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => actions.approve(true)}>Approve and continue</Button>
        <Button variant="outline" onClick={() => actions.approve(false)}>Decline</Button>
      </div>
    </div>}
    {actions.pending && <PendingRequestRecovery canManage={manage} busy={actions.busy}
      canWrite={actions.writesEnabled} retry={() => invoke(actions.retry)} dismiss={() => invoke(actions.dismiss)}
      query={() => invoke(actions.query)} rebase={() => invoke(actions.rebase)} />}
    {manage && <>
      <p className="text-xs text-muted">Unlock requests temporary read access through your wallet. Saving, renaming, deleting and renewing require paid encrypted storage and a separate library update; costs are shown before approval.</p>
      {!actions.unlocked && <Button disabled={actions.busy || actions.loading} onClick={() => void invoke(actions.unlock)}>Unlock private loadouts</Button>}
      {!actions.writesEnabled && <p role="status" className="text-xs text-muted">Library writes are disabled until the complete release is enabled. Unlock and transaction queries remain available.</p>}
      {actions.unlocked && <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
        {actions.endEpoch !== null && <p>Encrypted storage expires at Walrus epoch {actions.endEpoch}.</p>}
        <Button size="sm" variant="outline" disabled={editLocked} onClick={() => void invoke(actions.renew)}>Renew encrypted storage</Button>
      </div>}
      <details className="space-y-2 text-xs text-muted">
        <summary className="cursor-pointer">Encrypted backup and recovery</summary>
        <p>Download the encrypted pending request before changing devices or clearing browser data. Only its original owner and ownership epoch can unlock it. Expired storage is not an empty library.</p>
        <Button size="sm" variant="outline" disabled={!actions.canExport} onClick={() => void invoke(() => {
          const encoded = actions.exportRecovery(), url = URL.createObjectURL(new Blob([encoded], { type: 'application/json' }))
          try { const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'soulidity-private-loadout-recovery.json'; anchor.click() }
          finally { URL.revokeObjectURL(url) }
        })}>Download encrypted recovery</Button>
        {(['Restore pending request', 'Unlock current encrypted backup'] as const).map((label, index) => <label key={label} className="block">
          {label}
          <input type="file" accept="application/json,.json" className="mt-1 block max-w-full" disabled={actions.busy || actions.loading}
            onChange={event => {
              const file = event.target.files?.[0]; event.target.value = ''
              if (!file) return
              void invoke(async () => { if (file.size > 30 * 1024 * 1024) throw new Error('Encrypted recovery file is too large.')
                await actions.importRecovery(await file.text(), index === 1) })
            }} />
        </label>)}
      </details>
      {blocked && <p role="status" className="text-xs text-muted">Wait for the current equipment operation before changing saved loadouts.</p>}
      <form className="flex flex-wrap items-end gap-2" onSubmit={event => { event.preventDefault(); save() }}>
        <label className="min-w-0 flex-1 text-xs">Loadout name
          <Input className="mt-1" value={name} disabled={editLocked} onChange={event => setName(event.target.value)} autoComplete="off" />
        </label>
        <Button type="submit" disabled={editLocked || !actions.canSave || !name.trim()}>Save current loadout</Button>
      </form>
      {!snapshot.equipment && <p className="text-xs text-muted">Create Soul equipment before saving a loadout.</p>}
      {index && index.loadouts.length >= NAMED_LOADOUT_LIMIT && <p className="text-xs text-muted">You can save up to {NAMED_LOADOUT_LIMIT} loadouts. Delete one before saving another.</p>}
      {actions.busy && <p role="status" className="text-sm text-muted">Updating loadouts…</p>}
      {!actions.loading && !actions.error && index?.loadouts.length === 0 && <p className="text-sm text-muted">No saved loadouts yet.</p>}
      {!actions.loading && !actions.error && !index && <p className="text-sm text-muted">Saved loadouts are not available yet.</p>}
      {index && <ul className="m-0 grid list-none gap-2 p-0 sm:grid-cols-2">
        {index.loadouts.map(row => <li key={row.id} className="min-w-0 rounded-xl border border-[var(--border-soft)] p-3 text-sm">
          <h5 className="break-words font-semibold">{row.name}</h5>
          <p className="mt-1 text-xs text-muted">{row.selectionCount} selection(s) · {row.slotCount} slot(s)</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button size="sm" variant="outline" disabled={actions.busy || actions.loading || actions.pending}
              onClick={() => void invoke(() => actions.view(row.id))}>View</Button>
            <Button size="sm" variant="outline" disabled={editLocked} onClick={() => {
              setEditing(row.id); setRename(row.name); setLocalError(null)
            }}>Rename</Button>
            <Button size="sm" variant="outline" disabled={editLocked} onClick={() => void invoke(() => actions.remove(row.id))}>Delete</Button>
          </div>
          {editing === row.id && <form className="mt-3 space-y-2" onSubmit={event => { event.preventDefault(); submitRename(row.id) }}>
            <label className="block text-xs">New name for {row.name}
              <Input className="mt-1" value={rename} disabled={editLocked} onChange={event => setRename(event.target.value)} autoComplete="off" />
            </label>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" type="submit" disabled={editLocked || !rename.trim() || rename.trim() === row.name}>Save name</Button>
              <Button size="sm" type="button" variant="ghost" onClick={() => { setEditing(null); setLocalError(null) }}>Cancel rename</Button>
            </div>
          </form>}
        </li>)}
      </ul>}
      {selected && <div className="space-y-2 rounded-xl border border-[var(--border-soft)] p-3" aria-label="Saved loadout details">
        <h5 className="break-words text-sm font-semibold">{selected.name}</h5>
        <p className="text-xs text-muted">Saved equipment revision {selected.content.capturedEquipmentRevision}. These references are not applied to current equipment.</p>
        <p className="text-xs text-muted">Apply all slots in one wallet transaction. Current access and component availability are checked before signing; an empty loadout removes all equipment selections.</p>
        <Button disabled={locked || !canApply || !snapshot.equipment || snapshot.listed}
          onClick={() => {
            if (locked || !canApply || !snapshot.equipment || snapshot.listed) return
            void invoke(() => onApply(structuredClone(selected.content)))
          }}>Apply to Soul</Button>
        {!snapshot.release.writesEnabled && <p className="text-xs text-muted">Applying is disabled until the complete release is accepted. Saved loadouts remain available.</p>}
        <ol className="m-0 grid list-none gap-2 p-0 sm:grid-cols-2">
          {selected.content.slots.map((slot, position) => <li key={position} className="min-w-0 rounded-lg border border-[var(--border-soft)] p-2 text-xs">
            <p className="font-semibold">Slot {position + 1}{slot === null ? ' · Empty' : ''}</p>
            {slot && <>
              <p className="mt-1">{labels[slot.kind]}{slot.protected ? ' · Protected' : ''}</p>
              <p className="break-words">{slot.partKey} · {slot.itemKey}</p>
              <p className="break-words">Style {slot.styleKey} · Swatch {slot.swatchKey ?? 'none'}</p>
              <p className="mt-1 font-mono" title={slot.sourceDefinitionId}>Source {short(slot.sourceDefinitionId)}</p>
              <p className="font-mono" title={slot.accessSubject}>Access / item {short(slot.accessSubject)}</p>
            </>}
          </li>)}
        </ol>
      </div>}
    </>}
  </section>
}

function PendingRequestRecovery({ canManage, busy, canWrite, retry, dismiss, query, rebase }: {
  canManage: boolean; busy: boolean; canWrite: boolean; retry: () => Promise<void>; dismiss: () => Promise<void>
  query: () => Promise<void>; rebase: () => Promise<void>
}) {
  const [confirming, setConfirming] = useState(false)
  const [rebasing, setRebasing] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const submitted = useRef(false)
  const disabled = !canManage || busy || submitting
  const confirm = async () => {
    if (disabled || submitted.current) return
    submitted.current = true; setSubmitting(true); setConfirming(false)
    try { await dismiss() } finally { submitted.current = false; setSubmitting(false) }
  }
  return <div role="status" className="space-y-2 text-sm">
    <p>An encrypted loadout request is awaiting confirmation. Query its original transactions first. Unknown signed transactions cannot be discarded or replaced.</p>
    <div className="flex flex-wrap gap-2">
      <Button disabled={disabled} onClick={() => void query()}>Query original transactions</Button>
      <Button disabled={disabled || !canWrite} onClick={() => { setConfirming(false); void retry() }}>Retry same request</Button>
      <Button variant="outline" disabled={disabled || !canWrite} onClick={() => setRebasing(true)}>Rebase on current library</Button>
      <Button variant="outline" disabled={disabled} onClick={() => setConfirming(true)}>Stop retrying request</Button>
    </div>
    {rebasing && <div className="space-y-2">
      <p>Rebase unlocks the current library and reapplies this encrypted request. Changed data needs new paid storage. The earlier encrypted request and paid receipts are retained.</p>
      <Button disabled={disabled || !canWrite} onClick={() => { setRebasing(false); void rebase() }}>Confirm rebase</Button>
      <Button variant="ghost" disabled={disabled} onClick={() => setRebasing(false)}>Cancel rebase</Button>
    </div>}
    {confirming && <div className="space-y-2">
      <p>Query and archive this request only when no transaction is still unresolved. Its encrypted recovery is retained; stopping retries does not delete saved loadouts or change equipment.</p>
      <div className="flex flex-wrap gap-2">
        <Button disabled={disabled} onClick={() => void confirm()}>Confirm stop retrying</Button>
        <Button variant="ghost" disabled={disabled} onClick={() => setConfirming(false)}>Keep retrying</Button>
      </div>
    </div>}
  </div>
}
