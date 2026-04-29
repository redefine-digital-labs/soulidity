'use client'

import { useEffect } from 'react'
import { captureFrontendException } from '@/lib/observability/posthog-client-errors'

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    captureFrontendException(error, { digest: error.digest, scope: 'global-error' })
  }, [error])

  return (
    <html>
      <body>
        <div style={{
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          textAlign: 'center',
          padding: '24px',
          fontFamily: 'system-ui, -apple-system, sans-serif',
        }}>
          <div style={{ fontSize: '72px', opacity: 0.4, marginBottom: '24px' }}>⚠️</div>
          <h1 style={{ fontSize: '24px', fontWeight: 700, marginBottom: '12px' }}>Application error</h1>
          <p style={{ fontSize: '14px', color: '#666', maxWidth: '400px', marginBottom: '32px' }}>
            {error.message || 'A critical error occurred. Please reload the page.'}
          </p>
          <button
            onClick={reset}
            style={{
              background: '#7c3aed',
              color: '#fff',
              fontWeight: 700,
              fontSize: '14px',
              padding: '10px 24px',
              borderRadius: '8px',
              border: 'none',
              cursor: 'pointer',
            }}
          >
            Try Again
          </button>
        </div>
      </body>
    </html>
  )
}
