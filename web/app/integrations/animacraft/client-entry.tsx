'use client'

import { useMemo } from 'react'
import { useSearchParams } from 'next/navigation'
import { AnimacraftIntegrationClient } from './integration-client'

export function handoffFromSearch(search: Pick<URLSearchParams, 'getAll'>) {
  const single = (key: string) => { const values = search.getAll(key); return values.length === 1 ? values[0] : '' }
  return { source: single('source'), root: single('root'), owner: single('owner'),
    returnOrigin: single('returnOrigin'), returnNonce: single('returnNonce') }
}

export function AnimacraftIntegrationEntry() {
  const search = useSearchParams()
  const handoff = useMemo(() => handoffFromSearch(search), [search])
  return <AnimacraftIntegrationClient handoff={handoff} />
}
