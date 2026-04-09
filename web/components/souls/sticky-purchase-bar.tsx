'use client'

interface StickyPurchaseBarProps {
  price: string
  onPurchase: () => void
  purchasing: boolean
  disabled: boolean
}

export function StickyPurchaseBar({ price, onPurchase, purchasing, disabled }: StickyPurchaseBarProps) {
  return (
    <div
      className="fixed bottom-0 left-0 right-0 z-40 md:hidden p-4 flex items-center justify-between"
      style={{
        background: 'rgba(255, 255, 255, 0.95)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        borderTop: '1px solid var(--border-subtle)',
      }}
    >
      <p
        className="data-value text-lg font-semibold"
        style={{ color: 'var(--accent-cyan)' }}
      >
        {price}
      </p>
      <button
        type="button"
        onClick={onPurchase}
        disabled={disabled || purchasing}
        className="btn btn-primary px-5 py-2.5"
      >
        {purchasing ? 'Purchasing…' : 'Purchase'}
      </button>
    </div>
  )
}
