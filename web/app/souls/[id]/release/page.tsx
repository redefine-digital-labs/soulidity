'use client'

import { use, useState } from 'react'
import Link from 'next/link'
import { useAuth } from '@web/components/auth-provider'
import { usePrivySuiSign } from '@web/lib/souls/use-privy-sui'
import { buildPublishReleaseTx } from '@web/lib/souls/tx-builder'

function findCreatedObjectId(
  result: { objectChanges?: Array<{ type: string; objectType?: string; objectId?: string }> },
  typeSuffix: string,
): string | null {
  const obj = result.objectChanges?.find(
    (c) => c.type === 'created' && c.objectType?.includes(typeSuffix),
  )
  return obj?.objectId ?? null
}

export default function NewReleasePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const { getAuthHeaders } = useAuth()
  const { suiWallet, signAndExecute } = usePrivySuiSign()

  const [version, setVersion] = useState('')
  const [bundleFile, setBundleFile] = useState<File | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [status, setStatus] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!suiWallet || !bundleFile) return

    setError(null)
    setSubmitting(true)

    try {
      const headers = await getAuthHeaders()

      // Fetch series to get authorCapId
      setStatus('Loading series info...')
      const seriesRes = await fetch(`/api/souls/${encodeURIComponent(id)}`, { headers })
      if (!seriesRes.ok) throw new Error('Failed to load Soul series')
      const series = await seriesRes.json()

      // Upload bundle
      setStatus('Uploading bundle...')
      const form = new FormData()
      form.append('file', bundleFile)
      form.append('type', 'encrypted')
      const uploadRes = await fetch('/api/souls/upload', { method: 'POST', headers, body: form })
      if (!uploadRes.ok) {
        const data = await uploadRes.json().catch(() => ({}))
        throw new Error(data.error || 'Upload failed')
      }
      const { blobId, contentHash } = await uploadRes.json()

      // Create release on-chain
      setStatus('Creating release on-chain...')
      const contentHashBytes = new Uint8Array(
        contentHash.match(/.{1,2}/g)!.map((byte: string) => parseInt(byte, 16)),
      )
      const tx = buildPublishReleaseTx({
        authorCapId: series.authorCapOnChainId,
        seriesId: series.onChainId,
        version: version.trim() || '1.0.0',
        encryptedBlobId: blobId,
        publicMetadataId: blobId,
        contentHash: contentHashBytes,
      })
      const result = await signAndExecute(tx)
      const releaseOnChainId = findCreatedObjectId(result, '::series::SoulRelease')
      if (!releaseOnChainId) throw new Error('Failed to find created release')

      // Mirror to DB
      setStatus('Saving to database...')
      const mirrorRes = await fetch(`/api/souls/${encodeURIComponent(id)}/release`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ txDigest: result.digest, releaseOnChainId }),
      })
      if (!mirrorRes.ok) {
        const data = await mirrorRes.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to mirror release')
      }

      setDone(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Release failed')
    } finally {
      setSubmitting(false)
      setStatus('')
    }
  }

  if (done) {
    return (
      <div className="max-w-2xl mx-auto px-6 py-8">
        <div className="glass-card p-6 space-y-4">
          <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>Release Published</h1>
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>New release created successfully.</p>
          <Link href={`/souls/${encodeURIComponent(id)}`} className="btn btn-primary inline-flex">Back to Soul</Link>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-2xl mx-auto px-6 py-8">
      <div className="glass-card p-6 space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>New Release</h1>
          <Link href={`/souls/${encodeURIComponent(id)}`} className="text-sm" style={{ color: 'var(--text-muted)' }}>Cancel</Link>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1">
            <label htmlFor="release-version" className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>Version</label>
            <input id="release-version" type="text" className="input-dark w-full" placeholder="1.0.0" value={version} onChange={(e) => setVersion(e.target.value)} disabled={submitting} maxLength={32} />
          </div>

          <div className="space-y-1">
            <label htmlFor="release-bundle" className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>Bundle File</label>
            <input id="release-bundle" type="file" className="input-dark w-full text-xs" onChange={(e) => setBundleFile(e.target.files?.[0] ?? null)} disabled={submitting} />
          </div>

          {error && <p role="alert" className="text-sm" style={{ color: 'var(--color-error, #f87171)' }}>{error}</p>}

          <button type="submit" className="btn btn-primary w-full" disabled={submitting || !bundleFile || !suiWallet}>
            {submitting ? (status || 'Publishing...') : 'Publish Release'}
          </button>
        </form>
      </div>
    </div>
  )
}
