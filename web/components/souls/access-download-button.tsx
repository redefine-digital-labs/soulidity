'use client'

import { useState } from 'react'
import { useSuiClient } from '@mysten/dapp-kit'
import { useAuth } from '@web/components/auth-provider'
import {
  createSoulDownloadBlob,
  loadDecryptedSoulBundle,
  requirePrimarySuiWallet,
  sanitizeDownloadFileName,
  scheduleBlobUrlRevoke,
} from '@web/lib/souls/access-download'
import { usePrivySuiSign } from '@web/lib/souls/use-privy-sui'

export function AccessDownloadButton({ soulObjectId }: { soulObjectId: string }) {
  const { getAuthHeaders, user } = useAuth()
  const { signPersonalMessage } = usePrivySuiSign()
  const suiClient = useSuiClient()
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleDownload() {
    if (submitting) return
    try {
      requirePrimarySuiWallet(user?.primarySuiAddress)
    } catch (walletError) {
      setError(walletError instanceof Error ? walletError.message : 'Bind a Sui wallet before accessing Soul content')
      return
    }

    setSubmitting(true)
    setError(null)

    try {
      const bundle = await loadDecryptedSoulBundle({
        soulObjectId,
        getAuthHeaders,
        signPersonalMessage,
        suiClient,
      })
      const blob = createSoulDownloadBlob(bundle.bytes, bundle.mimeType)
      const blobUrl = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = blobUrl
      anchor.download = sanitizeDownloadFileName(bundle.fileName)
      document.body.appendChild(anchor)
      try {
        anchor.click()
      } finally {
        anchor.remove()
        scheduleBlobUrlRevoke(blobUrl)
      }
    } catch (downloadError) {
      setError(downloadError instanceof Error ? downloadError.message : 'Failed to download Soul content')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={handleDownload}
        aria-label="Download Soul content"
        disabled={submitting}
        className="px-4 py-3 rounded-xl font-semibold"
        style={{
          background: 'var(--accent-emerald)',
          color: '#04150f',
          opacity: submitting ? 0.7 : 1,
        }}
      >
        {submitting ? 'Decrypting…' : 'Download content'}
      </button>
      {error ? (
        <p className="text-sm" style={{ color: 'var(--accent-rose)' }}>{error}</p>
      ) : null}
    </div>
  )
}
