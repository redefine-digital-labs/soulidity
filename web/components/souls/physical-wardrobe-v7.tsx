'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  assertPhysicalWardrobeV7Runtime,
  buildDepositAndEquipPhysicalStyleV7Tx,
  buildDepositAndSwapPhysicalStyleV7Tx,
  buildEmergencyWithdrawPhysicalStyleV7Tx,
  buildEquipPhysicalStyleV7Tx,
  buildSwapPhysicalStyleV7Tx,
  buildUnequipPhysicalStyleV7Tx,
  buildWithdrawPhysicalStyleV7Tx,
  fetchPhysicalWardrobeV7Snapshot,
  physicalPartPolicyV7AcceptsAsset,
  physicalPartPolicyV7CanUnequip,
  physicalWardrobeV7OperationReadbackMatches,
  physicalWardrobeV7SlotKeys,
  physicalWardrobeV7RuntimeFromPublicEnv,
  renderPhysicalRendererV7Scene,
  resolvePhysicalRendererV7Scene,
  type PhysicalRendererV7AssetMetadata,
  type PhysicalRendererV7Scene,
  type PhysicalPartPolicyV7View,
  type PhysicalStyleAssetV7View,
  type PhysicalWardrobeV7Operation,
} from '@soulidity/sdk'
import { useWalletSign } from '@/lib/hooks/use-wallet-sign'
import { Button } from '@/components/ui/button'
import { Tag } from '@/components/ui/tag'

type Role = 'owner' | 'grantee' | 'visitor'
type AssetSource = 'wardrobe' | 'wallet'

interface SelectedStyle {
  source: AssetSource
  asset: PhysicalStyleAssetV7View
}

function shortId(value: string | null | undefined) {
  if (!value) return '—'
  return `${value.slice(0, 6)}…${value.slice(-4)}`
}

function operationLabel(operation: PhysicalWardrobeV7Operation | null) {
  if (operation === 'deposit-and-equip') return 'Deposit & equip'
  if (operation === 'deposit-and-swap') return 'Deposit & replace'
  if (operation === 'equip') return 'Equip Style'
  if (operation === 'swap') return 'Replace equipped Style'
  if (operation === 'unequip') return 'Unequip to Soul wardrobe'
  if (operation === 'withdraw') return 'Withdraw to wallet'
  if (operation === 'emergency-withdraw') return 'Emergency recover to wallet'
  return 'Replace Style'
}

function partPolicyLabel(policy: PhysicalPartPolicyV7View | null) {
  if (!policy) return 'Verified Part'
  if (policy.behavior === 0) return 'Fixed'
  if (policy.behavior === 1) return 'Soul wardrobe only'
  if (policy.behavior === 2) return 'External Styles'
  return 'Soul + external Styles'
}

function StyleCard({
  asset,
  metadata,
  source,
  equipped,
  selected,
  disabled = false,
  onSelect,
}: {
  asset: PhysicalStyleAssetV7View
  metadata?: PhysicalRendererV7AssetMetadata
  source: AssetSource
  equipped: boolean
  selected: boolean
  disabled?: boolean
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      className={`min-w-0 rounded-xl border p-3 text-left transition disabled:cursor-wait disabled:opacity-60 ${
        selected
          ? 'border-purple bg-[var(--ui-soft-action)] shadow-[0_0_0_1px_var(--purple)]'
          : 'border-[var(--border-soft)] bg-[var(--ui-surface)] hover:border-purple/60'
      }`}
      onClick={onSelect}
    >
      <div className="mb-2 flex aspect-square items-center justify-center overflow-hidden rounded-lg bg-[var(--ui-surface-muted)]">
        {metadata?.thumbnailUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={metadata.thumbnailUrl} alt="" className="h-full w-full object-contain" />
        ) : (
          <span className="text-3xl" aria-hidden>✦</span>
        )}
      </div>
      <div className="truncate text-[13px] font-bold text-foreground">
        {metadata?.name ?? asset.name}
      </div>
      <div className="mt-1 flex flex-wrap gap-1">
        <Tag color={equipped ? 'success' : source === 'wallet' ? 'gold' : 'muted'}>
          {equipped ? 'Equipped' : source === 'wallet' ? 'Wallet' : 'Soul wardrobe'}
        </Tag>
        {asset.soulLocal && <Tag color="teal">Soul-local</Tag>}
      </div>
      <div className="mt-2 truncate font-mono text-[10px] text-[var(--text-faint)]">
        {shortId(asset.objectId)}
      </div>
    </button>
  )
}

function VerifiedWardrobePreview({ scene }: { scene: PhysicalRendererV7Scene }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [renderError, setRenderError] = useState<string | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    let cancelled = false
    setRenderError(null)
    void renderPhysicalRendererV7Scene(scene, canvas).catch((error) => {
      if (!cancelled) {
        setRenderError(error instanceof Error ? error.message : 'Unable to draw the verified Loadout')
      }
    })
    return () => { cancelled = true }
  }, [scene])

  return (
    <section className="rounded-xl border border-purple/30 bg-[var(--ui-surface-muted)] p-4">
      <div className="grid gap-4 md:grid-cols-[minmax(0,320px)_1fr] md:items-start">
        <div className="overflow-hidden rounded-xl border border-[var(--border-soft)] bg-[var(--ui-surface)]">
          <canvas
            ref={canvasRef}
            className="block h-auto w-full"
            aria-label="Cryptographically verified current wardrobe preview"
          />
        </div>
        <div>
          <div className="text-[11px] font-bold uppercase tracking-[0.08em] text-action-label">
            Verified live Loadout
          </div>
          <div className="mt-1 text-base font-bold text-foreground">
            {scene.layers.length} immutable layer(s)
          </div>
          <p className="mt-2 text-[12px] leading-5 text-muted">
            This preview was rebuilt from the exact Sui Profiles and Product commitments, then checked against the hash-bound Walrus companion, base Maker manifest and PNGs.
          </p>
          <p className="mt-2 text-[11px] leading-5 text-[var(--text-faint)]">
            Wardrobe changes update this canonical live preview. The Soul&apos;s original immutable profile image remains its mint-time historical image.
          </p>
          {renderError && <div className="mt-2 text-[12px] text-danger">{renderError}</div>}
        </div>
      </div>
    </section>
  )
}

export function PhysicalWardrobeV7Panel({
  soulObjectId,
  soulStateObjectId,
  currentOwnerAddress,
  role,
  listed,
}: {
  soulObjectId: string
  soulStateObjectId: string
  currentOwnerAddress: string
  role: Role
  listed: boolean
}) {
  const runtime = useMemo(() => physicalWardrobeV7RuntimeFromPublicEnv(), [])
  const runtimeError = useMemo(() => {
    try {
      assertPhysicalWardrobeV7Runtime(runtime)
      return null
    } catch (error) {
      return error instanceof Error ? error.message : 'Physical Wardrobe v7 is unavailable'
    }
  }, [runtime])
  const { suiWallet, suiClient, signAndExecute } = useWalletSign()
  const queryClient = useQueryClient()
  const [currentSlot, setCurrentSlot] = useState<string | null>(null)
  const [selected, setSelected] = useState<SelectedStyle | null>(null)
  const [pending, setPending] = useState<PhysicalWardrobeV7Operation | null>(null)
  const [actionStatus, setActionStatus] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const walletAddress = suiWallet?.address ?? currentOwnerAddress

  const queryKey = useMemo(() => [
    'physical-wardrobe-v7',
    runtime.animacraftTypeOriginPackageId,
    soulObjectId,
    walletAddress,
  ], [runtime.animacraftTypeOriginPackageId, soulObjectId, walletAddress])

  const wardrobeQuery = useQuery({
    queryKey,
    enabled: runtimeError == null && Boolean(soulObjectId && walletAddress),
    queryFn: () => fetchPhysicalWardrobeV7Snapshot(suiClient as never, runtime, {
      soulObjectId,
      soulStateObjectId,
      walletAddress,
    }),
    staleTime: 8_000,
  })
  const rendererQuery = useQuery({
    queryKey: [
      ...queryKey,
      'canonical-renderer',
      wardrobeQuery.data?.wardrobe.revision.toString() ?? 'unbound',
    ],
    enabled: runtimeError == null && wardrobeQuery.data != null,
    queryFn: () => {
      if (!wardrobeQuery.data) throw new Error('The on-chain wardrobe is not loaded')
      return resolvePhysicalRendererV7Scene(suiClient as never, runtime, wardrobeQuery.data)
    },
    staleTime: Number.POSITIVE_INFINITY,
  })

  if (runtimeError) {
    return (
      <div className="space-y-4 p-5">
        <div>
          <h3 className="m-0 text-lg font-bold text-foreground">Soul wardrobe</h3>
          <p className="mt-1.5 text-[13px] text-muted">
            Physical Style assets are staged behind a separate v7 gate. Existing Soul, content and v6 appearance data are unchanged.
          </p>
        </div>
        <div className="rounded-xl border border-[var(--border-soft)] bg-[var(--ui-surface)] p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="font-semibold text-foreground">Not activated</div>
              <div className="mt-1 text-[12px] text-muted">{runtimeError}</div>
            </div>
            <Tag color="muted">Gate closed</Tag>
          </div>
        </div>
      </div>
    )
  }

  if (wardrobeQuery.isLoading) {
    return <div className="p-5 text-[13px] text-muted">Loading the on-chain Soul wardrobe…</div>
  }

  if (wardrobeQuery.error) {
    return (
      <div className="p-5">
        <div className="rounded-xl border border-danger/40 bg-danger/10 p-4 text-[13px] text-danger">
          {wardrobeQuery.error instanceof Error ? wardrobeQuery.error.message : 'Unable to load the Soul wardrobe'}
        </div>
      </div>
    )
  }

  const snapshot = wardrobeQuery.data
  if (!snapshot) {
    return (
      <div className="space-y-4 p-5">
        <h3 className="m-0 text-lg font-bold text-foreground">Soul wardrobe</h3>
        <div className="rounded-xl border border-dashed border-[var(--border-soft)] bg-[var(--ui-surface)] p-5 text-[13px] text-muted">
          This Soul has no Physical Wardrobe v7 companion. A v7 Maker mint or reviewed upgrade must bind it; the UI will not guess Maker/Profile IDs.
        </div>
      </div>
    )
  }

  const slots = physicalWardrobeV7SlotKeys(snapshot)
  const rendererMetadata = rendererQuery.data?.assetMetadata ?? {}
  const activeSlot = currentSlot && slots.includes(currentSlot) ? currentSlot : (slots[0] ?? null)
  const activePolicy = activeSlot
    ? snapshot.maker.partPolicies.find((policy) => policy.slotKey === activeSlot) ?? null
    : null
  const equippedRow = activeSlot
    ? snapshot.wardrobe.loadout.find((row) => row.slotKey === activeSlot) ?? null
    : null
  const equippedAsset = equippedRow
    ? snapshot.wardrobeAssets.find((asset) => asset.objectId === equippedRow.styleAssetObjectId) ?? null
    : null
  const wardrobeAssets = snapshot.wardrobeAssets.filter((asset) =>
    asset.slotKey === activeSlot && !asset.equipped,
  )
  const walletAssets = snapshot.walletAssets.filter((asset) =>
    asset.slotKey === activeSlot
    && asset.profileObjectId === snapshot.wardrobe.profileObjectId,
  )
  const isOwner = role === 'owner' && suiWallet?.address?.toLowerCase() === currentOwnerAddress.toLowerCase()
  const chainListed = snapshot.wardrobe.listed
  const listingMirrorMismatch = listed !== chainListed

  const maker = snapshot.maker
  const soul = {
    soulObjectId,
    soulStateObjectId,
    wardrobeObjectId: snapshot.wardrobe.objectId,
    expectedRevision: snapshot.wardrobe.revision,
  }
  const currentRevision = snapshot.wardrobe.revision

  async function execute(operation: PhysicalWardrobeV7Operation) {
    if (!isOwner || !selected) return
    if (chainListed) {
      setActionError('This Soul is listed on chain. Delist it before changing the wardrobe.')
      return
    }
    if (wardrobeQuery.isFetching) {
      setActionError('The latest wardrobe revision is still loading. Try again in a moment.')
      return
    }
    if (
      (operation === 'deposit-and-equip'
        || operation === 'deposit-and-swap'
        || operation === 'equip'
        || operation === 'swap')
      && !selectedFitsPart
    ) {
      setActionError('The sealed Maker Part policy does not accept this Style.')
      return
    }
    if (operation === 'unequip' && !canUnequipCurrent) {
      setActionError('A fixed or required Part cannot be left empty. Equip a replacement instead.')
      return
    }
    if (
      (operation === 'deposit-and-equip' || operation === 'deposit-and-swap')
      && selected.source !== 'wallet'
    ) {
      setActionError('Only a wallet Style can be deposited into the Soul wardrobe.')
      return
    }
    if (
      (operation === 'equip' || operation === 'swap' || operation === 'unequip' || operation === 'withdraw')
      && selected.source !== 'wardrobe'
    ) {
      setActionError('This action requires a Style already held by the Soul wardrobe.')
      return
    }
    if (
      (operation === 'deposit-and-equip' || operation === 'equip')
      && equippedRow
    ) {
      setActionError('This Part is occupied. Use the atomic replacement action instead.')
      return
    }
    if (
      (operation === 'deposit-and-swap' || operation === 'swap')
      && !equippedRow
    ) {
      setActionError('This Part is empty. Use the equip action instead.')
      return
    }
    if (operation === 'unequip' && !selectedIsEquipped) {
      setActionError('Only the currently equipped Style can be unequipped.')
      return
    }
    if (operation === 'withdraw' && !canWithdraw) {
      setActionError('Only an unequipped external Style can be withdrawn to the wallet.')
      return
    }
    const styleProductObjectId = selected.asset.styleProductObjectId
    const styleAssetObjectId = selected.asset.objectId
    const replacedStyleAssetObjectId =
      operation === 'deposit-and-swap' || operation === 'swap'
        ? equippedRow?.styleAssetObjectId ?? null
        : null
    const previousRevision = currentRevision
    setPending(operation)
    setActionStatus('Waiting for the owner wallet signature…')
    setActionError(null)
    try {
      let tx
      if (operation === 'deposit-and-equip') {
        if (!styleProductObjectId) throw new Error('Style asset is missing its immutable product ID')
        tx = buildDepositAndEquipPhysicalStyleV7Tx({
          runtime, maker, soul, styleProductObjectId,
          walletStyleAssetObjectId: selected.asset.objectId,
        })
      } else if (operation === 'deposit-and-swap') {
        if (!styleProductObjectId || !equippedRow) throw new Error('Replacement input is incomplete')
        tx = buildDepositAndSwapPhysicalStyleV7Tx({
          runtime, maker, soul, styleProductObjectId,
          walletStyleAssetObjectId: selected.asset.objectId,
          equippedStyleAssetObjectId: equippedRow.styleAssetObjectId,
        })
      } else if (operation === 'equip') {
        if (!styleProductObjectId) throw new Error('Style asset is missing its immutable product ID')
        if (equippedRow) throw new Error('This Part is occupied; use the atomic replace action')
        tx = buildEquipPhysicalStyleV7Tx({
          runtime, maker, soul, styleProductObjectId,
          wardrobeStyleAssetObjectId: selected.asset.objectId,
        })
      } else if (operation === 'swap') {
        if (!styleProductObjectId || !equippedRow) throw new Error('Replacement input is incomplete')
        tx = buildSwapPhysicalStyleV7Tx({
          runtime, maker, soul, styleProductObjectId,
          wardrobeStyleAssetObjectId: selected.asset.objectId,
          equippedStyleAssetObjectId: equippedRow.styleAssetObjectId,
        })
      } else if (operation === 'unequip') {
        if (!equippedRow) throw new Error('This Part has no equipped Style')
        tx = buildUnequipPhysicalStyleV7Tx({
          runtime, maker, soul,
          equippedStyleAssetObjectId: equippedRow.styleAssetObjectId,
        })
      } else if (operation === 'withdraw') {
        tx = buildWithdrawPhysicalStyleV7Tx({
          runtime, maker, soul,
          wardrobeStyleAssetObjectId: selected.asset.objectId,
        })
      } else if (operation === 'emergency-withdraw') {
        if (!selectedIsEquipped || selected.asset.soulLocal) {
          throw new Error('Emergency recovery only applies to an equipped external Style')
        }
        tx = buildEmergencyWithdrawPhysicalStyleV7Tx({
          runtime, maker, soul,
          equippedStyleAssetObjectId: selected.asset.objectId,
        })
      } else {
        throw new Error(`Unsupported wardrobe operation: ${operation}`)
      }
      const result = await signAndExecute(tx)
      setActionStatus(`Transaction ${shortId(result.digest)} confirmed. Reading the new wardrobe revision…`)
      let readbackRevision: bigint | null = null
      for (let attempt = 0; attempt < 8; attempt += 1) {
        const readback = await wardrobeQuery.refetch()
        if (readback.error) throw readback.error
        if (
          readback.data
          && physicalWardrobeV7OperationReadbackMatches(
            readback.data,
            operation as Exclude<PhysicalWardrobeV7Operation, 'create'>,
            styleAssetObjectId,
            previousRevision,
            replacedStyleAssetObjectId,
          )
        ) {
          readbackRevision = readback.data.wardrobe.revision
          break
        }
        await new Promise((resolve) => setTimeout(resolve, 750))
      }
      if (readbackRevision == null) {
        throw new Error(
          `Transaction ${shortId(result.digest)} was confirmed, but the wardrobe readback is delayed. Refresh before submitting another action.`,
        )
      }
      setSelected(null)
      setActionStatus(`Confirmed on chain · wardrobe revision ${readbackRevision.toString()}`)
      await queryClient.invalidateQueries({ queryKey: [...queryKey, 'canonical-renderer'] })
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Wardrobe transaction failed')
      setActionStatus(null)
    } finally {
      setPending(null)
    }
  }

  const selectedIsEquipped = Boolean(
    selected && equippedRow?.styleAssetObjectId === selected.asset.objectId,
  )
  const selectedFitsPart = Boolean(
    selected && physicalPartPolicyV7AcceptsAsset(activePolicy, selected.asset),
  )
  const canUnequipCurrent = physicalPartPolicyV7CanUnequip(activePolicy)
  const primaryOperation: PhysicalWardrobeV7Operation | null = !selected
    ? null
    : selectedIsEquipped
      ? (canUnequipCurrent ? 'unequip' : null)
      : !selectedFitsPart
        ? null
          : selected.source === 'wallet'
            ? (equippedRow ? 'deposit-and-swap' : 'deposit-and-equip')
            : (equippedRow ? 'swap' : 'equip')
  const canWithdraw = Boolean(
    selected
    && selected.source === 'wardrobe'
    && !selectedIsEquipped
    && !selected.asset.soulLocal
  )

  return (
    <div className="space-y-5 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="m-0 text-lg font-bold text-foreground">Soul wardrobe</h3>
          <p className="mt-1.5 max-w-[64ch] text-[13px] text-muted">
            Part is the slot, Item is the product family, and Style is the exact on-chain asset. Colors are concrete Styles; Smart Color is not applied here.
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Tag color="teal">Revision {snapshot.wardrobe.revision.toString()}</Tag>
          <Tag color="muted">{snapshot.wardrobe.externalAssetCount} external</Tag>
          <Tag color="muted">{snapshot.wardrobe.soulLocalAssetCount} Soul-local</Tag>
        </div>
      </div>

      {chainListed && (
        <div className="rounded-xl border border-gold/40 bg-[var(--ui-soft-value)] p-3 text-[12px] text-muted">
          This Soul is listed on chain. Wardrobe mutations are locked until it is delisted. Listing is only valid when external assets are zero.
        </div>
      )}
      {listingMirrorMismatch && (
        <div className="rounded-xl border border-[var(--border-soft)] bg-[var(--ui-surface-muted)] p-3 text-[11px] text-muted">
          The indexer listing status is still synchronizing. The verified on-chain wardrobe state controls every action.
        </div>
      )}

      {rendererQuery.isLoading && (
        <div className="rounded-xl border border-[var(--border-soft)] p-4 text-[12px] text-muted">
          Verifying Sui product commitments and Walrus renderer assets…
        </div>
      )}
      {rendererQuery.error && (
        <div className="rounded-xl border border-danger/40 bg-danger/10 p-4 text-[12px] text-danger">
          Live wardrobe preview is hidden because integrity verification failed: {' '}
          {rendererQuery.error instanceof Error ? rendererQuery.error.message : 'unknown renderer error'}
        </div>
      )}
      {rendererQuery.data && <VerifiedWardrobePreview scene={rendererQuery.data} />}

      {slots.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[var(--border-soft)] p-5 text-[13px] text-muted">
          No Part slots or Style assets were found in this wardrobe.
        </div>
      ) : (
        <>
          <div className="flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label="Wardrobe Parts">
            {slots.map((slot) => {
              const equipped = snapshot.wardrobe.loadout.some((row) => row.slotKey === slot)
              return (
                <button
                  type="button"
                  role="tab"
                  aria-selected={slot === activeSlot}
                  disabled={pending !== null || wardrobeQuery.isFetching}
                  key={slot}
                  onClick={() => {
                    setCurrentSlot(slot)
                    setSelected(null)
                    setActionError(null)
                    setActionStatus(null)
                  }}
                  className={`whitespace-nowrap rounded-xl border px-3 py-2 text-[12px] font-bold transition disabled:cursor-wait disabled:opacity-60 ${
                    slot === activeSlot
                      ? 'border-purple bg-[var(--ui-soft-action)] text-foreground'
                      : 'border-[var(--border-soft)] text-muted hover:text-foreground'
                  }`}
                >
                  {slot} {equipped ? '●' : '○'}
                </button>
              )
            })}
          </div>

          <section className="rounded-xl border border-[var(--border-soft)] bg-[var(--ui-surface-muted)] p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <div className="text-[11px] font-bold uppercase tracking-[0.08em] text-action-label">Current Part</div>
                <div className="mt-1 text-base font-bold text-foreground">{activeSlot}</div>
              </div>
              <div className="flex flex-wrap justify-end gap-1.5">
                <Tag color={activePolicy?.required ? 'gold' : 'muted'}>
                  {activePolicy?.required ? 'Required' : 'Optional'}
                </Tag>
                <Tag color="teal">{partPolicyLabel(activePolicy)}</Tag>
              </div>
            </div>
            <div className="text-[12px] text-muted">Every Part comes from the sealed Maker policy, so an empty configurable slot stays visible before you own a Style for it.</div>
          </section>

          <section className="rounded-xl border border-[var(--border-soft)] bg-[var(--ui-surface)] p-4">
            <div className="mb-2.5 flex items-center justify-between">
              <div>
                <div className="text-[12px] font-bold uppercase tracking-[0.08em] text-action-label">Currently equipped</div>
                <div className="mt-1 text-[11px] text-muted">The Style currently rendered on this Soul.</div>
              </div>
              <Tag color={equippedAsset ? 'success' : 'muted'}>{equippedAsset ? 'Equipped' : 'Empty'}</Tag>
            </div>
            {equippedAsset ? (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                <StyleCard
                  asset={equippedAsset}
                  metadata={rendererMetadata[equippedAsset.objectId]}
                  source="wardrobe"
                  equipped
                  selected={selected?.asset.objectId === equippedAsset.objectId}
                  disabled={pending !== null || wardrobeQuery.isFetching}
                  onSelect={() => setSelected({ source: 'wardrobe', asset: equippedAsset })}
                />
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-[var(--border-soft)] p-4 text-[12px] text-muted">Nothing is equipped in this Part.</div>
            )}
          </section>

          <section className="rounded-xl border border-[var(--border-soft)] bg-[var(--ui-surface)] p-4">
            <div className="mb-2.5 flex items-center justify-between">
              <div>
                <div className="text-[12px] font-bold uppercase tracking-[0.08em] text-action-label">Soul wardrobe</div>
                <div className="mt-1 text-[11px] text-muted">Unequipped Styles held safely inside this Soul.</div>
              </div>
              <span className="text-[11px] text-[var(--text-faint)]">{wardrobeAssets.length} Style asset(s)</span>
            </div>
            {wardrobeAssets.length > 0 ? (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                {wardrobeAssets.map((asset) => (
                  <StyleCard
                    key={asset.objectId}
                    asset={asset}
                    metadata={rendererMetadata[asset.objectId]}
                    source="wardrobe"
                    equipped={false}
                    selected={selected?.asset.objectId === asset.objectId}
                    disabled={pending !== null || wardrobeQuery.isFetching}
                    onSelect={() => setSelected({ source: 'wardrobe', asset })}
                  />
                ))}
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-[var(--border-soft)] p-4 text-[12px] text-muted">No unequipped Style for this Part is stored in the Soul wardrobe.</div>
            )}
          </section>

          <section className="rounded-xl border border-[var(--border-soft)] bg-[var(--ui-surface)] p-4">
            <div className="mb-2.5 flex items-center justify-between">
              <div>
                <div className="text-[12px] font-bold uppercase tracking-[0.08em] text-action-label">Wallet backpack</div>
                <div className="mt-1 text-[11px] text-muted">Compatible exact Styles held by the connected owner wallet.</div>
              </div>
              <span className="text-[11px] text-[var(--text-faint)]">{walletAssets.length} Style asset(s)</span>
            </div>
            {isOwner ? (
              walletAssets.length > 0 ? (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                  {walletAssets.map((asset) => (
                    <StyleCard
                      key={asset.objectId}
                      asset={asset}
                      metadata={rendererMetadata[asset.objectId]}
                      source="wallet"
                      equipped={false}
                      selected={selected?.asset.objectId === asset.objectId}
                      disabled={pending !== null || wardrobeQuery.isFetching}
                      onSelect={() => setSelected({ source: 'wallet', asset })}
                    />
                  ))}
                </div>
              ) : (
                <div className="rounded-xl border border-dashed border-[var(--border-soft)] p-4 text-[12px] text-muted">No compatible wallet Style is available for this Part.</div>
              )
            ) : (
              <div className="rounded-xl border border-dashed border-[var(--border-soft)] p-4 text-[12px] text-muted">Connect the current owner wallet to view its compatible backpack Styles.</div>
            )}
          </section>

          <section className="rounded-xl border border-[var(--border-soft)] bg-[var(--ui-surface)] p-4">
            <div className="mb-2.5 flex items-center justify-between">
              <div>
                <div className="text-[12px] font-bold uppercase tracking-[0.08em] text-action-label">Available products</div>
                <div className="mt-1 text-[11px] text-muted">Free claims and paid Styles admitted to this exact Maker Profile.</div>
              </div>
              <Tag color="muted">Catalog</Tag>
            </div>
            <div className="rounded-xl border border-dashed border-[var(--border-soft)] p-4 text-[12px] text-muted">
              No additional on-chain product catalog is connected to this view yet. Styles already owned by your wallet remain available in Wallet backpack.
            </div>
          </section>

          {selected && (
            <section className="rounded-xl border border-purple/40 bg-[var(--ui-soft-action)] p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-[11px] font-bold uppercase tracking-[0.08em] text-action-label">Selected Style</div>
                  <div className="mt-1 text-[14px] font-bold text-foreground">
                    {rendererMetadata[selected.asset.objectId]?.name ?? selected.asset.name}
                  </div>
                  <div className="mt-1 text-[12px] text-muted">
                    {selectedIsEquipped
                      ? 'Currently equipped on this Soul'
                      : selected.source === 'wallet'
                        ? 'Wallet backpack → Soul wardrobe → equipped'
                        : 'Stored in the Soul wardrobe'}
                  </div>
                  {!selectedFitsPart && !selectedIsEquipped && (
                    <div className="mt-1 text-[12px] text-danger">The sealed Part policy does not accept this Style.</div>
                  )}
                  {selectedIsEquipped && !canUnequipCurrent && (
                    <div className="mt-1 text-[12px] text-muted">This required or fixed Part cannot be left empty. Select a compatible replacement instead.</div>
                  )}
                </div>
                {isOwner && (
                  <div className="flex flex-wrap gap-2">
                    {primaryOperation && (
                      <Button
                        variant="primary"
                        size="sm"
                        disabled={pending !== null || wardrobeQuery.isFetching || chainListed}
                        onClick={() => void execute(primaryOperation)}
                      >
                        {pending === primaryOperation ? 'Waiting for wallet…' : operationLabel(primaryOperation)}
                      </Button>
                    )}
                    {canWithdraw && (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={pending !== null || wardrobeQuery.isFetching || chainListed}
                        onClick={() => void execute('withdraw')}
                      >
                        {pending === 'withdraw' ? 'Waiting for wallet…' : 'Withdraw to wallet'}
                      </Button>
                    )}
                    {selectedIsEquipped && !selected.asset.soulLocal && (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={pending !== null || wardrobeQuery.isFetching || chainListed}
                        onClick={() => void execute('emergency-withdraw')}
                      >
                        {pending === 'emergency-withdraw'
                          ? 'Waiting for wallet…'
                          : 'Emergency recover'}
                      </Button>
                    )}
                  </div>
                )}
              </div>
            </section>
          )}
        </>
      )}

      {!isOwner && role === 'owner' && (
        <div className="text-[12px] text-danger">Connect the current owner wallet to change this wardrobe.</div>
      )}
      {actionStatus && (
        <div className="rounded-xl border border-teal/30 bg-teal/10 p-3 text-[12px] text-foreground" role="status">
          {actionStatus}
        </div>
      )}
      {actionError && <div className="text-[12px] text-danger">{actionError}</div>}
      <div className="text-[11px] leading-5 text-[var(--text-faint)]">
        Recovery: pause/archive never blocks withdrawal; a listed Soul must be delisted first; Soul-local Styles cannot leave the Soul; stale revisions, cross-Soul, cross-Maker, wrong Profile and wrong Part all fail on chain.
      </div>
    </div>
  )
}
