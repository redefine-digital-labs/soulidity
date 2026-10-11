'use client'

import { cn } from '@/lib/utils/cn'

interface StripTab {
  id: string
  label: string
}

interface TabStripProps {
  tabs: StripTab[]
  activeId: string
  onChange: (id: string) => void
  className?: string
}

export function TabStrip({ tabs, activeId, onChange, className }: TabStripProps) {
  return (
    <div className={cn('flex border-b border-border', className)}>
      {tabs.map((tab) => {
        const isActive = tab.id === activeId
        return (
          <button
            key={tab.id}
            onClick={() => onChange(tab.id)}
            className={cn(
              'px-5 py-3 text-sm font-semibold cursor-pointer border-b-2 -mb-px transition-all duration-150 select-none',
              isActive
                ? 'text-purple border-purple'
                : 'text-muted border-transparent hover:text-foreground',
            )}
          >
            {tab.label}
          </button>
        )
      })}
    </div>
  )
}
