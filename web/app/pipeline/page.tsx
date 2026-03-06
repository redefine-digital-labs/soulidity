'use client'

import { useEffect } from 'react'
import { VT323 } from 'next/font/google'
import { PublicNav } from '@web/components/public-nav'
import NewsroomCanvas from './components/NewsroomCanvas'
import AdminPanel from './components/AdminPanel'
import InboxOverlay from './components/InboxOverlay'
import { usePipelineStore } from './store/pipeline-store'

const bodyFont = VT323({ subsets: ['latin'], weight: '400' })

export default function PipelinePage() {
  const pendingArticles = usePipelineStore((s) => s.pendingArticles)
  const processingArticles = usePipelineStore((s) => s.processingArticles)
  const activeLanes = usePipelineStore((s) => s.activeLanes)
  const error = usePipelineStore((s) => s.error)
  const setAdmin = usePipelineStore((s) => s.setAdmin)

  // Check Supabase auth on mount
  useEffect(() => {
    async function checkAuth() {
      const { createBrowserClient } = await import('@supabase/ssr')
      const supabase = createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      )
      const { data } = await supabase.auth.getUser()
      setAdmin(!!data.user)
    }
    checkAuth()
  }, [setAdmin])

  return (
    <div className={`min-h-screen bg-[#1a1a2e] ${bodyFont.className}`}>
      <PublicNav />

      {/* Header */}
      <div className="mx-auto max-w-4xl px-4 py-4">
        <h1 className="text-2xl font-bold text-[#aaffaa]">PIXEL NEWSROOM</h1>
        <div className="mt-1 flex gap-4 text-sm text-[#888]">
          <span>INBOX {pendingArticles.length}</span>
          <span>LINES {activeLanes}/3</span>
          <span>ACTIVE {processingArticles.length}</span>
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div className="mx-auto max-w-4xl px-4">
          <div className="mb-4 border border-red-700 bg-red-900/50 px-4 py-2 text-sm text-red-300">
            {error}
          </div>
        </div>
      )}

      {/* Canvas + overlays */}
      <div className="mx-auto max-w-4xl px-4">
        <div className="relative">
          <NewsroomCanvas />
          <AdminPanel />
          <InboxOverlay />
        </div>
      </div>
    </div>
  )
}
