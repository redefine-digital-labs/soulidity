type SkeletonCardProps = {
  variant?: 'standard' | 'tall' | 'compact'
}

export function SkeletonCard({ variant = 'standard' }: SkeletonCardProps) {
  if (variant === 'compact') {
    return (
      <div className="glass-panel p-3 flex items-center gap-3">
        <div className="skeleton w-[80px] h-[80px] shrink-0" />
        <div className="flex-1 flex flex-col gap-2">
          <div className="skeleton h-4 w-3/4" />
          <div className="skeleton h-3 w-1/2" />
        </div>
      </div>
    )
  }

  const aspectClass = variant === 'tall' ? 'aspect-[3/4]' : 'aspect-[4/3]'

  return (
    <div className="glass-panel overflow-hidden">
      <div className={`skeleton ${aspectClass} w-full`} />
      <div className="p-4 flex flex-col gap-3">
        <div className="skeleton h-5 w-3/4" />
        <div className="skeleton h-3 w-1/2" />
        <div className="skeleton h-3 w-full" />
      </div>
    </div>
  )
}
