'use client'

import { Press_Start_2P } from 'next/font/google'
import { usePipelineStore } from '../store/pipeline-store'

const pixelFont = Press_Start_2P({ subsets: ['latin'], weight: '400' })

export default function AdminPanel() {
  const isAdmin = usePipelineStore((s) => s.isAdmin)
  const activeLanes = usePipelineStore((s) => s.activeLanes)
  const laneAssignments = usePipelineStore((s) => s.laneAssignments)
  const processingArticles = usePipelineStore((s) => s.processingArticles)
  const openInbox = usePipelineStore((s) => s.openInbox)
  const openLane = usePipelineStore((s) => s.openLane)
  const closeLane = usePipelineStore((s) => s.closeLane)

  if (!isAdmin) return null

  const lastLaneIndex = activeLanes - 1
  const lastLaneBusy = laneAssignments.some((la) => la.laneIndex === lastLaneIndex)

  return (
    <div className={`pointer-events-none absolute inset-0 z-10 ${pixelFont.className}`}>
      {/* Top-right controls */}
      <div className="pointer-events-auto absolute right-3 top-3 flex flex-col gap-2">
        <button
          onClick={openInbox}
          className="border border-[#88ff88] bg-[#3a5a3a] px-3 py-1.5 text-[10px] text-[#88ff88] hover:bg-[#4a6a4a] active:bg-[#2a4a2a]"
        >
          OPEN INBOX
        </button>

        {activeLanes < 3 && (
          <button
            onClick={openLane}
            className="border border-[#8888ff] bg-[#3a3a5a] px-3 py-1.5 text-[10px] text-[#8888ff] hover:bg-[#4a4a6a] active:bg-[#2a2a4a]"
          >
            + NEW LINE
          </button>
        )}

        {activeLanes > 1 && (
          <button
            onClick={() => closeLane(lastLaneIndex)}
            disabled={lastLaneBusy}
            className="border border-[#ff8888] bg-[#5a3a3a] px-3 py-1.5 text-[10px] text-[#ff8888] hover:bg-[#6a4a4a] active:bg-[#4a2a2a] disabled:cursor-not-allowed disabled:opacity-40"
          >
            - CLOSE LINE
          </button>
        )}
      </div>

      {/* Bottom status bar */}
      <div className="pointer-events-auto absolute bottom-0 left-0 right-0 flex justify-center">
        <div className="bg-black/50 px-4 py-1 text-[8px] text-[#aaffaa]">
          ADMIN MODE | LINES {activeLanes}/3 | ACTIVE {processingArticles.length}
        </div>
      </div>
    </div>
  )
}
