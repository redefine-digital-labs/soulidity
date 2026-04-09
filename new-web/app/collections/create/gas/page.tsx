'use client'

import { useRouter } from 'next/navigation'
import { useEffect } from 'react'

// Gas is handled inline on the preview page — redirect any stale bookmarks
export default function PayGasPage() {
  const router = useRouter()
  useEffect(() => { router.replace('/collections/create/preview') }, [router])
  return null
}
