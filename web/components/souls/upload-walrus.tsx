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
        className="glass-card p-4 block text-center cursor-pointer transition-all"
        style={{
          borderStyle: 'dashed',
          color: uploaded ? 'var(--accent-emerald)' : 'var(--text-muted)',
        }}
      >
        <input
          type="file"
          accept={accept}
          onChange={handleChange}
          className="hidden"
          disabled={uploading}
        />
        {uploading ? 'Uploading...' : uploaded ? 'Uploaded!' : label}
      </label>
      {error && (
        <p className="text-xs mt-1" style={{ color: 'var(--accent-rose)' }}>
          {error}
        </p>
      )}
    </div>
  )
}
