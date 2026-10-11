# Soulidity Phase Handoff: animacraft-expansion-pack-v8-lifecycle-production

## Snapshot

- Created: 2026-08-14T08:04:56+08:00
- Phase: animacraft-expansion-pack-v8-lifecycle-production
- Status: complete
- Goal: Add complete fail-closed Expansion Pack lifecycle management backed by authoritative Mainnet state, durable exact-transaction recovery, wallet-owned AdminCap discovery, GitHub publication, and verified Vercel production deployment
- Worktree: `/Users/naoer/Documents/Claude/Projects/soulidity/tmp/animacraft-drop-legacy`
- Branch: `codex/expansion-pack-v8-wallet-activation`
- Commit: `0e456fbef81e635550ac49c703a9dcaec9ef654d`
- Working tree: clean except the intentionally untracked parent migration script
- Handoff: `docs/codex/handoffs/20260814-080456-animacraft-expansion-pack-v8-lifecycle-production.md`

## Outcome

Expansion Packs now expose Draft/Sealed/Admitted/Active/Paused/Archived lifecycle state, valid Pause/Resume/Archive controls, cross-reload/cross-tab recovery, and wallet-owned chain-only discovery; the audited implementation was pushed to PR #53 and deployed to production.

## Scope and non-goals

### In scope

- Expansion Pack lifecycle state and shared Maker lifecycle modal UI
- Exact signed TransactionData validation, digest-first recovery, version/digest-bound effects and event readback
- Wallet-owned AdminCap discovery including chain-only Packs after local data loss
- GitHub PR #53 update and Vercel production deployment

### Intentionally not done

- No lifecycle transaction was signed or broadcast; production Release remains ACTIVE
- No Mainnet package, object, Walrus Blob, gate, Pass, or entitlement mutation
- The untracked one-time parent migration script remains outside Git and Vercel

## Durable decisions

- ARCHIVED is terminal; ACTIVE must be Paused before Archive, and there is no Restore action
- Any persisted pending lifecycle transaction suppresses all new lifecycle signatures until exact digest-first recovery resolves it
- Resume mirrors the finalized parent Root operational gate before the wallet is opened
- Managed inventory is authoritative from wallet-owned stable-TypeOrigin AdminCaps; Player discovery remains admitted-catalog only

## Changed paths and assets

### Changed paths

- tmp/animacraft-drop-legacy/app.js
- tmp/animacraft-drop-legacy/expansion-pack-lifecycle-controller.js
- tmp/animacraft-drop-legacy/expansion-pack-lifecycle-inventory.js
- tmp/animacraft-drop-legacy/expansion-pack-lifecycle-recovery-store.js
- tmp/animacraft-drop-legacy/expansion-pack-lifecycle-v8.js
- tmp/animacraft-drop-legacy/expansion-pack-lifecycle-i18n.js

### Image and binary assets

- No image or binary assets recorded.

### Relevant commits

- 0e456fbef81e635550ac49c703a9dcaec9ef654d
- https://github.com/redefine-digital-labs/animacraft/pull/53

## Verification

- npm run check: 1204 tests total, 1203 passed, 1 intentional skip; Vite production build PASS
- Independent integrated lifecycle audit: no P0/P1; focused 237/237 PASS
- Live Mainnet read-only lifecycle smoke: one ACTIVE Release, allowedActions=[pause], authorityReady/readbackVerified/parent.operational all true PASS
- GitHub Repository hygiene, Web production build, Vercel, and Preview checks SUCCESS PASS
- Production smoke on https://animacraft.soulidity.ai: shell, security headers, config, Git drift, and SPA routes PASS
- Strict Mainnet Expansion Pack v8 preflight after production promotion PASS

## Risks and recovery

### Risks or blockers

- A wallet-authorized visual Manage/Pause UI acceptance still needs a controllable browser profile with an unlocked Mainnet provider; no transaction should be submitted accidentally

### Recovery or rollback points

- Vercel rollback deployment: dpl_5rXMq9o9WzxJpQ9fF8b7fkZ1wgWR
- Current production deployment: dpl_F8etALpXWEmgi2FZCK6ZWVzCLndq

### Working-tree evidence

```text
?? scripts/expansion-pack-v8-parent-migration.mjs
```

## Exact next action

Use a controllable browser profile with an unlocked Mainnet Sui/Slush wallet to open Creator Studio > Expansion Packs > Manage and visually verify the ACTIVE badge and Pause confirmation without submitting a lifecycle transaction unless intentionally approved.
