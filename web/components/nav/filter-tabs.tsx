'use client'

import { cn } from '@/lib/utils/cn'

interface FilterTab {
  id: string
  label: React.ReactNode
}

interface FilterTabsProps {
  tabs: FilterTab[]
  activeId: string
  onChange: (id: string) => void
  className?: string
}

export function FilterTabs({ tabs, activeId, onChange, className }: FilterTabsProps) {
  return (
    <div className={cn('hide-scrollbar flex items-center gap-2 overflow-x-auto pb-1', className)}>
      {tabs.map((tab) => {
        const isActive = tab.id === activeId
        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => {
              if (!isActive) {
                onChange(tab.id)
              }
            }}
            className={cn(
              'inline-flex items-center rounded-[20px] border px-3.5 py-1.5 text-xs font-semibold cursor-pointer select-none transition-colors duration-150',
              isActive
                ? 'border-[var(--ui-action)] bg-[var(--ui-action)] text-[var(--ui-action-text)]'
                : 'border-border bg-transparent text-muted hover:border-purple hover:text-action-label',
            )}
          >
            {tab.label}
          </button>
        )
      })}
    </div>
  )
}
