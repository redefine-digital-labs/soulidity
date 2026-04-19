import Link from 'next/link'
import { SealMark } from './seal-mark'
import { buttonStyles } from './ui/button'

interface EmptySoulsStateProps {
  isOwner: boolean
  displayName: string
}

export function EmptySoulsState({ isOwner, displayName }: EmptySoulsStateProps) {
  if (!isOwner) {
    return (
      <div className="pb-12">
        <p className="text-[13px] text-muted py-10 text-center">
          No Souls yet. {displayName} is just getting started.
        </p>
      </div>
    )
  }

  return (
    <div className="pb-12">
      <div className="flex flex-col items-center gap-3.5 rounded-[14px] border border-dashed border-border px-6 py-12 text-center">
        <SealMark size={48} variant="gradient" />
        <div>
          <div className="text-[15px] font-bold text-foreground mb-1.5">
            Your first Soul starts here
          </div>
          <p className="text-[13px] text-muted mx-auto max-w-[360px] leading-relaxed">
            Mint a new digital entity, or import one you&apos;ve built elsewhere. Once you do, it&apos;ll live on this page.
          </p>
        </div>
        <div className="flex gap-2.5 flex-wrap justify-center">
          <Link href="/create" className={buttonStyles({ variant: 'primary', size: 'default' })}>
            + Mint a Soul
          </Link>
          <Link href="/import" className={buttonStyles({ variant: 'outline', size: 'default' })}>
            Import existing
          </Link>
        </div>
      </div>
    </div>
  )
}
