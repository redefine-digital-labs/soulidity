'use client'
import { useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { Suspense } from 'react'

function VerifyForm() {
  const searchParams = useSearchParams()
  const tgId = searchParams.get('tg_id') ?? ''
  const [code, setCode] = useState('')
  const [result, setResult] = useState<{ verified: boolean; error?: string } | null>(null)

  async function verify() {
    const res = await fetch('/api/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, tg_id: tgId }),
    })
    setResult(await res.json())
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="glass-panel p-8 animate-fade-up">
          <h1 className="text-2xl font-bold mb-2" style={{ fontFamily: 'var(--font-display)' }}>
            <span className="text-gradient">CryptoOpenClaw</span>
          </h1>
          <p className="mb-8" style={{ color: 'var(--text-muted)' }}>
            Enter your invite code to join the community.
          </p>
          <input
            className="input-dark mb-4"
            placeholder="Invite code"
            value={code}
            onChange={e => setCode(e.target.value.toUpperCase())}
          />
          <button onClick={verify} className="btn btn-primary w-full">
            Verify
          </button>
          {result && (
            <div
              className="mt-6 p-4 rounded-lg animate-fade-up"
              style={{
                background: result.verified ? 'var(--accent-emerald-dim)' : 'var(--accent-rose-dim)',
                color: result.verified ? 'var(--accent-emerald)' : 'var(--accent-rose)',
                border: `1px solid ${result.verified ? 'rgba(52, 211, 153, 0.3)' : 'rgba(251, 113, 133, 0.3)'}`,
              }}
            >
              {result.verified ? 'Verified! You will receive a group invite shortly.' : result.error}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default function VerifyPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center">
        <div className="glass-panel p-8 animate-pulse" style={{ color: 'var(--text-muted)' }}>Loading...</div>
      </div>
    }>
      <VerifyForm />
    </Suspense>
  )
}
