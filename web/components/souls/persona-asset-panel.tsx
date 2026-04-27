'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Alert } from '@/components/ui/alert'
import { Tag } from '@/components/ui/tag'
import { UploadZone } from '@/components/ui/upload-zone'
import { useAssets } from '@/lib/hooks/use-assets'
import { validatePersonaSpriteDraft } from '@/lib/soulidity/persona-sprite'
import { MAX_SOUL_UPLOAD_BYTES } from '@/lib/soulidity/upload-validation'
import type { SoulAssetDetail, SoulAssetVersionRecord } from '@/lib/soulidity/types'

const SPRITE_SHEET_UPLOAD_LIMIT_MIB = Math.ceil(MAX_SOUL_UPLOAD_BYTES / (1024 * 1024))
const SPRITE_SHEET_UPLOAD_HINT = `PNG, up to ${SPRITE_SHEET_UPLOAD_LIMIT_MIB} MiB`

function formatAddress(value: string | null | undefined) {
  if (!value) return '—'
  return `${value.slice(0, 6)}…${value.slice(-4)}`
}

function formatDate(value: string | null | undefined) {
  if (!value) return '—'
  return new Date(value).toLocaleString()
}

interface SpriteVersionRowProps {
  version: SoulAssetVersionRecord
  isActive: boolean
  pending: 'append' | 'delete' | 'clear' | 'recovering' | null
  canManage: boolean
  onDelete: (version: SoulAssetVersionRecord) => void
}

function SpriteVersionRow({ version, isActive, pending, canManage, onDelete }: SpriteVersionRowProps) {
  // `assets::delete_version_as_owner` aborts with `EAssetVersionActive` when the version is
  // still the active sprite binding. Surface the clear-first requirement instead of offering
  // a Delete action that would always revert.
  const deletable = canManage && !version.deletedAt && !isActive
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/40 px-4 py-3 first:border-t-0">
      <div className="flex flex-wrap items-center gap-2">
        <Tag color="teal">v{version.versionIndex}</Tag>
        <Tag color={version.visibility === 'public' ? 'gold' : 'purple'}>
          {version.visibility === 'public' ? 'Public' : 'Private'}
        </Tag>
        {isActive && <Tag color="teal">Active</Tag>}
        {version.deletedAt && <Tag color="danger">Deleted</Tag>}
        <span className="text-xs text-muted font-mono">blob {formatAddress(version.blobObjectId)}</span>
        <span className="text-xs text-muted">{formatDate(version.createdAt)}</span>
      </div>
      {deletable ? (
        <Button
          type="button"
          size="sm"
          variant="danger"
          disabled={pending === 'delete'}
          onClick={() => onDelete(version)}
        >
          {pending === 'delete' ? 'Deleting…' : 'Delete'}
        </Button>
      ) : canManage && isActive && !version.deletedAt ? (
        <span className="text-xs text-muted">Clear active to delete</span>
      ) : null}
    </div>
  )
}

export function PersonaAssetPanel({ soul }: { soul: SoulAssetDetail }) {
  const {
    pending,
    error,
    canManage,
    spriteVersions,
    isLoading,
    appendAndActivateSprite,
    deleteVersion,
    clearActive,
  } = useAssets(soul)

  const [sheetFile, setSheetFile] = useState<File | null>(null)
  const [configFile, setConfigFile] = useState<File | null>(null)
  const [visibility, setVisibility] = useState<'public' | 'private'>('public')
  const [selectionError, setSelectionError] = useState<string | null>(null)

  async function handleSheetSelect(file: File) {
    setSheetFile(file)
    setSelectionError(null)
    if (configFile) {
      const result = await validatePersonaSpriteDraft({ sheetFile: file, configFile })
      if (!result.ok) setSelectionError(result.error)
    }
  }

  async function handleConfigSelect(file: File) {
    setConfigFile(file)
    setSelectionError(null)
    if (sheetFile) {
      const result = await validatePersonaSpriteDraft({ sheetFile, configFile: file })
      if (!result.ok) setSelectionError(result.error)
    }
  }

  async function handleAppend() {
    if (!sheetFile || !configFile) return
    const result = await validatePersonaSpriteDraft({ sheetFile, configFile })
    if (!result.ok) {
      setSelectionError(result.error)
      return
    }
    try {
      await appendAndActivateSprite({ sheetFile, configFile, visibility })
      setSheetFile(null)
      setConfigFile(null)
      setSelectionError(null)
    } catch {
      // error is surfaced via the hook's `error` state
    }
  }

  const activeVersionIndex = soul.activeSpriteVersionIndex
  const activePolicy = soul.activeSpriteDownloadPolicy

  return (
    <div className="bg-card2 border border-border rounded-xl p-4 space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="page-kicker text-muted mb-2">Persona Sprite</div>
          <p className="text-sm text-muted">
            Each upload publishes a new on-chain version and immediately sets it as active.
            Public versions stream from Walrus directly; private versions are AES-GCM encrypted before upload and gated by Seal.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Tag color={soul.assetsOnChainId ? 'teal' : 'muted'}>
            {soul.assetsOnChainId ? 'root ready' : 'no root'}
          </Tag>
          {activeVersionIndex != null && <Tag color="teal">active v{activeVersionIndex}</Tag>}
          {activePolicy && <Tag color={activePolicy === 'public' ? 'gold' : 'purple'}>{activePolicy}</Tag>}
        </div>
      </div>

      {error && (
        <Alert variant="warning" icon="!" className="text-sm">{error}</Alert>
      )}
      {isLoading && !error && (
        <Alert variant="info" icon="…" className="text-sm">Loading sprite versions…</Alert>
      )}

      {canManage ? (
        <div className="rounded-lg border border-border/80 bg-white/[0.03] p-4 space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted">Upload as</span>
            <Tag color="gold">owner</Tag>
            <Tag color={visibility === 'public' ? 'gold' : 'purple'}>{visibility}</Tag>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <UploadZone
              icon="🖼"
              label={sheetFile ? sheetFile.name : 'Sprite sheet PNG'}
              sublabel={sheetFile ? `${Math.max(1, Math.round(sheetFile.size / 1024))} KB selected` : SPRITE_SHEET_UPLOAD_HINT}
              accept="image/png"
              onFileSelect={(file) => { void handleSheetSelect(file) }}
              className="py-6"
            />
            <UploadZone
              icon="⚙️"
              label={configFile ? configFile.name : 'Sprite config JSON'}
              sublabel={configFile ? `${Math.max(1, Math.round(configFile.size / 1024))} KB selected` : 'PersonaSpriteConfig: frameWidth, frameHeight, columns, animations'}
              accept="application/json,.json"
              onFileSelect={(file) => { void handleConfigSelect(file) }}
              className="py-6"
            />
          </div>

          {selectionError && (
            <Alert variant="warning" icon="!" className="text-sm">{selectionError}</Alert>
          )}

          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant={visibility === 'public' ? 'gold' : 'outline'}
              onClick={() => setVisibility('public')}
            >
              Public
            </Button>
            <Button
              type="button"
              size="sm"
              variant={visibility === 'private' ? 'primary' : 'outline'}
              onClick={() => setVisibility('private')}
            >
              Private (owner_only)
            </Button>
            <Button
              type="button"
              variant="teal"
              size="sm"
              disabled={!sheetFile || !configFile || isLoading || pending === 'append' || Boolean(selectionError)}
              onClick={() => { void handleAppend() }}
            >
              {pending === 'append' ? 'Publishing…' : 'Upload & Set Active'}
            </Button>
            {activeVersionIndex != null && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={pending === 'clear'}
                onClick={() => { void clearActive() }}
              >
                {pending === 'clear' ? 'Clearing…' : 'Clear Active'}
              </Button>
            )}
          </div>
        </div>
      ) : soul.assetsOnChainId ? (
        <p className="text-sm text-muted">Sprite management is limited to the current Soul owner.</p>
      ) : (
        <p className="text-sm text-muted">This Soul was minted without a sprite assets root.</p>
      )}

      {spriteVersions.length === 0 ? (
        <p className="text-sm text-muted">No sprite version has been mirrored for this Soul yet.</p>
      ) : (
        <div className="rounded-lg border border-border/80 bg-white/[0.02] overflow-hidden">
          {spriteVersions.map((version) => (
            <SpriteVersionRow
              key={version.id}
              version={version}
              isActive={activeVersionIndex === version.versionIndex}
              pending={pending}
              canManage={canManage}
              onDelete={(v) => { void deleteVersion(v) }}
            />
          ))}
        </div>
      )}
    </div>
  )
}
