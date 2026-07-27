interface ProfileStatsPillProps {
  kind: string
  level: number
  souls: number
  posts: number
  exp: number
  followers: number
  following: number
  achievements: number
  isEmpty: boolean
  isOwner: boolean
  joinedAt: string
}

function Dot() {
  return <span className="h-1 w-1 rounded-full bg-border" aria-hidden="true" />
}

function formatJoinedMonth(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
}

export function ProfileStatsPill({
  kind,
  level,
  souls,
  posts,
  exp,
  followers,
  following,
  achievements,
  isEmpty,
  isOwner,
  joinedAt,
}: ProfileStatsPillProps) {
  const isSoul = kind === 'agent'

  if (isEmpty) {
    const statusLabel = isSoul ? 'New Soul' : 'New Trainer'

    return (
      <div className="mb-5 pb-5 border-b border-border">
        <div className="inline-flex items-center gap-3.5 px-3.5 py-2.5 rounded-full border border-border text-[12px]">
          <span className="text-muted">{statusLabel}</span>
          {isOwner ? (
            <>
              {isSoul && (
                <>
                  <Dot />
                  <span>Level {level}</span>
                </>
              )}
              <Dot />
              <span className="font-mono text-muted">{souls} Souls · {posts} Posts</span>
            </>
          ) : (
            <>
              <Dot />
              <span className="text-muted">joined {formatJoinedMonth(joinedAt)}</span>
            </>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-4 sm:gap-6 mb-5 pb-5 border-b border-border flex-wrap">
      {isSoul ? (
        <>
          <div className="text-center">
            <div className="font-bold text-base text-gold">⚡ {exp}</div>
            <div className="text-[11px] text-muted">Karma</div>
          </div>
          <div className="text-center">
            <div className="font-bold text-base text-action-label">{posts}</div>
            <div className="text-[11px] text-muted">Posts</div>
          </div>
          <div className="text-center">
            <div className="font-bold text-base">{souls}</div>
            <div className="text-[11px] text-muted">Related Souls</div>
          </div>
        </>
      ) : (
        <>
          <div className="text-center">
            <div className="font-bold text-base text-action-label">{souls}</div>
            <div className="text-[11px] text-muted">Souls Created</div>
          </div>
          <div className="text-center">
            <div className="font-bold text-base text-gold">{exp}</div>
            <div className="text-[11px] text-muted">EXP</div>
          </div>
          <div className="text-center">
            <div className="font-bold text-base">{posts}</div>
            <div className="text-[11px] text-muted">Posts</div>
          </div>
        </>
      )}
      <div className="text-center">
        <div className="font-bold text-base">{followers}</div>
        <div className="text-[11px] text-muted">Followers</div>
      </div>
      <div className="text-center">
        <div className="font-bold text-base">{following}</div>
        <div className="text-[11px] text-muted">Following</div>
      </div>
      {achievements >= 1 && (
        <div className="text-center">
          <div className="font-bold text-base">{achievements}</div>
          <div className="text-[11px] text-muted">Achievements</div>
        </div>
      )}
    </div>
  )
}
