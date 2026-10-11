'use client'

import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react'
import { cn } from '@/lib/utils/cn'
import { useVisualTheme } from '@/components/providers/visual-theme-provider'
import {
  THEME_PREFERENCES,
  type ThemePreference,
} from '@/lib/theme/visual-theme'

const themeOption: Record<
  ThemePreference,
  { label: string; description: string; swatches: string[] }
> = {
  auto: {
    label: 'Automatic',
    description: 'Use the Soulidity default',
    swatches: ['var(--ui-action)', 'var(--ui-value)', 'var(--ui-tech)'],
  },
  animacraft: {
    label: 'Animacraft',
    description: 'Paper, mint, rose, and gold',
    swatches: ['#ed7090', '#2db7a3', '#f0a23a'],
  },
  soulidity: {
    label: 'Soulidity',
    description: 'Deep purple, gold, and teal',
    swatches: ['#a855f7', '#f59e0b', '#14b8a6'],
  },
}

function PaletteMark({ swatches }: { swatches: string[] }) {
  return (
    <span
      className="grid h-5 w-5 shrink-0 grid-cols-2 overflow-hidden rounded-full border border-[var(--ui-border-strong)] bg-[var(--ui-surface)]"
      aria-hidden="true"
    >
      <span className="row-span-2" style={{ background: swatches[0] }} />
      <span style={{ background: swatches[1] }} />
      <span style={{ background: swatches[2] }} />
    </span>
  )
}

export function ThemeSwitcher() {
  const { preference, setPreference } = useVisualTheme()
  const [open, setOpen] = useState(false)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([])
  const menuId = useId()
  const label = themeOption[preference].label

  function focusOption(index: number) {
    window.requestAnimationFrame(() => itemRefs.current[index]?.focus())
  }

  function closeMenu({ restoreFocus = false } = {}) {
    setOpen(false)
    if (restoreFocus) {
      window.requestAnimationFrame(() => triggerRef.current?.focus())
    }
  }

  function openMenu(index = THEME_PREFERENCES.indexOf(preference)) {
    setOpen(true)
    focusOption(Math.max(0, index))
  }

  useEffect(() => {
    if (!open) return

    function onPointerDown(event: PointerEvent) {
      if (!wrapperRef.current?.contains(event.target as Node)) {
        closeMenu()
      }
    }

    function onKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault()
        closeMenu({ restoreFocus: true })
      }
    }

    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  function handleTriggerKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>) {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      openMenu()
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      openMenu(THEME_PREFERENCES.length - 1)
    }
  }

  function handleItemKeyDown(
    event: ReactKeyboardEvent<HTMLButtonElement>,
    index: number,
  ) {
    let nextIndex: number | null = null
    if (event.key === 'ArrowDown') {
      nextIndex = (index + 1) % THEME_PREFERENCES.length
    } else if (event.key === 'ArrowUp') {
      nextIndex = (index - 1 + THEME_PREFERENCES.length) % THEME_PREFERENCES.length
    } else if (event.key === 'Home') {
      nextIndex = 0
    } else if (event.key === 'End') {
      nextIndex = THEME_PREFERENCES.length - 1
    } else if (event.key === 'Tab') {
      closeMenu()
      return
    }

    if (nextIndex !== null) {
      event.preventDefault()
      itemRefs.current[nextIndex]?.focus()
    }
  }

  return (
    <div ref={wrapperRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-label={`Visual theme: ${label}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--ui-border)] bg-[var(--ui-surface)] text-[var(--ui-text)] shadow-sm transition hover:-translate-y-px hover:border-[var(--ui-border-strong)]"
        onClick={() => {
          if (open) closeMenu()
          else openMenu()
        }}
        onKeyDown={handleTriggerKeyDown}
      >
        <PaletteMark swatches={themeOption[preference].swatches} />
      </button>

      {open && (
        <div
          id={menuId}
          role="menu"
          aria-label="Visual theme"
          className="fixed inset-x-3 top-[60px] z-[160] w-auto rounded-[var(--ui-radius-md)] border border-[var(--ui-border)] bg-[var(--ui-panel-translucent)] p-1.5 shadow-[var(--ui-shadow-sm)] backdrop-blur-xl md:absolute md:inset-x-auto md:right-0 md:top-full md:mt-2 md:w-[18rem]"
        >
          <div className="px-2.5 pb-1.5 pt-1 text-[10px] font-bold uppercase tracking-[0.1em] text-[var(--ui-muted)]">
            Visual theme
          </div>
          {THEME_PREFERENCES.map((option, index) => {
            const selected = preference === option
            const details = themeOption[option]
            return (
              <button
                key={option}
                ref={(node) => {
                  itemRefs.current[index] = node
                }}
                type="button"
                role="menuitemradio"
                aria-checked={selected}
                tabIndex={selected ? 0 : -1}
                className={cn(
                  'flex w-full items-center gap-3 rounded-[var(--ui-radius-sm)] border px-2.5 py-2 text-left transition',
                  selected
                    ? 'border-[var(--ui-border-strong)] bg-[var(--ui-surface-selected)] text-[var(--ui-text)]'
                    : 'border-transparent text-[var(--ui-text)] hover:bg-[var(--ui-surface-muted)]',
                )}
                onClick={() => {
                  setPreference(option)
                  closeMenu({ restoreFocus: true })
                }}
                onKeyDown={(event) => handleItemKeyDown(event, index)}
              >
                <PaletteMark swatches={details.swatches} />
                <span className="min-w-0 flex-1">
                  <span className="block text-xs font-bold">{details.label}</span>
                  <span className="block truncate text-[10.5px] text-[var(--ui-muted)]">
                    {details.description}
                  </span>
                </span>
                <span
                  className={cn(
                    'flex h-5 w-5 items-center justify-center rounded-full border text-[11px] font-bold',
                    selected
                      ? 'border-[var(--ui-action)] bg-[var(--ui-action)] text-[var(--ui-action-text)]'
                      : 'border-[var(--ui-border)] text-transparent',
                  )}
                  aria-hidden="true"
                >
                  ✓
                </span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
