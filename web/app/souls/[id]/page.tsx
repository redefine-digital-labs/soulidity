'use client'

import { useMemo, useState } from 'react'
import { useParams } from 'next/navigation'
import { PublicNav } from '@web/components/public-nav'
import { PurchaseButton } from '@web/components/souls/purchase-button'
import { useAuth } from '@web/components/auth-provider'
import { useSoulDetail } from '@web/lib/souls/queries'
import { buildRevokeAgentGrantTx, buildSetAgentGrantTx } from '@web/lib/souls/tx-builder'
import { mirrorRouteRequest, formatMirrorSyncError } from '@web/lib/souls/mirror-sync'
import { usePrivySuiSign } from '@web/lib/souls/use-privy-sui'
import { formatAtomicSuiForDisplay } from '@web/lib/souls/price-format'

function extractCreatedAccessCapObjectId(result: { objectChanges?: Array<Record<string, unknown>> | null }) {
  return result.objectChanges?.find((change) => (
    change?.type === 'created'
    && typeof change.objectId === 'string'
    && typeof change.objectType === 'string'
    && change.objectType.includes('::grant::SoulAccessCap')
  ))?.objectId ?? null
}

export default function SoulDetailPage() {
  const params = useParams()
  const soulId = params.id as string
  const { user, getAuthHeaders } = useAuth()
  const { signAndExecute } = usePrivySuiSign()
  const { data: soul, isLoading, error, refetch } = useSoulDetail(soulId, getAuthHeaders)

  const [agentAddress, setAgentAddress] = useState('')
  const [grantSubmitting, setGrantSubmitting] = useState(false)
  const [grantError, setGrantError] = useState<string | null>(null)

  const previewImage = useMemo(() => soul?.previewImages[0] ?? soul?.imageUrl ?? null, [soul])

  async function handleSetGrant() {
    if (!soul) return
    setGrantSubmitting(true)
    setGrantError(null)
    try {
      const tx = buildSetAgentGrantTx({
        soulObjectId: soul.onChainId,
        agentAddress,
      })
      const result = await signAndExecute(tx)
      const soulAccessCapOnChainId = extractCreatedAccessCapObjectId(result as { objectChanges?: Array<Record<string, unknown>> | null })
      if (!soulAccessCapOnChainId) {
        throw new Error('Transaction succeeded but no Soul access cap was created')
      }

      const headers = await getAuthHeaders()
      await mirrorRouteRequest({
        input: `/api/souls/${encodeURIComponent(soul.onChainId)}/grant`,
        init: {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...headers,
          },
          body: JSON.stringify({
            agentAddress,
            soulAccessCapOnChainId,
            txDigest: result.digest,
          }),
        },
      })

      setAgentAddress('')
      await refetch()
    } catch (grantSyncError) {
      setGrantError(formatMirrorSyncError(grantSyncError))
    } finally {
      setGrantSubmitting(false)
    }
  }

  async function handleRevokeGrant() {
    if (!soul) return
    setGrantSubmitting(true)
    setGrantError(null)
    try {
      const tx = buildRevokeAgentGrantTx({ soulObjectId: soul.onChainId })
      const result = await signAndExecute(tx)
      const headers = await getAuthHeaders()
      await mirrorRouteRequest({
        input: `/api/souls/${encodeURIComponent(soul.onChainId)}/grant`,
        init: {
          method: 'DELETE',
          headers: {
            'Content-Type': 'application/json',
            ...headers,
          },
          body: JSON.stringify({ txDigest: result.digest }),
        },
      })
      await refetch()
    } catch (grantSyncError) {
      setGrantError(formatMirrorSyncError(grantSyncError))
    } finally {
      setGrantSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen">
      <PublicNav />
      <main className="max-w-5xl mx-auto px-6 py-10">
        {isLoading ? (
          <div style={{ color: 'var(--text-muted)' }}>Loading…</div>
        ) : error || !soul ? (
          <div style={{ color: 'var(--accent-rose)' }}>Failed to load Soul.</div>
        ) : (
          <div className="grid gap-8 lg:grid-cols-[1.1fr_0.9fr]">
            <div className="flex flex-col gap-6">
              {previewImage ? (
                <div
                  className="glass-card aspect-[4/3] bg-cover bg-center"
                  style={{ backgroundImage: `url("${previewImage}")` }}
                />
              ) : null}
              <div className="glass-panel p-6 flex flex-col gap-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-xs uppercase tracking-[0.16em]" style={{ color: 'var(--text-muted)' }}>
                      {soul.category}
                    </p>
                    <h1 className="text-3xl font-bold" style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-display)' }}>
                      {soul.name}
                    </h1>
                  </div>
                  <div className="text-right">
                    <p className="text-xs uppercase tracking-[0.12em]" style={{ color: 'var(--text-muted)' }}>
                      Status
                    </p>
                    <p style={{ color: soul.listingStatus === 'listed' ? 'var(--accent-cyan)' : 'var(--accent-emerald)' }}>
                      {soul.listingStatus === 'listed' ? 'Listed' : 'Held'}
                    </p>
                  </div>
                </div>
                <p style={{ color: 'var(--text-secondary)' }}>{soul.description}</p>
                <div className="flex flex-wrap gap-2">
                  {soul.tags.map((tag) => (
                    <span
                      key={tag}
                      className="px-2 py-1 rounded-full text-xs"
                      style={{ background: 'var(--bg-elevated)', color: 'var(--text-muted)' }}
                    >
                      {tag}
                    </span>
                  ))}
                </div>
                {soul.readme ? (
                  <pre className="whitespace-pre-wrap text-sm" style={{ color: 'var(--text-secondary)' }}>
                    {soul.readme}
                  </pre>
                ) : null}
              </div>
            </div>

            <aside className="flex flex-col gap-6">
              <div className="glass-panel p-6 flex flex-col gap-4">
                <div>
                  <p className="text-xs uppercase tracking-[0.12em]" style={{ color: 'var(--text-muted)' }}>
                    Price
                  </p>
                  <p className="text-2xl font-semibold" style={{ color: 'var(--accent-cyan)' }}>
                    {soul.listedPriceSui ? formatAtomicSuiForDisplay(soul.listedPriceSui) : 'Not for sale'}
                  </p>
                </div>

                {soul.listingStatus === 'listed' && !soul.isOwner && soul.sellerKioskId && soul.listedPriceSui && soul.purchaseFeeAmountSui ? (
                  <PurchaseButton
                    soulObjectId={soul.onChainId}
                    sellerKioskId={soul.sellerKioskId}
                    listedPriceSui={soul.listedPriceSui}
                    feeAmountSui={soul.purchaseFeeAmountSui}
                    onPurchased={async () => { await refetch() }}
                  />
                ) : soul.isOwner ? (
                  <p style={{ color: 'var(--text-muted)' }}>You currently own this Soul.</p>
                ) : (
                  <p style={{ color: 'var(--text-muted)' }}>This Soul is not currently purchasable.</p>
                )}
              </div>

              {soul.isOwner && soul.listingStatus === 'held' ? (
                <div className="glass-panel p-6 flex flex-col gap-4">
                  <div>
                    <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
                      Agent access
                    </h2>
                    <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                      Grant a single agent wallet direct Seal access to this Soul.
                    </p>
                  </div>

                  {soul.agentGrantAddress ? (
                    <div className="flex flex-col gap-3">
                      <div>
                        <p className="text-xs uppercase tracking-[0.12em]" style={{ color: 'var(--text-muted)' }}>
                          Current agent
                        </p>
                        <p className="break-all text-sm" style={{ color: 'var(--text-secondary)' }}>
                          {soul.agentGrantAddress}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={handleRevokeGrant}
                        disabled={grantSubmitting}
                        className="px-4 py-3 rounded-xl font-semibold"
                        style={{ background: 'var(--accent-rose)', color: 'white', opacity: grantSubmitting ? 0.7 : 1 }}
                      >
                        {grantSubmitting ? 'Revoking…' : 'Revoke access'}
                      </button>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-3">
                      <input
                        value={agentAddress}
                        onChange={(event) => setAgentAddress(event.target.value)}
                        placeholder="0x... agent wallet"
                        className="glass-panel px-3 py-3 bg-transparent outline-none"
                        style={{ color: 'var(--text-primary)' }}
                      />
                      <button
                        type="button"
                        onClick={handleSetGrant}
                        disabled={grantSubmitting || agentAddress.trim().length === 0}
                        className="px-4 py-3 rounded-xl font-semibold"
                        style={{ background: 'var(--accent-cyan)', color: '#02131a', opacity: grantSubmitting ? 0.7 : 1 }}
                      >
                        {grantSubmitting ? 'Granting…' : 'Grant access'}
                      </button>
                    </div>
                  )}

                  {grantError ? (
                    <p className="text-sm" style={{ color: 'var(--accent-rose)' }}>{grantError}</p>
                  ) : null}
                </div>
              ) : null}
            </aside>
          </div>
        )}
      </main>
    </div>
  )
}
