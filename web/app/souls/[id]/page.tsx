'use client'

import { use, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { normalizeSuiAddress } from '@mysten/sui/utils'
import { useQueryClient } from '@tanstack/react-query'
import { useSoulDetail } from '@/lib/hooks/use-souls'
import { useAuth } from '@/components/providers/auth-provider'
import { EmptyState } from '@/components/ui/empty-state'
import { Tag } from '@/components/ui/tag'
import { Button, buttonStyles } from '@/components/ui/button'
import { SoulCoverImage } from '@/components/souls/soul-cover-image'
import { UpdatePriceModal, DelistModal } from '@/components/souls/listing-modals'
import { ReportModal } from '@/components/shared/report-modal'
import { useRequireAuth } from '@/lib/hooks/use-require-auth'
import { formatAtomicAmountForDisplay } from '@soulidity/sdk'
import { KIND_MEMORY, KIND_SKILL, KIND_SPRITE } from '@soulidity/sdk'
import { useGrant } from '@/lib/hooks/use-grant'
import { SOUL_GRANT_SCOPE_MEMORY, SOUL_GRANT_SCOPE_SEAL, SOUL_GRANT_SCOPE_SKILLS } from '@soulidity/sdk'
import type { SoulAssetDetail, SoulContentVersionRecord, SoulGrantRecord } from '@soulidity/sdk'
import './soul-detail.css'

type Role = 'owner' | 'grantee' | 'visitor'

// ── Helpers ──────────────────────────────────────────────────────────
function formatAddress(value: string | null | undefined) {
  if (!value) return '—'
  return `${value.slice(0, 6)}…${value.slice(-4)}`
}

function formatDate(value: string | null | undefined) {
  if (!value) return '—'
  return new Date(value).toLocaleString()
}

function formatRelative(value: string | null | undefined | number) {
  if (value == null) return '—'
  const then = typeof value === 'number' ? value : new Date(value).getTime()
  if (Number.isNaN(then)) return '—'
  const diff = Date.now() - then
  if (diff < 60_000) return 'just now'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)}d ago`
  return new Date(then).toLocaleDateString()
}

function deriveRole(soul: SoulAssetDetail): Role {
  if (soul.isOwner) return 'owner'
  if (soul.isGrantedAgent) return 'grantee'
  return 'visitor'
}

function formatProvenance(kind: SoulAssetDetail['provenanceKind']) {
  if (kind === 'imported') return 'Imported'
  if (kind === 'personal-join') return 'Personal Join'
  return 'Native'
}

function activeVersions(rows: SoulContentVersionRecord[], kind: number) {
  return rows
    .filter((r) => r.kind === kind && r.deletedAt == null)
    .sort((a, b) => b.versionIndex - a.versionIndex)
}

function normalizeSuiAddressForCompare(value: string | null | undefined) {
  const trimmed = value?.trim()
  if (!trimmed) return ''
  try {
    return normalizeSuiAddress(trimmed).toLowerCase()
  } catch {
    return trimmed.toLowerCase()
  }
}

function findActiveGrantForAddress(grants: SoulGrantRecord[], address: string) {
  const normalized = normalizeSuiAddressForCompare(address)
  if (!normalized) return null
  return grants.find((grant) => normalizeSuiAddressForCompare(grant.granteeAddress) === normalized) ?? null
}

// ── CopyChip ─────────────────────────────────────────────────────────
function CopyChip({ value, label, tone = 'teal' }: { value: string | null | undefined; label?: string; tone?: 'teal' | 'muted' }) {
  const [copied, setCopied] = useState(false)
  const toneClass = tone === 'teal' ? 'text-teal' : 'text-muted'
  const display = label ?? (value ? `${value.slice(0, 6)}…${value.slice(-4)}` : '—')

  return (
    <span className={`inline-flex items-center gap-1 font-mono text-[12px] ${toneClass}`} title={value ?? undefined}>
      <span className="whitespace-nowrap">{display}</span>
      {value && (
        <button
          type="button"
          className="rounded px-1 py-0.5 text-[11px] text-[var(--text-faint)] transition hover:bg-white/5 hover:text-foreground cursor-pointer"
          onClick={(e) => {
            e.stopPropagation()
            navigator.clipboard?.writeText(value)
            setCopied(true)
            setTimeout(() => setCopied(false), 1200)
          }}
          title={copied ? 'Copied' : 'Copy'}
          aria-label="Copy to clipboard"
        >
          {copied ? '✓' : '⧉'}
        </button>
      )}
    </span>
  )
}

// ── KV row ───────────────────────────────────────────────────────────
function KV({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2.5 border-t border-white/[0.04] py-[9px] text-[13px] first:border-t-0">
      <span className="whitespace-nowrap text-muted">{k}</span>
      <span className="inline-flex min-w-0 items-center gap-1 whitespace-nowrap text-foreground">{v}</span>
    </div>
  )
}

// ── Hero ─────────────────────────────────────────────────────────────
function Hero({
  soul,
  role,
  priceLabel,
  onUpdatePrice,
  onDelist,
  onReport,
}: {
  soul: SoulAssetDetail
  role: Role
  priceLabel: string
  onUpdatePrice: () => void
  onDelist: () => void
  onReport: () => void
}) {
  const router = useRouter()
  const { requireAuth } = useRequireAuth()
  const listed = soul.listingStatus === 'listed'
  const sprites = useMemo(() => activeVersions(soul.contentVersions, KIND_SPRITE), [soul.contentVersions])

  return (
    <div className="sd-hero grid items-start gap-7" style={{ gridTemplateColumns: 'minmax(320px,420px) minmax(0,1fr)' }}>
      {/* Cover card */}
      <div className="relative flex flex-col overflow-hidden rounded-[18px] border border-[var(--border-soft)] bg-card">
        <div className="relative aspect-[4/5] w-full overflow-hidden">
          <SoulCoverImage imageUrl={soul.imageUrl} className="absolute inset-0 h-full w-full" />

          {/* Overlay tags + actions */}
          <div className="absolute inset-x-3.5 top-3.5 z-[2] flex items-center gap-1.5">
            <span className="inline-flex flex-shrink-0 items-center whitespace-nowrap rounded-full border border-white/10 bg-[rgba(13,10,30,0.65)] px-2.5 py-[5px] text-[11px] font-semibold text-foreground backdrop-blur-md">
              {formatProvenance(soul.provenanceKind)}
            </span>
            <span className="inline-flex flex-shrink-0 items-center whitespace-nowrap rounded-full border border-white/10 bg-[rgba(13,10,30,0.65)] px-2.5 py-[5px] text-[11px] font-semibold text-foreground backdrop-blur-md">
              {listed ? 'Listed' : 'Held'}
            </span>
            {soul.activeSpriteVersionIndex != null && (
              <span className="sd-pill-live inline-flex flex-shrink-0 items-center whitespace-nowrap rounded-full border border-white/10 bg-[rgba(13,10,30,0.65)] px-2.5 py-[5px] text-[11px] font-semibold text-foreground backdrop-blur-md">
                Sprite v{soul.activeSpriteVersionIndex} live
              </span>
            )}
            <span className="flex-1" />
            <div className="flex flex-shrink-0 items-center gap-1.5">
              <button
                type="button"
                title="Open image"
                onClick={() => soul.imageUrl && window.open(soul.imageUrl, '_blank')}
                className="inline-flex h-[30px] w-[30px] items-center justify-center rounded-lg border border-white/10 bg-[rgba(13,10,30,0.65)] text-[13px] text-foreground backdrop-blur-md transition hover:bg-[rgba(13,10,30,0.9)] cursor-pointer"
              >
                ⛶
              </button>
              <button
                type="button"
                title="Copy share link"
                onClick={() => {
                  const url = typeof window !== 'undefined' ? window.location.href : ''
                  navigator.clipboard?.writeText(url)
                }}
                className="inline-flex h-[30px] w-[30px] items-center justify-center rounded-lg border border-white/10 bg-[rgba(13,10,30,0.65)] text-[13px] text-foreground backdrop-blur-md transition hover:bg-[rgba(13,10,30,0.9)] cursor-pointer"
              >
                ↗
              </button>
              {role !== 'owner' && (
                <button
                  type="button"
                  title="Report"
                  onClick={onReport}
                  className="inline-flex h-[30px] w-[30px] items-center justify-center rounded-lg border border-white/10 bg-[rgba(13,10,30,0.65)] text-[13px] text-foreground backdrop-blur-md transition hover:bg-[rgba(13,10,30,0.9)] cursor-pointer"
                >
                  ⚑
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Sprite strip */}
        {sprites.length > 0 && (
          <div className="flex items-center gap-2.5 border-t border-[var(--border-soft)] bg-gradient-to-b from-[rgba(13,10,30,0.92)] to-[rgba(13,10,30,0.98)] px-4 py-3.5">
            <div className="flex flex-1 items-center gap-1.5">
              {sprites.slice(0, 5).map((v) => {
                const isActive = v.versionIndex === soul.activeSpriteVersionIndex && v.name === soul.activeSpriteName
                return (
                  <div
                    key={v.id}
                    className={`sd-sprite-thumb relative h-11 w-11 overflow-hidden rounded-lg border ${
                      isActive ? 'border-gold shadow-[0_0_0_2px_rgba(245,158,11,0.18)]' : 'border-[var(--border-soft)]'
                    }`}
                  >
                    <span className="absolute bottom-0.5 right-1 font-mono text-[9px] text-white/85">v{v.versionIndex}</span>
                  </div>
                )
              })}
            </div>
            <div className="flex-shrink-0 whitespace-nowrap text-right text-[11px] text-muted">
              {soul.activeSpriteVersionIndex != null ? (
                <>
                  <div>
                    <b className="font-semibold text-foreground">Sprite v{soul.activeSpriteVersionIndex}</b>
                    {soul.activeSpriteDownloadPolicy && <> · {soul.activeSpriteDownloadPolicy.replace('_', ' ')}</>}
                  </div>
                  <div className="mt-0.5 font-mono text-[10px] text-[var(--text-faint)]">walrus · {sprites.length} version{sprites.length === 1 ? '' : 's'}</div>
                </>
              ) : (
                <div>No sprite bound</div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Identity column */}
      <div className="flex min-w-0 flex-col gap-4">
        <div className="flex flex-wrap items-center gap-1.5">
          {soul.tags.map((t) => (
            <Tag key={t} color="muted">
              {t}
            </Tag>
          ))}
          {soul.collection && <Tag color="teal">{soul.collection.name}</Tag>}
        </div>

        <div>
          <h1
            className="sd-id-title m-0 font-display font-extrabold leading-[1.05] tracking-[-0.025em]"
            style={{ fontSize: 40 }}
          >
            {soul.name}
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 text-[13px] text-muted">
            <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
              <span className="text-[10px] font-bold uppercase tracking-[0.08em] text-[var(--text-faint)]">Creator</span>
              <span className="font-mono text-[12px] font-medium text-foreground">{formatAddress(soul.creatorAddress)}</span>
            </span>
            <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
              <span className="text-[10px] font-bold uppercase tracking-[0.08em] text-[var(--text-faint)]">Owner</span>
              <span className="font-mono text-[12px] font-medium text-foreground">{formatAddress(soul.currentOwnerAddress)}</span>
              {role === 'owner' && (
                <span className="rounded bg-teal/20 px-1.5 py-px text-[10px] font-bold uppercase tracking-[0.04em] text-teal">YOU</span>
              )}
              {role === 'grantee' && (
                <span className="rounded bg-purple/20 px-1.5 py-px text-[10px] font-bold uppercase tracking-[0.04em] text-purple">GRANTEE</span>
              )}
            </span>
          </div>
        </div>

        <p className="max-w-[56ch] text-sm leading-[1.6] text-muted">{soul.description}</p>

        {/* Listing card */}
        <div
          className={`sd-listing grid items-end gap-4 rounded-[14px] border p-[18px] ${
            listed ? 'sd-listing-listed border-gold/40' : 'border-border bg-card2'
          }`}
          style={{ gridTemplateColumns: 'minmax(0,1fr) auto' }}
        >
          <div className="min-w-0">
            <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--text-faint)]">
              {listed ? 'Current checkout total' : 'Listing status'}
            </div>
            <div
              className={`mt-1.5 flex flex-wrap items-baseline gap-2.5 font-display font-extrabold leading-[1.1] tracking-[-0.02em] ${
                listed ? 'text-gold' : 'text-foreground'
              }`}
              style={{ fontSize: 32 }}
            >
              <span className="whitespace-nowrap">{listed ? priceLabel : 'Not listed'}</span>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-x-3.5 gap-y-1 text-[12px] text-muted">
              {listed ? (
                <>
                  <span className="whitespace-nowrap">
                    Creator royalty <b className="text-foreground">{(soul.creatorRoyaltyBps / 100).toFixed(2)}%</b>
                  </span>
                  {soul.collection && (
                    <>
                      <span className="text-[var(--text-faint)]">·</span>
                      <span className="whitespace-nowrap">
                        Collection royalty <b className="text-foreground">{(soul.collection.extraRoyaltyBps / 100).toFixed(2)}%</b>
                      </span>
                    </>
                  )}
                </>
              ) : (
                <span>List your Soul on the Soulidity Market when you&apos;re ready to find a new owner.</span>
              )}
            </div>
          </div>
          <div className="sd-listing-actions flex flex-col items-stretch gap-2" style={{ minWidth: 140 }}>
            {role === 'owner' && listed && (
              <>
                <Button variant="gold" size="sm" onClick={onUpdatePrice}>
                  Update price
                </Button>
                <Button variant="outline" size="sm" onClick={onDelist}>
                  Delist
                </Button>
              </>
            )}
            {role === 'owner' && !listed && (
              <Link
                href={`/souls/${encodeURIComponent(soul.onChainId)}/sell`}
                className={buttonStyles({ variant: 'gold', size: 'sm' })}
              >
                List Soul
              </Link>
            )}
            {role !== 'owner' && listed && soul.quote && (
              <button
                type="button"
                onClick={() => {
                  requireAuth(
                    () => {
                      router.push(`/souls/${encodeURIComponent(soul.onChainId)}/buy`)
                    },
                    {
                      path: `/souls/${encodeURIComponent(soul.onChainId)}/buy`,
                      label: `Resuming purchase of ${soul.name}.`,
                    },
                  )
                }}
                className={buttonStyles({ variant: 'gold', size: 'sm' })}
              >
                Buy for {priceLabel}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Quick stats ──────────────────────────────────────────────────────
function QuickStats({ soul }: { soul: SoulAssetDetail }) {
  const updated = soul.updatedAt ?? soul.createdAt
  const cells: Array<{ label: string; value: React.ReactNode; sub?: React.ReactNode; key: string }> = [
    {
      key: 'soul',
      label: 'Soul object',
      value: <CopyChip value={soul.onChainId} />,
    },
    {
      key: 'provenance',
      label: 'Provenance',
      value: <span className="text-[18px] font-bold tracking-[-0.01em] text-foreground">{formatProvenance(soul.provenanceKind)}</span>,
      sub: soul.collection ? <span>in {soul.collection.name}</span> : <span>Standalone</span>,
    },
    {
      key: 'grants',
      label: 'Active grants',
      value: (
        <span className="text-[18px] font-bold tracking-[-0.01em] text-foreground">
          {soul.activeGrantCount}
          <span className="ml-1 text-[12px] font-medium text-muted"> / {soul.grantCapacity}</span>
        </span>
      ),
    },
    {
      key: 'sprite',
      label: 'Sprite',
      value:
        soul.activeSpriteVersionIndex != null ? (
          <span className="text-[18px] font-bold tracking-[-0.01em] text-foreground">
            v{soul.activeSpriteVersionIndex}
            {soul.activeSpriteDownloadPolicy && (
              <span className="ml-1 text-[12px] font-medium text-muted"> · {soul.activeSpriteDownloadPolicy.replace('_', ' ')}</span>
            )}
          </span>
        ) : (
          <span className="text-[18px] font-bold tracking-[-0.01em] text-muted">—</span>
        ),
    },
    {
      key: 'updated',
      label: 'Updated',
      value: <span className="text-[15px] font-bold text-foreground">{formatRelative(updated)}</span>,
      sub: <span>{formatDate(updated)}</span>,
    },
  ]

  return (
    <div className="sd-qstats grid gap-3" style={{ gridTemplateColumns: 'repeat(5, 1fr)' }}>
      {cells.map((c) => (
        <div key={c.key} className="flex min-w-0 flex-col gap-1 rounded-xl border border-[var(--border-soft)] bg-card px-4 py-3.5">
          <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.1em] text-[var(--text-faint)]">
            {c.label}
          </div>
          <div className="flex min-w-0 items-baseline gap-1.5">{c.value}</div>
          {c.sub && <div className="whitespace-nowrap text-[11px] text-muted">{c.sub}</div>}
        </div>
      ))}
    </div>
  )
}

// ── Workspace tabs ───────────────────────────────────────────────────
type TabId = 'info' | 'sprite' | 'skills' | 'memory' | 'grants'

function Workspace({ soul, role, detailQueryId, viewerId }: { soul: SoulAssetDetail; role: Role; detailQueryId: string; viewerId?: string | null }) {
  const [tab, setTab] = useState<TabId>('info')
  const counts = useMemo(
    () => ({
      sprite: activeVersions(soul.contentVersions, KIND_SPRITE).length,
      skills: activeVersions(soul.contentVersions, KIND_SKILL).length,
      memory: activeVersions(soul.contentVersions, KIND_MEMORY).length,
      grants: soul.activeGrantCount,
    }),
    [soul.contentVersions, soul.activeGrantCount],
  )

  const tabs: Array<{ id: TabId; label: string; count: number | null }> = [
    { id: 'info', label: 'Info', count: null },
    { id: 'sprite', label: 'Persona Sprite', count: counts.sprite },
    { id: 'skills', label: 'Skills', count: counts.skills },
    { id: 'memory', label: 'Memory', count: counts.memory },
    { id: 'grants', label: 'Grants', count: counts.grants },
  ]

  return (
    <div className="overflow-hidden rounded-2xl border border-[var(--border-soft)] bg-card">
      <div role="tablist" className="flex items-center overflow-x-auto border-b border-[var(--border-soft)] px-1.5">
        {tabs.map((t) => {
          const selected = tab === t.id
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={selected}
              data-grants-tab={t.id === 'grants' ? '' : undefined}
              onClick={() => setTab(t.id)}
              className={`sd-tab relative inline-flex items-center gap-2 whitespace-nowrap px-4 py-3.5 text-[13px] font-semibold transition cursor-pointer ${
                selected ? 'text-foreground' : 'text-muted hover:text-foreground'
              }`}
            >
              {t.label}
              {t.count != null && (
                <span
                  className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${
                    selected ? 'bg-[var(--purple-soft)] text-purple' : 'bg-card2 text-muted'
                  }`}
                >
                  {t.count}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {tab === 'info' && <InfoPanel soul={soul} />}
      {tab === 'sprite' && <SpritePanel soul={soul} role={role} />}
      {tab === 'skills' && <SkillsPanel soul={soul} role={role} />}
      {tab === 'memory' && <MemoryPanel soul={soul} role={role} />}
      {tab === 'grants' && <GrantsPanel soul={soul} role={role} detailQueryId={detailQueryId} viewerId={viewerId} />}
    </div>
  )
}

function PanelHead({ title, copy, tags }: { title: string; copy?: string; tags?: React.ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0 flex-[1_1_320px]">
        <h3 className="m-0 text-lg font-bold tracking-[-0.01em] text-foreground">{title}</h3>
        {copy && <p className="mt-1.5 max-w-[60ch] text-[13px] text-muted">{copy}</p>}
      </div>
      {tags && <div className="flex flex-shrink-0 flex-wrap gap-1.5">{tags}</div>}
    </div>
  )
}

function Subcard({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-xl border border-[var(--border-soft)] bg-white/[0.015] p-4 ${className}`}>
      {children}
    </div>
  )
}

// ── Info panel (object graph + royalties) ────────────────────────────
function InfoPanel({ soul }: { soul: SoulAssetDetail }) {
  return (
    <div className="p-5">
      <PanelHead
        title="Soul info"
        copy="A Soul is composed of multiple Sui objects bound by a shared State. Tap any reference to copy. Royalty splits and grant capacity are encoded on the State and apply to every secondary trade."
        tags={<Tag color="teal">{formatProvenance(soul.provenanceKind)}</Tag>}
      />
      <div className="grid gap-3 lg:grid-cols-2">
        <Subcard>
          <div className="mb-2 text-[11px] font-bold uppercase tracking-[0.1em] text-purple">Object graph</div>
          <KV k="Soul object" v={<CopyChip value={soul.onChainId} />} />
          <KV k="State object" v={<CopyChip value={soul.stateOnChainId} />} />
          <KV k="Content root" v={<CopyChip value={soul.contentOnChainId} />} />
          <KV k="Paid-access list" v={<CopyChip value={soul.paidAccessListOnChainId} />} />
          <KV k="Kiosk" v={<CopyChip value={soul.currentKioskId} />} />
          {soul.listingObjectOnChainId && <KV k="Listing object" v={<CopyChip value={soul.listingObjectOnChainId} />} />}
          {soul.collection && <KV k="Collection" v={<CopyChip value={soul.collection.onChainId} />} />}
        </Subcard>
        <Subcard>
          <div className="mb-2 text-[11px] font-bold uppercase tracking-[0.1em] text-purple">Royalties &amp; access</div>
          <KV k="Creator royalty" v={<span>{(soul.creatorRoyaltyBps / 100).toFixed(2)}%</span>} />
          <KV
            k="Collection royalty"
            v={<span>{soul.collection ? `${(soul.collection.extraRoyaltyBps / 100).toFixed(2)}%` : 'None'}</span>}
          />
          <KV k="Grant capacity" v={<span>{soul.activeGrantCount} / {soul.grantCapacity}</span>} />
          <KV k="Sprite versions" v={<span>{activeVersions(soul.contentVersions, KIND_SPRITE).length}</span>} />
          <KV k="Skills versions" v={<span>{activeVersions(soul.contentVersions, KIND_SKILL).length}</span>} />
          <KV k="Memory entries" v={<span>{activeVersions(soul.contentVersions, KIND_MEMORY).length}</span>} />
          <KV k="Created" v={<span>{formatDate(soul.createdAt)}</span>} />
          <KV k="Updated" v={<span>{formatDate(soul.updatedAt)}</span>} />
        </Subcard>
      </div>
    </div>
  )
}

// ── Content panels (sprite / skills / memory) ────────────────────────
function ContentPanel({
  soul,
  role,
  kind,
  title,
  copy,
  emptyIcon,
  emptyTitle,
  emptySub,
  versionLabelSingular,
  uploadCard,
}: {
  soul: SoulAssetDetail
  role: Role
  kind: number
  title: string
  copy: string
  emptyIcon: string
  emptyTitle: string
  emptySub: string
  versionLabelSingular: string
  uploadCard?: React.ReactNode
}) {
  const versions = useMemo(() => activeVersions(soul.contentVersions, kind), [soul.contentVersions, kind])

  const tags: React.ReactNode = (
    <>
      <Tag color={soul.contentOnChainId ? 'teal' : 'muted'}>{soul.contentOnChainId ? 'root ready' : 'no root'}</Tag>
      {kind === KIND_SPRITE && soul.activeSpriteVersionIndex != null && (
        <>
          <Tag color="gold">active v{soul.activeSpriteVersionIndex}</Tag>
          {soul.activeSpriteDownloadPolicy && <Tag color="gold">{soul.activeSpriteDownloadPolicy.replace('_', ' ')}</Tag>}
        </>
      )}
      <Tag color="muted">{versions.length} {versions.length === 1 ? versionLabelSingular : `${versionLabelSingular}s`}</Tag>
      {role === 'visitor' && <Tag color="muted">read-only</Tag>}
    </>
  )

  return (
    <div className="p-5">
      <PanelHead title={title} copy={copy} tags={tags} />

      {uploadCard}

      <div className="mt-4">
        <div className="mb-2.5 flex items-center justify-between">
          <div className="text-[12px] font-bold uppercase tracking-[0.08em] text-muted">
            Versions ({versions.length})
          </div>
          {versions.length > 0 && <span className="text-[11px] text-muted">Newest first</span>}
        </div>

        {versions.length === 0 ? (
          <EmptyState icon={emptyIcon} label={emptyTitle} sublabel={emptySub} />
        ) : (
          <div className="space-y-2">
            {versions.map((v) => {
              const isActiveSprite =
                kind === KIND_SPRITE && v.versionIndex === soul.activeSpriteVersionIndex && v.name === soul.activeSpriteName
              return (
                <div
                  key={v.id}
                  className="flex flex-wrap items-center gap-3.5 rounded-xl border border-[var(--border-soft)] bg-white/[0.015] px-3.5 py-3"
                >
                  <div className="flex-shrink-0 rounded-md bg-teal/10 px-2 py-1 font-mono text-[13px] font-bold text-teal">
                    v{v.versionIndex}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2 text-[13px] font-semibold text-foreground">
                      <span className="whitespace-nowrap">{v.name || versionLabelSingular}</span>
                      {isActiveSprite && <Tag color="gold">Active</Tag>}
                      <Tag color={v.isPublic ? 'gold' : 'purple'}>{v.isPublic ? 'public' : 'private'}</Tag>
                      {v.sealEncrypted && <Tag color="purple">sealed</Tag>}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-muted">
                      <span className="whitespace-nowrap">blob <span className="font-mono text-teal">{formatAddress(v.blobObjectId)}</span></span>
                      <span className="opacity-50">·</span>
                      <span className="whitespace-nowrap">{formatRelative(v.createdAtMs)}</span>
                      <span className="opacity-50">·</span>
                      <span className="whitespace-nowrap font-mono text-[10.5px]">{v.downloadPolicy}</span>
                    </div>
                  </div>
                  <div className="flex flex-shrink-0 gap-1.5">
                    <Button variant="outline" size="sm" disabled>
                      Open
                    </Button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

function MigrationNote({ kind }: { kind: 'sprite' | 'skills' | 'memory' }) {
  return (
    <div className="rounded-xl border border-dashed border-border bg-card2 p-4 text-[13px] text-muted">
      The {kind} write panel is migrating to the Phase 2 unified-content surface. The on-chain data is
      already mirrored above and accessible via the new <code className="font-mono text-teal">/api/souls/[id]/content</code>{' '}
      endpoints; the upload UI returns when the new ContentPanel ships.
    </div>
  )
}

function SpritePanel({ soul, role }: { soul: SoulAssetDetail; role: Role }) {
  return (
    <ContentPanel
      soul={soul}
      role={role}
      kind={KIND_SPRITE}
      title="Persona Sprite"
      copy="Each sprite version is published on-chain and can be set as the active binding. Public versions stream from Walrus directly; private versions are AES-GCM encrypted and gated by Seal."
      emptyIcon="🖼"
      emptyTitle="No sprite versions yet"
      emptySub="When the owner uploads a persona sprite, every version stays addressable on-chain and the latest active binding renders here."
      versionLabelSingular="version"
      uploadCard={role === 'owner' ? <MigrationNote kind="sprite" /> : undefined}
    />
  )
}

function SkillsPanel({ soul, role }: { soul: SoulAssetDetail; role: Role }) {
  return (
    <ContentPanel
      soul={soul}
      role={role}
      kind={KIND_SKILL}
      title="Skills"
      copy="Each skill bundle is appended on-chain as an immutable version. Bundles ship a SKILL.md that names the skill; private bundles are AES-GCM encrypted and Seal-gated."
      emptyIcon="📚"
      emptyTitle="No skill versions yet"
      emptySub="No skill bundles have been appended to this Soul. Once appended, every version stays addressable on-chain and can be opened or revoked here."
      versionLabelSingular="version"
      uploadCard={role === 'owner' || role === 'grantee' ? <MigrationNote kind="skills" /> : undefined}
    />
  )
}

function MemoryPanel({ soul, role }: { soul: SoulAssetDetail; role: Role }) {
  const versions = useMemo(() => activeVersions(soul.contentVersions, KIND_MEMORY), [soul.contentVersions])
  const canDecrypt = role === 'owner' || role === 'grantee'

  if (versions.length === 0) {
    return (
      <div className="p-5">
        <PanelHead
          title="Memory log"
          copy="Each entry is an encrypted append to the on-chain memory log, written by the agent runtime, the founder, or any holder with a memory grant. Only the owner or a grant holder can decrypt the body."
          tags={
            <>
              <Tag color="teal">0 entries</Tag>
              {!canDecrypt && <Tag color="muted">read-only</Tag>}
            </>
          }
        />
        <EmptyState
          icon="🧠"
          label="No memory entries yet"
          sublabel="Once the agent runtime or a memory grant holder appends an entry, the encrypted log will appear here."
        />
      </div>
    )
  }

  return (
    <div className="p-5">
      <PanelHead
        title="Memory log"
        copy="Each entry is an encrypted append to the on-chain memory log, written by the agent runtime, the founder, or any holder with a memory grant. Only the owner or a grant holder can decrypt the body."
        tags={
          <>
            <Tag color="teal">{versions.length} entries</Tag>
            {!canDecrypt && <Tag color="muted">read-only</Tag>}
          </>
        }
      />
      <div className="space-y-2">
        {versions.map((v) => (
          <MemoryRow key={v.id} entry={v} canDecrypt={canDecrypt} />
        ))}
      </div>
    </div>
  )
}

function MemoryRow({ entry, canDecrypt }: { entry: SoulContentVersionRecord; canDecrypt: boolean }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="overflow-hidden rounded-xl border border-[var(--border-soft)] bg-white/[0.015]">
      <button
        type="button"
        className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left transition hover:bg-white/[0.025] cursor-pointer"
        onClick={() => setOpen((v) => !v)}
      >
        <Tag color="teal">v{entry.versionIndex}</Tag>
        <span className="flex-1 truncate text-[13px] font-medium text-foreground">
          {entry.name || `Memory entry`}
        </span>
        <span className="whitespace-nowrap text-[12px] text-muted">{formatRelative(entry.createdAtMs)}</span>
        <span className="text-[var(--text-faint)]" title="Encrypted blob on Walrus">🔒</span>
        <span className="text-[11px] text-[var(--text-faint)]">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="border-t border-[var(--border-soft)] bg-black/[0.15] px-3.5 pb-3 pt-2">
          <KV k="Slot name" v={<span className="font-mono text-[12px] text-teal">{entry.name}</span>} />
          <KV k="Blob object" v={<CopyChip value={entry.blobObjectId} />} />
          {entry.blobId && <KV k="Walrus blob" v={<CopyChip value={entry.blobId} />} />}
          <KV k="Download policy" v={<span className="font-mono text-[12px]">{entry.downloadPolicy}</span>} />
          <KV k="Created" v={<span>{formatDate(entry.createdAt)}</span>} />
          <div className="mt-2.5 flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled
              title={canDecrypt ? 'Memory decrypt flow not yet wired' : 'Owner / grant only'}
            >
              {canDecrypt ? 'Decrypt unavailable' : 'Owner / grant only'}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Grants panel ─────────────────────────────────────────────────────
function GrantsPanel({ soul, role, detailQueryId, viewerId }: { soul: SoulAssetDetail; role: Role; detailQueryId: string; viewerId?: string | null }) {
  const canManage = role === 'owner'
  const [scope, setScope] = useState<'skills' | 'memory'>('skills')
  const [agentAddress, setAgentAddress] = useState('')
  const [reassignmentNotice, setReassignmentNotice] = useState<string | null>(null)
  const { pending, error, issueGrant, revokeGrant } = useGrant(soul)
  const queryClient = useQueryClient()
  const trimmedAgentAddress = agentAddress.trim()
  const targetActiveGrant = findActiveGrantForAddress(soul.activeGrants, trimmedAgentAddress)
  const capacityFullForNewGrantee = Boolean(
    trimmedAgentAddress && !targetActiveGrant && soul.activeGrantCount >= soul.grantCapacity,
  )

  function refreshSoulDetail() {
    void queryClient.invalidateQueries({ queryKey: ['soul', detailQueryId, viewerId ?? null] })
  }

  async function handleAuthorize() {
    const addr = trimmedAgentAddress
    if (!addr) return
    const scopeMask = scope === 'skills' ? SOUL_GRANT_SCOPE_SKILLS | SOUL_GRANT_SCOPE_SEAL : SOUL_GRANT_SCOPE_MEMORY
    setReassignmentNotice(null)
    try {
      if (capacityFullForNewGrantee) {
        setReassignmentNotice('Capacity full. Revoke an existing grantee before authorizing a new one.')
        return
      }
      await issueGrant(addr, null, scopeMask)
      refreshSoulDetail()
      setAgentAddress('')
    } catch (e) {
      // error surfaced via hook state
    }
  }

  async function handleRevoke(grant: SoulGrantRecord) {
    try {
      await revokeGrant(grant.granteeAddress)
      refreshSoulDetail()
    } catch (e) {
      // error surfaced via hook state
    }
  }

  return (
    <div className="p-5">
      <PanelHead
        title="SoulGrants"
        copy="Authorize an agent to access this Soul on your behalf. Only the grantee can read or append within their scope — no one else, including Soulidity. When capacity is full, revoke the grantee you want to replace before adding a new one."
        tags={
          <Tag color="muted">
            {soul.activeGrantCount} / {soul.grantCapacity} slot
          </Tag>
        }
      />

      {soul.activeGrants.length === 0 ? (
        <EmptyState
          icon="🔑"
          label="No active grant"
          sublabel="This Soul has no SoulGrant attached. Authorize a grantee to give an external agent scoped read or append access."
        />
      ) : (
        <div className="space-y-2">
          {soul.activeGrants.map((grant) => (
            <Subcard key={grant.id} className="!p-3.5">
              <div className="flex flex-wrap items-center justify-between gap-2.5">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <Tag color="success">{grant.status}</Tag>
                  {grant.scopes.map((s) => (
                    <Tag key={`${grant.id}:${s}`} color="teal">
                      {s}
                    </Tag>
                  ))}
                  <CopyChip value={grant.granteeAddress} />
                </div>
                {canManage && (
                  <Button variant="ghost" size="sm" disabled={pending !== null} onClick={() => handleRevoke(grant)}>
                    Revoke
                  </Button>
                )}
              </div>
              <div className="mt-3 grid gap-1.5 text-[12px]">
                <div className="flex justify-between text-muted">
                  <span>Issued by</span>
                  <span className="font-mono text-foreground">{formatAddress(grant.issuedByAddress)}</span>
                </div>
                <div className="flex justify-between text-muted">
                  <span>Expires</span>
                  <span>{grant.expiresAt ? formatDate(grant.expiresAt) : 'Never'}</span>
                </div>
              </div>
            </Subcard>
          ))}
        </div>
      )}

      {canManage && (
        <Subcard className="mt-4">
          <div className="mb-2.5 text-[12px] font-bold uppercase tracking-[0.08em] text-muted">
            {soul.activeGrants.length === 0 ? 'Authorize new grantee' : 'Authorize or update grantee'}
          </div>

          <div role="radiogroup" className="mb-3.5 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            {[
              {
                id: 'skills' as const,
                title: 'Skills & Docs',
                desc: 'Append, read, and decrypt skill bundles & document assets.',
                color: 'teal' as const,
              },
              {
                id: 'memory' as const,
                title: 'Memory',
                desc: 'Read, decrypt, and append entries to the memory log.',
                color: 'purple' as const,
              },
            ].map((s) => (
              <button
                key={s.id}
                type="button"
                role="radio"
                aria-checked={scope === s.id}
                data-selected={scope === s.id ? 'true' : 'false'}
                className="sd-scope-card"
                onClick={() => setScope(s.id)}
              >
                <div className="flex items-center justify-between">
                  <span
                    className={`font-mono text-[13px] font-semibold ${s.color === 'teal' ? 'text-teal' : 'text-purple'}`}
                  >
                    {s.title}
                  </span>
                  <span className="text-[14px] leading-none text-muted">{scope === s.id ? '●' : '○'}</span>
                </div>
                <div className="mt-1.5 text-[12px] leading-[1.45] text-muted">{s.desc}</div>
              </button>
            ))}
          </div>

          <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.04em] text-muted">
            Grantee Sui address
          </label>
          <input
            type="text"
            placeholder="0x…"
            spellCheck={false}
            value={agentAddress}
            onChange={(e) => {
              setAgentAddress(e.target.value)
              setReassignmentNotice(null)
            }}
            className="sd-grant-input"
          />
          {error && <div className="mt-2 text-[12px] text-danger">{error}</div>}
          {reassignmentNotice && <div className="mt-2 text-[12px] text-gold/90">{reassignmentNotice}</div>}
          <div className="mt-3.5 flex flex-wrap items-center gap-2">
            <Button
              variant="primary"
              size="sm"
              disabled={pending !== null || !trimmedAgentAddress || capacityFullForNewGrantee}
              onClick={handleAuthorize}
            >
              {pending === 'issue' ? 'Authorizing…' : pending === 'revoke' ? 'Revoking…' : '+ Authorize'}
            </Button>
            <span className="ml-auto text-[11px] text-muted">
              {capacityFullForNewGrantee
                ? 'Capacity full. Revoke an existing grantee before authorizing a new one.'
                : targetActiveGrant
                  ? 'Issuing updates this grantee without touching other active grants.'
                  : `Capacity ${soul.activeGrantCount} / ${soul.grantCapacity}`}
            </span>
          </div>
        </Subcard>
      )}
    </div>
  )
}

// ── Right rail ───────────────────────────────────────────────────────
function Rail({ soul, role }: { soul: SoulAssetDetail; role: Role }) {
  const grantPct =
    soul.grantCapacity > 0 ? Math.min(100, (soul.activeGrantCount / soul.grantCapacity) * 100) : 0

  // Synthesize a small activity feed from contentVersions + grants.
  const activity = useMemo(() => {
    type Item = { ts: number; title: string; detail: string; tone?: 'gold' | 'teal' }
    const items: Item[] = []
    items.push({
      ts: new Date(soul.createdAt).getTime(),
      title: 'Soul minted',
      detail: `${formatProvenance(soul.provenanceKind)} · creator ${formatAddress(soul.creatorAddress)}`,
    })
    for (const v of soul.contentVersions.slice(0, 8)) {
      const kindLabel =
        v.kind === KIND_SPRITE ? 'Sprite' : v.kind === KIND_SKILL ? 'Skill' : v.kind === KIND_MEMORY ? 'Memory' : v.kindName
      items.push({
        ts: v.createdAtMs,
        title: `${kindLabel} v${v.versionIndex} published`,
        detail: `${v.isPublic ? 'public' : 'private'} · ${v.name}`,
        tone: v.isPublic ? 'gold' : 'teal',
      })
    }
    for (const g of soul.activeGrants) {
      items.push({
        ts: new Date(g.createdAt).getTime(),
        title: 'Grant issued',
        detail: `${formatAddress(g.granteeAddress)} · ${g.scopes.join(', ')}`,
        tone: 'teal',
      })
    }
    return items.sort((a, b) => b.ts - a.ts).slice(0, 6)
  }, [soul.contentVersions, soul.activeGrants, soul.createdAt, soul.creatorAddress, soul.provenanceKind])

  return (
    <aside className="flex flex-col gap-4">
      <div className="rounded-2xl border border-[var(--border-soft)] bg-card p-[18px]">
        <div className="mb-3 flex items-center justify-between">
          <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-purple">Provenance</div>
        </div>
        <KV k="Creator" v={<CopyChip value={soul.creatorAddress} />} />
        <KV k="Current owner" v={<CopyChip value={soul.currentOwnerAddress} />} />
        <KV k="Provenance" v={<span>{formatProvenance(soul.provenanceKind)}</span>} />
        {soul.collection && (
          <KV
            k="Collection"
            v={
              <Link href={`/collections/${encodeURIComponent(soul.collection.onChainId)}`} className="text-teal hover:underline">
                {soul.collection.name}
              </Link>
            }
          />
        )}
        <KV k="Created" v={<span>{new Date(soul.createdAt).toLocaleDateString()}</span>} />
      </div>

      <div className="rounded-2xl border border-[var(--border-soft)] bg-card p-[18px]">
        <div className="mb-3 flex items-center justify-between">
          <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-purple">Access</div>
          <Tag color="success">Active</Tag>
        </div>
        <KV k="Owner access" v={<span className="text-success">● Active</span>} />
        <KV k="Grant capacity" v={<span>{soul.activeGrantCount} / {soul.grantCapacity}</span>} />
        <div className="my-1.5 sd-progress">
          <div style={{ width: `${grantPct}%` }} />
        </div>
        <KV k="Skills versions" v={<span>{activeVersions(soul.contentVersions, KIND_SKILL).length}</span>} />
        <KV k="Memory entries" v={<span>{activeVersions(soul.contentVersions, KIND_MEMORY).length}</span>} />
        <KV k="Creator royalty" v={<span>{(soul.creatorRoyaltyBps / 100).toFixed(2)}%</span>} />
        {soul.collection && (
          <KV k="Collection royalty" v={<span>{(soul.collection.extraRoyaltyBps / 100).toFixed(2)}%</span>} />
        )}
        {role === 'owner' && (
          <div className="mt-3">
            <Button
              variant="primary"
              size="sm"
              full
              onClick={() => {
                document.querySelector<HTMLButtonElement>('[data-grants-tab]')?.click()
              }}
            >
              + Issue grant
            </Button>
          </div>
        )}
      </div>

      <div className="rounded-2xl border border-[var(--border-soft)] bg-card p-[18px]">
        <div className="mb-3 flex items-center justify-between">
          <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-purple">Activity</div>
        </div>
        <div className="sd-activity">
          {activity.map((a, i) => (
            <div key={i} className={`sd-act ${a.tone === 'gold' ? 'sd-act-gold' : a.tone === 'teal' ? 'sd-act-teal' : ''}`}>
              <div className="flex items-baseline justify-between gap-2">
                <span className="min-w-0 truncate text-[13px] font-semibold text-foreground">{a.title}</span>
                <span className="flex-shrink-0 whitespace-nowrap text-[11px] text-[var(--text-faint)]">{formatRelative(a.ts)}</span>
              </div>
              <div className="mt-1 text-[12px] leading-[1.45] text-muted">{a.detail}</div>
            </div>
          ))}
        </div>
      </div>

      {soul.collection && (
        <div className="rounded-2xl border border-[var(--border-soft)] bg-card p-[18px]">
          <div className="mb-3 flex items-center justify-between">
            <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-purple">Collection</div>
            <Link
              href={`/collections/${encodeURIComponent(soul.collection.onChainId)}`}
              className="text-[11px] text-muted transition hover:text-foreground"
            >
              View →
            </Link>
          </div>
          <div className="flex items-center gap-3">
            <div
              className="h-12 w-12 flex-shrink-0 rounded-[10px]"
              style={{ background: 'linear-gradient(135deg, var(--teal), #0E7C70)' }}
            />
            <div className="min-w-0">
              <div className="truncate text-[14px] font-semibold text-foreground">{soul.collection.name}</div>
              <div className="line-clamp-2 text-[12px] text-muted">{soul.collection.description}</div>
            </div>
          </div>
        </div>
      )}
    </aside>
  )
}

// ── Page ─────────────────────────────────────────────────────────────
export default function SoulDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const { user, getAuthHeaders } = useAuth()
  const { data: soul, isLoading, error } = useSoulDetail(id, getAuthHeaders, user?.id)
  const [showUpdatePrice, setShowUpdatePrice] = useState(false)
  const [showDelist, setShowDelist] = useState(false)
  const [showReport, setShowReport] = useState(false)

  if (isLoading) {
    return (
      <div className="sd-page mx-auto w-full max-w-[1320px] px-4 py-6 sm:px-7">
        <div className="mb-4 h-3 w-32 animate-pulse rounded bg-card2" />
        <div
          className="sd-hero grid items-start gap-7"
          style={{ gridTemplateColumns: 'minmax(320px,420px) minmax(0,1fr)' }}
        >
          <div className="aspect-[4/5] animate-pulse rounded-[18px] bg-card2" />
          <div className="space-y-3">
            <div className="h-5 w-40 animate-pulse rounded bg-card2" />
            <div className="h-10 w-72 animate-pulse rounded bg-card2" />
            <div className="h-20 w-full animate-pulse rounded bg-card2" />
            <div className="h-24 w-full animate-pulse rounded bg-card2" />
          </div>
        </div>
      </div>
    )
  }

  if (error || !soul) {
    return (
      <div className="mx-auto max-w-[1080px] px-4 py-12 sm:px-6">
        <EmptyState
          icon="🫥"
          label="Soul not found"
          sublabel="The Soulidity projection does not have this asset yet, or the route ID is invalid."
          actionLabel="Back to Market"
          onAction={() => {
            window.location.href = '/market'
          }}
        />
      </div>
    )
  }

  const role = deriveRole(soul)
  const priceLabel = soul.quote?.totalAtomic
    ? formatAtomicAmountForDisplay(soul.quote.totalAtomic)
    : soul.listedPriceAtomic
      ? formatAtomicAmountForDisplay(soul.listedPriceAtomic)
      : 'Not listed'

  return (
    <div className="sd-page relative z-10 mx-auto w-full max-w-[1320px] px-4 pb-16 pt-6 sm:px-7">
      {/* Breadcrumbs */}
      <div className="mb-4 flex items-center gap-2 text-[12px] text-[var(--text-faint)]">
        <Link href="/market" className="transition hover:text-muted">
          Market
        </Link>
        <span className="opacity-50">/</span>
        {soul.collection && (
          <>
            <Link
              href={`/collections/${encodeURIComponent(soul.collection.onChainId)}`}
              className="transition hover:text-muted"
            >
              {soul.collection.name}
            </Link>
            <span className="opacity-50">/</span>
          </>
        )}
        <span className="truncate text-muted">{soul.name}</span>
      </div>

      <Hero
        soul={soul}
        role={role}
        priceLabel={priceLabel}
        onUpdatePrice={() => setShowUpdatePrice(true)}
        onDelist={() => setShowDelist(true)}
        onReport={() => setShowReport(true)}
      />

      <div className="mt-5">
        <QuickStats soul={soul} />
      </div>

      <div className="sd-body mt-5 grid gap-5" style={{ gridTemplateColumns: 'minmax(0,1fr) 380px' }}>
        <Workspace soul={soul} role={role} detailQueryId={id} viewerId={user?.id ?? null} />
        <Rail soul={soul} role={role} />
      </div>

      {soul.isOwner && soul.listingStatus === 'listed' && (
        <>
          <UpdatePriceModal soul={soul} open={showUpdatePrice} onClose={() => setShowUpdatePrice(false)} />
          <DelistModal soul={soul} open={showDelist} onClose={() => setShowDelist(false)} />
        </>
      )}

      <ReportModal
        open={showReport}
        onClose={() => setShowReport(false)}
        subjectType="soul"
        subjectId={soul.onChainId}
        subjectLabel={soul.name}
      />
    </div>
  )
}
