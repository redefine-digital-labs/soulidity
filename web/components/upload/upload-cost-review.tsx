'use client'

import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { Button } from '@/components/ui/button'
import { Modal } from '@/components/ui/modal'
import type { WalrusUploadQuote } from '@soulidity/sdk'

interface UploadCostReviewContextValue {
  requestUploadCostApproval: (quote: WalrusUploadQuote) => Promise<boolean>
}

const UploadCostReviewContext = createContext<UploadCostReviewContextValue | null>(null)

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KiB', 'MiB', 'GiB']
  let value = bytes / 1024
  for (const unit of units) {
    if (value < 1024 || unit === units[units.length - 1]) {
      return `${value.toFixed(value >= 10 ? 1 : 2)} ${unit}`
    }
    value /= 1024
  }
  return `${bytes} B`
}

function formatMist(mist: bigint) {
  if (mist === 0n) return '0'
  const sui = Number(mist) / 1_000_000_000
  if (Number.isFinite(sui) && sui >= 0.000001) {
    return `${sui.toFixed(sui >= 1 ? 4 : 6)} SUI`
  }
  return `${mist.toString()} MIST`
}

export function formatWal(value: bigint) {
  const decimals = 9
  const base = 10n ** BigInt(decimals)
  const whole = value / base
  const fraction = value % base
  if (fraction === 0n) return `${whole.toString()} WAL`
  const fractionText = fraction.toString().padStart(decimals, '0').replace(/0+$/, '')
  return `${whole.toString()}.${fractionText} WAL`
}

export function UploadCostReviewProvider({ children }: { children: ReactNode }) {
  const [quote, setQuote] = useState<WalrusUploadQuote | null>(null)
  const resolverRef = useRef<((approved: boolean) => void) | null>(null)

  const settle = useCallback((approved: boolean) => {
    resolverRef.current?.(approved)
    resolverRef.current = null
    setQuote(null)
  }, [])

  const requestUploadCostApproval = useCallback((nextQuote: WalrusUploadQuote) => {
    if (resolverRef.current) {
      resolverRef.current(false)
    }
    setQuote(nextQuote)
    return new Promise<boolean>((resolve) => {
      resolverRef.current = resolve
    })
  }, [])

  return (
    <UploadCostReviewContext.Provider value={{ requestUploadCostApproval }}>
      {children}
      <Modal
        open={Boolean(quote)}
        onClose={() => settle(false)}
        maxWidth="lg"
        title="Review Upload Cost"
        subtitle="Walrus storage is paid by your connected wallet before the app signs the Soul transaction."
      >
        {quote ? (
          <div className="space-y-5">
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="rounded-lg border border-border/60 bg-black/20 px-3 py-2">
                <div className="text-[10px] font-bold uppercase tracking-[0.08em] text-muted">Network</div>
                <div className="mt-1 text-sm font-semibold text-foreground">{quote.network}</div>
              </div>
              <div className="rounded-lg border border-border/60 bg-black/20 px-3 py-2">
                <div className="text-[10px] font-bold uppercase tracking-[0.08em] text-muted">Payload</div>
                <div className="mt-1 text-sm font-semibold text-foreground">
                  {quote.fileCount} file · {formatBytes(quote.totalBytes)}
                </div>
              </div>
              <div className="rounded-lg border border-border/60 bg-black/20 px-3 py-2">
                <div className="text-[10px] font-bold uppercase tracking-[0.08em] text-muted">Storage</div>
                <div className="mt-1 text-sm font-semibold text-foreground">{quote.storageEpochs} epochs</div>
              </div>
              <div className="rounded-lg border border-border/60 bg-black/20 px-3 py-2">
                <div className="text-[10px] font-bold uppercase tracking-[0.08em] text-muted">
                  {quote.walletSignatureCount != null ? 'Wallet signatures' : 'Transactions'}
                </div>
                <div className="mt-1 text-sm font-semibold text-foreground">
                  {quote.walletSignatureCount ?? quote.transactionCount}
                </div>
              </div>
            </div>

            <div className="divide-y divide-border/50 rounded-lg border border-border/60">
              <div className="flex items-center justify-between px-3 py-2 text-sm">
                <span className="text-muted">WAL storage</span>
                <span className="font-mono text-foreground">{formatWal(quote.walStorageCost + quote.walWriteCost)}</span>
              </div>
              <div className="flex items-center justify-between px-3 py-2 text-sm">
                <span className="text-muted">Relay tip</span>
                <span className="font-mono text-foreground">{formatMist(quote.relayTipMist)}</span>
              </div>
              <div className="flex items-center justify-between px-3 py-2 text-sm">
                <span className="text-muted">Gas budget estimate</span>
                <span className="font-mono text-foreground">{formatMist(quote.gasBudgetMist)}</span>
              </div>
            </div>

            <div className="max-h-40 overflow-auto rounded-lg border border-border/60">
              {quote.items.map((item) => (
                <div key={item.label} className="flex items-center justify-between gap-3 border-b border-border/40 px-3 py-2 text-xs last:border-b-0">
                  <span className="min-w-0 truncate text-muted">{item.label}</span>
                  <span className="shrink-0 font-mono text-foreground">{formatBytes(item.payloadBytes)}</span>
                </div>
              ))}
            </div>

            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => settle(false)}>
                Cancel
              </Button>
              <Button type="button" variant="gold" onClick={() => settle(true)}>
                Confirm
              </Button>
            </div>
          </div>
        ) : null}
      </Modal>
    </UploadCostReviewContext.Provider>
  )
}

export function useUploadCostReview() {
  const context = useContext(UploadCostReviewContext)
  if (!context) {
    throw new Error('useUploadCostReview must be used within UploadCostReviewProvider')
  }
  return context
}
