'use client'

import React from 'react'

export function TxRow({
  label,
  children,
  align = 'center',
}: {
  label: string
  children: React.ReactNode
  align?: 'center' | 'top'
}) {
  return (
    <div className={`flex justify-between gap-4 py-3 text-[13px] ${align === 'top' ? 'items-start' : 'items-center'}`}>
      <span className="text-muted shrink-0">{label}</span>
      <span className="text-right">{children}</span>
    </div>
  )
}
