# Soulidity Phase Handoff: codex-memory-and-phase-workflow

## Snapshot

- Created: 2026-08-11T13:25:02+08:00
- Phase: codex-memory-and-phase-workflow
- Status: complete
- Goal: Safely reclaim caches, provide a recoverable read-only-by-default Codex session archive workflow, automate bounded Soulidity phases, and decide whether Hermes is needed
- Worktree: `/Users/naoer/Documents/Claude/Projects/soulidity`
- Branch: `codex/maker-editor-p0`
- Commit: `40dc2ce5ee568be1950f9d6b36eff11165dd49e4`
- Working tree: dirty (9 status entries)
- Handoff: `docs/codex/handoffs/2026-08-11-codex-memory-and-phase-workflow.md`

## Outcome

Implemented the Soulidity phase-memory contract, installed and validated its dedicated skill, added compact current/project memory plus a guarded handoff generator, and added a fail-closed zstd session archive/verify/restore tool with synthetic integration tests. Safe caches were cleared without changing source or dirty-worktree counts. Hermes was evaluated and intentionally not installed.

## Scope and non-goals

### In scope

- Soulidity project phase boundaries, durable handoffs, image/subagent context controls, and Codex session storage recovery
- Safe removal of regenerable dependency, build, runtime, and closed-app caches

### Intentionally not done

- No live or historical Codex rollout was deleted or compressed without an external archive destination
- No Git commit, push, application database change, or Hermes installation was performed

## Durable decisions

- Use native Codex goal, compact, AGENTS.md, skills, and repository handoffs before adding another agent platform
- Treat .jsonl.zst as offline recovery data; restore the original JSONL before Codex can use it
- Never inherit full history for subagents spawned from a long or image-heavy task

## Changed paths and assets

### Changed paths

- AGENTS.md
- clawnews/AGENTS.md
- docs/codex/CURRENT.md
- docs/codex/PROJECT_MEMORY.md
- docs/codex/HANDOFF_TEMPLATE.md
- docs/codex/SESSION_ARCHIVE.md
- docs/codex/handoffs/2026-08-11-codex-memory-and-phase-workflow.md
- scripts/codex/phase_handoff.py
- scripts/codex/session_archive.py
- scripts/codex/test_session_archive.py
- /Users/naoer/.codex/skills/manage-soulidity-phases/SKILL.md
- /Users/naoer/.codex/skills/manage-soulidity-phases/agents/openai.yaml

### Image and binary assets

- No image or binary assets recorded.

### Relevant commits

- No additional commit references recorded.

## Verification

- python3 -m py_compile for all three Python files: PASS
- python3 -m unittest -v scripts/codex/test_session_archive.py (4 tests): PASS
- manage-soulidity-phases quick_validate.py: PASS
- phase_handoff output, completion, root, and dry-run mutation gates: PASS
- real Codex session scan and archive preview remained read-only: PASS
- clean and dirty worktree status counts remained preserved after cache cleanup: PASS

## Risks and recovery

### Risks or blockers

- Codex sessions are still about 97.3 GiB and the Data volume has only about 6.4 GiB free; an external archive/offline pass is still needed to reach the 15 GiB safety line
- The new workflow files are local and untracked until the user intentionally stages and commits them

### Recovery or rollback points

- Use docs/codex/SESSION_ARCHIVE.md plus manifest verification and restore before reopening an archived child session
- Preserve the existing dirty and detached worktrees; no cleanup action changed their tracked status counts

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

Connect an encrypted external APFS volume, run the documented archive preview, then quit Codex and execute verified source removal from Terminal; start the next Soulidity product phase in a new task using the linked handoff.
