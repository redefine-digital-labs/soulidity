# Soulidity Phase Handoff: animacraft-commerce-preflight-parity-production

## Snapshot

- Created: 2026-08-13T23:15:54+08:00
- Phase: animacraft-commerce-preflight-parity-production
- Status: complete
- Goal: Eliminate the false generic Commerce v5 blocker for initial Maker drafts while preserving genuine v5 gates, then publish and verify the correction in production
- Worktree: `/Users/naoer/Documents/Claude/Projects/soulidity`
- Branch: `codex/maker-editor-p0`
- Commit: `40dc2ce5ee568be1950f9d6b36eff11165dd49e4`
- Working tree: dirty (9 status entries)
- Handoff: `docs/codex/handoffs/20260813-231554-animacraft-commerce-preflight-parity-production.md`

## Outcome

Replaced the generic Commerce blocker with deterministic reason-specific issues, added a narrow legacy initial-v1 250-to-300 compatibility boundary, added explicit undoable recovery for old gate-off rights choices, kept independent Pack drafts out of parent preflight, and made the immutable release clone consume the same canonical economics as Preflight. Pushed commits 2c38a8d and dd82797, updated Draft PR #53, promoted Vercel dpl_5rXMq9o9WzxJpQ9fF8b7fkZ1wgWR, and verified production byte parity.

## Scope and non-goals

### In scope

- Animacraft Maker Commerce preflight classification and initial-v1 legacy compatibility
- Gate-off Rights UI recovery and five-language copy
- Preflight versus immutable release economics parity
- GitHub branch/PR update and controlled Vercel production rollout

### Intentionally not done

- No Commerce v5 runtime gate activation or Move/Mainnet object mutation
- No signing, wallet claim, Walrus write, or tracked migration-script publication

## Durable decisions

- Independent Expansion Pack projects do not block parent Maker publication; only legacy embedded Pack state remains a genuine Commerce v5 reason.
- A 250-to-300 royalty mismatch is compatible only for an unpublished initial v1 with exact known defaults; published successors and arbitrary mismatches remain fail-closed.
- The release clone must use canonical MakerDocument royalty and mint economics already inspected by Preflight; legacy shell inputs are projections only.

## Changed paths and assets

### Changed paths

- tmp/animacraft-drop-legacy/app.js
- tmp/animacraft-drop-legacy/maker-commerce-v5.js
- tmp/animacraft-drop-legacy/maker-workspace.js
- tmp/animacraft-drop-legacy/maker-workspace-i18n.js
- tmp/animacraft-drop-legacy/test/app-commerce-v5-wiring.test.js
- tmp/animacraft-drop-legacy/test/maker-commerce-v5.test.js
- tmp/animacraft-drop-legacy/test/maker-cover-release-contract.test.js
- tmp/animacraft-drop-legacy/test/maker-workspace-actions.test.js

### Image and binary assets

- No image or binary assets recorded.

### Relevant commits

- 2c38a8df1fb6c11650407a154db6d0dee3c01c44
- dd82797442714717349b5e92cc253a941d9bcce1

## Verification

- npm run check: 1158 tests, 1157 passed, 1 intentional skip, 0 failed; Vite production build PASS
- Independent final audit found no P0/P1; focused Commerce suites 198/198 PASS
- GitHub PR #53 repository hygiene, production build, Vercel, and preview comments PASS
- Production smoke https://animacraft.soulidity.ai: shell, headers, runtime config, Git drift, and SPA route checks PASS
- Deployed /assets/index-CKQBbWU4.js is byte-identical to local dist, SHA-256 ef30b60339b055dc4876ff9ad318aed562a35d750d7a4c4bcb1f70ba08241d27 PASS

## Risks and recovery

### Risks or blockers

- The exact user IndexedDB draft is browser-local; after hard refresh and Run again it may surface a genuine specific reason such as legacy embedded Pack state, which now has accurate guidance.
- The untracked historical scripts/expansion-pack-v8-parent-migration.mjs remains intentionally outside Git and is excluded by .vercelignore scripts/.

### Recovery or rollback points

- Vercel rollback deployment before this rollout: dpl_3hiEVvxoo9PK4xuyJRQhkPKsQL64

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

User should hard-refresh https://animacraft.soulidity.ai, reopen the affected Maker, and click Run again; if a real reason remains, use its specific Commerce & Rights repair action rather than the removed generic blocker.
