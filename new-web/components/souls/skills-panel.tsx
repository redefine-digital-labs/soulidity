'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Alert } from '@/components/ui/alert'
import { Tag } from '@/components/ui/tag'
import { UploadZone } from '@/components/ui/upload-zone'
import { useSkills } from '@/lib/hooks/use-skills'
import type { SoulAssetDetail, SoulSkillVisibility, SoulSkillVersionRecord } from '@/lib/soulidity/types'

function formatAddress(value: string | null | undefined) {
  if (!value) return '—'
  return `${value.slice(0, 6)}…${value.slice(-4)}`
}

function formatDate(value: string | null | undefined) {
  if (!value) return '—'
  return new Date(value).toLocaleString()
}

function formatVersionFileName(version: SoulSkillVersionRecord) {
  return `v${version.versionNumber}`
}

export function SkillsPanel({ soul }: { soul: SoulAssetDetail }) {
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [visibility, setVisibility] = useState<SoulSkillVisibility>('private')
  const { pending, error, canManageSkills, skillGrant, appendSkillVersion, deleteSkillVersion, openSkillVersion } = useSkills(soul)

  const uploaderLabel = soul.isOwner
    ? 'owner'
    : skillGrant
      ? `skills grant ${formatAddress(skillGrant.granteeAddress)}`
      : null

  async function handleAppend() {
    if (!selectedFile) return
    await appendSkillVersion(selectedFile, visibility)
    setSelectedFile(null)
  }

  return (
    <div className="bg-card2 border border-border rounded-xl p-4 space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="page-kicker text-muted mb-2">Skills</div>
          <p className="text-sm text-muted">
            Versions are append-only. Private versions require owner access or an active `skills` grant to decrypt.
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

      {canManageSkills ? (
        <div className="rounded-lg border border-border/80 bg-white/[0.03] p-4 space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted">Append as</span>
            <Tag color={soul.isOwner ? 'gold' : 'purple'}>{uploaderLabel ?? 'authorized writer'}</Tag>
            <Tag color={visibility === 'private' ? 'purple' : 'gold'}>{visibility}</Tag>
          </div>

          <UploadZone
            icon="🧠"
            label={selectedFile ? selectedFile.name : 'Upload a new skill version'}
            sublabel={selectedFile ? `${Math.max(1, Math.round(selectedFile.size / 1024))} KB selected` : 'Markdown, text, or JSON supported. Private versions are encrypted before upload.'}
            accept=".md,.markdown,.txt,.json,text/markdown,text/plain,application/json"
            onFileSelect={setSelectedFile}
            className="py-6"
          />

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
              disabled={!selectedFile || pending === 'append'}
              onClick={() => {
                void handleAppend()
              }}
            >
              {pending === 'append' ? 'Appending…' : 'Append Version'}
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

      {soul.skillVersions.length === 0 ? (
        <p className="text-sm text-muted">No skills version has been mirrored for this Soul yet.</p>
      ) : (
        <div className="space-y-3">
          {soul.skillVersions.map((version) => (
            <div key={version.id} className="rounded-lg border border-border/80 bg-white/[0.03] px-4 py-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Tag color={version.visibility === 'public' ? 'gold' : 'purple'}>{version.visibility}</Tag>
                  <Tag color="muted">{formatVersionFileName(version)}</Tag>
                  {version.deletedAt ? <Tag color="danger">deleted</Tag> : null}
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant={version.visibility === 'public' ? 'outline' : 'primary'}
                    disabled={Boolean(version.deletedAt) || pending === 'read'}
                    onClick={() => {
                      void openSkillVersion(version)
                    }}
                  >
                    {pending === 'read' ? 'Opening…' : version.visibility === 'public' ? 'Open Blob' : 'Decrypt'}
                  </Button>
                  {canManageSkills && !version.deletedAt ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="danger"
                      disabled={pending === 'delete'}
                      onClick={() => {
                        void deleteSkillVersion(version)
                      }}
                    >
                      {pending === 'delete' ? 'Deleting…' : 'Delete'}
                    </Button>
                  ) : null}
                </div>
              </div>

              <div className="mt-3 grid gap-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted">Blob</span>
                  <span>{formatAddress(version.blobObjectId)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted">Previous</span>
                  <span>{formatAddress(version.previousVersionOnChainId)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted">Created</span>
                  <span>{formatDate(version.createdAt)}</span>
                </div>
                {version.deletedAt ? (
                  <div className="flex justify-between">
                    <span className="text-muted">Deleted</span>
                    <span>{formatDate(version.deletedAt)}</span>
                  </div>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
