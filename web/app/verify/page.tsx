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
    <div className="max-w-md mx-auto p-6 mt-20">
      <h1 className="text-2xl font-bold mb-4">ClawNews Verification</h1>
      <p className="text-gray-500 mb-6">Enter your invite code to join the community.</p>
      <input
        className="w-full border rounded px-3 py-2 mb-4"
        placeholder="Invite code"
        value={code}
        onChange={e => setCode(e.target.value.toUpperCase())}
      />
      <button onClick={verify} className="w-full bg-gray-900 text-white rounded py-2 hover:bg-gray-700">
        Verify
      </button>
      {result && (
        <div className={`mt-4 p-3 rounded ${result.verified ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
          {result.verified ? 'Verified! You will receive a group invite shortly.' : result.error}
        </div>
      )}
    </div>
  )
}

export default function VerifyPage() {
  return (
    <Suspense fallback={<div className="max-w-md mx-auto p-6 mt-20">Loading...</div>}>
      <VerifyForm />
    </Suspense>
  )
}
