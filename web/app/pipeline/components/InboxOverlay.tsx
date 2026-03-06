'use client'

import { Press_Start_2P, VT323 } from 'next/font/google'
import { usePipelineStore } from '../store/pipeline-store'

const pixelFont = Press_Start_2P({ subsets: ['latin'], weight: '400' })
const bodyFont = VT323({ subsets: ['latin'], weight: '400' })

export default function InboxOverlay() {
  const inboxOpen = usePipelineStore((s) => s.inboxOpen)
  const pendingArticles = usePipelineStore((s) => s.pendingArticles)
  const activeLanes = usePipelineStore((s) => s.activeLanes)
  const laneAssignments = usePipelineStore((s) => s.laneAssignments)
  const closeInbox = usePipelineStore((s) => s.closeInbox)
  const assignArticleToLane = usePipelineStore((s) => s.assignArticleToLane)

  if (!inboxOpen) return null

  const allBusy = laneAssignments.length >= activeLanes
  const sorted = [...pendingArticles].sort(
    (a, b) => b.rawItem.score - a.rawItem.score,
  )

  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/60">
      <div className="w-full max-w-md border-2 border-[#6a5a3a] bg-[#2a2a3a] p-4">
        {/* Header */}
        <div className="mb-3 flex items-center justify-between">
          <span className={`text-[10px] text-[#ffcc66] ${pixelFont.className}`}>
            INBOX ({pendingArticles.length})
          </span>
          <button
            onClick={closeInbox}
            className={`text-[10px] text-[#ff8888] hover:text-[#ffaaaa] ${pixelFont.className}`}
          >
            [X]
          </button>
        </div>

        {/* All lanes busy warning */}
        {allBusy && (
          <div className={`mb-2 text-[8px] text-[#ff6666] ${pixelFont.className}`}>
            ALL LINES BUSY
          </div>
        )}

        {/* Scrollable list */}
        <div className={`max-h-64 overflow-y-auto ${bodyFont.className}`}>
          {sorted.length > 0 ? (
            sorted.map((article) => (
              <button
                key={article.id}
                onClick={() => {
                  assignArticleToLane(article.id)
                  closeInbox()
                }}
                disabled={allBusy}
                className="mb-1 flex w-full items-center gap-2 border border-[#444] bg-[#1a1a2e] px-3 py-2 text-left text-sm text-[#cccccc] hover:bg-[#2a2a4e] disabled:cursor-not-allowed disabled:opacity-40"
              >
                <span className="flex-1 truncate">
                  {article.titleZh || article.rawItem.title}
                </span>
                <span className="shrink-0 bg-[#5a4a2a] px-1.5 py-0.5 text-[10px] text-[#ffcc66]">
                  {article.rawItem.score}
                </span>
                <span className="shrink-0 text-[10px] text-[#888888]">
                  {article.rawItem.sourceName}
                </span>
              </button>
            ))
          ) : (
            <div
              className={`py-8 text-center text-[10px] text-[#666666] ${pixelFont.className}`}
            >
              NO PENDING NEWS
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
