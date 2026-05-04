'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useAutoConnectWallet, useCurrentWallet } from '@mysten/dapp-kit'
import Image from 'next/image'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { FlowBar } from '@/components/nav/flow-bar'
import { PageContainer } from '@/components/layout/page-container'
import { SectionHeader } from '@/components/layout/section-header'
import { Tag } from '@/components/ui/tag'
import { buttonStyles } from '@/components/ui/button'
import { useToast } from '@/components/ui/toast'
import { parseDisplayAmountToAtomic } from '@soulidity/sdk'
import { useAuth } from '@/components/providers/auth-provider'
import { useLogin } from '@/lib/hooks/use-login'
import { getWalletActionState } from '@/lib/wallet/wallet-action-state'
import { parseCollectionSupplyCapInput } from '@/lib/collections/supply-cap'
import {
  useCreateCollection,
  collectionSteps,
  type BatchSoulEntry,
  type SoulFolderFiles,
} from '@/components/providers/create-collection-provider'
import { buildCollectionDraftSignature, useCollectionPublish } from '@/lib/hooks/use-collection-publish'

// ── Helpers ──

function formatRoyalty(bps: number) {
  const pct = bps / 100
  return pct % 1 === 0 ? `${pct}%` : `${pct.toFixed(1)}%`
}

function isSoulReady(s: BatchSoulEntry, folder?: SoulFolderFiles, recovered?: boolean) {
  if (recovered) {
    return true
  }
  return !!(s.name && s.description && folder?.characterFile && folder?.memoryFile)
}

// ── Fallback image component ──

function SoulThumb({ name, imageFile }: { name: string; imageFile?: File }) {
  const [erroredSrc, setErroredSrc] = useState<string | null>(null)
  const blobUrl = useMemo(() => (imageFile ? URL.createObjectURL(imageFile) : null), [imageFile])

  useEffect(() => {
    return () => {
      if (blobUrl) {
        URL.revokeObjectURL(blobUrl)
      }
    }
  }, [blobUrl])

  if (!blobUrl || erroredSrc === blobUrl) {
    return (
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-purple/20 text-xs font-bold text-purple">
        {name.slice(0, 2).toUpperCase()}
      </span>
    )
  }

  return (
    <Image
      src={blobUrl}
      alt={name}
      width={32}
      height={32}
      unoptimized
      onError={() => setErroredSrc(blobUrl)}
      className="h-8 w-8 shrink-0 rounded-lg border border-purple/20 object-cover"
    />
  )
}

// ── Soul row ──

function SoulRow({
  soul,
  folder,
  index,
  recovered,
}: {
  soul: BatchSoulEntry
  folder?: SoulFolderFiles
  index: number
  recovered?: boolean
}) {
  const ready = isSoulReady(soul, folder, recovered)

  return (
    <div className="flex items-center gap-3 rounded-xl border border-border/50 bg-card2/40 px-4 py-3">
      <SoulThumb name={soul.name} imageFile={folder?.imageFile} />

      <div className="min-w-0 flex-1">
        <span className="text-sm font-semibold text-foreground">{soul.name}</span>
        <span className="text-sm text-muted"> · #{index + 1} · will mint on Launch</span>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <span title="Character file (soul.md)" className={folder?.characterFile ? 'text-teal' : 'text-muted/40'}>
          <svg viewBox="0 0 16 16" fill="none" className="h-4 w-4">
            <path d="M4.5 2h5l3 3v7.5a1.5 1.5 0 0 1-1.5 1.5H4.5A1.5 1.5 0 0 1 3 12.5V3.5A1.5 1.5 0 0 1 4.5 2Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
            <path d="M9.5 2v3h3" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
          </svg>
        </span>
        <span title="Memory (memory.md)" className={folder?.memoryFile ? 'text-gold' : 'text-muted/40'}>
          <svg viewBox="0 0 16 16" fill="none" className="h-4 w-4">
            <path d="M8 13V9m0 0c0-2.2 1.5-4.2 4.4-4.4 0 3.2-1.8 4.4-4.4 4.4Zm0 0c0-2-1-3.7-3.8-4.2 0 2.8 1.5 4.2 3.8 4.2Z" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
        <span title="Image" className={folder?.imageFile ? 'text-purple' : 'text-muted/40'}>
          <svg viewBox="0 0 16 16" fill="none" className="h-4 w-4">
            <rect x="2" y="2" width="12" height="12" rx="2" stroke="currentColor" strokeWidth="1.2" />
            <circle cx="5.5" cy="5.5" r="1.25" stroke="currentColor" strokeWidth="1" />
            <path d="M2 11l3-3 2 2 3-3 4 4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>

        {ready ? (
          <Tag color="success" className="ml-1 text-[10px]">Ready</Tag>
        ) : (
          <Tag color="danger" className="ml-1 text-[10px]">Incomplete</Tag>
        )}
      </div>
    </div>
  )
}

// ── Settings row ──

function SettingRow({
  label,
  value,
  color,
  bold,
  children,
}: {
  label: string
  value?: string
  color?: 'teal' | 'gold'
  bold?: boolean
  children?: React.ReactNode
}) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <span className="text-[13px] text-muted">{label}</span>
      {children ?? (
        <span
          className={`text-right text-[13px] ${
            color === 'teal'
              ? 'text-teal'
              : color === 'gold'
                ? 'text-gold'
                : bold
                  ? 'font-semibold text-foreground'
                  : 'text-foreground'
          }`}
        >
          {value}
        </span>
      )}
    </div>
  )
}

const statusLabels: Record<string, string> = {
  uploading: 'Uploading cover image…',
  'preparing-souls': 'Preparing Soul assets…',
  building: 'Building transaction…',
  signing: 'Waiting for signature…',
  syncing: 'Syncing on-chain state…',
  'minting-souls': 'Minting Souls…',
  'binding-souls': 'Binding Souls to collection…',
}

// ── Page ──

export default function PreviewPage() {
  const router = useRouter()
  const ctx = useCreateCollection()
  const { name, floorPrice, extraRoyaltyBps, tradeable, batchSouls, collectionRightListingPrice, setPublishResult } = ctx
  const { user } = useAuth()
  const completedDigestRef = useRef<string | null>(null)
  // When recovery state has a committed collection TX, bypass File-dependent guards
  // (File objects cannot survive page refresh, but recovery has all uploaded asset refs)
  const missingStep1 = !ctx.hasRecoveryTx && (!ctx.name.trim() || !ctx.description.trim() || !ctx.coverImageFile)
  const isSkipFlow = ctx.addSoulsMethod === 'skip'
  const missingStep2 = !ctx.hasRecoveryTx && !isSkipFlow && (!ctx.batchFile || ctx.batchSouls.length === 0 || ctx.batchErrors.length > 0 || ctx.folderErrors.length > 0)
  const maxSupplyParam = ctx.unlimitedSupply ? null : parseCollectionSupplyCapInput(ctx.supplyCap)
  // Parse the optional collection-right listing price defensively so render
  // does not crash on intermediate input (e.g. ".", "abc"), and so toggling
  // the checkbox without a price blocks launch instead of silently dropping
  // the listing leg.
  const collectionRightListingActive = ctx.tradeable && ctx.listCollectionRightOnLaunch
  const collectionRightListingParse = useMemo(() => {
    if (!collectionRightListingActive) {
      return { atomic: null as string | null, error: null as string | null }
    }
    const trimmed = collectionRightListingPrice.trim()
    if (!trimmed) {
      return { atomic: null, error: 'Listing price is required when listing collection-right at launch' }
    }
    try {
      const atomic = parseDisplayAmountToAtomic(trimmed)
      if (atomic <= 0n) {
        return { atomic: null, error: 'Listing price must be greater than zero' }
      }
      return { atomic: atomic.toString(), error: null }
    } catch (err) {
      return { atomic: null, error: err instanceof Error ? err.message : 'Invalid listing price' }
    }
  }, [collectionRightListingActive, collectionRightListingPrice])
  const collectionRightListingPriceAtomic = collectionRightListingParse.atomic
  const collectionRightListingPriceError = collectionRightListingParse.error
  const draftSignature = !missingStep1 && !missingStep2
    ? buildCollectionDraftSignature({
        name: ctx.name,
        description: ctx.description,
        extraRoyaltyBps: ctx.extraRoyaltyBps,
        tradeable: ctx.tradeable,
        floorPriceAtomic: ctx.floorPrice ? parseDisplayAmountToAtomic(ctx.floorPrice).toString() : null,
        maxSupply: maxSupplyParam,
        collectionRightListing: collectionRightListingPriceAtomic ? { priceAtomic: collectionRightListingPriceAtomic } : null,
        souls: ctx.batchSouls.map((s) => ({
          name: s.name,
          description: s.description,
          tags: s.tags,
          creatorRoyaltyBps: s.creatorRoyaltyBps,
        })),
      })
    : null
  const { status, error, txDigest, syncData, progress, publish, suiWallet, resetRecovery } = useCollectionPublish(draftSignature)
  const { showToast } = useToast()
  const walletConnection = useCurrentWallet()
  const autoConnectStatus = useAutoConnectWallet()
  const openWalletLogin = useLogin()

  const floor = floorPrice || '0'
  const royaltyDisplay = formatRoyalty(extraRoyaltyBps)
  const displayName = user?.displayName || user?.tgName || 'you'
  const soulNames = batchSouls.map((s) => s.name).join(', ')

  const isBusy = status !== 'idle' && status !== 'done' && status !== 'error'
  const walletRestoring = !suiWallet && (walletConnection.isConnecting || autoConnectStatus === 'idle')
  const walletActionState = getWalletActionState({
    hasActiveWallet: !!suiWallet,
    hasSessionWallet: !!user?.primarySuiAddress,
    walletRestoring,
    busy: isBusy,
    busyLabel: statusLabels[status] ?? 'Processing...',
    balanceBlocked: false,
    recovery: !!txDigest && !ctx.coverImageFile,
    txDigest,
    readyLabel: 'Sign & Launch',
    recoveryReadyLabel: 'Resume Launch',
    reconnectLabel: 'Reconnect Sui Wallet',
    connectLabel: 'Connect Sui Wallet',
  })
  const missingLaunchInput = !ctx.coverImageFile && !txDigest
  const launchDisabled =
    walletActionState.disabled
    || missingLaunchInput
    || collectionRightListingPriceError !== null

  // Store publish result in context and navigate to success when done
  useEffect(() => {
    if (status === 'done' && syncData) {
      if (completedDigestRef.current === syncData.txDigest) return
      completedDigestRef.current = syncData.txDigest

      setPublishResult(syncData, {
        name,
        floorPrice: floorPrice || '0',
        extraRoyaltyBps,
        tradeable,
        collectionRightListed: syncData.listingStatus === 'listed',
        collectionRightListingPrice: collectionRightListingPrice || null,
        soulNames: batchSouls.map((s) => s.name),
        maxSoulSupply: syncData.maxSoulSupply ?? null,
        emptyCollection: batchSouls.length === 0,
      })
      showToast('Collection launched successfully!', 'success')
      router.push('/collections/create/success')
    }
  }, [status, syncData, setPublishResult, name, floorPrice, extraRoyaltyBps, tradeable, collectionRightListingPrice, batchSouls, router, showToast])

  useEffect(() => {
    if (status === 'error' && error) {
      showToast(`Collection launch failed: ${error}`, 'danger')
    }
  }, [status, error, showToast])

  useEffect(() => {
    if (!ctx.isHydrated) return
    if (missingStep1) {
      router.replace('/collections/create')
    } else if (missingStep2) {
      router.replace('/collections/create/souls')
    }
  }, [ctx.isHydrated, missingStep1, missingStep2, router])

  if (!ctx.isHydrated) {
    return (
      <div className="max-w-[560px] mx-auto px-6 py-8">
        <div className="h-[420px] rounded-xl bg-card animate-pulse" />
      </div>
    )
  }

  if (missingStep1 || missingStep2) {
    return null
  }

  async function handleLaunch() {
    if (!ctx.coverImageFile && !txDigest) return
    if (collectionRightListingPriceError) {
      showToast(collectionRightListingPriceError, 'danger')
      return
    }
    const floorPriceAtomic = ctx.floorPrice ? parseDisplayAmountToAtomic(ctx.floorPrice).toString() : null
    const collectionRightListing = collectionRightListingPriceAtomic
      ? { priceAtomic: collectionRightListingPriceAtomic }
      : null
    await publish({
      coverImageFile: ctx.coverImageFile,
      name: ctx.name,
      description: ctx.description,
      extraRoyaltyBps: ctx.extraRoyaltyBps,
      tradeable: ctx.tradeable,
      floorPriceAtomic,
      maxSupply: maxSupplyParam,
      soulFolders: ctx.soulFolders.size > 0 ? ctx.soulFolders : undefined,
      souls: ctx.batchSouls.map((s) => ({
        name: s.name,
        description: s.description,
        tags: s.tags,
        creatorRoyaltyBps: s.creatorRoyaltyBps,
      })),
      collectionRightListing,
    })
  }

  function handleLaunchAction() {
    if (walletActionState.needsWalletReconnect) {
      openWalletLogin()
      return
    }
    void handleLaunch()
  }

  return (
    <>
      <FlowBar steps={collectionSteps} currentStep={2} />

      <div className="relative z-10 border-t border-purple/20">
        <PageContainer size="sm" className="space-y-6 pt-7 sm:pt-9">
          <SectionHeader
            label="Create Soul Collection"
            title="Step 3 — Preview"
            subtitle="Review everything before going on-chain. After Launch, all metadata and the Soul list are permanently locked."
            className="mb-2"
          />

          {/* ── Collection preview card ── */}
          <div className="space-y-4 rounded-2xl border border-purple/40 bg-card2/55 p-5">
            {/* Header */}
            <div className="flex items-start gap-4">
              {ctx.coverImagePreviewUrl ? (
                <Image
                  src={ctx.coverImagePreviewUrl}
                  alt="Collection cover"
                  width={64}
                  height={64}
                  unoptimized
                  className="h-16 w-16 shrink-0 rounded-full border border-purple/30 object-cover"
                />
              ) : (
                <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-purple/20 text-2xl">
                  📦
                </span>
              )}

              <div className="min-w-0">
                <h3 className="text-lg font-bold text-foreground">
                  {ctx.name || 'Untitled Collection'}
                </h3>
                <p className="mt-0.5 text-sm text-muted">
                  by {displayName} · {ctx.batchSouls.length} new Soul{ctx.batchSouls.length !== 1 ? 's' : ''} · Floor: {floor} USDC
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Tag color="purple">+ Collection</Tag>
                  {ctx.extraRoyaltyBps > 0 && <Tag color="gold">Royalty {royaltyDisplay}</Tag>}
                </div>
              </div>
            </div>

            {/* Description */}
            {ctx.description && (
              <p className="text-[13px] leading-6 text-muted">{ctx.description}</p>
            )}

            {/* Souls list */}
            {ctx.batchSouls.length > 0 && (
              <div>
                <p className="mb-3 text-[11px] font-bold uppercase tracking-[0.08em] text-muted">
                  Souls ({ctx.batchSouls.length} new · 0 existing)
                </p>
                <div className="space-y-2">
                  {ctx.batchSouls.map((soul, i) => (
                    <SoulRow
                      key={i}
                      soul={soul}
                      folder={ctx.soulFolders.get(i + 1)}
                      index={i}
                      recovered={ctx.hasRecoveryTx && ctx.soulFolders.size === 0}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* ── Transaction preview ── */}
          <div className="rounded-2xl border border-border bg-card2/55 p-5">
            <p className="mb-4 text-[11px] font-bold uppercase tracking-[0.08em] text-muted">
              Transaction Preview
            </p>
            <div className="space-y-3">
              <SettingRow label="Action" value="Launch Soul Collection" bold />
              <SettingRow label="Soul Collection" value={ctx.name || 'Untitled'} bold />
              <SettingRow
                label="Souls to mint"
                value={
                  ctx.batchSouls.length === 0
                    ? `0 now · capacity ${ctx.unlimitedSupply ? 'Unlimited' : (ctx.supplyCap || 'Unlimited')}`
                    : `${ctx.batchSouls.length} (${soulNames})`
                }
                bold
              />
              <SettingRow
                label="Creator Royalty"
                value={`${royaltyDisplay} · locked on-chain`}
                color="teal"
              />
              <SettingRow
                label="NFT Resale"
                value={ctx.tradeable ? 'Tradeable' : 'Non-tradeable'}
                color={ctx.tradeable ? 'teal' : undefined}
              />
              <SettingRow
                label="Floor Price"
                value={`${floor} USDC per Soul`}
                bold
              />
              <SettingRow
                label="Memory Policy"
                value="Grant-gated writes · founding memory locked · history preserved"
                bold
              />
              <SettingRow
                label="Persona Sprite"
                value="Post-mint from each Soul detail page"
                bold
              />
              <SettingRow label="Estimated Gas" value="~0.032 SUI" bold />
            </div>
          </div>

          {/* ── Optional collection-right listing on launch ── */}
          {ctx.tradeable && (
            <div className="rounded-2xl border border-purple/30 bg-purple/6 p-5 space-y-3">
              <div className="text-[11px] font-bold uppercase tracking-[0.08em] text-purple">
                List collection-right on launch
              </div>
              <p className="text-xs text-muted leading-relaxed">
                When enabled, the collection-right is listed at the price below in the same PTB that creates the collection — no extra wallet signature.
              </p>
              <label className="flex items-center gap-2 text-sm text-foreground">
                <input
                  type="checkbox"
                  checked={ctx.listCollectionRightOnLaunch}
                  onChange={(e) => ctx.setListCollectionRightOnLaunch(e.currentTarget.checked)}
                  className="h-4 w-4 accent-purple"
                />
                List collection-right at launch
              </label>
              {ctx.listCollectionRightOnLaunch && (
                <div className="flex flex-col gap-1 pl-6">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted">USDC price</span>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={ctx.collectionRightListingPrice}
                      onChange={(e) => ctx.setCollectionRightListingPrice(e.currentTarget.value)}
                      placeholder="e.g. 100.00"
                      aria-invalid={collectionRightListingPriceError !== null}
                      className={`rounded border bg-transparent px-2 py-1 text-xs text-foreground ${
                        collectionRightListingPriceError ? 'border-danger/60' : 'border-purple/30'
                      }`}
                    />
                  </div>
                  {collectionRightListingPriceError && (
                    <p className="text-[11px] font-medium text-danger">{collectionRightListingPriceError}</p>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ── Error ── */}
          {error && (
            <div className="rounded-xl border border-danger/30 bg-danger/8 px-4 py-3">
              <p className="text-[13px] font-medium text-danger">{error}</p>
              {txDigest && (
                <button
                  type="button"
                  onClick={() => {
                    resetRecovery()
                    router.push('/collections/create')
                  }}
                  className="mt-2 text-[13px] font-semibold text-danger underline underline-offset-2 hover:text-foreground"
                >
                  Start Over
                </button>
              )}
            </div>
          )}

          {/* ── Warning ── */}
          <div className="rounded-xl border border-border bg-card2/55 px-4 py-3">
            <p className="text-[13px] leading-6 text-muted">
              {ctx.batchSouls.length === 0
                ? '🔒 After signing: Collection metadata + supply cap locked · Soul list opens for later additions up to the capacity'
                : '🔒 After signing: Collection metadata + supply cap locked · Soul–Collection binding permanent (does not affect Soul trading)'}
            </p>
          </div>

          {/* ── Action buttons ── */}
          <div className="flex items-center gap-3">
            <Link
              href="/collections/create/souls"
              className={buttonStyles({
                variant: 'outline',
                size: 'lg',
                className: 'w-[112px] rounded-xl border-border bg-transparent text-foreground hover:border-purple hover:text-foreground',
              })}
            >
              ← Back
            </Link>
            <button
              type="button"
              disabled={launchDisabled}
              onClick={handleLaunchAction}
              className={buttonStyles({
                variant: 'landing',
                size: 'lg',
                className: `min-w-0 flex-1 rounded-xl ${isBusy ? 'opacity-60 cursor-wait' : ''} ${launchDisabled ? 'opacity-50 cursor-not-allowed' : ''}`,
              })}
            >
              {walletActionState.label}
              {!walletActionState.disabled && !walletActionState.needsWalletReconnect && (
                <span aria-hidden="true"> →</span>
              )}
            </button>
          </div>
        </PageContainer>
      </div>

      {/* ── Launching overlay ── */}
      {isBusy && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="mx-4 rounded-2xl border border-purple/40 bg-[linear-gradient(135deg,rgba(28,17,63,0.97),rgba(18,10,41,0.98))] px-14 py-10 text-center shadow-[0_24px_64px_rgba(124,58,237,0.3)]">
            <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-2 border-purple/30 border-t-purple" />
            <h3 className="text-lg font-bold text-foreground">
              {status === 'uploading'
                ? 'Uploading collection assets…'
                : status === 'minting-souls'
                ? `Minting Soul ${progress.mintedSouls + 1} of ${progress.totalSouls}…`
                : status === 'binding-souls'
                  ? `Binding Soul ${progress.boundSouls + 1} of ${progress.totalSouls}…`
                  : 'Creating Collection…'}
            </h3>
            <p className="mt-1.5 text-sm text-muted">
              {statusLabels[status] ?? 'Processing…'}
            </p>
            {txDigest && (
              <p className="mt-3 font-mono text-xs text-teal">
                TX: {txDigest.slice(0, 16)}…
              </p>
            )}
          </div>
        </div>
      )}
    </>
  )
}
