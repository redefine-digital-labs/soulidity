'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { NativeOriginalPreview } from './native-original-preview'
import { NativeEquipmentPreview } from './native-equipment-preview'
import { NativeLoadouts } from './native-loadouts'
import { EquipmentMarketPanel } from './equipment-market-panel'
import { EquipmentMarketRecovery } from './equipment-market-recovery'
import { equipmentMarketReadRequest } from '@/lib/animacraft/equipment-market-operation-adapter'
import type { EquipmentMarketAction } from '@/lib/animacraft/equipment-market-operation'
import type { EquipmentMarketReadRequest } from '@/lib/animacraft/equipment-market-operation-snapshot'
import { useNativeEquipmentActions } from '@/lib/hooks/use-native-equipment-actions'
import { equipmentEligibility, baseSelectionEligibility, packSelectionEligibility, clearableEquipmentSelection, protectedBaseProof } from '@/lib/animacraft/equipment-eligibility'
import { equipmentPackStyleColor, type PackStyle } from '@/lib/animacraft/native-equipment-pack'
import { packAttachmentEligibility } from '@/lib/animacraft/equipment-pack-attachment'
import type { AnimacraftEquipmentV8Removal } from '@soulidity/sdk'
import { equipmentReleaseKey, type EquipmentOperation } from '@/lib/animacraft/equipment-operation'
import type { readNativeEquipment } from '@/lib/animacraft/native-equipment'
import { readBrowserNativeEquipment } from '@/lib/animacraft/browser-native-equipment'
import type { NamedLoadoutContent } from '@/lib/animacraft/named-loadout'

type Snapshot = Awaited<ReturnType<typeof readNativeEquipment>>
const short = (id: string) => `${id.slice(0, 6)}…${id.slice(-4)}`
const messages: Record<string, string> = {
  NATIVE_RECEIVE_TARGET_UNAVAILABLE: 'The verified release configuration is not available yet.',
  NATIVE_EQUIPMENT_TARGET_UNAVAILABLE: 'The verified equipment release is not available yet.',
  NATIVE_EQUIPMENT_CHANGED: 'The Soul or its equipment changed. Refresh to load the current state.',
  NATIVE_EQUIPMENT_INVALID: 'The equipment could not be verified. No inventory or ownership was assumed.',
  NATIVE_EQUIPMENT_SOURCE_INVALID: 'The Maker source could not be verified. Existing equipment is unchanged.',
  NATIVE_EQUIPMENT_PACK_INVALID: 'The Pack source could not be verified. Existing equipment is unchanged.',
  NAMED_LOADOUT_EQUIPMENT_CHANGED: 'The Soul or saved loadout source changed. Refresh before applying it.',
  NATIVE_EQUIPMENT_RATE_LIMIT: 'Too many requests. Wait briefly, then refresh.',
}
async function fetchSnapshot(soulId: string, stateId: string, query: URLSearchParams, signal: AbortSignal,
  loadoutContent?: NamedLoadoutContent): Promise<Snapshot> {
  try { return await readBrowserNativeEquipment({ soulId, stateId, query, signal, loadoutContent }) }
  catch (error) {
    if (signal.aborted) throw error
    const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : ''
    throw new Error(messages[code] ?? 'Unable to load verified equipment. Please retry.')
  }
}

/** The existing Wardrobe tab's native read surface. No legacy issuer or guessed
 * object IDs. Mutations are added only with the corresponding recovery flow. */
export function NativeWardrobePanel({ soulObjectId, stateObjectId }: { soulObjectId: string; stateObjectId: string }) {
  const [kind, setKind] = useState<'base' | 'external'>('base')
  const [cursor, setCursor] = useState<string | null>(null)
  const [styleStart, setStyleStart] = useState(0)
  const [packOpen,setPackOpen] = useState(false)
  const [packCursor,setPackCursor] = useState<string | null>(null)
  const [packPass,setPackPass] = useState<string | null>(null)
  const [packStyleCursor,setPackStyleCursor] = useState<string | null>(null)
  const [sale,setSale] = useState<EquipmentMarketReadRequest|null>(null)
  const [saleAction,setSaleAction] = useState<EquipmentMarketAction>('list')
  const equipment = useQuery({ queryKey: ['native-equipment', soulObjectId, stateObjectId], retry: false,
    queryFn: ({ signal }) => fetchSnapshot(soulObjectId, stateObjectId, new URLSearchParams(), signal), staleTime: 0 })
  const source = useQuery({ queryKey: ['native-equipment-source', soulObjectId, stateObjectId, kind, cursor, styleStart],
    enabled: equipment.data !== undefined && !equipment.isError, retry: false, staleTime: 0,
    queryFn: ({ signal }) => fetchSnapshot(soulObjectId, stateObjectId, new URLSearchParams({ inventory: kind, source: '1',
      styleStart: String(styleStart), ...(cursor ? { cursor } : {}) }), signal) })
  const packSource = useQuery({ queryKey: ['native-equipment-pack',soulObjectId,stateObjectId,packCursor,packPass,packStyleCursor],
    enabled: packOpen && equipment.data !== undefined && !equipment.isError,retry: false,staleTime: 0,
    queryFn: ({ signal }) => fetchSnapshot(soulObjectId,stateObjectId,new URLSearchParams({ source: '1',pack: '1',
      ...(packPass ? { packPass,...(packStyleCursor ? { packStyleCursor } : {}) } : packCursor ? { packCursor } : {}) }),signal) })
  const snapshot = equipment.data
  const detail = source.data
  const sameScope = detail && snapshot && detail.soulId === snapshot.soulId && detail.owner === snapshot.owner
    && detail.ownershipEpoch === snapshot.ownershipEpoch && detail.equipment?.loadout.id === snapshot.equipment?.loadout.id
    && detail.equipment?.loadout.revision === snapshot.equipment?.loadout.revision
    && detail.release && snapshot.release && equipmentReleaseKey(detail.release) === equipmentReleaseKey(snapshot.release)
  const config = sameScope ? detail.source : null
  const inventory = sameScope ? detail.inventory : null
  const packDetail = packSource.data
  const packSameScope = packDetail && snapshot && packDetail.soulId === snapshot.soulId && packDetail.owner === snapshot.owner
    && packDetail.ownershipEpoch === snapshot.ownershipEpoch && packDetail.equipment?.loadout.id === snapshot.equipment?.loadout.id
    && packDetail.equipment?.loadout.revision === snapshot.equipment?.loadout.revision
    && equipmentReleaseKey(packDetail.release) === equipmentReleaseKey(snapshot.release)
  const packs = packSameScope && !packSource.isError ? packDetail.source?.pack : null
  const refresh = () => { void equipment.refetch(); void source.refetch(); if (packOpen) void packSource.refetch() }
  const actions = useNativeEquipmentActions({ soulId: soulObjectId, snapshot,
    read: operation => {
      if (operation?.kind === 'apply-loadout') return fetchSnapshot(soulObjectId,stateObjectId,new URLSearchParams(),
        AbortSignal.timeout(30000),operation.content)
      const query = new URLSearchParams()
      if (operation && !['create', 'close'].includes(operation.kind)) query.set('update', '1')
      if (operation && ['create','equip','select-base','select-pack','attach-pack'].includes(operation.kind)) query.set('source','1')
      if (operation?.kind === 'attach-pack') { query.set('pack', '1'); query.set('packPass', operation.pack.passId) }
      if (operation?.kind === 'select-pack') {
        query.set('pack','1'); query.set('packPass',operation.selection.passId)
        query.set('packPart',operation.selection.partKey); query.set('packItem',operation.selection.itemKey)
        query.set('packStyle',operation.selection.styleKey)
      }
      if (operation?.kind === 'select-base') query.set('styleStart',String(operation.styleStart ?? 0))
      if (operation?.kind === 'equip') {
        query.set('inventory', operation.item.kind); query.set('item', operation.item.itemId)
        query.set('styleStart', String(operation.styleStart ?? 0))
      }
      return fetchSnapshot(soulObjectId, stateObjectId, query, AbortSignal.timeout(30000))
    }, onChanged: refresh })
  const creation = sameScope && detail && config && !source.isError ? equipmentEligibility(detail) : null
  const selectSale=(value:Snapshot,itemId:string,itemKind:'base'|'external',equipped:boolean)=>{setSaleAction('list');setSale({
    actor:value.owner,rootId:value.rootId,itemId,kind:itemKind,
    ...(equipped?{equipmentScope:{soulId:value.soulId,stateId:stateObjectId}}:{})})}
  return <section className="space-y-5 p-5" aria-label="Soul wardrobe">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h3 className="m-0 text-lg font-bold text-foreground">Soul wardrobe</h3>
        <p className="mt-1 text-[13px] text-muted">Equipment belongs to this Soul. Wallet components remain distinct from Maker and Pack access.</p></div>
      <Button onClick={refresh} disabled={equipment.isFetching || source.isFetching}>Refresh</Button>
    </div>
    {equipment.isPending && <p role="status" className="text-sm text-muted">Loading verified equipment…</p>}
    {equipment.isError && <p role="alert" className="text-sm text-danger">{equipment.error.message}</p>}
    {actions.error && <p role="alert" className="text-sm text-danger">{actions.error}</p>}
    {actions.notice && <p role="status" className="text-sm text-muted">{actions.notice}</p>}
    <EquipmentMarketRecovery onSelect={record=>{setSale(equipmentMarketReadRequest(record.snapshot));setSaleAction(record.action)}}/>
    {sale&&<EquipmentMarketPanel key={JSON.stringify([sale.actor,sale.itemId,saleAction])} request={sale} action={saleAction}
      identityKey={JSON.stringify([soulObjectId,stateObjectId,sale.actor])} blocked={actions.pending||actions.busy}/>}
    {actions.record && <div className="rounded-xl border border-[var(--border-soft)] p-3 text-sm" role="status">
      <p>Equipment transaction · {actions.record.phase}</p>
      <p className="break-all font-mono text-xs text-muted">{actions.record.digest}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        <Button disabled={actions.busy} onClick={() => void actions.check()}>Check saved transaction</Button>
        {actions.pending && <Button disabled={actions.busy} onClick={() => void actions.resume()}>
          {actions.record.phase === 'SIGNED' ? 'Retry same transaction' : 'Sign saved transaction'}</Button>}
        {actions.record.phase === 'PREPARED' && <Button disabled={actions.busy} onClick={() => void actions.cancelUnsigned()}>Discard unsigned operation</Button>}
      </div>
    </div>}
    {snapshot && !equipment.isError && <>
      <NativeEquipmentPreview snapshot={snapshot} />
      <NativeOriginalPreview key={JSON.stringify([soulObjectId, stateObjectId, snapshot.owner, snapshot.ownershipEpoch])}
        soulObjectId={soulObjectId} stateObjectId={stateObjectId} />
      <NativeLoadouts snapshot={snapshot} blocked={actions.pending || actions.busy} canApply={actions.canStart}
        onApply={content => actions.start({kind:'apply-loadout',content})} />
      <div className="rounded-xl border border-[var(--border-soft)] p-3 text-xs text-muted">
        <div>Soul <span className="font-mono">{short(snapshot.soulId)}</span> · owner <span className="font-mono">{short(snapshot.owner)}</span></div>
        {snapshot.listed && <p className="mt-1">Listed Souls cannot change equipment.</p>}
      </div>
      {snapshot.status === 'NOT_CREATED' ? <div className="text-sm text-muted">
        <p>No persistent equipment has been created for this Soul.</p>
        <Button className="mt-2" disabled={!actions.canStart || !creation?.allowed}
          onClick={() => void actions.start({ kind: 'create' })}>Create Soul equipment</Button>
        <p className="mt-2 text-xs">{creation?.reason ?? 'Load the verified Maker source first.'}</p>
        {!snapshot.release?.writesEnabled && <p className="mt-2 text-xs">Signing is disabled until the complete release is accepted.</p>}
      </div>
        : <div><h4 className="mb-2 text-sm font-semibold">Current equipment · revision {snapshot.equipment.loadout.revision}</h4>
          <ul className="m-0 grid list-none gap-2 p-0 sm:grid-cols-2">
            {snapshot.equipment.loadout.selections.map((row,index) => <li key={index} className="rounded-xl border border-[var(--border-soft)] p-3 text-sm">
              <div className="font-semibold">{row ? `${row.part_key} · ${row.item_key}` : `Slot ${index + 1}`}</div>
              <div className="mt-1 text-xs text-muted">{row ? `${row.style_key}${row.swatch_key ? ` · ${row.swatch_key}` : ''}` : 'Empty'}</div>
              {row && <div className="mt-1 text-xs text-muted">{row.source_class === 1 ? 'Pack selection' : row.source_class === 2 ? 'External component' : 'Base selection'}{row.protected ? ' · Protected' : ''}</div>}
              {row && snapshot.equipment.instances.filter(instance => instance.item.id === row.access_subject).map(instance =>
                <div key={instance.item.id}><Button className="mt-2" disabled={!actions.canStart} onClick={() => void actions.start({
                  kind: instance.kind === 'base' ? 'unequip-base' : 'unequip-external', itemId: instance.item.id,
                })}>Unequip component</Button>
                <Button className="mt-2" onClick={()=>selectSale(snapshot,instance.item.id,instance.kind,true)}>Review component sale</Button></div>)}
              {row && clearableEquipmentSelection(snapshot,index) && <Button className="mt-2" disabled={!actions.canStart}
                onClick={() => void actions.start({ kind: 'clear-selection', selectionIndex: String(index) })}>Clear selection</Button>}
            </li>)}
          </ul>
          {snapshot.equipment.loadout.selection_count === '0' && <Button className="mt-3" disabled={!actions.canStart}
            onClick={() => void actions.start({ kind: 'close' })}>Close empty equipment binding</Button>}
          <p className="mt-2 text-xs text-muted">{snapshot.release?.writesEnabled
            ? 'Removal keeps the component in its wallet. Network gas may apply.'
            : 'Signing is disabled until the complete release is accepted. Saved transactions can still be checked.'}</p>
        </div>}
      <div className="border-t border-[var(--border-soft)] pt-4">
        <div className="flex flex-wrap items-center gap-2"><h4 className="mr-auto text-sm font-semibold">Wallet components</h4>
          {(['base','external'] as const).map(value => <Button key={value} aria-pressed={kind === value} onClick={() => { setKind(value); setCursor(null) }}>
            {value === 'base' ? 'Base items' : 'External items'}</Button>)}
        </div>
        {source.isPending && <p role="status" className="mt-3 text-sm text-muted">Loading source and wallet components…</p>}
        {source.isError && <p role="alert" className="mt-3 text-sm text-danger">{source.error.message}</p>}
        {detail && !sameScope && <p role="alert" className="mt-3 text-sm text-danger">Equipment changed while loading choices. Refresh to synchronize.</p>}
        {config && !source.isError && <p className="mt-2 text-xs text-muted">
          {config.root.lifecycle === 1 ? 'Maker active' : 'Maker not active'} · {config.access ? 'Maker access held' : 'Maker access not held'} · {config.slots.length} part(s)
        </p>}
        {inventory && !source.isError && <>
          {inventory.objects.length === 0 ? <p className="mt-3 text-sm text-muted">No {kind} components were returned on this wallet page.</p>
            : <ul className="mt-3 grid list-none gap-2 p-0 sm:grid-cols-2">{inventory.objects.map(({ item, occupancy }) => <li key={item.id} className="rounded-xl border border-[var(--border-soft)] p-3 text-sm">
              <div className="font-semibold">{'item_key' in item ? `${item.part_key} · ${item.item_key}` : `External · ${short(item.product_id)}`}</div>
              <div className="mt-1 font-mono text-xs text-muted">{short(item.id)}</div>
              <div className="mt-1 text-xs text-muted">{occupancy === 'UNLOCKED' ? 'Not equipped' : occupancy === 'THIS_SOUL' ? 'Equipped here' : 'Used in another loadout'}</div>
              {detail&&(occupancy==='UNLOCKED'||occupancy==='THIS_SOUL')&&<Button className="mt-2"
                onClick={()=>selectSale(detail,item.id,'part_key' in item?'base':'external',occupancy==='THIS_SOUL')}>Review component sale</Button>}
              {detail && config && <EquipmentChoiceControls key={JSON.stringify([detail.soulId, detail.owner, detail.ownershipEpoch,
                detail.equipment?.loadout.id, detail.equipment?.loadout.revision, item.id, styleStart])}
                snapshot={detail} itemId={item.id} canStart={actions.canStart} start={actions.start} />}
            </li>)}</ul>}
          <p className="mt-3 text-xs text-muted">Choices are checked against the current Maker source. Signing rechecks ownership and eligibility; network gas may apply. A protected selection does not grant a decrypted preview.</p>
        </>}
        <div className="mt-3 flex gap-2">{cursor && <Button onClick={() => setCursor(null)}>First page</Button>}
          {inventory && !source.isError && inventory.hasNextPage && <Button onClick={() => setCursor(inventory.cursor)}>Next wallet page</Button>}</div>
      </div>
      <div className="border-t border-[var(--border-soft)] pt-4" aria-label="Pack equipment">
        <h4 className="text-sm font-semibold">Pack content</h4>
        <p className="mt-1 text-xs text-muted">Use access already held in this wallet. Selecting content does not buy access or spend a completion quota. Protected content still requires authorized decryption to preview.</p>
        {!packOpen ? <Button className="mt-2" onClick={() => setPackOpen(true)}>Browse Pack access</Button> : <>
          {packSource.isFetching && <p role="status" className="mt-2 text-sm text-muted">Loading verified Pack content…</p>}
          {packSource.isError && <p role="alert" className="mt-2 text-sm text-danger">{packSource.error.message}</p>}
          {packDetail && !packSameScope && <p role="alert" className="mt-2 text-sm text-danger">Equipment changed while loading Pack choices. Refresh to synchronize.</p>}
          {!packPass && packs && <>
            {packs.passes.length === 0 && <p className="mt-2 text-sm text-muted">No Pack access was returned on this wallet page.</p>}
            <ul className="mt-2 grid list-none gap-2 p-0 sm:grid-cols-2">{packs.passes.map(({ pass,compatible }) => <li key={pass.id} className="rounded-xl border border-[var(--border-soft)] p-3 text-sm">
              <p>Pack {short(pass.release_id)} · pass {short(pass.id)}</p>
              <Button className="mt-2" disabled={!compatible} onClick={() => { setPackPass(pass.id); setPackStyleCursor(null) }}>Open Pack {short(pass.release_id)}</Button>
              {!compatible && <p className="mt-1 text-xs text-muted">This pass belongs to a different Maker.</p>}
            </li>)}</ul>
          </>}
          {packPass && packs?.selected && packDetail && <>
            <h5 className="mt-3 text-sm font-semibold">{packs.selected.release.semantic_pack_id}</h5>
            {packs.selected.definitionCommitment && <PackAttachmentControls snapshot={packDetail}
              canStart={actions.canStart && !!packSameScope} start={actions.start} />}
            {packs.selected.styles.length === 0 && <p className="mt-2 text-sm text-muted">No styles were returned on this Pack page.</p>}
            <ul className="mt-2 grid list-none gap-2 p-0 sm:grid-cols-2">{packs.selected.styles.map(style => <li key={JSON.stringify([packPass,style.part_key,style.item_key,style.style_key])} className="rounded-xl border border-[var(--border-soft)] p-3 text-sm">
              <div>{style.part_key} · {style.item_key} · {style.style_key}{style.protected ? ' · Protected' : ''}</div>
              <PackSelectionControls key={JSON.stringify([packPass,packDetail.owner,packDetail.ownershipEpoch,packDetail.equipment?.loadout.id,
                packDetail.equipment?.loadout.revision,style.part_key,style.item_key,style.style_key])}
                snapshot={packDetail} style={style} canStart={actions.canStart && !packSource.isFetching} start={actions.start} />
            </li>)}</ul>
          </>}
          <div className="mt-3 flex flex-wrap gap-2">
            {packPass ? <Button onClick={() => { setPackPass(null); setPackStyleCursor(null) }}>Back to Pack access</Button>
              : packCursor && <Button onClick={() => setPackCursor(null)}>First Pack access page</Button>}
            {!packPass && packs?.hasNextPage && <Button onClick={() => setPackCursor(packs.cursor)}>Next Pack access page</Button>}
            {packPass && packStyleCursor && <Button onClick={() => setPackStyleCursor(null)}>First Pack styles</Button>}
            {packPass && packs?.selected?.hasNextPage && <Button onClick={() => setPackStyleCursor(packs.selected!.cursor)}>Next Pack styles</Button>}
            {packSource.isError && <Button disabled={packSource.isFetching} onClick={() => void packSource.refetch()}>Retry Pack lookup</Button>}
          </div>
        </>}
      </div>
      {(config && !source.isError || styleStart > 0) && <div className="border-t border-[var(--border-soft)] pt-4">
        {config && !source.isError && <>
        <h4 className="text-sm font-semibold">Maker styles · {config.stylePage.total} total</h4>
        <ul className="mt-2 grid list-none gap-2 p-0 sm:grid-cols-2">{config.styles.map(row => <li key={JSON.stringify([row.part_key,row.item_key,row.style_key])} className="rounded-xl border border-[var(--border-soft)] p-3 text-sm">
          <div>{row.label || row.style_key}</div><div className="mt-1 text-xs text-muted">{row.part_key} · {row.item_key}{row.protected ? ' · Protected' : ''}</div>
          {!config.definitions.item_assetization && detail && <BaseSelectionControls
            key={JSON.stringify([detail.soulId,detail.owner,detail.ownershipEpoch,detail.equipment?.loadout.id,
              detail.equipment?.loadout.revision,row.part_key,row.item_key,row.style_key,styleStart])}
            snapshot={detail} style={row} canStart={actions.canStart} start={actions.start} />}
        </li>)}</ul>
        </>}
        <div className="mt-3 flex gap-2">{styleStart > 0 && <Button onClick={() => setStyleStart(0)}>First styles</Button>}
          {config && !source.isError && config.stylePage.next !== null && <Button onClick={() => setStyleStart(config.stylePage.next!)}>Next styles</Button>}</div>
      </div>}
    </>}
  </section>
}

function EquipmentChoiceControls({ snapshot, itemId, canStart, start }: {
  snapshot: Snapshot; itemId: string; canStart: boolean; start: (operation: EquipmentOperation) => Promise<void>
}) {
  const [styleKey, setStyleKey] = useState('')
  const [swatchKey, setSwatchKey] = useState<string | null>(null)
  const source = snapshot.source!
  const candidate = snapshot.inventory!.objects.find(row => row.item.id === itemId)!
  const item = candidate.item
  const styles = 'part_key' in item ? source.styles.filter(row => row.part_key === item.part_key && row.item_key === item.item_key) : []
  const style = styles.find(row => row.style_key === styleKey)
  const part = 'part_key' in item ? item.part_key : source.external.find(row => row.product.id === item.product_id)?.product.part_key
  const replacements = equipmentReplacements(snapshot,part)
  const previous = replacements.length === 1 ? replacements[0] : undefined
  const proof = style?.protected ? protectedBaseProof(snapshot,style.part_key,style.item_key,style.style_key) : null
  const choice: EquipmentOperation = { kind: 'equip', styleStart: source.stylePage.start,
    item: 'part_key' in item ? { kind: 'base', itemId, baseRegistryId: item.base_registry_id, styleKey, swatchKey, ...(proof ? { protection: proof } : {}) }
      : { kind: 'external', itemId, productId: item.product_id },
    ...(previous ? { replaces: previous.removal } : {}) }
  const eligibility = equipmentEligibility(snapshot, choice)
  return <div className="mt-3 space-y-2">
    {'part_key' in item && <>
      <label className="block text-xs">Component style
        <select className="mt-1 block w-full rounded border bg-background p-2 text-foreground" aria-label={`Style for ${itemId}`}
          value={styleKey} onChange={event => { setStyleKey(event.target.value); setSwatchKey(null) }}>
          <option value="">Choose a style</option>
          {styles.map(row => <option key={row.style_key} value={row.style_key}>{row.label || row.style_key}{row.protected ? ' · Protected' : ''}</option>)}
        </select>
      </label>
      {styles.length === 0 && <p className="text-xs text-muted">No matching style on this page. Use the Maker style pages below.</p>}
      {style?.color_channel_key && <label className="block text-xs">Component color
        <select className="mt-1 block w-full rounded border bg-background p-2 text-foreground" aria-label={`Color for ${itemId}`}
          value={swatchKey ?? ''} onChange={event => setSwatchKey(event.target.value || null)}>
          <option value="">Choose a color</option>
          {source.colors.find(row => row.key === style.color_channel_key)?.swatches.map(row => <option key={row.key} value={row.key}>{row.label || row.key}</option>)}
        </select>
      </label>}
    </>}
    {previous && <p className="text-xs">{previous.label} · wallet ownership is unchanged.</p>}
    <p className="text-xs text-muted" role="status">{eligibility.reason}</p>
    <Button disabled={!canStart || !eligibility.allowed} onClick={() => void start(choice)}>
      {previous ? 'Replace component atomically' : 'Equip component'}</Button>
  </div>
}

function equipmentReplacements(snapshot: Snapshot, part: string | undefined, definitionId = snapshot.rootId) {
  const slot = snapshot.equipment?.loadout.definition_slots.find(row => row.source_definition_id === definitionId && row.part_key === part)
  if (!slot || slot.capacity !== '1') return []
  return snapshot.equipment?.loadout.selections.flatMap((row,index) => {
    if (!row || row.part_key !== part || !slot || index < Number(slot.start) || index >= Number(slot.start) + Number(slot.capacity)) return []
    const instance = snapshot.equipment!.instances.find(value => value.item.id === row.access_subject)
    const removal: AnimacraftEquipmentV8Removal | null = instance ? { kind: instance.kind, itemId: instance.item.id }
      : clearableEquipmentSelection(snapshot,index) ? { kind: 'selection', selectionIndex: String(index) } : null
    return removal ? [{ removal, key: instance?.item.id ?? `selection:${index}`,
      label: `Replaces ${part} · ${instance ? short(instance.item.id) : row.item_key}` }] : []
  }) ?? []
}

function PackAttachmentControls({ snapshot, canStart, start }: {
  snapshot: Snapshot; canStart: boolean; start: (operation: EquipmentOperation) => Promise<void>
}) {
  const selected = snapshot.source!.pack!.selected!
  const pack = { releaseId: selected.release.id, passId: selected.pass.id }
  const status = packAttachmentEligibility(snapshot, pack)
  return <div className="mt-2 space-y-2">
    <p className="text-xs text-muted">Attach this Pack’s definitions and slots to this Soul. This does not buy access or select a style.</p>
    <p className="text-xs text-muted" role="status">{status.reason}</p>
    <Button disabled={!canStart || !status.allowed} onClick={() => void start({ kind: 'attach-pack', pack })}>Attach Pack</Button>
  </div>
}

function PackSelectionControls({ snapshot,style,canStart,start }: {
  snapshot: Snapshot; style: PackStyle; canStart: boolean; start: (operation: EquipmentOperation) => Promise<void>
}) {
  const [swatchKey,setSwatchKey] = useState<string | null>(null)
  const source = snapshot.source!; const pack = source.pack!.selected!
  const replacements = equipmentReplacements(snapshot,style.part_key,
    style.definition_sources.part === 2 ? pack.release.id : source.root.id)
  const previous = replacements.length === 1 ? replacements[0] : undefined
  const operation: EquipmentOperation = { kind: 'select-pack',selection: { baseRegistryId: source.base.id,
    releaseId: pack.release.id,passId: pack.pass.id,partKey: style.part_key,itemKey: style.item_key,styleKey: style.style_key,swatchKey },
    ...(previous ? { replaces: previous.removal } : {}) }
  const eligibility = packSelectionEligibility(snapshot,operation)
  const label = `${pack.release.id}/${style.part_key}/${style.item_key}/${style.style_key}`
  return <div className="mt-3 space-y-2">
    {style.color_channel_key !== null && <label className="block text-xs">Pack color
      <select className="mt-1 block w-full rounded border bg-background p-2 text-foreground" aria-label={`Pack color for ${label}`}
        value={swatchKey ?? ''} onChange={event => setSwatchKey(event.target.value || null)}>
        <option value="">Choose a color</option>
        {equipmentPackStyleColor(pack, style)?.swatches.map(row => <option key={row.key} value={row.key}>{row.label || row.key}</option>)}
      </select>
    </label>}
    {previous && <p className="text-xs">{previous.label} · only the current equipment changes.</p>}
    <p className="text-xs text-muted" role="status">{eligibility.reason}</p>
    <Button disabled={!canStart || !eligibility.allowed} onClick={() => void start(operation)}>
      {previous ? 'Replace with Pack style' : 'Use Pack style'}</Button>
  </div>
}

function BaseSelectionControls({ snapshot, style, canStart, start }: {
  snapshot: Snapshot; style: NonNullable<Snapshot['source']>['styles'][number]; canStart: boolean
  start: (operation: EquipmentOperation) => Promise<void>
}) {
  const [swatchKey,setSwatchKey] = useState<string | null>(null)
  const source = snapshot.source!
  const replacements = equipmentReplacements(snapshot,style.part_key)
  const previous = replacements.length === 1 ? replacements[0] : undefined
  const proof = style.protected ? protectedBaseProof(snapshot,style.part_key,style.item_key,style.style_key) : null
  const operation: EquipmentOperation = { kind: 'select-base', styleStart: source.stylePage.start,
    selection: { baseRegistryId: source.base.id, partKey: style.part_key, itemKey: style.item_key, styleKey: style.style_key, swatchKey,
      ...(proof ? { protection: proof } : {}) },
    ...(previous ? { replaces: previous.removal } : {}) }
  const eligibility = baseSelectionEligibility(snapshot,operation)
  const label = `${style.part_key}/${style.item_key}/${style.style_key}`
  return <div className="mt-3 space-y-2">
    <p className="text-xs text-muted">Included Maker content · no independent wallet item required</p>
    {style.color_channel_key !== null && <label className="block text-xs">Selection color
      <select className="mt-1 block w-full rounded border bg-background p-2 text-foreground" aria-label={`Selection color for ${label}`}
        value={swatchKey ?? ''} onChange={event => setSwatchKey(event.target.value || null)}>
        <option value="">Choose a color</option>
        {source.colors.find(row => row.key === style.color_channel_key)?.swatches.map(row => <option key={row.key} value={row.key}>{row.label || row.key}</option>)}
      </select>
    </label>}
    {previous && <p className="text-xs">{previous.label} · only the current equipment changes.</p>}
    <p className="text-xs text-muted" role="status">{eligibility.reason}</p>
    <Button disabled={!canStart || !eligibility.allowed} onClick={() => void start(operation)}>
      {previous ? 'Replace with Maker style' : 'Use Maker style'}</Button>
  </div>
}
