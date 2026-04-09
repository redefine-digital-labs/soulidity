export default function Loading() {
  return (
    <div className="min-h-[calc(100vh-56px)] flex items-center justify-center">
      <div className="flex flex-col items-center gap-3">
        <svg
          className="w-8 h-8 text-purple animate-spin"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <circle cx="12" cy="12" r="10" strokeOpacity="0.2" />
          <path d="M12 2a10 10 0 0 1 10 10" strokeLinecap="round" />
        </svg>
        <span className="text-muted text-sm">Loading…</span>
      </div>
    </div>
  )
}
