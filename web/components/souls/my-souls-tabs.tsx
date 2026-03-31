'use client'

type Tab = {
  id: string
  label: string
  count: number
}

type MySoulsTabsProps = {
  tabs: Tab[]
  activeTab: string
  onTabChange: (id: string) => void
}

export function MySoulsTabs({ tabs, activeTab, onTabChange }: MySoulsTabsProps) {
  return (
    <div
      className="flex gap-1"
      role="tablist"
      style={{ borderBottom: '1px solid var(--border-subtle)' }}
    >
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          onClick={() => onTabChange(tab.id)}
          className="px-4 py-3 text-sm font-medium transition-colors relative"
          style={{ color: activeTab === tab.id ? 'var(--accent-cyan)' : 'var(--text-muted)' }}
          role="tab"
          aria-selected={activeTab === tab.id}
        >
          {tab.label}
          {tab.count > 0 && (
            <span className="ml-1.5 text-xs" style={{ color: 'var(--text-muted)' }}>
              ({tab.count})
            </span>
          )}
          {activeTab === tab.id && (
            <span
              className="absolute bottom-0 left-0 right-0 h-0.5"
              style={{ background: 'var(--accent-cyan)' }}
            />
          )}
        </button>
      ))}
    </div>
  )
}
