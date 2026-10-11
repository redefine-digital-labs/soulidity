# External Blockers — clawnews

Tracked items that are NOT in-scope tails. Each has an explicit external trigger.
Re-check on every `/health` run.

## 2026-05-04 — God file splits deferred (Step 7 of update plan)

**Plan reference:** `/Users/admin/.claude/plans/starry-tinkering-conway.md` Step 7

**Files awaiting split:**
- `web/app/souls/[id]/page.tsx` (1152 lines → 1 + 3 panels)
- `web/lib/upload/client-upload.ts` (1236 lines → 1 + 2 sub-modules)
- `web/lib/soulidity/events.ts` (1101 lines → 1 + 2 layers)
- `web/lib/hooks/use-collection-publish.ts` (1536 lines → 1 + 2 phases/recovery)

**Why deferred:**
- User has substantial in-flight stashed edits to `web/app/souls/[id]/page.tsx` aligning the file with phase 2 unified content (1048 insertions / 276 deletions in the diff, matching `api-sdk/page.tsx` doc updates and `soulidity/types.ts` reshape).
- The other 3 files share the same Soulidity SDK import surface that the user is reshaping (kinds, content-document-id, content-version-pagination, mirror layer).
- Splitting any of the 4 mid-WIP creates a 3-way merge problem: my structural moves vs user's content reshape vs future panel boundaries.

**External trigger to unblock:**
- User commits and lands the phase 2 alignment edits to `souls/[id]/page.tsx` and any related Soulidity SDK reshape.

**Action when triggered:**
- Re-run `/health` to confirm file sizes still warrant splitting (likely yes; user's diff was ~size-neutral).
- Apply the split plan from the original update plan, file paths intact.

**Status:** OPEN — not a leftover tail; coupled to user's own work.

---

## 2026-05-04 — eslint 9 → 10 deferred (Step 9 of update plan)

**Plan reference:** `/Users/admin/.claude/plans/starry-tinkering-conway.md` Step 9

**Why deferred:**
- `eslint-config-next@16.2.4` peerDependencies declare `eslint: ">=9.0.0"` (claims compatibility with v10).
- Reality: the version of `eslint-plugin-react` bundled under `eslint-config-next/node_modules/eslint-plugin-react` (nested) calls `context.getFilename()` directly. ESLint 10 removed that legacy method on the rule context. Result: every lint run on this repo throws `TypeError: contextOrFilename.getFilename is not a function` from `eslint-plugin-react/lib/util/version.js:31`.
- This is upstream — neither our code nor our config can fix it.

**Verification command:**
```bash
cd web && npm i -D eslint@^10.3.0 && npm run lint
# fails with TypeError on every file
```

**External trigger to unblock:**
- Either (a) `eslint-plugin-react` ships a release that supports eslint 10's new rule context API, then `eslint-config-next` releases a version that bumps its nested eslint-plugin-react pin, OR (b) `eslint-config-next` updates its bundled eslint-plugin-react directly.
- Track issues:
  - Vercel/Next: https://github.com/vercel/next.js/issues
  - eslint-plugin-react: https://github.com/jsx-eslint/eslint-plugin-react/issues

**Action when triggered:**
- `cd web && npm i -D eslint@^10.x.x`, `npm i -D eslint-config-next@^17.x.x` (or latest minor with eslint-plugin-react v8+).
- `npm run lint` to confirm clean run.

**Status:** OPEN — rolled back to eslint 9.39.4 in this session. Re-check monthly via `/health`.

## 2026-05-04 — vite 7 → 8 deferred (Step 10 of update plan)

**Plan reference:** `/Users/admin/.claude/plans/starry-tinkering-conway.md` Step 10

**Why deferred:**
- `electron-vite@5.0.0` (latest) declares `peerDependencies.vite: "^5.0.0 || ^6.0.0 || ^7.0.0"` — vite 8 is NOT in that range.
- Root `package.json` also has an `overrides.vite: "7.3.2"` pin which would need to be updated globally.
- Bumping vite to 8 today would either fail install (peer mismatch with `--strict-peer-deps`) or build-time failure inside electron-vite's vite plumbing.

**Verification command:**
```bash
npm view electron-vite@latest peerDependencies
# vite: '^5.0.0 || ^6.0.0 || ^7.0.0'
```

**External trigger to unblock:**
- `electron-vite` ships a release that adds `vite ^8.0.0` to its peer range.
- Then bump root `overrides.vite` to 8.x and `@soulidity/desktop devDependencies.vite` to ^8.

**Action when triggered:**
- `cd desktop && pnpm --filter @soulidity/desktop add -D vite@^8 electron-vite@<new>`
- Update root `overrides.vite` to match.
- `cd desktop && pnpm build` to confirm desktop dmg still builds on macOS.

**Status:** OPEN — vite stayed at 7.3.2. Desktop is dev-only-affected; web/server unaffected.

---

## (template for future entries)

### YYYY-MM-DD — Title

**Plan reference:**
**Why deferred:**
**External trigger to unblock:**
**Action when triggered:**
**Status:** OPEN | UNBLOCKED | DROPPED
