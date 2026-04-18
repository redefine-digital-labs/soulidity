# Design Review Implementation — Soulidity Design Review.html

## Scope

Handoff bundle from Claude Design (`/tmp/soulidity-design/`). 38-finding UI/UX audit + brand identity for the Soul marketplace. Audit-against-code pass shows most findings already shipped. This PR closes the remaining open/partial items in one pass.

Reference: `/tmp/soulidity-design/soulidity/project/Soulidity Design Review.html`
Brand direction: **D — Seal & Flame** (already adopted in navbar + favicon)

## Already shipped (verified in `web/`)

Brand (mark + wordmark), S1 pending-buy, S3 "+ New" menu, S6 agent-mode gradient, M1 persona filter, M3 gradient avatars, M4 filter tabs, M7 collection chip, M8 collection ribbons, M9 muted tags, P1 portfolio strip, P2 grant filter + CSV, P3 "Soul/Trainer says", P5 history filters, P6 notification drawer, P7 docs top-level, P8 report modal, C5 wrap+link NFT grid, X2 border #3B2388, X3 empty states, X6 tag sizing, X7 light-mode cut, X8 focus-visible.

## This pass (must-finish)

- [x] C1 — Remove "awaken" pre-mint copy in `create/preview` + `import/preview`
- [x] M5 — Compact Provenance strip on soul-detail (creator · object · grant status · created)
- [x] X5 — Toast redesign: bottom-right stack, max 3, 6s dismiss, hover-pause, left-border semantic stripes
- [x] S5 — Add Deposit action to wallet dropdown
- [x] X8 — Dual-ring focus (purple + bg-offset)

## Follow-up pass (landed after initial scope)

- [x] C7 — baked-in cropper: new `CoverImagePicker` component (canvas-based, no new deps). Enforces 1:1 output, 1024×1024 WebP, ≤2MB via stepped quality. Wired into `create/`, `collections/create/`, `import/map/`. Regression-guard test `tests/new-web/create-basic-info-ui.test.ts` updated to pin the new component.

## Deliberately deferred (Later lane — explicit tail the user should know about)

- S4 — global ⌘K palette (new feature, multi-surface)
- C3 — memory editor upgrade (needs editing UI surface)
- C4 — import smart-guess auto-mapping (source-specific logic)
- P4 — Space template differentiation Soul vs Trainer (cosmetic restructure)
- X1 — shared tokens.css package (currently Tailwind v4 theme serves this role)
- C7 secondary 4:1 banner variant — deferred. Data model only has one cover slot today; adding a second requires provider + upload + on-chain metadata changes.

## Verification

- [x] `npm run lint` — no new issues on changed files (4 pre-existing errors in `lib/hooks/use-wallet-balances.ts` are on master, unrelated)
- [x] `npx tsc --noEmit` — exit 0
- [x] `npm test` — 941 passing, 2 pre-existing failures on master (unrelated to this pass)
- [x] `grep -i awaken` on `web/` — no matches

## Review

Files touched (6):

- `web/app/create/preview/page.tsx` — C1 copy ("awaken" → "mint")
- `web/app/import/preview/page.tsx` — C1 copy ("awaken" → "mint")
- `web/app/souls/[id]/page.tsx` — M5 added `ProvenanceStrip` + `formatRelative`; strip rendered between hero block and Protocol State/Access grid
- `web/components/ui/toast.tsx` — X5 full redesign: bottom-right stack, max 3, 6s dismiss, hover-pause, left-border semantic stripes, dismiss button. Signature `showToast(message, color)` preserved
- `web/components/nav/account-button.tsx` — S5 added Deposit action below SUI balance; copies address and fires a success toast
- `web/app/globals.css` — X8 dual-ring focus: `:focus-visible` now includes a bg-colored box-shadow so the purple outline reads on purple-bordered parents

No code committed per user request.
