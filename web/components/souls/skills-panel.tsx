'use client'

import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Alert } from '@/components/ui/alert'
import { SkillBundleFormatHint } from '@/components/souls/skill-bundle-format-hint'
import { Tag } from '@/components/ui/tag'
import { UploadZone } from '@/components/ui/upload-zone'
import { useSkills } from '@/lib/hooks/use-skills'
import type { SoulAssetDetail, SoulSkillVisibility, SoulSkillVersionRecord } from '@/lib/soulidity/types'
import { validateSelectedSkillBundle } from '@/lib/soulidity/upload-validation'

function formatAddress(value: string | null | undefined) {
  if (!value) return '—'
  return `${value.slice(0, 6)}…${value.slice(-4)}`
}

function formatDate(value: string | null | undefined) {
  if (!value) return '—'
  return new Date(value).toLocaleString()
}

function groupVersionsBySkillName(versions: SoulSkillVersionRecord[]) {
  const groups = new Map<string, SoulSkillVersionRecord[]>()
  for (const version of versions) {
    const existing = groups.get(version.skillName)
    if (existing) {
      existing.push(version)
    } else {
      groups.set(version.skillName, [version])
    }
  }
  // Sort versions within each group by versionIndex descending (newest first)
  for (const group of groups.values()) {
    group.sort((a, b) => b.versionIndex - a.versionIndex)
  }
  return groups
}

interface SkillGroupProps {
  skillName: string
  versions: SoulSkillVersionRecord[]
  canManageSkills: boolean
  pending: 'append' | 'delete' | 'read' | 'recovering' | null
  onDelete: (version: SoulSkillVersionRecord) => void
  onOpen: (version: SoulSkillVersionRecord) => void
}

function SkillGroup({ skillName, versions, canManageSkills, pending, onDelete, onOpen }: SkillGroupProps) {
  const [expanded, setExpanded] = useState(true)
  const activeCount = versions.filter((v) => !v.deletedAt).length
  const latestActive = versions.find((v) => !v.deletedAt)

  return (
    <div className="rounded-lg border border-border/80 bg-white/[0.03] overflow-hidden">
      <button
        type="button"
        className="w-full px-4 py-3 flex flex-wrap items-center justify-between gap-3 text-left hover:bg-white/[0.03] transition-colors"
        onClick={() => setExpanded((prev) => !prev)}
        aria-expanded={expanded}
      >
        <div className="flex flex-wrap items-center gap-2 min-w-0">
          <span className="font-semibold text-sm truncate">{skillName}</span>
          <Tag color="teal">
            v{latestActive?.versionIndex ?? versions[0]?.versionIndex ?? 0}
          </Tag>
          <Tag color="muted">{activeCount} active</Tag>
          {versions.length > activeCount && (
            <Tag color="danger">{versions.length - activeCount} deleted</Tag>
          )}
        </div>
        <span className="text-muted text-xs ml-auto">{expanded ? '▲' : '▼'}</span>
      </button>

      {expanded && (
        <div className="border-t border-border/60 divide-y divide-border/40">
          {versions.map((version) => (
            <div key={version.id} className="px-4 py-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Tag color="teal">v{version.versionIndex}</Tag>
                  <Tag color={version.visibility === 'public' ? 'gold' : 'purple'}>
                    {version.visibility === 'public' ? 'Public' : 'Private'}
                  </Tag>
                  {version.deletedAt && <Tag color="danger">Deleted</Tag>}
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant={version.visibility === 'public' ? 'outline' : 'primary'}
                    disabled={Boolean(version.deletedAt) || pending === 'read'}
                    onClick={() => onOpen(version)}
                  >
                    {pending === 'read' ? 'Opening…' : version.visibility === 'public' ? 'Open Blob' : 'Decrypt'}
                  </Button>
                  {canManageSkills && !version.deletedAt && (
                    <Button
                      type="button"
                      size="sm"
                      variant="danger"
                      disabled={pending === 'delete'}
                      onClick={() => onDelete(version)}
                    >
                      {pending === 'delete' ? 'Deleting…' : 'Delete'}
                    </Button>
                  )}
                </div>
              </div>

              <div className="mt-3 grid gap-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted">Blob object</span>
                  <span className="font-mono text-xs text-teal">{formatAddress(version.blobObjectId)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted">Uploaded</span>
                  <span>{formatDate(version.createdAt)}</span>
                </div>
                {version.deletedAt && (
                  <div className="flex justify-between">
                    <span className="text-muted">Deleted</span>
                    <span className="text-danger">{formatDate(version.deletedAt)}</span>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export function SkillsPanel({ soul }: { soul: SoulAssetDetail }) {
  const [selectedFiles, setSelectedFiles] = useState<File[]>([])
  const [selectedSkillName, setSelectedSkillName] = useState<string | null>(null)
  const [selectionError, setSelectionError] = useState<string | null>(null)
  const [visibility, setVisibility] = useState<SoulSkillVisibility>('private')
  const {
    pending,
    error,
    canManageSkills,
    skillGrant,
    skillVersions,
    skillVersionCount,
    skillsLoading,
    hasMoreSkillVersions,
    loadingMoreSkillVersions,
    loadMoreSkillVersions,
    appendSkillVersion,
    appendSkillVersions,
    deleteSkillVersion,
    openSkillVersion,
  } = useSkills(soul)
  const groupedVersions = useMemo(() => groupVersionsBySkillName(skillVersions), [skillVersions])

  const uploaderLabel = soul.isOwner
    ? 'owner'
    : skillGrant
      ? `skills grant ${formatAddress(skillGrant.granteeAddress)}`
      : null

  async function handleAppend() {
    if (selectedFiles.length === 0) return
    if (selectedFiles.length === 1) {
      await appendSkillVersion(selectedFiles[0], visibility)
    } else {
      await appendSkillVersions(selectedFiles, visibility)
    }
    setSelectedFiles([])
    setSelectedSkillName(null)
    setSelectionError(null)
  }

  async function handleFileSelect(file: File) {
    const result = await validateSelectedSkillBundle(file)
    if (!result.ok) {
      setSelectedFiles([])
      setSelectedSkillName(null)
      setSelectionError(result.error)
      return
    }

    setSelectionError(null)
    setSelectedSkillName(result.skillName)
    setSelectedFiles([file])
  }

  async function handleFilesSelect(files: FileList) {
    const nextFiles = Array.from(files)
    if (nextFiles.length === 0) return
    const skillNames: string[] = []
    for (const file of nextFiles) {
      const result = await validateSelectedSkillBundle(file)
      if (!result.ok) {
        setSelectedFiles([])
        setSelectedSkillName(null)
        setSelectionError(result.error)
        return
      }
      skillNames.push(result.skillName)
    }

    setSelectionError(null)
    setSelectedSkillName(Array.from(new Set(skillNames)).join(', '))
    setSelectedFiles(nextFiles)
  }

  return (
    <div className="bg-card2 border border-border rounded-xl p-4 space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="page-kicker text-muted mb-2">Skills</div>
          <p className="text-sm text-muted">
            Each upload creates a new revision. Private versions require owner access or an active `skills` grant to decrypt.
          </p>
        </div>
        <Tag color={soul.skillsOnChainId ? 'teal' : 'muted'}>
          {soul.skillsOnChainId ? 'root ready' : 'no root'}
        </Tag>
      </div>

      {error ? (
        <Alert variant="warning" icon="!" className="text-sm">
          {error}
        </Alert>
      ) : null}

      {skillsLoading ? (
        <Alert variant="info" icon="…" className="text-sm">
          Loading skill versions…
        </Alert>
      ) : null}

      {canManageSkills ? (
        <div className="rounded-lg border border-border/80 bg-white/[0.03] p-4 space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted">Append as</span>
            <Tag color={soul.isOwner ? 'gold' : 'purple'}>{uploaderLabel ?? 'authorized writer'}</Tag>
            <Tag color={visibility === 'private' ? 'purple' : 'gold'}>{visibility}</Tag>
          </div>

          <UploadZone
            icon="🧠"
            label={selectedFiles.length > 0 ? `${selectedFiles.length} ZIP bundle${selectedFiles.length === 1 ? '' : 's'} selected` : 'Upload ZIP skill bundle(s)'}
            sublabel={selectedFiles.length > 0
              ? `${Math.max(1, Math.round(selectedFiles.reduce((sum, file) => sum + file.size, 0) / 1024))} KB selected · Skill: ${selectedSkillName ?? 'read from SKILL.md'}`
              : 'Only ZIP bundles with SKILL.md frontmatter are accepted. Private versions are encrypted before upload.'}
            accept=".zip,application/zip,application/x-zip-compressed"
            multiple
            onFileSelect={(file) => {
              void handleFileSelect(file)
            }}
            onFilesSelect={(files) => {
              void handleFilesSelect(files)
            }}
            className="py-6"
          />

          {(selectedFiles.length === 0 || selectionError) && (
            <SkillBundleFormatHint error={selectionError} />
          )}

          <div className="flex flex-wrap gap-2">
            <Button
              variant={visibility === 'private' ? 'primary' : 'outline'}
              size="sm"
              type="button"
              onClick={() => setVisibility('private')}
            >
              Private
            </Button>
            <Button
              variant={visibility === 'public' ? 'gold' : 'outline'}
              size="sm"
              type="button"
              onClick={() => setVisibility('public')}
            >
              Public
            </Button>
            <Button
              type="button"
              variant="teal"
              size="sm"
              disabled={selectedFiles.length === 0 || pending === 'append'}
              onClick={() => {
                void handleAppend()
              }}
            >
              {pending === 'append' ? 'Appending…' : selectedFiles.length > 1 ? 'Append Versions' : 'Append Version'}
            </Button>
          </div>
        </div>
      ) : soul.skillsOnChainId ? (
        <p className="text-sm text-muted">
          This Soul has a skills root, but the current viewer does not hold a `skills` scope grant, so write/delete controls stay hidden.
        </p>
      ) : (
        <p className="text-sm text-muted">
          This Soul was minted without an initial character file, so there is no shared skills root to append to.
        </p>
      )}

      {groupedVersions.size === 0 ? (
        <p className="text-sm text-muted">No skills version has been mirrored for this Soul yet.</p>
      ) : (
        <div className="space-y-3">
          <div className="text-xs text-muted">
            Showing {skillVersions.length} of {skillVersionCount} version{skillVersionCount === 1 ? '' : 's'}
          </div>
          {Array.from(groupedVersions.entries()).map(([skillName, versions]) => (
            <SkillGroup
              key={skillName}
              skillName={skillName}
              versions={versions}
              canManageSkills={canManageSkills}
              pending={pending}
              onDelete={(version) => { void deleteSkillVersion(version) }}
              onOpen={(version) => { void openSkillVersion(version) }}
            />
          ))}
          {hasMoreSkillVersions ? (
            <div className="flex justify-center pt-1">
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={loadingMoreSkillVersions}
                onClick={() => {
                  void loadMoreSkillVersions()
                }}
              >
                {loadingMoreSkillVersions ? 'Loading…' : 'Load More Versions'}
              </Button>
            </div>
          ) : null}
        </div>
      )}
    </div>
  )
}
