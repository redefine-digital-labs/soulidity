# Uncommitted Changes Review

Date: 2026-03-12

## Findings

No open issues in the current uncommitted diff.

## Re-verified prior items

- `fixed.md`: item 4 still validates as fixed in `web/app/api/market/confirm-purchase/route.ts`.
- `fixed.md`: items 6, 7, 9, and 10 still validate as fixed in the current code.
- `fixed.md`: item 8 still validates as fixed after the hook rename to `useSuiPrice`.
- `not-issue.md`: items 11 and 12 still validate as not issues for `src/db/seed-market.ts`.

## Verification

- `npx tsc --noEmit -p web/tsconfig.json` passed.
- `npx eslint 'app/api/market/confirm-purchase/route.ts' 'app/api/market/listings/[id]/route.ts' 'app/api/market/listings/route.ts' 'app/api/market/my/route.ts' 'app/api/market/publish/route.ts' 'app/market/[id]/page.tsx' 'app/market/page.tsx'` reported only pre-existing issues outside the reviewed changes: `web/app/api/market/listings/route.ts:14` (`@typescript-eslint/no-explicit-any`) and `web/app/market/page.tsx:55,64` (`react-hooks/set-state-in-effect`).
- `npx tsc --noEmit -p tsconfig.json` fails at `tests/collector/x.test.ts:134` (`TS2554`), which is unrelated to the current market diff.
