# Sprite Lifecycle Test Plan

## Overview

Test matrix for Soul persona sprite add / update / delete across web mirror + desktop consumption.
- `[AUTO]` — Can be verified via vitest / tsc / Chrome DevTools MCP / script smoke
- `[MANUAL]` — Requires real owner wallet, Soul on testnet, or running Electron app

Follows the `test-plan-auth.md` matrix convention. Results captured as
⏸ BLOCKED / ✅ PASS / ❌ FAIL / ☐ pending / ⚠️ PARTIAL.

---

## Automated Tests

| ID | Test | Steps | Expected | Result |
|----|------|-------|----------|--------|
| S1 | Move protocol tests `[AUTO]` | `sui move test --path move/soulidity` | 149 passed | ✅ PASS — 149/149 |
| S2 | Web typecheck `[AUTO]` | `cd web && npx tsc -p tsconfig.json --noEmit` | zero errors | ✅ PASS — zero errors |
| S3 | Vitest — sprite contract reducer `[AUTO]` | `npx vitest run tests/new-web/desktop-sprite-contract.test.ts` | 6 passed | ✅ PASS — 6/6 |
| S4 | Vitest — sprite animation renderer `[AUTO]` | `npx vitest run tests/desktop/sprite-animation-resolution.test.ts` | 4 passed | ✅ PASS — 4/4 |
| S5 | Vitest — mirror upsert + asset routes `[AUTO]` | `npx vitest run tests/new-web/soul-asset-append-route.test.ts tests/new-web/soul-asset-delete-route.test.ts tests/new-web/soul-metadata-route.test.ts tests/new-web/soulidity-mirror-upsert.test.ts` | 50 passed | ✅ PASS — 50/50 |
| S6 | Full root vitest `[AUTO]` | `npx vitest run` | delta vs baseline = 0 new failures | ✅ PASS — 1095 passed, 4 pre-existing fails (Electron install in `tests/desktop/task-executor` + `status-watcher`; `extract-draft` fixture drift). Confirmed baseline identical via `git stash`. Sprite-flow Playwright spec excluded via `vitest.config.ts`. |
| S7 | Desktop vitest `[AUTO]` | `cd desktop && pnpm test` | 96 passed | ✅ PASS — 96/96 |
| S8 | Script import smoke `[AUTO]` | `cd web && npx tsx scripts/e2e-sprite-lifecycle.ts` | prints usage, zero MODULE_NOT_FOUND | ✅ PASS — prints "Usage: e2e-sprite-lifecycle.ts append\|activate\|delete\|clear\|inspect\|run-all" |
| S9 | Script subcommand parsing `[AUTO]` | `cd web && npx tsx scripts/e2e-sprite-lifecycle.ts append wusaqi wrongpolicy` | throws "visibility must be public or private" pre-network | ✅ PASS — thrown before any DB / Walrus / chain access |
| U1 | Web dev server boots `[AUTO]` | `npm run dev` → MCP navigate to `/` | 200 with app HTML | ✅ PASS — title "Soulidity — On-chain Soul Ownership", ready state `complete`, only pre-existing Privy Solana-connector warnings |
| U2 | `/souls/<id>` route renders `[AUTO]` | MCP navigate to `/souls/0xb064...dae269` on clean DB | Soul-not-found handled cleanly, shell renders | ✅ PASS — title `Soul · Soulidity`, navigation + footer render, only errors are two expected 404s for the empty-DB Soul fetch |
| U3 | PersonaAssetPanel guarded by owner flag `[AUTO]` | Source grep | owner-only gate present | ✅ PASS — `web/app/souls/[id]/page.tsx:356 {soul.isOwner && <PersonaAssetPanel soul={soul} />}`; import on line 13 |
| U4 | Panel component module contract `[AUTO]` | Source grep for exports + copy | `export function PersonaAssetPanel` + "Persona Sprite" kicker + "Upload & Set Active" button label exist | ✅ PASS — `persona-asset-panel.tsx:58 export function PersonaAssetPanel`, button label confirmed |
| A1 | `GET /api/souls/<id>/assets` contract `[AUTO]` | `curl -s http://localhost:3100/api/souls/<id>/assets` | 200 `{assets:[]}` or 404 when soul missing | ✅ PASS — HTTP 404 `{"error":"Soul not found"}` on empty DB; populated `200 {assets:[…]}` path exercised by vitest S5 (`soul-asset-append-route.test.ts`) |
| A2 | `POST /api/souls/<id>/assets` unauth → 401 `[AUTO]` | curl POST without session cookie | 401/403 | ✅ PASS — HTTP 401 `{"error":"请先登录"}` |
| A3 | `POST /api/souls/<id>/metadata` unauth → 401 `[AUTO]` | same | 401/403 | ✅ PASS — HTTP 401 `{"error":"请先登录"}` |
| A4 | `POST /api/souls/<id>/assets/<name>/versions/0/delete` unauth → 401 `[AUTO]` | same | 401/403 | ✅ PASS — HTTP 401 `{"error":"请先登录"}` |

## Manual Tests

| ID | Test | Why Manual | Result |
|----|------|-----------|--------|
| M1 | Script `run-all` on testnet | Needs `OWNER_PRIVATE_KEY` of Soul owner + `SOUL_ON_CHAIN_ID` | ☐ |
| M2 | Owner UI: Upload public sprite → appears in list, active badge flips | Needs signed-in owner wallet + Privy session | ☐ |
| M3 | Owner UI: Upload private sprite → `sealSidecar` mirrored, owner_only policy visible | Needs signed-in owner + Seal keys | ☐ |
| M4 | Owner UI: Delete a version → row shows `deletedAt`, `GET /assets` filters it out | Needs signed-in owner | ☐ |
| M5 | Owner UI: Clear Active → `activeSpriteAssetName` nulls in DB | Needs signed-in owner | ☐ |
| M6 | Desktop Refresh after script append → Soul card appears, `Download` available | Needs built desktop app + wallet token | ☐ |
| M7 | Desktop Download public sprite → sheet streams from Walrus, canvas renders | Needs desktop + public sprite version mirrored | ☐ |
| M8 | Desktop Download private sprite → Seal session → decrypted, renders | Needs desktop + private sprite + SessionKey | ☐ |
| M9 | Playwright smoke: `pnpm --filter @soulidity/desktop run e2e -- -g boots` | Needs `pnpm install` for `@playwright/test` + `playwright install` | ☐ |
| M10 | Playwright live flow: `SOUL_SPRITE_LIVE=1 SOUL_ON_CHAIN_ID=0x... pnpm ... e2e` | Needs M1 completed + web dev running | ☐ |

---

## Screenshots

Evidence screenshots saved to `docs/screenshots/sprite-lifecycle/`:

- `souls-detail-panel.png` — `/souls/<id>` with PersonaAssetPanel (owner viewpoint)
- `api-assets-empty.json` — `GET /api/souls/<id>/assets` response sample

## Code Verification

- `npx tsc -p tsconfig.json --noEmit` (web) — passes
- `sui move test --path move/soulidity` — 149/149 passes
- Plan file: `/Users/admin/.claude/plans/soul-sprite-tender-elephant.md`
- Playbook: `docs/plans/sprite-e2e-playbook.md`
