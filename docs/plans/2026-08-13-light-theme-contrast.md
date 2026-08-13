# Light-theme contrast fix

## Objective

Restore readable light-theme contrast on the My Souls portfolio strip and
verify the adjacent My Souls / Create Soul actions without changing product
behavior or the Soulidity dark-theme identity.

## Scope

- Replace the portfolio strip's hard-coded dark translucent background with
  shared theme tokens.
- Use semantic readable text tokens for the listed-value and helper copy.
- Keep shared outline and primary buttons readable in default, hover, focus,
  and disabled states in both themes.
- Add regression coverage for the component classes and WCAG AA token pairs.

## Non-goals

- No authentication, data, marketplace, protocol, or Animacraft repository
  changes.
- No redesign of the My Souls page or global palette.

## Acceptance checks

- The portfolio strip contains no hard-coded Soulidity surface color.
- Small portfolio text and action labels reach at least 4.5:1 against their
  rendered surfaces in both themes; focus rings reach at least 3:1 against
  adjacent surfaces.
- My Souls and Create Soul retain readable default and hover states; shared
  disabled buttons remain visibly disabled and retain the not-allowed cursor.
- Target tests, lint, typecheck, and production build pass.
- Browser screenshots cover the My Souls strip in light and dark themes plus
  the adjacent actions' hover/focus states.

## Rollback

Revert the single implementation commit on `codex/light-theme-contrast`.
