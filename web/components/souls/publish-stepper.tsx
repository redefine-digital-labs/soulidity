'use client'

import { Fragment } from 'react'

interface StepDefinition {
  id: 1 | 2 | 3
  label: string
  labelMobile: string
}

const STEPS: StepDefinition[] = [
  { id: 1, label: 'Identity', labelMobile: 'Info' },
  { id: 2, label: 'Content', labelMobile: 'Files' },
  { id: 3, label: 'Review', labelMobile: 'Publish' },
]

function CheckIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
      aria-hidden="true"
      style={{ display: 'inline', marginRight: '4px', flexShrink: 0 }}
    >
      <path
        d="M2 6L5 9L10 3"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

interface PublishStepperProps {
  currentStep: 1 | 2 | 3
  completedSteps: Set<number>
}

export function PublishStepper({ currentStep, completedSteps }: PublishStepperProps) {
  return (
    <nav className="flex items-center gap-2 sm:gap-3 mb-8" aria-label="Publish steps">
      {STEPS.map((step, i) => {
        const isActive = currentStep === step.id
        const isCompleted = completedSteps.has(step.id)

        let color: string
        if (isCompleted) {
          color = 'var(--accent-emerald)'
        } else if (isActive) {
          color = 'var(--text-primary)'
        } else {
          color = 'var(--text-muted)'
        }

        return (
          <Fragment key={step.id}>
            {i > 0 && (
              <span
                className="text-xs select-none"
                style={{ color: 'var(--border-subtle)' }}
                aria-hidden="true"
              >
                —
              </span>
            )}
            <span
              className="text-sm flex items-center"
              style={{
                color,
                fontWeight: isActive ? 500 : 400,
                borderBottom: isActive ? '2px solid var(--accent-cyan)' : '2px solid transparent',
                paddingBottom: '2px',
                transition: 'color 0.15s, border-color 0.15s',
              }}
              aria-current={isActive ? 'step' : undefined}
            >
              {isCompleted && <CheckIcon />}
              <span className="hidden sm:inline">{step.label}</span>
              <span className="sm:hidden">{step.labelMobile}</span>
            </span>
          </Fragment>
        )
      })}
    </nav>
  )
}
