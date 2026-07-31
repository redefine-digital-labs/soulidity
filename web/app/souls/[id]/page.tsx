'use client'

import { use, useCallback, useMemo, useState } from 'react'
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
import { AgentGrantRecommendations } from '@/components/souls/agent-grant-recommendations'
import { PurgeConfirmModal } from '@/components/souls/purge-confirm-modal'
import { ReportModal } from '@/components/shared/report-modal'
import { useRequireAuth } from '@/lib/hooks/use-require-auth'
import { formatAtomicAmountForDisplay, NO_DOWNLOAD_POLICY, READ_GRANT, READ_OWNER, READ_PUBLIC } from '@soulidity/sdk'
import { KIND_AUDIO, KIND_MEMORY, KIND_SKILL, KIND_SOUL_DOC, KIND_SPRITE } from '@soulidity/sdk'
import { useGrant } from '@/lib/hooks/use-grant'
import { usePaidAccess } from '@/lib/hooks/use-paid-access'
import { useSoulContentActions, useSoulContentSyncReplay } from '@/lib/hooks/use-soul-content-actions'
import { SkillBundleFormatHint } from '@/components/souls/skill-bundle-format-hint'
import { parsePersonaSpriteConfig, PERSONA_SPRITE_CONFIG_ERROR, validateSelectedSkillBundle } from '@soulidity/sdk'
import { MAX_GRANT_CAPACITY, SOUL_GRANT_SCOPE_ASSETS, SOUL_GRANT_SCOPE_MEMORY, SOUL_GRANT_SCOPE_SEAL, SOUL_GRANT_SCOPE_SKILLS } from '@soulidity/sdk'
import type {
  SoulAssetDetail,
  SoulContentVersionRecord,
  SoulGrantRecord,
  SoulPaidAccessEntryRecord,
  SoulPaidAccessKindConfigRecord,
} from '@soulidity/sdk'
import './soul-detail.css'

type Role = 'owner' | 'grantee' | 'visitor'
type ContentActions = ReturnType<typeof useSoulContentActions>

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
  if (kind === 'animacraft') return 'Animacraft'
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

function contentVersionsForKind(rows: SoulContentVersionRecord[], kind: number) {
  return rows
    .filter((r) => r.kind === kind && r.purgedAt == null)
    .sort((a, b) => b.versionIndex - a.versionIndex)
}

function scopeMaskForKind(kind: number) {
  if (kind === KIND_SPRITE) return SOUL_GRANT_SCOPE_ASSETS
  if (kind === KIND_SKILL) return SOUL_GRANT_SCOPE_SKILLS
  if (kind === KIND_MEMORY) return SOUL_GRANT_SCOPE_MEMORY
  return 0
}

function grantIncludesScope(grant: SoulGrantRecord, scopeMask: number) {
  if (scopeMask === SOUL_GRANT_SCOPE_ASSETS) return grant.scopes.includes('assets')
  if (scopeMask === SOUL_GRANT_SCOPE_SKILLS) return grant.scopes.includes('skills')
  if (scopeMask === SOUL_GRANT_SCOPE_MEMORY) return grant.scopes.includes('memory')
  return false
}

function viewerGrantForKind(soul: SoulAssetDetail, viewerAddress: string | null | undefined, kind: number) {
  const normalized = normalizeSuiAddressForCompare(viewerAddress)
  if (!normalized) return null
  const scopeMask = scopeMaskForKind(kind)
  return soul.activeGrants.find((grant) =>
    grant.status === 'active'
    && normalizeSuiAddressForCompare(grant.granteeAddress) === normalized
    && grantIncludesScope(grant, scopeMask),
  ) ?? null
}

function canAppendContent(role: Role, soul: SoulAssetDetail, viewerAddress: string | null | undefined, kind: number) {
  if (role === 'owner') return true
  if (role !== 'grantee') return false
  return viewerGrantForKind(soul, viewerAddress, kind) !== null
}

function canDeleteContent(role: Role, soul: SoulAssetDetail, viewerAddress: string | null | undefined, kind: number) {
  return canAppendContent(role, soul, viewerAddress, kind)
}

function canPurgeContent(role: Role) {
  return role === 'owner'
}

function canSetActiveContent(role: Role) {
  return role === 'owner'
}

// ── CopyChip ─────────────────────────────────────────────────────────
function CopyChip({ value, label, tone = 'teal' }: { value: string | null | undefined; label?: string; tone?: 'teal' | 'muted' }) {
  const [copied, setCopied] = useState(false)
  const toneClass = tone === 'teal' ? 'text-tech-text' : 'text-muted'
  const display = label ?? (value ? `${value.slice(0, 6)}…${value.slice(-4)}` : '—')

  return (
    <span className={`inline-flex items-center gap-1 font-mono text-[12px] ${toneClass}`} title={value ?? undefined}>
      <span className="whitespace-nowrap">{display}</span>
      {value && (
        <button
          type="button"
          className="cursor-pointer rounded px-1 py-0.5 text-[11px] text-[var(--text-faint)] transition hover:bg-[var(--ui-surface-muted)] hover:text-foreground"
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
    <div className="flex items-center justify-between gap-2.5 border-t border-[var(--border-soft)] py-[9px] text-[13px] first:border-t-0">
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
  const isAnimacraftV5 = soul.animacraftProvenance?.animacraftVersion === 5
  const v5CollectionBlocked = isAnimacraftV5 && Boolean(soul.collectionOnChainId)
  const soulCreatorRoyaltyBps =
    soul.quote?.soulCreatorRoyaltyBps ?? soul.creatorRoyaltyBps
  const sprites = useMemo(() => activeVersions(soul.contentVersions, KIND_SPRITE), [soul.contentVersions])

  return (
    <div className="sd-hero grid items-start gap-7" style={{ gridTemplateColumns: 'minmax(320px,420px) minmax(0,1fr)' }}>
      {/* Cover card */}
      <div className="relative flex flex-col overflow-hidden rounded-[18px] border border-[var(--border-soft)] bg-card">
        <div className="relative aspect-[4/5] w-full overflow-hidden">
          <SoulCoverImage imageUrl={soul.imageUrl} className="absolute inset-0 h-full w-full" />

          {/* Overlay tags + actions */}
          <div className="absolute inset-x-3.5 top-3.5 z-[2] flex items-center gap-1.5">
            <span className="inline-flex flex-shrink-0 items-center whitespace-nowrap rounded-full border border-white/10 bg-[rgba(13,10,30,0.65)] px-2.5 py-[5px] text-[11px] font-semibold text-white backdrop-blur-md">
              {formatProvenance(soul.provenanceKind)}
            </span>
            <span className="inline-flex flex-shrink-0 items-center whitespace-nowrap rounded-full border border-white/10 bg-[rgba(13,10,30,0.65)] px-2.5 py-[5px] text-[11px] font-semibold text-white backdrop-blur-md">
              {listed ? 'Listed' : 'Held'}
            </span>
            {soul.activeSpriteVersionIndex != null && (
              <span className="sd-pill-live inline-flex flex-shrink-0 items-center whitespace-nowrap rounded-full border border-white/10 bg-[rgba(13,10,30,0.65)] px-2.5 py-[5px] text-[11px] font-semibold text-white backdrop-blur-md">
                Sprite v{soul.activeSpriteVersionIndex} live
              </span>
            )}
            <span className="flex-1" />
            <div className="flex flex-shrink-0 items-center gap-1.5">
              <button
                type="button"
                title="Open image"
                onClick={() => soul.imageUrl && window.open(soul.imageUrl, '_blank')}
                className="inline-flex h-[30px] w-[30px] cursor-pointer items-center justify-center rounded-lg border border-white/10 bg-[rgba(13,10,30,0.65)] text-[13px] text-white backdrop-blur-md transition hover:bg-[rgba(13,10,30,0.9)]"
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
                className="inline-flex h-[30px] w-[30px] cursor-pointer items-center justify-center rounded-lg border border-white/10 bg-[rgba(13,10,30,0.65)] text-[13px] text-white backdrop-blur-md transition hover:bg-[rgba(13,10,30,0.9)]"
              >
                ↗
              </button>
              {role !== 'owner' && (
                <button
                  type="button"
                  title="Report"
                  onClick={onReport}
                  className="inline-flex h-[30px] w-[30px] cursor-pointer items-center justify-center rounded-lg border border-white/10 bg-[rgba(13,10,30,0.65)] text-[13px] text-white backdrop-blur-md transition hover:bg-[rgba(13,10,30,0.9)]"
                >
                  ⚑
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Sprite strip */}
        {sprites.length > 0 && (
          <div className="flex items-center gap-2.5 border-t border-[var(--border-soft)] bg-[linear-gradient(180deg,var(--ui-panel-translucent),var(--ui-surface))] px-4 py-3.5">
            <div className="flex flex-1 items-center gap-1.5">
              {sprites.slice(0, 5).map((v) => {
                const isActive = v.versionIndex === soul.activeSpriteVersionIndex && v.name === soul.activeSpriteName
                return (
                  <div
                    key={v.id}
                    className={`sd-sprite-thumb relative h-11 w-11 overflow-hidden rounded-lg border ${
                      isActive ? 'border-gold shadow-[0_0_0_2px_var(--ui-soft-value)]' : 'border-[var(--border-soft)]'
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
                <span className="rounded bg-teal/20 px-1.5 py-px text-[10px] font-bold uppercase tracking-[0.04em] text-tech-text">YOU</span>
              )}
              {role === 'grantee' && (
                <span className="rounded bg-purple/20 px-1.5 py-px text-[10px] font-bold uppercase tracking-[0.04em] text-action-label">GRANTEE</span>
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
                listed ? 'text-value-text' : 'text-foreground'
              }`}
              style={{ fontSize: 32 }}
            >
              <span className="whitespace-nowrap">{listed ? priceLabel : 'Not listed'}</span>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-x-3.5 gap-y-1 text-[12px] text-muted">
              {listed ? (
                <>
                  <span className="whitespace-nowrap">
                    {isAnimacraftV5
                      ? 'Maker-source royalty'
                      : soul.provenanceKind === 'animacraft'
                        ? 'Maker royalty'
                        : 'Creator royalty'}{' '}
                    <b className="text-foreground">{((soul.animacraftProvenance?.makerRoyaltyBps ?? soul.creatorRoyaltyBps) / 100).toFixed(2)}%</b>
                  </span>
                  {isAnimacraftV5 && (
                    <>
                      <span className="text-[var(--text-faint)]">·</span>
                      <span className="whitespace-nowrap">
                        Soul creator royalty{' '}
                        <b className="text-foreground">{(soulCreatorRoyaltyBps / 100).toFixed(2)}%</b>
                      </span>
                    </>
                  )}
                  {soul.collection && !isAnimacraftV5 && (
                    <>
                      <span className="text-[var(--text-faint)]">·</span>
                      <span className="whitespace-nowrap">
                        Collection royalty <b className="text-foreground">{(soul.collection.extraRoyaltyBps / 100).toFixed(2)}%</b>
                      </span>
                    </>
                  )}
                </>
              ) : v5CollectionBlocked ? (
                <span className="text-danger">
                  Collection-bound Animacraft v5 Soul · secondary listing is blocked.
                </span>
              ) : (
                <span>List your Soul on the Soulidity Market when you&apos;re ready to find a new owner.</span>
              )}
            </div>
          </div>
          <div className="sd-listing-actions flex flex-col items-stretch gap-2" style={{ minWidth: 140 }}>
            {role === 'owner' && listed && (
              <>
                {!v5CollectionBlocked && (
                  <Button variant="gold" size="sm" onClick={onUpdatePrice}>
                    Update price
                  </Button>
                )}
                <Button variant="outline" size="sm" onClick={onDelist}>
                  Delist
                </Button>
              </>
            )}
            {role === 'owner' && !listed && !v5CollectionBlocked && (
              <Link
                href={`/souls/${encodeURIComponent(soul.onChainId)}/sell`}
                className={buttonStyles({ variant: 'gold', size: 'sm' })}
              >
                List Soul
              </Link>
            )}
            {role === 'owner' && !listed && v5CollectionBlocked && (
              <button
                type="button"
                disabled
                className={buttonStyles({ variant: 'outline', size: 'sm' })}
              >
                Listing blocked
              </button>
            )}
            {role !== 'owner' && listed && soul.quote && !v5CollectionBlocked && (
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

function Workspace({
  soul,
  role,
  detailQueryId,
  viewerId,
  viewerAddress,
}: {
  soul: SoulAssetDetail
  role: Role
  detailQueryId: string
  viewerId?: string | null
  viewerAddress?: string | null
}) {
  useSoulContentSyncReplay({ soul, detailQueryId, viewerId })

  const [tab, setTab] = useState<TabId>('info')
  const counts = useMemo(
    () => ({
      sprite: activeVersions(soul.contentVersions, KIND_SPRITE).length,
      skills: activeVersions(soul.contentVersions, KIND_SKILL).length,
      memory: activeVersions(soul.contentVersions, KIND_MEMORY).length,
      grants: soul.activeGrantCount + countActivePaidEntries(soul, role, viewerAddress),
    }),
    [soul, role, viewerAddress],
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
                    selected ? 'bg-[var(--purple-soft)] text-action-label' : 'bg-card2 text-muted'
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
      {tab === 'sprite' && <SpritePanel soul={soul} role={role} detailQueryId={detailQueryId} viewerId={viewerId} viewerAddress={viewerAddress} />}
      {tab === 'skills' && <SkillsPanel soul={soul} role={role} detailQueryId={detailQueryId} viewerId={viewerId} viewerAddress={viewerAddress} />}
      {tab === 'memory' && <MemoryPanel soul={soul} role={role} detailQueryId={detailQueryId} viewerId={viewerId} viewerAddress={viewerAddress} />}
      {tab === 'grants' && <GrantsPanel soul={soul} role={role} detailQueryId={detailQueryId} viewerId={viewerId} viewerAddress={viewerAddress} />}
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
    <div className={`rounded-xl border border-[var(--border-soft)] bg-[var(--ui-surface)] p-4 ${className}`}>
      {children}
    </div>
  )
}

// ── Info panel (object graph + royalties) ────────────────────────────
function InfoPanel({ soul }: { soul: SoulAssetDetail }) {
  const isAnimacraftV5 = soul.animacraftProvenance?.animacraftVersion === 5
  const soulCreatorRoyaltyBps =
    soul.quote?.soulCreatorRoyaltyBps ?? soul.creatorRoyaltyBps

  return (
    <div className="p-5">
      <PanelHead
        title="Soul info"
        copy="A Soul is composed of multiple Sui objects bound by a shared State. Tap any reference to copy. Royalty splits and grant capacity are encoded on the State and apply to every secondary trade."
        tags={<Tag color="teal">{formatProvenance(soul.provenanceKind)}</Tag>}
      />
      <div className="grid gap-3 lg:grid-cols-2">
        <Subcard>
          <div className="mb-2 text-[11px] font-bold uppercase tracking-[0.1em] text-action-label">Object graph</div>
          <KV k="Soul object" v={<CopyChip value={soul.onChainId} />} />
          <KV k="State object" v={<CopyChip value={soul.stateOnChainId} />} />
          <KV k="Content root" v={<CopyChip value={soul.contentOnChainId} />} />
          <KV k="Paid-access list" v={<CopyChip value={soul.paidAccessListOnChainId} />} />
          <KV k="Kiosk" v={<CopyChip value={soul.currentKioskId} />} />
          {soul.listingObjectOnChainId && <KV k="Listing object" v={<CopyChip value={soul.listingObjectOnChainId} />} />}
          {soul.collection && <KV k="Collection" v={<CopyChip value={soul.collection.onChainId} />} />}
        </Subcard>
        <Subcard>
          <div className="mb-2 text-[11px] font-bold uppercase tracking-[0.1em] text-action-label">Royalties &amp; access</div>
          <KV
            k={
              isAnimacraftV5
                ? 'Maker-source royalty'
                : soul.provenanceKind === 'animacraft'
                  ? 'Maker royalty'
                  : 'Creator royalty'
            }
            v={<span>{((soul.animacraftProvenance?.makerRoyaltyBps ?? soul.creatorRoyaltyBps) / 100).toFixed(2)}%</span>}
          />
          {isAnimacraftV5 && (
            <KV
              k="Soul creator royalty"
              v={<span>{(soulCreatorRoyaltyBps / 100).toFixed(2)}%</span>}
            />
          )}
          <KV
            k="Collection royalty"
            v={
              <span>
                {isAnimacraftV5 && soul.collectionOnChainId
                  ? 'Incompatible · resale blocked'
                  : soul.collection
                    ? `${(soul.collection.extraRoyaltyBps / 100).toFixed(2)}%`
                    : 'None'}
              </span>
            }
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
  viewerAddress,
  kind,
  title,
  copy,
  emptyIcon,
  emptyTitle,
  emptySub,
  versionLabelSingular,
  uploadCard,
  actions,
}: {
  soul: SoulAssetDetail
  role: Role
  viewerAddress?: string | null
  kind: number
  title: string
  copy: string
  emptyIcon: string
  emptyTitle: string
  emptySub: string
  versionLabelSingular: string
  uploadCard?: React.ReactNode
  actions: ContentActions
}) {
  const versions = useMemo(() => contentVersionsForKind(soul.contentVersions, kind), [soul.contentVersions, kind])
  const { pendingAction, contentActionError } = actions
  const canDelete = canDeleteContent(role, soul, viewerAddress, kind)
  const canPurge = canPurgeContent(role)
  const canSetActive = canSetActiveContent(role)
  const [purgeTarget, setPurgeTarget] = useState<SoulContentVersionRecord | null>(null)

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
      {contentActionError && (
        <div className="mt-3 rounded-lg border border-danger/35 bg-danger/8 px-3.5 py-2 text-[12px] text-danger">
          {contentActionError}
        </div>
      )}

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
              const canOpen =
                !v.deletedAt
                && (
                  role === 'owner'
                  || viewerGrantForKind(soul, viewerAddress, kind) !== null
                  || (
                    role === 'visitor'
                    && kind === KIND_SPRITE
                    && v.isPublic
                    && !v.sealEncrypted
                    && v.downloadPolicy === 'public'
                  )
                )
              return (
                <div
                  key={v.id}
                  className="flex flex-wrap items-center gap-3.5 rounded-xl border border-[var(--border-soft)] bg-[var(--ui-surface)] px-3.5 py-3"
                >
                  <div className="flex-shrink-0 rounded-md bg-teal/10 px-2 py-1 font-mono text-[13px] font-bold text-tech-text">
                    v{v.versionIndex}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2 text-[13px] font-semibold text-foreground">
                      <span className="whitespace-nowrap">{v.name || versionLabelSingular}</span>
                      {isActiveSprite && <Tag color="gold">Active</Tag>}
                      {v.deletedAt && <Tag color="muted">Deleted</Tag>}
                      <Tag color={v.isPublic ? 'gold' : 'purple'}>{v.isPublic ? 'public' : 'private'}</Tag>
                      {v.sealEncrypted && <Tag color="purple">sealed</Tag>}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-muted">
                      <span className="whitespace-nowrap">blob <span className="font-mono text-tech-text">{formatAddress(v.blobObjectId)}</span></span>
                      <span className="opacity-50">·</span>
                      <span className="whitespace-nowrap">{formatRelative(v.createdAtMs)}</span>
                      <span className="opacity-50">·</span>
                      <span className="whitespace-nowrap font-mono text-[10.5px]">{v.downloadPolicy}</span>
                    </div>
                  </div>
                  <div className="flex flex-shrink-0 flex-wrap gap-1.5">
                    {canOpen && (
                      <Button variant="outline" size="sm" disabled={pendingAction !== null} onClick={() => void actions.openContentVersion(v)}>
                        Open
                      </Button>
                    )}
                    {kind === KIND_SPRITE && !v.deletedAt && canSetActive && !isActiveSprite && (
                      <Button
                        variant="teal"
                        size="sm"
                        disabled={pendingAction !== null}
                        onClick={() => void actions.setActiveContent(v.kind, v.name, v.versionIndex)}
                      >
                        Set active
                      </Button>
                    )}
                    {kind === KIND_SPRITE && !v.deletedAt && canSetActive && isActiveSprite && (
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={pendingAction !== null}
                        onClick={() => void actions.clearActiveContent(v.kind)}
                      >
                        Clear active
                      </Button>
                    )}
                    {!v.deletedAt && canDelete && (
                      <Button
                        variant="danger"
                        size="sm"
                        disabled={pendingAction !== null || isActiveSprite || !canDelete}
                        title={isActiveSprite ? 'Clear or change the active sprite before deleting this version.' : undefined}
                        onClick={() => void actions.deleteContentVersion(v)}
                      >
                        Delete
                      </Button>
                    )}
                    {v.deletedAt && canPurge && (
                      <Button
                        variant="danger"
                        size="sm"
                        disabled={pendingAction !== null}
                        onClick={() => setPurgeTarget(v)}
                      >
                        Purge
                      </Button>
                    )}
                    {role === 'visitor' && (
                      <Button variant="outline" size="sm" disabled>
                        Metadata only
                      </Button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      <PurgeConfirmModal
        open={purgeTarget !== null}
        version={purgeTarget}
        pending={pendingAction === 'purge'}
        onClose={() => setPurgeTarget(null)}
        onConfirm={async () => {
          if (!purgeTarget) return
          // Let `purgeContentVersion` errors propagate so
          // `PurgeConfirmModal.handleConfirm()` renders the failure inline.
          // `contentActionError` is also set on the panel, but that banner
          // sits behind the modal overlay while purge stays open for retry.
          await actions.purgeContentVersion(purgeTarget)
          setPurgeTarget(null)
        }}
      />
    </div>
  )
}

function readFileText(file: File | null) {
  return file ? file.text() : Promise.resolve(null)
}

function SpriteAppendCard({ role, canAppend, actions }: { role: Role; canAppend: boolean; actions: ContentActions }) {
  const [sheetFile, setSheetFile] = useState<File | null>(null)
  const [configFile, setConfigFile] = useState<File | null>(null)
  const [configFileText, setConfigFileText] = useState<string | null>(null)
  const [configError, setConfigError] = useState<string | null>(null)
  const [visibility, setVisibility] = useState<'public' | 'owner_only'>('owner_only')
  const [setActiveAfterUpload, setSetActiveAfterUpload] = useState(role === 'owner')
  const { pendingAction } = actions
  const configValid = configFile == null || (configFileText != null && parsePersonaSpriteConfig(configFileText) != null)

  if (!canAppend) return null

  async function handleConfigFileChange(file: File | null) {
    setConfigFile(file)
    setConfigError(null)
    if (!file) {
      setConfigFileText(null)
      return
    }
    const text = await file.text()
    setConfigFileText(text)
    // Parse the persona sprite config eagerly so we can keep the upload
    // disabled and surface the error before the user pays for Walrus storage
    // and signs the on-chain mutation. Anything that fails this parse would
    // also be rejected by the desktop resolver downstream, so we never want
    // it to reach `setStateConfig('sprite_config_json', ...)`.
    if (!parsePersonaSpriteConfig(text)) {
      setConfigError(PERSONA_SPRITE_CONFIG_ERROR)
    }
  }

  async function handleUpload() {
    if (!sheetFile) return
    if (role === 'owner' && !configFile) return
    if (configFile && !configValid) {
      setConfigError(PERSONA_SPRITE_CONFIG_ERROR)
      return
    }
    const spriteConfigJson = configFileText ?? await readFileText(configFile)
    await actions.appendContentVersion({
      kind: KIND_SPRITE,
      name: 'persona-sprite',
      file: sheetFile,
      // `content::append_version_impl` hardcodes `seal_encrypted = true` on
      // every appended slot, and `/content/sync` rejects sealed slots that
      // arrive without a sidecar. Sprite uploads therefore always go through
      // the Seal envelope path so the post-TX mirror has a sidecar to store —
      // including "Public" slots, which are sealed-public (any wallet can
      // construct a Seal session via `seal_approve_content_public`) rather
      // than anonymous-plaintext.
      uploadType: 'encrypted',
      slotReadModeMask: visibility === 'public' ? READ_OWNER | READ_GRANT | READ_PUBLIC : READ_OWNER | READ_GRANT,
      downloadPolicy: visibility === 'public' ? 'public' : 'owner_only',
      setActive: role === 'owner' && setActiveAfterUpload,
      spriteConfigJson,
    })
    setSheetFile(null)
    setConfigFile(null)
    setConfigFileText(null)
    setConfigError(null)
  }

  return (
    <Subcard className="mb-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-[12px] font-bold uppercase tracking-[0.08em] text-muted">Append sprite version</div>
          <div className="mt-1 text-[12px] text-muted">Upload a sprite sheet. Owners also attach the sprite config JSON mirrored into Soul state.</div>
        </div>
        <Tag color={role === 'owner' ? 'teal' : 'purple'}>{role === 'owner' ? 'owner write' : 'assets grant'}</Tag>
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        <label className="block text-[12px] text-muted">
          <span className="mb-1.5 block font-semibold text-foreground">Sprite sheet</span>
          <input type="file" accept="image/*,.zip" onChange={(e) => setSheetFile(e.target.files?.[0] ?? null)} className="sd-file-input" />
        </label>
        <label className="block text-[12px] text-muted">
          <span className="mb-1.5 block font-semibold text-foreground">Config JSON</span>
          <input
            type="file"
            accept="application/json,.json"
            onChange={(e) => void handleConfigFileChange(e.target.files?.[0] ?? null)}
            className="sd-file-input"
          />
          {configError && <span className="mt-1.5 block text-[12px] text-red-500">{configError}</span>}
        </label>
        <div className="grid grid-cols-2 gap-2">
          <label className="block text-[12px] text-muted">
            <span className="mb-1.5 block font-semibold text-foreground">Access</span>
            <select
              value={visibility}
              onChange={(e) => setVisibility(e.target.value === 'public' ? 'public' : 'owner_only')}
              className="sd-grant-input"
            >
              <option value="owner_only">Owner only</option>
              <option value="public">Public</option>
            </select>
          </label>
          {role === 'owner' && (
            <label className="mt-6 inline-flex items-center gap-2 text-[12px] text-muted">
              <input
                type="checkbox"
                checked={setActiveAfterUpload}
                onChange={(e) => setSetActiveAfterUpload(e.target.checked)}
                className="h-4 w-4 accent-purple"
              />
              Set active
            </label>
          )}
        </div>
      </div>
      <div className="mt-3 flex justify-end">
        <Button
          variant="primary"
          size="sm"
          disabled={pendingAction !== null || !sheetFile || (role === 'owner' && !configFile) || !configValid}
          onClick={() => void handleUpload()}
        >
          {pendingAction === 'append' ? 'Uploading…' : 'Append sprite'}
        </Button>
      </div>
    </Subcard>
  )
}

function SkillsAppendCard({ canAppend, actions }: { canAppend: boolean; actions: ContentActions }) {
  const [bundleFile, setBundleFile] = useState<File | null>(null)
  const [skillName, setSkillName] = useState<string | null>(null)
  const [bundleError, setBundleError] = useState<string | null>(null)
  const { pendingAction } = actions

  if (!canAppend) return null

  async function handleFile(file: File | null) {
    setBundleFile(null)
    setSkillName(null)
    setBundleError(null)
    if (!file) return
    const result = await validateSelectedSkillBundle(file)
    if (!result.ok) {
      setBundleError(result.error)
      return
    }
    setBundleFile(file)
    setSkillName(result.skillName)
  }

  async function handleUpload() {
    if (!bundleFile || !skillName) return
    await actions.appendContentVersion({
      kind: KIND_SKILL,
      name: skillName,
      file: bundleFile,
      uploadType: 'encrypted',
      slotReadModeMask: READ_OWNER | READ_GRANT,
      downloadPolicy: NO_DOWNLOAD_POLICY,
    })
    setBundleFile(null)
    setSkillName(null)
    setBundleError(null)
  }

  return (
    <Subcard className="mb-4">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="text-[12px] font-bold uppercase tracking-[0.08em] text-muted">Add skill bundle</div>
              <div className="mt-1 text-[12px] text-muted">Upload a .zip bundle with SKILL.md frontmatter. The skill name becomes the content slot.</div>
            </div>
            {skillName && <Tag color="teal">{skillName}</Tag>}
          </div>
          <label className="block text-[12px] text-muted">
            <span className="mb-1.5 block font-semibold text-foreground">Skill bundle zip</span>
            <input
              type="file"
              accept="application/zip,.zip"
              onChange={(e) => void handleFile(e.target.files?.[0] ?? null)}
              className="sd-file-input"
            />
          </label>
          <div className="mt-3 flex justify-end">
            <Button
              variant="primary"
              size="sm"
              disabled={pendingAction !== null || !bundleFile || !skillName}
              onClick={() => void handleUpload()}
            >
              {pendingAction === 'append' ? 'Uploading…' : 'Append skill'}
            </Button>
          </div>
        </div>
        <SkillBundleFormatHint error={bundleError} />
      </div>
    </Subcard>
  )
}

function MemoryAppendCard({ canAppend, actions }: { canAppend: boolean; actions: ContentActions }) {
  const [body, setBody] = useState('')
  const { pendingAction } = actions
  const trimmed = body.trim()

  if (!canAppend) return null

  async function handleUpload() {
    if (!trimmed) return
    const file = new File([trimmed], `memory-${Date.now()}.md`, { type: 'text/markdown' })
    await actions.appendContentVersion({
      kind: KIND_MEMORY,
      name: actions.canonicalMemoryName,
      file,
      uploadType: 'encrypted',
      slotReadModeMask: READ_OWNER | READ_GRANT,
      downloadPolicy: actions.noDownloadPolicy,
    })
    setBody('')
  }

  return (
    <Subcard className="mb-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-[12px] font-bold uppercase tracking-[0.08em] text-muted">Append memory entry</div>
          <div className="mt-1 text-[12px] text-muted">Write a markdown entry into the canonical memory slot.</div>
        </div>
        <Tag color="purple">{actions.canonicalMemoryName}</Tag>
      </div>
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={5}
        aria-label="Memory entry"
        className="sd-grant-input min-h-[120px] resize-y font-sans leading-5"
        placeholder="Memory entry…"
      />
      <div className="mt-3 flex justify-end">
        <Button
          variant="primary"
          size="sm"
          disabled={pendingAction !== null || !trimmed}
          onClick={() => void handleUpload()}
        >
          {pendingAction === 'append' ? 'Uploading…' : 'Append memory'}
        </Button>
      </div>
    </Subcard>
  )
}

interface ContentPanelProps {
  soul: SoulAssetDetail
  role: Role
  detailQueryId: string
  viewerId?: string | null
  viewerAddress?: string | null
}

function SpritePanel({ soul, role, detailQueryId, viewerId, viewerAddress }: ContentPanelProps) {
  const actions = useSoulContentActions({ soul, role, detailQueryId, viewerId })
  const canAppend = canAppendContent(role, soul, viewerAddress, KIND_SPRITE)

  return (
    <ContentPanel
      soul={soul}
      role={role}
      viewerAddress={viewerAddress}
      kind={KIND_SPRITE}
      title="Persona Sprite"
      copy="Each sprite version is published on-chain and can be set as the active binding. Public versions stream from Walrus directly; private versions are AES-GCM encrypted and gated by Seal."
      emptyIcon="🖼"
      emptyTitle="No sprite versions yet"
      emptySub="When the owner uploads a persona sprite, every version stays addressable on-chain and the latest active binding renders here."
      versionLabelSingular="version"
      uploadCard={
        <>
          <AgentGrantRecommendations
            soul={soul}
            kindScopeMask={SOUL_GRANT_SCOPE_ASSETS}
            kindLabel="sprite"
            role={role}
            pendingAction={actions.pendingAction}
          />
          <SpriteAppendCard role={role} canAppend={canAppend} actions={actions} />
        </>
      }
      actions={actions}
    />
  )
}

function SkillsPanel({ soul, role, detailQueryId, viewerId, viewerAddress }: ContentPanelProps) {
  const actions = useSoulContentActions({ soul, role, detailQueryId, viewerId })
  const canAppend = canAppendContent(role, soul, viewerAddress, KIND_SKILL)

  return (
    <ContentPanel
      soul={soul}
      role={role}
      viewerAddress={viewerAddress}
      kind={KIND_SKILL}
      title="Skills"
      copy="Each skill bundle is appended on-chain as an immutable version. Bundles ship a SKILL.md that names the skill; private bundles are AES-GCM encrypted and Seal-gated."
      emptyIcon="📚"
      emptyTitle="No skill versions yet"
      emptySub="No skill bundles have been appended to this Soul. Once appended, every version stays addressable on-chain and can be opened or revoked here."
      versionLabelSingular="version"
      uploadCard={
        <>
          <AgentGrantRecommendations
            soul={soul}
            kindScopeMask={SOUL_GRANT_SCOPE_SKILLS}
            kindLabel="skill"
            role={role}
            pendingAction={actions.pendingAction}
          />
          <SkillsAppendCard canAppend={canAppend} actions={actions} />
        </>
      }
      actions={actions}
    />
  )
}

function MemoryPanel({ soul, role, detailQueryId, viewerId, viewerAddress }: ContentPanelProps) {
  const actions = useSoulContentActions({ soul, role, detailQueryId, viewerId })
  const versions = useMemo(() => contentVersionsForKind(soul.contentVersions, KIND_MEMORY), [soul.contentVersions])
  const canAppend = canAppendContent(role, soul, viewerAddress, KIND_MEMORY)
  const canDelete = canDeleteContent(role, soul, viewerAddress, KIND_MEMORY)
  const canDecrypt = role === 'owner' || viewerGrantForKind(soul, viewerAddress, KIND_MEMORY) !== null
  const canPurge = canPurgeContent(role)
  const { pendingAction, contentActionError } = actions
  const [purgeTarget, setPurgeTarget] = useState<SoulContentVersionRecord | null>(null)
  const purgeModal = (
    <PurgeConfirmModal
      open={purgeTarget !== null}
      version={purgeTarget}
      pending={pendingAction === 'purge'}
      onClose={() => setPurgeTarget(null)}
      onConfirm={async () => {
        if (!purgeTarget) return
        // Propagate purge failures so the modal's local error renders
        // inline; the modal stays open because `setPurgeTarget(null)`
        // only runs on success.
        await actions.purgeContentVersion(purgeTarget)
        setPurgeTarget(null)
      }}
    />
  )
  const tags = (
    <>
      <Tag color="teal">{versions.length} {versions.length === 1 ? 'entry' : 'entries'}</Tag>
      {role === 'visitor' && <Tag color="muted">read-only</Tag>}
      {role === 'grantee' && canDecrypt && <Tag color="purple">memory grant</Tag>}
    </>
  )

  if (versions.length === 0) {
    return (
      <div className="p-5">
        <PanelHead
          title="Memory log"
          copy="Each entry is an encrypted append to the on-chain memory log, written by the agent runtime, the founder, or any holder with a memory grant. Only the owner or a grant holder can decrypt the body."
          tags={tags}
        />
        <AgentGrantRecommendations
          soul={soul}
          kindScopeMask={SOUL_GRANT_SCOPE_MEMORY}
          kindLabel="memory"
          role={role}
          pendingAction={actions.pendingAction}
        />
        <MemoryAppendCard canAppend={canAppend} actions={actions} />
        {contentActionError && (
          <div className="mb-3 rounded-lg border border-danger/35 bg-danger/8 px-3.5 py-2 text-[12px] text-danger">
            {contentActionError}
          </div>
        )}
        <EmptyState
          icon="🧠"
          label="No memory entries yet"
          sublabel="Once the agent runtime or a memory grant holder appends an entry, the encrypted log will appear here."
        />
        {purgeModal}
      </div>
    )
  }

  return (
    <div className="p-5">
      <PanelHead
        title="Memory log"
        copy="Each entry is an encrypted append to the on-chain memory log, written by the agent runtime, the founder, or any holder with a memory grant. Only the owner or a grant holder can decrypt the body."
        tags={tags}
      />
      <MemoryAppendCard canAppend={canAppend} actions={actions} />
      {contentActionError && (
        <div className="mb-3 rounded-lg border border-danger/35 bg-danger/8 px-3.5 py-2 text-[12px] text-danger">
          {contentActionError}
        </div>
      )}
      <div className="space-y-2">
        {versions.map((v) => (
          <MemoryRow
            key={v.id}
            entry={v}
            canDecrypt={canDecrypt && !v.deletedAt}
            canDelete={canDelete && !v.deletedAt}
            canPurge={canPurge && Boolean(v.deletedAt)}
            pendingAction={pendingAction}
            actions={actions}
            onRequestPurge={(entry) => setPurgeTarget(entry)}
          />
        ))}
      </div>
      {purgeModal}
    </div>
  )
}

function MemoryRow({
  entry,
  canDecrypt,
  canDelete,
  canPurge,
  pendingAction,
  actions,
  onRequestPurge,
}: {
  entry: SoulContentVersionRecord
  canDecrypt: boolean
  canDelete: boolean
  canPurge: boolean
  pendingAction: ContentActions['pendingAction']
  actions: ContentActions
  onRequestPurge: (entry: SoulContentVersionRecord) => void
}) {
  const [open, setOpen] = useState(false)
  const [plaintext, setPlaintext] = useState<string | null>(null)
  const [rowError, setRowError] = useState<string | null>(null)

  async function handleDecrypt() {
    if (!canDecrypt) return
    setRowError(null)
    try {
      const bytes = await actions.decryptContentVersion(entry)
      setPlaintext(new TextDecoder().decode(bytes))
    } catch (error) {
      setRowError(error instanceof Error ? error.message : 'Failed to decrypt memory entry')
    }
  }

  return (
    <div className="overflow-hidden rounded-xl border border-[var(--border-soft)] bg-[var(--ui-surface)]">
      <button
        type="button"
        className="flex w-full cursor-pointer items-center gap-2.5 px-3.5 py-2.5 text-left transition hover:bg-[var(--ui-surface-muted)]"
        onClick={() => setOpen((v) => !v)}
      >
        <Tag color="teal">v{entry.versionIndex}</Tag>
        <span className="flex-1 truncate text-[13px] font-medium text-foreground">
          {`Memory @ ${formatDate(entry.createdAt)}`}
        </span>
        {entry.deletedAt && <Tag color="muted">Deleted</Tag>}
        <span className="whitespace-nowrap text-[12px] text-muted">{formatRelative(entry.createdAtMs)}</span>
        <span className="text-[var(--text-faint)]" title="Encrypted blob on Walrus">🔒</span>
        <span className="text-[11px] text-[var(--text-faint)]">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="border-t border-[var(--border-soft)] bg-[var(--ui-surface-muted)] px-3.5 pb-3 pt-2">
          <KV k="Slot name" v={<span className="font-mono text-[12px] text-tech-text">{entry.name}</span>} />
          <KV k="Blob object" v={<CopyChip value={entry.blobObjectId} />} />
          {entry.blobId && <KV k="Walrus blob" v={<CopyChip value={entry.blobId} />} />}
          <KV k="Download policy" v={<span className="font-mono text-[12px]">{entry.downloadPolicy}</span>} />
          <KV k="Created" v={<span>{formatDate(entry.createdAt)}</span>} />
          {rowError && <div className="mt-2 text-[12px] text-danger">{rowError}</div>}
          {plaintext && (
            <pre className="mt-2 max-h-[240px] overflow-auto whitespace-pre-wrap rounded-lg border border-[var(--border-soft)] bg-[var(--ui-control-bg)] p-3 text-[12px] leading-5 text-foreground">
              {plaintext}
            </pre>
          )}
          <div className="mt-2.5 flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={pendingAction !== null || !canDecrypt}
              title={canDecrypt ? undefined : 'Owner / grant only'}
              onClick={() => void handleDecrypt()}
            >
              {pendingAction === 'open' ? 'Decrypting…' : canDecrypt ? 'Read' : 'Owner / grant only'}
            </Button>
            {canDelete && (
              <Button
                variant="danger"
                size="sm"
                disabled={pendingAction !== null}
                onClick={() => void actions.deleteContentVersion(entry)}
              >
                Delete
              </Button>
            )}
            {canPurge && (
              <Button
                variant="danger"
                size="sm"
                disabled={pendingAction !== null}
                onClick={() => onRequestPurge(entry)}
              >
                Purge
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Grants panel ─────────────────────────────────────────────────────
function GrantsPanel({
  soul,
  role,
  detailQueryId,
  viewerId,
  viewerAddress,
}: {
  soul: SoulAssetDetail
  role: Role
  detailQueryId: string
  viewerId?: string | null
  viewerAddress?: string | null
}) {
  const canManage = role === 'owner'
  const [skillsAndDocsScope, setSkillsAndDocsScope] = useState(true)
  const [memoryScope, setMemoryScope] = useState(false)
  const [assetsScope, setAssetsScope] = useState(false)
  const [agentAddress, setAgentAddress] = useState('')
  const [reassignmentNotice, setReassignmentNotice] = useState<string | null>(null)
  const [preflightActive, setPreflightActive] = useState(false)
  const [preflightError, setPreflightError] = useState<string | null>(null)
  const { pending, error, issueGrant, revokeGrant } = useGrant(soul)
  const { getAuthHeaders } = useAuth()
  const queryClient = useQueryClient()
  const trimmedAgentAddress = agentAddress.trim()
  const targetActiveGrant = findActiveGrantForAddress(soul.activeGrants, trimmedAgentAddress)
  // Mirror-only hint for the helper text below the form. NOT authoritative:
  // the preflight in `handleAuthorize` will identify chain-only existing
  // grantees as `isNewGrantee: false` (R-001) and will bump capacity for
  // truly-new grantees up to `MAX_GRANT_CAPACITY`. The button stays
  // enabled even when the mirror looks "full" so the preflight can correct
  // the decision against on-chain truth.
  const mirrorLooksFullForNewGrantee = Boolean(
    trimmedAgentAddress && !targetActiveGrant && soul.activeGrantCount >= soul.grantCapacity,
  )

  function refreshSoulDetail() {
    void queryClient.invalidateQueries({ queryKey: ['soul', detailQueryId, viewerId ?? null] })
  }

  const scopeMask =
    (skillsAndDocsScope ? (SOUL_GRANT_SCOPE_SKILLS | SOUL_GRANT_SCOPE_SEAL) : 0)
    | (memoryScope ? SOUL_GRANT_SCOPE_MEMORY : 0)
    | (assetsScope ? SOUL_GRANT_SCOPE_ASSETS : 0)

  async function handleAuthorize() {
    const addr = trimmedAgentAddress
    if (!addr) return
    if (scopeMask === 0) return
    setReassignmentNotice(null)
    setPreflightError(null)
    try {
      // Always preflight `/grant-merge-masks` before deciding capacity or
      // scope. The mirror's `activeGrantCount` / `grantCapacity` can lag
      // behind the chain (post-TX mirror miss, grant issued via another
      // UI), so a local "capacity full" decision would reject a supersede
      // that the chain would happily accept. The preflight is the
      // authoritative source for both:
      //  - `isNewGrantee` (whether issuing consumes a fresh slot — chain
      //    fallback already self-heals mirror misses, see R-001 F-450); and
      //  - `requiredCapacity` / `currentCapacity` (whether the PTB needs
      //    a `set_grant_capacity` bump before `issue_to_grantee`).
      setPreflightActive(true)
      let mergedScopeMask = scopeMask
      let isNewGrantee = false
      let requiredCapacity = soul.grantCapacity
      let currentCapacity = soul.grantCapacity
      try {
        const headers = await getAuthHeaders()
        const mergeRes = await fetch('/api/souls/grant-merge-masks', {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            items: [{
              soulOnChainId: soul.onChainId,
              granteeAddress: addr,
              addedScopeMask: scopeMask,
            }],
          }),
        })
        if (!mergeRes.ok) {
          const body = await mergeRes.json().catch(() => ({}))
          throw new Error(body.error || `Failed to compute merged grant scope (${mergeRes.status})`)
        }
        const mergeBody = await mergeRes.json() as {
          items: Array<{
            soulOnChainId: string
            mergedScopeMask: number
            isNewGrantee: boolean
            currentCapacity: number
            requiredCapacity: number
          }>
        }
        const preflightItem = mergeBody.items[0]
        mergedScopeMask = preflightItem?.mergedScopeMask ?? scopeMask
        isNewGrantee = preflightItem?.isNewGrantee ?? false
        currentCapacity = preflightItem?.currentCapacity ?? soul.grantCapacity
        requiredCapacity = preflightItem?.requiredCapacity ?? currentCapacity
      } catch (mergeErr) {
        setPreflightError(mergeErr instanceof Error ? mergeErr.message : 'Failed to compute merged grant scope')
        return
      } finally {
        setPreflightActive(false)
      }

      // Capacity gate using the preflight's authoritative answer. Existing
      // grantees (chain-confirmed) supersede their own slot and never need
      // a bump — `requiredCapacity === currentCapacity`. New grantees may
      // need the bump; refuse if the bump would exceed the on-chain
      // ceiling.
      if (isNewGrantee && requiredCapacity > MAX_GRANT_CAPACITY) {
        setPreflightError(
          `Authorizing this grantee would require capacity ${requiredCapacity}, which exceeds the on-chain maximum of ${MAX_GRANT_CAPACITY}. Revoke an existing grantee first.`,
        )
        return
      }
      const setCapacityTo = requiredCapacity > currentCapacity ? requiredCapacity : null

      await issueGrant(addr, null, mergedScopeMask, { setCapacityTo })
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
    <div className="space-y-5 p-5">
      <section>
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

          <div role="group" aria-label="Grant scopes" className="mb-3.5 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            {[
              {
                id: 'skillsAndDocs' as const,
                title: 'Skills & Docs',
                desc: 'Append, read, and decrypt skill bundles & document assets.',
                color: 'teal' as const,
                checked: skillsAndDocsScope,
                toggle: () => setSkillsAndDocsScope((v) => !v),
              },
              {
                id: 'memory' as const,
                title: 'Memory',
                desc: 'Read, decrypt, and append entries to the memory log.',
                color: 'purple' as const,
                checked: memoryScope,
                toggle: () => setMemoryScope((v) => !v),
              },
              {
                id: 'assets' as const,
                title: 'Sprite & Audio',
                desc: 'Read and decrypt persona sprite sheets and voice clips.',
                color: 'gold' as const,
                checked: assetsScope,
                toggle: () => setAssetsScope((v) => !v),
              },
            ].map((s) => (
              <button
                key={s.id}
                type="button"
                role="checkbox"
                aria-checked={s.checked}
                data-selected={s.checked ? 'true' : 'false'}
                className="sd-scope-card"
                onClick={s.toggle}
              >
                <div className="flex items-center justify-between">
                  <span
                    className={`font-mono text-[13px] font-semibold ${
                      s.color === 'teal' ? 'text-tech-text' : s.color === 'purple' ? 'text-action-label' : 'text-value-text'
                    }`}
                  >
                    {s.title}
                  </span>
                  <span className="text-[14px] leading-none text-muted">{s.checked ? '☑' : '☐'}</span>
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
          {preflightError && <div className="mt-2 text-[12px] text-danger">{preflightError}</div>}
          {reassignmentNotice && <div className="mt-2 text-[12px] text-value-text">{reassignmentNotice}</div>}
          {scopeMask === 0 && <div className="mt-2 text-[12px] text-muted">Select at least one scope.</div>}
          <div className="mt-3.5 flex flex-wrap items-center gap-2">
            <Button
              variant="primary"
              size="sm"
              disabled={
                pending !== null
                || preflightActive
                || !trimmedAgentAddress
                || scopeMask === 0
              }
              onClick={handleAuthorize}
            >
              {preflightActive
                ? 'Checking scope…'
                : pending === 'issue'
                  ? 'Authorizing…'
                  : pending === 'revoke'
                    ? 'Revoking…'
                    : '+ Authorize'}
            </Button>
            <span className="ml-auto text-[11px] text-muted">
              {targetActiveGrant
                ? 'Selected scopes will be merged with the grantee\'s existing scopes — never narrows.'
                : mirrorLooksFullForNewGrantee
                  ? `Capacity ${soul.activeGrantCount} / ${soul.grantCapacity} — will be raised automatically for a new grantee.`
                  : `Capacity ${soul.activeGrantCount} / ${soul.grantCapacity}`}
            </span>
          </div>
        </Subcard>
      )}
      </section>

      <PaidAccessSection
        soul={soul}
        role={role}
        viewerAddress={viewerAddress}
        detailQueryId={detailQueryId}
        viewerId={viewerId}
      />
    </div>
  )
}

// ── Paid-access section ──────────────────────────────────────────────
function PaidAccessSection({
  soul,
  role,
  viewerAddress,
  detailQueryId,
  viewerId,
}: {
  soul: SoulAssetDetail
  role: Role
  viewerAddress?: string | null
  detailQueryId: string
  viewerId?: string | null
}) {
  const canManage = role === 'owner'
  const queryClient = useQueryClient()
  const refreshSoulDetail = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['soul', detailQueryId, viewerId ?? null] })
  }, [detailQueryId, queryClient, viewerId])
  const { pending, error, revokePaidAccess } = usePaidAccess(soul, { onSynced: refreshSoulDetail })

  async function handleRevoke(entry: SoulPaidAccessEntryRecord) {
    try {
      await revokePaidAccess(entry.buyerAddress, entry.kind)
      refreshSoulDetail()
    } catch {
      // surfaced via hook state
    }
  }

  const visibleEntries = selectVisiblePaidEntries(soul, role, viewerAddress)
  const activeConfigs = soul.paidAccessKindConfigs.filter((c) => paidAccessConfigActive(c, soul))
  const activeVisibleCount = visibleEntries.filter((e) => paidEntryActive(e, soul)).length
  const tagText = role === 'owner'
    ? `${activeVisibleCount} active`
    : activeVisibleCount > 0
      ? `${activeVisibleCount} you hold`
      : visibleEntries.length > 0
        ? `${visibleEntries.length} on file`
        : '0 active'

  const emptyCopy = role === 'owner'
    ? activeConfigs.length === 0
      ? 'No paid-access kind is configured. Configure pricing on-chain to make this Soul purchasable per kind.'
      : 'No buyer has purchased paid access yet.'
    : activeConfigs.length === 0
      ? 'Paid access is not offered for this Soul.'
      : 'You have not purchased paid access for this Soul.'

  return (
    <section className="border-t border-[var(--border-soft)] pt-5">
      <PanelHead
        title="Paid access"
        copy="Per-buyer scoped read access purchased on-chain. Each entry binds one buyer to one kind (seal · memory · skills · assets) with optional duration. Owners can revoke at any time (no on-chain refund); entries auto-invalidate on Soul resale."
        tags={<Tag color="muted">{tagText}</Tag>}
      />

      {activeConfigs.length > 0 && (
        <div className="mb-3 grid gap-2 sm:grid-cols-2">
          {activeConfigs.map((c) => (
            <PaidConfigCard key={c.id} config={c} />
          ))}
        </div>
      )}

      {visibleEntries.length === 0 ? (
        <EmptyState icon="💳" label="No paid-access entry" sublabel={emptyCopy} />
      ) : (
        <div className="space-y-2">
          {visibleEntries.map((entry) => (
            <PaidEntryCard
              key={entry.id}
              entry={entry}
              soul={soul}
              canManage={canManage}
              pending={pending !== null}
              onRevoke={canManage ? () => handleRevoke(entry) : null}
            />
          ))}
        </div>
      )}

      {canManage && error && <div className="mt-2 text-[12px] text-danger">{error}</div>}
    </section>
  )
}

function PaidConfigCard({ config }: { config: SoulPaidAccessKindConfigRecord }) {
  return (
    <Subcard className="!p-3">
      <div className="flex flex-wrap items-center justify-between gap-2 text-[12px]">
        <span className="font-mono font-semibold text-foreground">
          {paidAccessKindLabel(config.kind)}
        </span>
        <span className="text-muted">
          {formatAtomicAmountForDisplay(config.priceAtomic)}
          {' · '}
          {formatDurationMs(config.durationMs)}
        </span>
      </div>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {paidAccessScopeLabels(config.scopeMask).map((s) => (
          <Tag key={`${config.id}:${s}`} color="teal">
            {s}
          </Tag>
        ))}
      </div>
    </Subcard>
  )
}

function PaidEntryCard({
  entry,
  soul,
  canManage,
  pending,
  onRevoke,
}: {
  entry: SoulPaidAccessEntryRecord
  soul: SoulAssetDetail
  canManage: boolean
  pending: boolean
  onRevoke: (() => void) | null
}) {
  const expired = paidEntryExpired(entry)
  const stale = paidEntryStale(entry, soul)
  const active = paidEntryActive(entry, soul)
  const statusLabel = active ? 'active' : stale ? 'stale' : expired ? 'expired' : 'on file'
  const isComp = isCompEntry(entry)
  return (
    <Subcard className="!p-3.5">
      <div className="flex flex-wrap items-center justify-between gap-2.5">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <Tag color={active ? 'success' : 'muted'}>{statusLabel}</Tag>
          <Tag color="purple">{paidAccessKindLabel(entry.kind)}</Tag>
          {paidAccessScopeLabels(entry.scopeMask).map((s) => (
            <Tag key={`${entry.id}:${s}`} color="teal">
              {s}
            </Tag>
          ))}
          {isComp && <Tag color="gold">comp</Tag>}
          <CopyChip value={entry.buyerAddress} />
        </div>
        {canManage && onRevoke && (
          <Button variant="ghost" size="sm" disabled={pending} onClick={onRevoke}>
            Revoke
          </Button>
        )}
      </div>
      <div className="mt-3 grid gap-1.5 text-[12px]">
        <div className="flex justify-between text-muted">
          <span>{isComp ? 'Granted' : 'Price paid'}</span>
          <span className="font-mono text-foreground">
            {isComp ? '0 USDC' : formatAtomicAmountForDisplay(entry.pricePaidAtomic)}
          </span>
        </div>
        <div className="flex justify-between text-muted">
          <span>Expires</span>
          <span>{formatExpiresAtMs(entry.expiresAtMs)}</span>
        </div>
        <div className="flex justify-between text-muted">
          <span>Purchased</span>
          <span>{formatRelative(entry.createdAtMs)}</span>
        </div>
      </div>
    </Subcard>
  )
}

function selectVisiblePaidEntries(
  soul: SoulAssetDetail,
  role: Role,
  viewerAddress: string | null | undefined,
): SoulPaidAccessEntryRecord[] {
  const all = soul.paidAccessEntries.filter((e) => e.revokedAt == null)
  if (role === 'owner') return all
  const v = normalizeSuiAddressForCompare(viewerAddress)
  if (!v) return []
  return all.filter((e) => normalizeSuiAddressForCompare(e.buyerAddress) === v)
}

function countActivePaidEntries(
  soul: SoulAssetDetail,
  role: Role,
  viewerAddress: string | null | undefined,
): number {
  return selectVisiblePaidEntries(soul, role, viewerAddress).filter(
    (e) => paidEntryActive(e, soul),
  ).length
}

function paidAccessConfigActive(config: SoulPaidAccessKindConfigRecord, soul: SoulAssetDetail): boolean {
  return config.deletedAt == null
    && soul.currentOwnershipEpoch != null
    && config.ownershipEpochSnapshot === soul.currentOwnershipEpoch
}

function paidEntryActive(entry: SoulPaidAccessEntryRecord, soul: SoulAssetDetail): boolean {
  return entry.revokedAt == null
    && !paidEntryExpired(entry)
    && soul.currentOwnershipEpoch != null
    && entry.ownershipEpochSnapshot === soul.currentOwnershipEpoch
}

function paidEntryStale(entry: SoulPaidAccessEntryRecord, soul: SoulAssetDetail): boolean {
  return soul.currentOwnershipEpoch != null
    && entry.ownershipEpochSnapshot !== soul.currentOwnershipEpoch
}

function paidEntryExpired(entry: SoulPaidAccessEntryRecord): boolean {
  if (!entry.expiresAtMs) return false
  try {
    return BigInt(entry.expiresAtMs) <= BigInt(Date.now())
  } catch {
    return false
  }
}

function isCompEntry(entry: SoulPaidAccessEntryRecord): boolean {
  try {
    return BigInt(entry.pricePaidAtomic) === 0n
  } catch {
    return false
  }
}

function paidAccessKindLabel(kind: number): string {
  if (kind === KIND_SOUL_DOC) return 'Soul body'
  if (kind === KIND_MEMORY) return 'Memory'
  if (kind === KIND_SKILL) return 'Skill'
  if (kind === KIND_SPRITE) return 'Sprite'
  if (kind === KIND_AUDIO) return 'Audio'
  return `Kind ${kind}`
}

function paidAccessScopeLabels(mask: number): string[] {
  const labels: string[] = []
  if (mask & SOUL_GRANT_SCOPE_SEAL) labels.push('seal')
  if (mask & SOUL_GRANT_SCOPE_MEMORY) labels.push('memory')
  if (mask & SOUL_GRANT_SCOPE_SKILLS) labels.push('skills')
  if (mask & SOUL_GRANT_SCOPE_ASSETS) labels.push('assets')
  return labels
}

function formatDurationMs(value: string | number | bigint | null | undefined): string {
  if (value == null) return 'lifetime'
  let ms: bigint
  try {
    ms = BigInt(value as string | number | bigint)
  } catch {
    return '—'
  }
  if (ms <= 0n) return 'lifetime'
  const SEC = 1000n
  const MIN = 60n * SEC
  const HR = 60n * MIN
  const DAY = 24n * HR
  if (ms >= DAY) {
    const days = ms / DAY
    return `${days} ${days === 1n ? 'day' : 'days'}`
  }
  if (ms >= HR) {
    const hrs = ms / HR
    return `${hrs} ${hrs === 1n ? 'hour' : 'hours'}`
  }
  if (ms >= MIN) {
    const mins = ms / MIN
    return `${mins} ${mins === 1n ? 'min' : 'mins'}`
  }
  const secs = ms / SEC
  return `${secs} ${secs === 1n ? 'sec' : 'secs'}`
}

function formatExpiresAtMs(value: string | null): string {
  if (!value) return 'Never'
  const ms = Number(value)
  if (!Number.isFinite(ms)) return '—'
  return new Date(ms).toLocaleString()
}

// ── Right rail ───────────────────────────────────────────────────────
function Rail({ soul, role }: { soul: SoulAssetDetail; role: Role }) {
  const isAnimacraftV5 = soul.animacraftProvenance?.animacraftVersion === 5
  const soulCreatorRoyaltyBps =
    soul.quote?.soulCreatorRoyaltyBps ?? soul.creatorRoyaltyBps
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
          <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-action-label">Provenance</div>
        </div>
        <KV k="Creator" v={<CopyChip value={soul.creatorAddress} />} />
        <KV k="Current owner" v={<CopyChip value={soul.currentOwnerAddress} />} />
        <KV k="Provenance" v={<span>{formatProvenance(soul.provenanceKind)}</span>} />
        {soul.collection && (
          <KV
            k="Collection"
            v={
              <Link href={`/collections/${encodeURIComponent(soul.collection.onChainId)}`} className="text-tech-text hover:underline">
                {soul.collection.name}
              </Link>
            }
          />
        )}
        <KV k="Created" v={<span>{new Date(soul.createdAt).toLocaleDateString()}</span>} />
      </div>

      <div className="rounded-2xl border border-[var(--border-soft)] bg-card p-[18px]">
        <div className="mb-3 flex items-center justify-between">
          <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-action-label">Access</div>
          <Tag color="success">Active</Tag>
        </div>
        <KV k="Owner access" v={<span className="text-success">● Active</span>} />
        <KV k="Grant capacity" v={<span>{soul.activeGrantCount} / {soul.grantCapacity}</span>} />
        <div className="my-1.5 sd-progress">
          <div style={{ width: `${grantPct}%` }} />
        </div>
        <KV k="Skills versions" v={<span>{activeVersions(soul.contentVersions, KIND_SKILL).length}</span>} />
        <KV k="Memory entries" v={<span>{activeVersions(soul.contentVersions, KIND_MEMORY).length}</span>} />
        <KV
          k={
            isAnimacraftV5
              ? 'Maker-source royalty'
              : soul.provenanceKind === 'animacraft'
                ? 'Maker royalty'
                : 'Creator royalty'
          }
          v={<span>{((soul.animacraftProvenance?.makerRoyaltyBps ?? soul.creatorRoyaltyBps) / 100).toFixed(2)}%</span>}
        />
        {isAnimacraftV5 && (
          <KV
            k="Soul creator royalty"
            v={<span>{(soulCreatorRoyaltyBps / 100).toFixed(2)}%</span>}
          />
        )}
        {soul.collection && !isAnimacraftV5 && (
          <KV k="Collection royalty" v={<span>{(soul.collection.extraRoyaltyBps / 100).toFixed(2)}%</span>} />
        )}
        {isAnimacraftV5 && soul.collectionOnChainId && (
          <KV k="Secondary sale" v={<span className="text-danger">Blocked by collection binding</span>} />
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
          <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-action-label">Activity</div>
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
            <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-action-label">Collection</div>
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
              style={{ background: 'linear-gradient(135deg, var(--ui-tech), var(--ui-tech-text))' }}
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
        <Workspace
          soul={soul}
          role={role}
          detailQueryId={id}
          viewerId={user?.id ?? null}
          viewerAddress={user?.primarySuiAddress ?? null}
        />
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
