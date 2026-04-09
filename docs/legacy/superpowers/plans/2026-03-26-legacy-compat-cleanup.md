# Legacy Compat Cleanup Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the confirmed-dead Souls compatibility branches and lock the remaining ambiguous items behind explicit defer boundaries.

**Architecture:** This cleanup is split into one small runtime batch and one documentation boundary batch. Runtime changes are limited to Souls publish draft storage and the Souls publish mirror route because both have a single verified caller. Auth fallback and root snake_case interfaces remain untouched and are explicitly deferred.

**Tech Stack:** Next.js 16, React 19, Vitest, Prisma 7, localStorage

---

### Task 1: Remove Global Draft Key Fallback

**Files:**
- Modify: `web/lib/souls/publish-draft.ts`
- Test: `tests/web/soul-publish-draft.test.ts`

- [ ] **Step 1: Rewrite the failing test expectations**

Replace the current legacy-migration assertions with expectations for the new contract:
- bare `SOUL_PUBLISH_DRAFT_STORAGE_KEY` is ignored at read time
- wallet-scoped drafts still recover across Sui address normalization
- malformed old payloads stay ignored
- if a recovered draft contains `releaseId` without `releaseTxDigest`, it is explicitly rejected or sanitized according to the chosen strategy

Run: `npx vitest run tests/web/soul-publish-draft.test.ts`
Expected: FAIL on the removed legacy behaviors before implementation.

- [ ] **Step 2: Delete the runtime fallback**

Remove:
- `readSoulPublishDraft()` fallback read/migrate branch for bare `SOUL_PUBLISH_DRAFT_STORAGE_KEY`
- `writeSoulPublishDraft()` / `clearSoulPublishDraft()` legacy cleanup-only branches

Keep:
- wallet-scoped key generation
- address normalization
- malformed payload rejection

- [ ] **Step 3: Re-run the draft tests**

Run: `npx vitest run tests/web/soul-publish-draft.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add web/lib/souls/publish-draft.ts tests/web/soul-publish-draft.test.ts
git commit -m "refactor(souls): drop global publish draft fallback"
```

### Task 2: Enforce Explicit Release Mirror Contract

**Files:**
- Modify: `web/app/api/souls/publish/route.ts`
- Modify: `web/app/souls/publish/page.tsx` or `web/lib/souls/publish-draft.ts` (choose one explicit stale-draft handling point)
- Test: `tests/web/soul-publish-route.test.ts`
- Test: `tests/web/soul-publish-draft.test.ts`

- [ ] **Step 1: Add the failing route test**

Add a test that sends:

```json
{
  "txDigest": "<valid publish tx>",
  "seriesOnChainId": "<valid series>",
  "releaseOnChainId": "<valid release>",
  "oneTimePlanOnChainId": "<valid plan>",
  "oneTimePlanTxDigest": "<valid plan tx>"
}
```

without `releaseTxDigest`.

Expect:
- `400`
- error message for missing `releaseTxDigest`
- no `getTransactionBlock()` / `getObject()` calls

Run: `npx vitest run tests/web/soul-publish-route.test.ts`
Expected: FAIL before implementation.

- [ ] **Step 2: Tighten the route contract**

In `web/app/api/souls/publish/route.ts`:
- require `releaseTxDigest` whenever `releaseOnChainId` exists
- require `releaseOnChainId` whenever `releaseTxDigest` exists
- remove the `seriesTransaction` fallback branch for release verification

- [ ] **Step 3: Handle stale recovered drafts explicitly**

Choose one clear behavior and implement it in exactly one place:
- reject draft recovery when `releaseId` exists but `releaseTxDigest` is missing, or
- clear the stale release fields and force the user to re-create the release

Do not preserve the old route fallback as the recovery mechanism.

- [ ] **Step 4: Re-run focused tests**

Run: `npx vitest run tests/web/soul-publish-draft.test.ts tests/web/soul-publish-route.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add web/app/api/souls/publish/route.ts web/app/souls/publish/page.tsx web/lib/souls/publish-draft.ts tests/web/soul-publish-route.test.ts tests/web/soul-publish-draft.test.ts
git commit -m "refactor(souls): require release tx digest for publish mirror"
```

### Task 3: Update Audit Boundary And Defer Auth Cleanup

**Files:**
- Modify: `LEGACY_COMPAT_AUDIT.md`
- Modify: `docs/legacy/superpowers/specs/2026-03-26-legacy-compat-cleanup-spec.md`
- Optional note only: `docs/test-plan-auth.md`

- [ ] **Step 1: Update the audit classification**

Make the document reflect the verified state:
- `A1/A2` are in-scope cleanup
- `A3` is deferred auth migration work
- `B4` is historical migration SQL
- `B5` is an active root runtime interface, not dead compatibility code

- [ ] **Step 2: Cross-check auth remains intentionally untouched**

Run: `npx vitest run tests/web/identity.test.ts`
Expected: PASS, confirming the deferred auth fallback still behaves as documented.

- [ ] **Step 3: Commit**

```bash
git add LEGACY_COMPAT_AUDIT.md docs/legacy/superpowers/specs/2026-03-26-legacy-compat-cleanup-spec.md docs/test-plan-auth.md
git commit -m "docs: narrow legacy cleanup scope"
```

### Task 4: Final Verification

**Files:**
- Verify only

- [ ] **Step 1: Run targeted regression**

Run: `npx vitest run tests/web/soul-publish-draft.test.ts tests/web/soul-publish-route.test.ts tests/web/identity.test.ts`
Expected: PASS

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 3: Review diff against the spec**

Confirm the implementation satisfies all six acceptance items in `docs/legacy/superpowers/specs/2026-03-26-legacy-compat-cleanup-spec.md`.
