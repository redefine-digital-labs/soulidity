# Soulidity Phase Handoff: correct-maker-object-and-english-repositories

## Snapshot

- Created: 2026-08-31T09:00:45+03:00
- Phase: correct-maker-object-and-english-repositories
- Status: complete
- Goal: Correct the Animacraft Maker release playbook to use actual Character Maker objects and make both private roadmap repositories English-only on current main.
- Worktree: `/Users/naoer/Documents/Claude/Projects/soulidity`
- Branch: `codex/maker-editor-p0`
- Commit: `40dc2ce5ee568be1950f9d6b36eff11165dd49e4`
- Working tree: dirty (10 status entries)
- Handoff: `docs/codex/handoffs/20260831-090045-correct-maker-object-and-english-repositories.md`

## Outcome

Rebuilt the launch playbook around one game or season plus two or three version-pinned Animacraft Character Maker releases, removed the human/KOL Maker ontology, closed the independent review findings, translated the autonomous-worlds roadmap, validated both repositories, and pushed clean private main branches.

## Scope and non-goals

### In scope

- Correct Maker ontology and game-release flywheel.
- English-only current Markdown in both private repositories.
- Version, rights, Expansion Pack, participant-promotion, validation, commit, and push evidence.

### Intentionally not done

- No game implementation, Maker publication, recruitment, partnership, payment, public launch, public license, or Git history rewrite.

## Durable decisions

- Maker means the Animacraft Character Maker product object; people use explicit creator, artist, administrator, rights-holder, player, or operator roles.
- The proposed release unit is one game or season plus two or three exact Maker binding records; two returning plus one new is a testable default.
- Current Commerce-v5 bindings distinguish editor lineage, OCMaker, MakerRootV5, embedded/sealed Packs, and live lifecycle/policy/gate state.
- Gameplay notice does not authorize promotional use; per-person, per-asset grants are required.

## Changed paths and assets

### Changed paths

- ../animacraft-maker-launch-playbook/
- ../oc-autonomous-worlds-roadmap/

### Image and binary assets

- No image or binary assets recorded.

### Relevant commits

- animacraft-maker-launch-playbook@dc8ac312e6c367d9492ae3d563163542cb0067d8
- oc-autonomous-worlds-roadmap@94219a28ddb0179d1ef8509e403b195cd64f94d8

## Verification

- Launch playbook: markdownlint 0 issues across 30 Markdown files; CJK/full-width and prohibited-ontology scans 0; all links pass; git diff --check pass: PASS
- Autonomous-worlds roadmap: markdownlint 0 issues across 15 Markdown files; CJK/full-width scan 0; all links pass; git diff --check pass: PASS
- Independent launch-playbook audit found no P0 and all three P1 findings were remediated: PASS
- Both local main refs equal origin/main after push: PASS

## Risks and recovery

### Risks or blockers

- No production game adapter, real Maker cohort, rights grant, Soul path evidence, or live season exists; the documents remain proposals.
- Earlier Git history retains superseded Chinese and human-Maker content because history was not destructively rewritten; current main is English-only and correct.

### Recovery or rollback points

- Corrected launch playbook is recoverable at dc8ac312e6c367d9492ae3d563163542cb0067d8.
- English autonomous-worlds roadmap is recoverable at 94219a28ddb0179d1ef8509e403b195cd64f94d8.

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

Instantiate a one-Maker technical slice only after real rights-cleared OCMaker and MakerRootV5 binding evidence exists; do not invent IDs or present the slice as validation of the public two-to-three-Maker model.
