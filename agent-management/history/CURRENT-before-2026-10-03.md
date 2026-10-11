<!-- managed-by: scripts/codex/phase_handoff.py -->

# Soulidity Current Phase

This is the compact entry point for continuing Soulidity work. Keep it short;
link to source, tests, commits, and one handoff instead of copying chat history.

- Stable cross-phase memory: `docs/codex/PROJECT_MEMORY.md`
- Last updated: 2026-08-31
- Status: active
- Phase: animacraft-b0-source-blockers
- Goal: Fix the two pinned Animacraft B0 source blockers: completion receipt
  recipe-binding verification and migrated legacy-archive handling.
- Constraints / non-goals: Preserve unrelated work; no deployment, package
  upgrade, chain migration, real-Maker publication, Mainnet gate enablement,
  rights decision, or public launch.
- Acceptance checks: Web receipt verification agrees with the actual Move event
  and an authoritative on-chain Recipe binding; migrated legacy archive is
  accepted only through an ACTIVE, freshly verified v5 Root; legacy-only,
  disabled, stale, or non-ACTIVE paths still fail closed; focused and relevant
  broader tests pass; source docs state the resolved behavior; independent
  review finds no unresolved P0/P1.
- Worktree / branch / baseline: nested `animacraft/` repository /
  `codex/commerce-rights-v5` /
  `99c6b2b9b6ea432d4ee87d6b9523855d0d9a150c`.
- Current evidence: Mainnet remains disabled/unconfigured. The Web verifier
  expects `recipe_hash` on `CompleteAuthorizedV5`, but the Move event omits it;
  v5 migration archives legacy `OCMaker`, while `ocRecipeIssues()` rejects that
  flag before honoring the ACTIVE v5 Root.
- Exact next action: Finish source-flow review, implement the smallest
  fail-closed fixes, and run targeted regressions before broader validation.
- Previous handoff:
  `docs/codex/handoffs/20260831-101251-first-real-maker-cohort-readiness.md`
