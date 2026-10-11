# Soulidity Phase Handoff: first-real-maker-cohort-readiness

## Snapshot

- Created: 2026-08-31T10:12:51+03:00
- Phase: first-real-maker-cohort-readiness
- Status: complete
- Goal: Publish an English-only, source-aligned operating playbook that takes actual Animacraft Character Maker releases from protocol bootstrap through the first evidence-bearing multi-Maker game release without inventing IDs, rights, integrations, or return history.
- Worktree: `/Users/naoer/Documents/Claude/Projects/soulidity`
- Branch: `codex/maker-editor-p0`
- Commit: `40dc2ce5ee568be1950f9d6b36eff11165dd49e4`
- Working tree: dirty (10 status entries)
- Handoff: `docs/codex/handoffs/20260831-101251-first-real-maker-cohort-readiness.md`

## Outcome

The private launch-playbook repository now defines a global B0 bootstrap, a fail-closed R1-to-R8 evidence ladder, a one-Maker technical slice, a first two-Maker release, and reusable evidence records. All operational templates reject unresolved evidence as pass. Both private roadmap repositories are English-only and at remote main parity. Readiness remains R0 because B0 is deliberately blocked on two pinned source issues.

## Scope and non-goals

### In scope

- Actual Animacraft Character Maker product objects and exact immutable releases
- Global B0 protocol bootstrap and R1-to-R8 game-release readiness ladder
- Fail-closed operational evidence templates 01 through 12
- English-only private GitHub roadmap and launch-playbook documentation

### Intentionally not done

- No Maker selection, publication, migration, recruitment, rights grant, payment, partnership, game implementation, gate enablement, or public launch
- No claim that a fixture, one-Maker technical slice, or first cohort creates returning-Maker history

## Durable decisions

- Maker always means an Animacraft Character Maker product object; people use explicit role names.
- R3 is a one-Maker technical slice only; R4 is the first actual release with two new-to-network exact Maker releases.
- B0 is global and precedes per-Maker migration; it remains blocked until receipt/event ABI parity and legacy-archive migration behavior are fixed and tested.
- The mature two-returning-plus-one-new model is a later hypothesis, not a first-release fact or protocol guarantee.

## Changed paths and assets

### Changed paths

- /Users/naoer/Documents/Claude/Projects/animacraft-maker-launch-playbook/docs/12-FIRST-REAL-COHORT-READINESS.md
- /Users/naoer/Documents/Claude/Projects/animacraft-maker-launch-playbook/docs/10-OPERATING-ROADMAP.md
- /Users/naoer/Documents/Claude/Projects/animacraft-maker-launch-playbook/templates/01-GAME-MAKER-RELEASE-BRIEF.md through templates/12-PROTOCOL-BOOTSTRAP-EVIDENCE.md
- /Users/naoer/Documents/Claude/Projects/animacraft-maker-launch-playbook/README.md and STATUS.md
- /Users/naoer/Documents/Claude/Projects/animacraft-maker-launch-playbook/docs/codex/CURRENT.md and PROJECT_MEMORY.md

### Image and binary assets

- No image or binary assets recorded.

### Relevant commits

- animacraft-maker-launch-playbook 051c6579c9526f96353d8c35b4b7579228e7990e
- animacraft-maker-launch-playbook d732504fca75d5ba0beb3c14a224f4c0136da6ae
- oc-autonomous-worlds-roadmap 94219a28ddb0179d1ef8509e403b195cd64f94d8
- authoritative Animacraft source 99c6b2b9b6ea432d4ee87d6b9523855d0d9a150c

## Verification

- markdownlint-cli2 checked 33 Markdown files with zero issues: PASS
- repository English-script and Maker-identity contradiction scans returned no matches: PASS
- local-link validator checked 37 links with zero broken targets: PASS
- git diff --check and both independent P0/P1 semantic audits: PASS
- local and origin main hashes match for both private GitHub repositories: PASS

## Risks and recovery

### Risks or blockers

- B0 cannot pass at the pinned source revision because the Web receipt verifier and Move CompleteAuthorizedV5 event disagree on recipe_hash.
- The migrated legacy OCMaker archive flag currently blocks the Web preparation path before Active MakerRootV5 authority is honored.
- Mainnet currently has zero verified public Makers and disabled/unset Commerce-v5, Soul-mint, and Seal configuration; no real release is claimed.

### Recovery or rollback points

- Launch-playbook pre-phase baseline is dc8ac312e6c367d9492ae3d563163542cb0067d8; completed remote main is d732504fca75d5ba0beb3c14a224f4c0136da6ae.
- Companion roadmap remote main is 94219a28ddb0179d1ef8509e403b195cd64f94d8.

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
?? releases/
?? scripts/
```

## Exact next action

Keep readiness at R0; if implementation is authorized, reconcile the CompleteAuthorizedV5 receipt/event ABI and migrated legacy-archive handling, then produce a passing B0 record before selecting or migrating any Maker release.
