'use client'

import { useState } from 'react'
import { useAuth } from '@web/components/auth-provider'

export interface WalrusUploadResult {
  blobId: string
  blobObjectId: string | null
  contentHash: string
  sealDekEnvelope?: string
}

interface UploadWalrusProps {
  type: 'encrypted' | 'public'
  label: string
  accept?: string
  onUpload: (result: WalrusUploadResult) => void
}

export function UploadWalrus({ type, label, accept, onUpload }: UploadWalrusProps) {
  const { getAuthHeaders } = useAuth()
  const [uploading, setUploading] = useState(false)
  const [uploaded, setUploaded] = useState(false)
  const [error, setError] = useState('')

  async function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return

    setUploading(true)
    setError('')

    try {
      const formData = new FormData()
      formData.append('file', file)
      formData.append('type', type)

      const headers = await getAuthHeaders()
      const res = await fetch('/api/souls/upload', {
        method: 'POST',
        headers,
        body: formData,
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Upload failed')
      }

      const result = (await res.json()) as WalrusUploadResult
      onUpload(result)
      setUploaded(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setUploading(false)
    }
  }

  return (
    <div>
      <label
        className="relative overflow-hidden flex flex-col items-center justify-center gap-3 rounded-xl cursor-pointer select-none"
        style={{
          minHeight: '200px',
          border: `2px dashed ${uploaded ? 'var(--accent-emerald)' : 'var(--border-default)'}`,
          background: 'var(--bg-surface)',
          transition: 'border-color 0.2s ease',
          padding: '24px 16px',
          cursor: uploading ? 'default' : 'pointer',
        }}
      >
        <input
          type="file"
          accept={accept}
          onChange={handleChange}
          className="sr-only"
          disabled={uploading}
        />
        {uploading ? (
          <>
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" aria-hidden="true" style={{ opacity: 0.4, color: 'var(--text-muted)' }}>
              <rect x="3" y="3" width="18" height="18" rx="3" stroke="currentColor" strokeWidth="1.5" />
              <path d="M3 16l5-5 4 4 3-3 3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              <circle cx="8.5" cy="8.5" r="1.5" fill="currentColor" />
              <path d="M15 7v4M13 9h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            <span className="text-sm" style={{ color: 'var(--text-muted)' }}>Uploading…</span>
          </>
        ) : uploaded ? (
          <>
            <span className="text-sm font-medium" style={{ color: 'var(--accent-emerald)' }}>Uploaded!</span>
          </>
        ) : (
          <>
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" aria-hidden="true" style={{ opacity: 0.4, color: 'var(--text-muted)' }}>
              <rect x="3" y="3" width="18" height="18" rx="3" stroke="currentColor" strokeWidth="1.5" />
              <path d="M3 16l5-5 4 4 3-3 3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              <circle cx="8.5" cy="8.5" r="1.5" fill="currentColor" />
              <path d="M15 7v4M13 9h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{label}</span>
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>JPEG, PNG, WebP, GIF</span>
          </>
        )}
      </label>
      {error && (
        <p className="text-xs mt-1" style={{ color: 'var(--accent-rose)' }}>
          {error}
        </p>
      )}
    </div>
  )
}
