'use client'

import { useState } from 'react'
import { Tag } from '@/components/ui/tag'
import type { TagColor } from '@/components/ui/tag'
import type { SoulAssetDetail, SoulMemoryEntryRecord, SoulWriterKind } from '@/lib/soulidity/types'

function formatAddress(value: string | null | undefined) {
  if (!value) return '—'
  return `${value.slice(0, 6)}…${value.slice(-4)}`
}

function formatTimestamp(createdAtMs: number) {
  return new Date(createdAtMs).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatDate(value: string | null | undefined) {
  if (!value) return '—'
  return new Date(value).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function writerKindLabel(kind: SoulWriterKind): string {
  if (kind === 'founder') return 'Founder'
  if (kind === 'granted-agent') return 'Agent'
  return 'Owner'
}

function writerKindColor(kind: SoulWriterKind): TagColor {
  if (kind === 'founder') return 'purple'
  if (kind === 'granted-agent') return 'gold'
  return 'teal'
}

function MemoryEntryRow({ entry }: { entry: SoulMemoryEntryRecord }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="rounded-lg border border-border/80 bg-white/[0.03] overflow-hidden">
      <button
        type="button"
        className="w-full px-4 py-3 flex flex-wrap items-center justify-between gap-3 text-left hover:bg-white/[0.03] transition-colors"
        onClick={() => setExpanded((prev) => !prev)}
        aria-expanded={expanded}
      >
        <div className="flex flex-wrap items-center gap-2 min-w-0">
          <Tag color={writerKindColor(entry.writerKind)}>
            {writerKindLabel(entry.writerKind)}
          </Tag>
          <span className="text-[11px] font-semibold text-muted tracking-[0.01em]">
            {formatTimestamp(entry.createdAtMs)}
          </span>
          <span className="text-xs text-muted" title="Encrypted blob stored on Walrus">
            {'\uD83D\uDD12'}
          </span>
        </div>
        <span className="text-muted text-xs ml-auto">{expanded ? '▲' : '▼'}</span>
      </button>

      {expanded && (
        <div className="px-4 pb-4 pt-1 border-t border-border/60 space-y-2">
          <div className="grid gap-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted">Timestamp key</span>
              <span className="font-mono text-xs text-teal">{entry.timestampKey}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted">Writer</span>
              <span className="font-mono text-xs text-teal">{formatAddress(entry.writerAddress)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted">Blob object</span>
              <span className="font-mono text-xs text-teal">{formatAddress(entry.blobObjectId)}</span>
            </div>
            {entry.blobId && (
              <div className="flex justify-between">
                <span className="text-muted">Walrus blob</span>
                <span className="font-mono text-xs text-teal">{formatAddress(entry.blobId)}</span>
              </div>
            )}
            <div className="flex justify-between">
              <span className="text-muted">Mirrored at</span>
              <span>{formatDate(entry.createdAt)}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export function MemoryPanel({ soul }: { soul: SoulAssetDetail }) {
  const entries = soul.memoryEntries

  return (
    <div className="bg-card2 border border-border rounded-xl p-4 space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="page-kicker text-muted mb-2">Memory</div>
          <p className="text-sm text-muted">
            Each append writes an encrypted entry to the on-chain memory log. Only the owner or a{' '}
            <code className="text-xs bg-white/5 px-1 py-0.5 rounded">memory</code> grant holder can decrypt.
          </p>
        </div>
        <Tag color={soul.memoryOnChainId ? 'teal' : 'muted'}>
          {entries.length} {entries.length === 1 ? 'entry' : 'entries'}
        </Tag>
      </div>

      {entries.length === 0 ? (
        <p className="text-sm text-muted">No memory entries have been mirrored for this Soul yet.</p>
      ) : (
        <div className="space-y-2">
          {entries.map((entry) => (
            <MemoryEntryRow key={entry.id} entry={entry} />
          ))}
        </div>
      )}
    </div>
  )
}
