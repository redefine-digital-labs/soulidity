'use client'

import { useEffect, useRef } from 'react'
import Link from 'next/link'
import { FlowBar } from '@/components/nav/flow-bar'
import { PageContainer } from '@/components/layout/page-container'
import { SectionHeader } from '@/components/layout/section-header'
import { buttonStyles } from '@/components/ui/button'
import { usePublish, type PublishParams } from '@/lib/hooks/use-publish'
import { useAuth } from '@/components/providers/auth-provider'
import { usePrivySuiSign } from '@/lib/hooks/use-privy-sui'
import { buildListSoulTx } from '@/lib/soulidity/tx/list'
import { buildIssueGrantTx, buildRevokeGrantTx } from '@/lib/soulidity/tx/grant'

const steps = [
  { label: 'Basic Info' },
  { label: 'Living Content' },
  { label: 'Soul Awakened' },
  { label: 'Pay Gas' },
  { label: 'On-chain' },
]

export default function CreateGasPage() {
  const { status, error, txDigest, publish, suiWallet } = usePublish()
  const { getAuthHeaders } = useAuth()
  const { signAndExecute } = usePrivySuiSign()
  const publishRef = useRef(publish)
  const getAuthHeadersRef = useRef(getAuthHeaders)
  const signAndExecuteRef = useRef(signAndExecute)
  publishRef.current = publish
  getAuthHeadersRef.current = getAuthHeaders
  signAndExecuteRef.current = signAndExecute

  // Expose publish + authenticated upload + list for E2E testing
  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any
    w.__e2ePublish = (params: PublishParams) => publishRef.current(params)
    w.__e2eUpload = async (fileContent: string, fileName: string, type: 'public' | 'encrypted' = 'encrypted') => {
      const headers = await getAuthHeadersRef.current()
      const blob = new Blob([fileContent], { type: 'text/markdown' })
      const file = new File([blob], fileName, { type: 'text/markdown' })
      const formData = new FormData()
      formData.append('file', file)
      formData.append('type', type)
      const res = await fetch('/api/souls/upload', { method: 'POST', headers, body: formData })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || `Upload failed: ${res.status}`)
      }
      return res.json()
    }
    w.__e2eListSoul = async (params: {
      currentKioskId: string; currentKioskCapOnChainId: string;
      stateObjectId: string; soulObjectId: string; priceAtomic: string;
    }) => {
      const tx = buildListSoulTx({
        ...params,
        priceAtomic: BigInt(params.priceAtomic),
      })
      const result = await signAndExecuteRef.current(tx)
      const headers = await getAuthHeadersRef.current()
      const syncRes = await fetch(`/api/souls/${params.soulObjectId}/list`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ txDigest: result.digest }),
      })
      if (!syncRes.ok) {
        const err = await syncRes.json().catch(() => ({}))
        throw new Error(err.error || `List sync failed: ${syncRes.status}`)
      }
      return { digest: result.digest, ...(await syncRes.json()) }
    }
    w.__e2eGetAuthHeaders = () => getAuthHeadersRef.current()
    w.__e2eIssueGrant = async (params: { stateObjectId: string; granteeAddress: string; scopeMask: number; soulObjectId: string }) => {
      const tx = buildIssueGrantTx({ stateObjectId: params.stateObjectId, granteeAddress: params.granteeAddress, scopeMask: params.scopeMask })
      const result = await signAndExecuteRef.current(tx)
      const headers = await getAuthHeadersRef.current()
      const syncRes = await fetch(`/api/souls/${params.soulObjectId}/grant`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ txDigest: result.digest }),
      })
      if (!syncRes.ok) {
        const err = await syncRes.json().catch(() => ({}))
        throw new Error(err.error || `Grant sync failed: ${syncRes.status}`)
      }
      return { digest: result.digest, ...(await syncRes.json()) }
    }
    w.__e2eRevokeGrant = async (params: { stateObjectId: string; granteeAddress: string; soulObjectId: string }) => {
      const tx = buildRevokeGrantTx({ stateObjectId: params.stateObjectId, granteeAddress: params.granteeAddress })
      const result = await signAndExecuteRef.current(tx)
      const headers = await getAuthHeadersRef.current()
      const syncRes = await fetch(`/api/souls/${params.soulObjectId}/grant`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ txDigest: result.digest, action: 'revoke', granteeAddress: params.granteeAddress }),
      })
      if (!syncRes.ok) {
        const err = await syncRes.json().catch(() => ({}))
        return { digest: result.digest, synced: false, error: err.error }
      }
      return { digest: result.digest, synced: true, ...(await syncRes.json()) }
    }
    return () => {
      delete w.__e2ePublish; delete w.__e2eUpload; delete w.__e2eListSoul
      delete w.__e2eGetAuthHeaders; delete w.__e2eIssueGrant; delete w.__e2eRevokeGrant
    }
  }, [])

  return (
    <div className="relative z-10">
      <FlowBar steps={steps} currentStep={3} />

      <PageContainer size="sm" className="space-y-6">
        <SectionHeader
          label="Create Soul"
          title="Step 4 — Pay Gas"
          subtitle="Review your Soul details and pay the Sui gas fee to mint on-chain."
        />

        {/* Wallet status */}
        <div className="card px-5 py-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted">Connected wallet</span>
            <span className="text-sm font-mono text-foreground">
              {suiWallet ? `${suiWallet.address.slice(0, 8)}...${suiWallet.address.slice(-6)}` : 'Not connected'}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted">Network</span>
            <span className="text-sm text-foreground">{process.env.NEXT_PUBLIC_SUI_NETWORK ?? 'testnet'}</span>
          </div>
        </div>

        {/* Publish status */}
        <div className="card px-5 py-4 space-y-3" data-testid="publish-status">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted">Status</span>
            <span className={`text-sm font-semibold ${
              status === 'done' ? 'text-success' :
              status === 'error' ? 'text-danger' :
              status === 'idle' ? 'text-muted' : 'text-purple'
            }`}>
              {status === 'idle' && 'Ready to publish'}
              {status === 'building' && '⟳ Building TX…'}
              {status === 'signing' && '⟳ Signing…'}
              {status === 'syncing' && '⟳ Syncing…'}
              {status === 'done' && '✓ Published'}
              {status === 'error' && '✗ Failed'}
            </span>
          </div>
          {txDigest && (
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted">TX Digest</span>
              <span className="text-sm font-mono text-foreground">{txDigest.slice(0, 16)}…</span>
            </div>
          )}
          {error && (
            <div className="text-sm text-danger bg-danger/10 border border-danger/30 rounded-lg px-4 py-3">
              {error}
            </div>
          )}
        </div>

        {/* Info note */}
        <div className="rounded-[10px] border border-purple/30 bg-purple/10 px-4 py-4 text-sm leading-6 text-purple">
          ⛽ Gas is paid in SUI. The mint transaction creates a Soul object in your personal kiosk.
          Privy embedded wallet will auto-sign.
        </div>

        <div className="flex flex-col-reverse sm:flex-row gap-3">
          <Link href="/create/preview" className={buttonStyles({ variant: 'outline', size: 'lg', className: 'w-full sm:w-auto' })}>
            ← Back
          </Link>
          {status === 'done' ? (
            <Link href="/create/success" className={buttonStyles({ variant: 'primary', size: 'lg', full: true })}>
              Continue <span aria-hidden="true">→</span>
            </Link>
          ) : (
            <div className={buttonStyles({ variant: 'ghost', size: 'lg', full: true, className: 'text-center opacity-60 cursor-default' })}>
              {status === 'idle' ? 'Waiting for publish trigger…' : `${status}…`}
            </div>
          )}
        </div>
      </PageContainer>
    </div>
  )
}
