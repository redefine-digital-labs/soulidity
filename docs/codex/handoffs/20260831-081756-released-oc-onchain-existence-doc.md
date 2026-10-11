# Soulidity Phase Handoff: released-oc-onchain-existence-doc

## Snapshot

- Created: 2026-08-31T08:17:56+03:00
- Phase: released-oc-onchain-existence-doc
- Status: complete
- Goal: Document and publish the proposed transition in which a voluntarily released OC becomes an independently operating onchain existence maintained by permissionless Keepers
- Worktree: `/Users/naoer/Documents/Claude/Projects/soulidity`
- Branch: `codex/maker-editor-p0`
- Commit: `40dc2ce5ee568be1950f9d6b36eff11165dd49e4`
- Working tree: dirty (10 status entries)
- Handoff: `docs/codex/handoffs/20260831-081756-released-oc-onchain-existence-doc.md`

## Outcome

Published the autonomous release and Keeper research model with rights, canon, liveness, AI, funding, threat, and evidence boundaries

## Scope and non-goals

### In scope

- Use the goal statement as the recorded scope.

### Intentionally not done

- No additional non-goals recorded.

## Durable decisions

- No durable decisions recorded for this boundary.

## Changed paths and assets

### Changed paths

- ../oc-autonomous-worlds-roadmap/docs/09-AUTONOMOUS-RELEASE-AND-KEEPER-MODEL.md
- ../oc-autonomous-worlds-roadmap/README.md
- ../oc-autonomous-worlds-roadmap/GLOSSARY.md
- ../oc-autonomous-worlds-roadmap/STATUS.md
- ../oc-autonomous-worlds-roadmap/IP-NOTICE.md
- ../oc-autonomous-worlds-roadmap/docs/03-CONCEPTUAL-ARCHITECTURE.md
- ../oc-autonomous-worlds-roadmap/docs/05-ROADMAP.md
- ../oc-autonomous-worlds-roadmap/docs/06-RISKS-GOVERNANCE-AND-VALIDATION.md
- ../oc-autonomous-worlds-roadmap/docs/07-DECISIONS.md
- ../oc-autonomous-worlds-roadmap/docs/08-RIGHTS-AND-STATE-MODEL.md

### Image and binary assets

- No image or binary assets recorded.

### Relevant commits

- No additional commit references recorded.

## Verification

- npx --yes markdownlint-cli2@0.23.2 '**/*.md' reported 0 issues across 15 files: PASS
- markdown-link-check@3.15.0 across every Markdown file: PASS
- git diff --cached --check before commit: PASS
- independent rights, Keeper, and post-fix consistency reviews: PASS
- local main, origin/main, and GitHub remote ref match 7be28d483bb3b7d1a73693488fb448206b372bb4: PASS

## Risks and recovery

### Risks or blockers

- No additional risk recorded.

### Recovery or rollback points

- Use the snapshot commit and preserve all uncommitted files shown below.

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

Review proposed decision D-013 and decide whether to accept autonomous release as a product direction before writing an implementation specification
