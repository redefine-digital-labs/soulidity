'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { FlowBar } from '@/components/nav/flow-bar'
import { PageContainer } from '@/components/layout/page-container'
import { SectionHeader } from '@/components/layout/section-header'
import { Tag } from '@/components/ui/tag'
import { buttonStyles } from '@/components/ui/button'
import { useToast } from '@/components/ui/toast'
import { parseDisplayAmountToAtomic } from '@/lib/soulidity/format'
import { useAuth } from '@/components/providers/auth-provider'
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

function isSoulReady(s: BatchSoulEntry, folder?: SoulFolderFiles) {
  return !!(s.name && s.description && folder?.characterFile && folder?.memoryFile)
}

// ── Fallback image component ──

function SoulThumb({ name, imageFile }: { name: string; imageFile?: File }) {
  const [failed, setFailed] = useState(false)
  const [blobUrl, setBlobUrl] = useState<string | null>(null)

  useEffect(() => {
    if (imageFile) {
      const url = URL.createObjectURL(imageFile)
      setBlobUrl(url)
      return () => URL.revokeObjectURL(url)
    }
    setBlobUrl(null)
  }, [imageFile])

  if (failed || !blobUrl) {
    return (
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-purple/20 text-xs font-bold text-purple">
        {name.slice(0, 2).toUpperCase()}
      </span>
    )
  }

  return (
    <img
      src={blobUrl}
      alt={name}
      onError={() => setFailed(true)}
      className="h-8 w-8 shrink-0 rounded-lg border border-purple/20 object-cover"
    />
  )
}

// ── Soul row ──

function SoulRow({ soul, folder, index }: { soul: BatchSoulEntry; folder?: SoulFolderFiles; index: number }) {
  const ready = isSoulReady(soul, folder)

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
  const { name, floorPrice, extraRoyaltyBps, tradeable, batchSouls, setPublishResult } = ctx
  const { user } = useAuth()
  const completedDigestRef = useRef<string | null>(null)
  // When recovery state has a committed collection TX, bypass File-dependent guards
  // (File objects cannot survive page refresh, but recovery has all uploaded asset refs)
  const missingStep1 = !ctx.hasRecoveryTx && (!ctx.name.trim() || !ctx.description.trim() || !ctx.coverImageFile)
  const missingStep2 = !ctx.hasRecoveryTx && (!ctx.batchFile || ctx.batchSouls.length === 0 || ctx.batchErrors.length > 0 || ctx.folderErrors.length > 0)
  const draftSignature = !missingStep1 && !missingStep2
    ? buildCollectionDraftSignature({
        name: ctx.name,
        description: ctx.description,
        extraRoyaltyBps: ctx.extraRoyaltyBps,
        tradeable: ctx.tradeable,
        floorPriceAtomic: ctx.floorPrice ? parseDisplayAmountToAtomic(ctx.floorPrice).toString() : null,
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

  const floor = floorPrice || '0'
  const royaltyDisplay = formatRoyalty(extraRoyaltyBps)
  const displayName = user?.displayName || user?.tgName || 'you'
  const soulNames = batchSouls.map((s) => s.name).join(', ')

  const isBusy = status !== 'idle' && status !== 'done' && status !== 'error'

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
        soulNames: batchSouls.map((s) => s.name),
      })
      showToast('Collection launched successfully!', 'success')
      router.push('/collections/create/success')
    }
  }, [status, syncData, setPublishResult, name, floorPrice, extraRoyaltyBps, tradeable, batchSouls, router, showToast])

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
    const floorPriceAtomic = ctx.floorPrice ? parseDisplayAmountToAtomic(ctx.floorPrice).toString() : null
    await publish({
      coverImageFile: ctx.coverImageFile,
      name: ctx.name,
      description: ctx.description,
      extraRoyaltyBps: ctx.extraRoyaltyBps,
      tradeable: ctx.tradeable,
      floorPriceAtomic,
      soulFolders: ctx.soulFolders.size > 0 ? ctx.soulFolders : undefined,
      souls: ctx.batchSouls.map((s) => ({
        name: s.name,
        description: s.description,
        tags: s.tags,
        creatorRoyaltyBps: s.creatorRoyaltyBps,
      })),
    })
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
                <img
                  src={ctx.coverImagePreviewUrl}
                  alt="Collection cover"
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
                    <SoulRow key={i} soul={soul} folder={ctx.soulFolders.get(i + 1)} index={i} />
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
                value={`${ctx.batchSouls.length} (${soulNames})`}
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
              <SettingRow label="Estimated Gas" value="~0.032 SUI" bold />
            </div>
          </div>

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
              🔒 After signing: Collection metadata locked · Soul list locked · Soul–Collection binding permanent (does not affect Soul trading)
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
              disabled={isBusy || !suiWallet || (!ctx.coverImageFile && !txDigest)}
              onClick={handleLaunch}
              className={buttonStyles({
                variant: 'landing',
                size: 'lg',
                className: `min-w-0 flex-1 rounded-xl ${isBusy ? 'opacity-60 cursor-wait' : ''} ${!suiWallet ? 'opacity-50 cursor-not-allowed' : ''}`,
              })}
            >
              {!suiWallet
                ? 'No Wallet Connected'
                : isBusy
                  ? (statusLabels[status] ?? 'Processing…')
                  : txDigest && !ctx.coverImageFile
                    ? <>Resume Launch <span aria-hidden="true">→</span></>
                    : <>Sign &amp; Launch <span aria-hidden="true">→</span></>}
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
              {status === 'preparing-souls'
                ? 'Preparing Soul assets…'
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
