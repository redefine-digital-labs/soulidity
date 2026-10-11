# Soulidity Phase Handoff: released-oc-onchain-existence-doc

## Snapshot

- Created: 2026-08-31T08:18:39+03:00
- Phase: released-oc-onchain-existence-doc
- Status: complete
- Goal: Document and publish the proposed transition in which a voluntarily released OC becomes an independently operating onchain existence maintained by permissionless Keepers
- Worktree: `/Users/naoer/Documents/Claude/Projects/soulidity`
- Branch: `codex/maker-editor-p0`
- Commit: `40dc2ce5ee568be1950f9d6b36eff11165dd49e4`
- Working tree: dirty (10 status entries)
- Handoff: `docs/codex/handoffs/20260831-081839-released-oc-onchain-existence-doc.md`

## Outcome

Published the autonomous release and Keeper research model with rights, canon, liveness, AI, funding, threat, and evidence boundaries

## Scope and non-goals

### In scope

- Add a dedicated autonomous-release design document to the private OC autonomous-worlds roadmap repository
- Integrate the proposal into navigation, glossary, status, architecture, roadmap, risks, decisions, rights, and IP boundaries
- Validate Markdown, internal links, permissionless-Keeper invariants, rights separation, and the published Git reference

### Intentionally not done

- No smart-contract implementation, chain or Keeper-provider selection, token model, OC ownership market, product launch, or public-license decision
- Do not mark D-013 accepted or claim autonomous release is implemented, legally ownerless, conscious, permanent, or free of external dependencies

## Durable decisions

- Autonomous release is a Research capability and Proposed decision, not an accepted or implemented feature
- Only the Rights Manifest current-control subject or threshold may release protocol control; release does not change canon authority, copyright, attribution, licenses, privacy, or other participants' consent
- A Keeper may materialize only the unique next state transition derived from canonical state and input; it cannot select actions, slots, proofs, or multi-OC execution order
- Release records a canon snapshot and creates autonomous continuity without automatically writing to original canon

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

- oc-autonomous-worlds-roadmap@7be28d483bb3b7d1a73693488fb448206b372bb4
- https://github.com/soul893/oc-autonomous-worlds-roadmap/commit/7be28d483bb3b7d1a73693488fb448206b372bb4

## Verification

- npx --yes markdownlint-cli2@0.23.2 '**/*.md' reported 0 issues across 15 files: PASS
- markdown-link-check@3.15.0 across every Markdown file: PASS
- git diff --cached --check before commit: PASS
- independent rights, Keeper, and post-fix consistency reviews: PASS
- local main, origin/main, and GitHub remote ref match 7be28d483bb3b7d1a73693488fb448206b372bb4: PASS

## Risks and recovery

### Risks or blockers

- D-013 remains proposed; implementation must not begin as if the product direction were already accepted
- No open-source license has been selected; the private repository does not grant reuse rights

### Recovery or rollback points

- Published target repository snapshot is commit 7be28d483bb3b7d1a73693488fb448206b372bb4 on origin/main
- Pre-phase target repository snapshot is commit 71e68542f984a61df65640696e4e6fd0c573a28a

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
