# Soulidity Phase Handoff: animacraft-shared-maker-shell-ui-convergence

## Snapshot

- Created: 2026-08-13T18:26:47+08:00
- Phase: animacraft-shared-maker-shell-ui-convergence
- Status: complete
- Goal: Unify Maker and Expansion Pack editor UI, fix publication and Play Test regressions, restore Soulidity light-theme readability, and publish both verified sites
- Worktree: `/Users/naoer/Documents/Claude/Projects/soulidity`
- Branch: `codex/maker-editor-p0`
- Commit: `40dc2ce5ee568be1950f9d6b36eff11165dd49e4`
- Working tree: dirty (9 status entries)
- Handoff: `docs/codex/handoffs/20260813-183000-shared-editor-light-theme-production-rollout.md`

## Outcome

Maker and Pack now share one shell, Part list, compact inspector and Rules editor; Pack publication recovery is fail-closed; Play Test footer remains reachable; mirrored legacy royalty no longer falsely blocks v4 publication; Soulidity light-theme contrast is restored; both GitHub branches and Vercel production deployments are live and smoke-verified.

## Scope and non-goals

### In scope

- Animacraft shared Maker/Pack editor UI and responsive 1180/820/560 behavior
- Animacraft Pack publication checkpoint recovery and stale async context fencing
- Animacraft Play Test modal and legacy royalty preflight fixes
- Soulidity light/dark theme My Souls cards and shared button contrast
- GitHub Draft PR and Vercel production rollout for both repositories

### Intentionally not done

- No Mainnet Move/package/object/release/Walrus/wallet transaction or runtime gate mutation

## Durable decisions

- Maker and Pack must call the same host-neutral shell, Part list and Rules renderer rather than copy classes or fork visual systems.
- Only an exact canonical Commerce maker-source royalty mirror of the explicit legacy publication royalty remains v4-compatible; genuine v5 features stay blocked.
- Vercel candidates are promoted only with a known rollback deployment and immediate production-domain smoke.

## Changed paths and assets

### Changed paths

- tmp/animacraft-drop-legacy
- tmp/soulidity-light-theme-contrast

### Image and binary assets

- No image or binary assets recorded.

### Relevant commits

- Animacraft 0119a8fd0768ffad4e77d33632fb6508e1374fcf (PR #53)
- Soulidity 920b6df3d63bf9ac88428868852378be856e5882 (PR #31)

## Verification

- Animacraft npm run check: 1148 tests / 1147 pass / 1 intentional skip, config preflight and Vite build PASS
- Animacraft production smoke https://animacraft.soulidity.ai: shell, security headers, runtime config, Git drift and SPA routes PASS
- Soulidity theme/auth tests 18/18; targeted ESLint; current master typecheck and production build PASS
- Soulidity production smoke: /, /my-souls and /market HTTP 200 with HSTS, frame, MIME and cache headers PASS

## Risks and recovery

### Risks or blockers

- Real Wallet Standard claim/render acceptance still requires a controllable unlocked Mainnet Sui/Slush browser provider.
- Animacraft worktree intentionally retains one untracked historical scripts/expansion-pack-v8-parent-migration.mjs; it is not committed and is excluded from Vercel.

### Recovery or rollback points

- Animacraft previous production deployment dpl_7A4b896UamiAhm2EC817a8g9s1YF
- Soulidity previous production deployment dpl_9JUgzueShZoe79NKdjrtS3grsqHt

### Working-tree evidence

```text
 M .gitignore
 M CONTEXT.md
 M README.md
?? .pnpm-store/
?? AGENTS.md
?? clawnews/
?? docs/
?? live-portrait.html
?? scripts/
```

## Exact next action

Await user feedback or review Draft PR #53 and Soulidity Draft PR #31; real Mainnet wallet claim/render acceptance remains a separate wallet-provider phase.
