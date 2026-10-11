import { cn } from '@/lib/utils/cn'

interface FlowStep {
  label: string
}

interface FlowBarProps {
  steps: FlowStep[]
  currentStep: number
  className?: string
}

export function FlowBar({ steps, currentStep, className }: FlowBarProps) {
  return (
    <div
      className={cn(
        'border-b border-border bg-card2',
        className,
      )}
    >
      <div className="hide-scrollbar mx-auto flex max-w-[1100px] items-center overflow-x-auto px-4 py-3 sm:px-6 lg:px-8">
        <div className="flex min-w-max items-center gap-0">
          {steps.map((step, i) => {
            const isDone = i < currentStep
            const isActive = i === currentStep
            const isPending = i > currentStep
            const isLast = i === steps.length - 1

            return (
              <div key={i} className="flex items-center gap-0">
                <div className="flex items-center gap-2.5">
                  <div
                    className={cn(
                      'flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold',
                      isDone && 'bg-success text-[var(--ui-tech-action-text)]',
                      isActive && 'bg-[var(--ui-action)] text-[var(--ui-action-text)]',
                      isPending && 'bg-border text-muted',
                    )}
                  >
                    {isDone ? '✓' : i + 1}
                  </div>
                  <span
                    className={cn(
                      'whitespace-nowrap text-xs tracking-[0.01em]',
                      isDone && 'text-success',
                      isActive && 'font-semibold text-foreground',
                      isPending && 'text-muted',
                    )}
                  >
                    {step.label}
                  </span>
                </div>
                {!isLast && (
                  <span className="mx-3 text-border text-[11px] select-none">›</span>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
