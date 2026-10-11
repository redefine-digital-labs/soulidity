# Soulidity Phase Handoff: codex-session-salvage-21

## Snapshot

- Created: 2026-08-11T17:10:00+08:00
- Phase: codex-session-salvage-21
- Status: complete
- Goal: Preserve durable conclusions from exactly 21 approved inactive Soulidity subagent rollouts and prepare a fail-closed, resume-safe offline same-volume archive procedure without touching current v8 work or raw sources.
- Worktree: `/Users/naoer/Documents/Claude/Projects/soulidity`
- Branch: `codex/maker-editor-p0`
- Commit: `40dc2ce5ee568be1950f9d6b36eff11165dd49e4`
- Working tree: dirty (9 status entries)
- Handoff: `docs/codex/handoffs/2026-08-11-codex-session-salvage-21.md`

## Outcome

Generated a 168 KiB sanitized recovery pack with 155 bounded assistant conclusion messages for all 21 approved threads, fixed and tested a conservative zstd archive/finalize tool, and added a frozen smallest-first offline runner for exactly 52,956,289,794 source bytes. The online dry-run selected exactly those 21 logs; all raw JSONL files remain unchanged and no archive root was created.

## Scope and non-goals

### In scope

- Exactly 21 explicitly approved inactive subagent rollout UUIDs totaling 52,956,289,794 bytes.
- Bounded sanitized conclusion recovery, verified zstd archive safety, dry-run selection, and offline runbook.

### Intentionally not done

- No raw rollout was compressed, removed, renamed, or modified while Codex was online.
- No v8 source, docs/codex/CURRENT.md, Git commit, push, PR, asset, or worktree was changed by this maintenance phase.

## Durable decisions

- Keep the recovery pack as a lossy review aid and the zstd archives as the only exact restorable copy after source removal.
- Use the frozen 21-ID runner only; no quiescent-legacy or broad selector is permitted for this approved batch.
- Actual same-volume execution requires zero Codex writer locks, at least the mandatory 5 GiB reserve plus per-file worst case, and an explicit offline acknowledgement.

## Changed paths and assets

### Changed paths

- scripts/codex/session_salvage.py
- scripts/codex/test_session_salvage.py
- docs/codex/recovered-subagent-summaries
- scripts/codex/session_archive.py
- scripts/codex/test_session_archive.py
- scripts/codex/archive_approved_21.py
- scripts/codex/test_archive_approved_21.py
- docs/codex/SESSION_ARCHIVE.md

### Image and binary assets

- No image or binary assets recorded.

### Relevant commits

- No additional commit references recorded.

## Verification

- python3 -m unittest for salvage, archive, and approved runner: 14 tests passed — PASS
- Recovery pack and source stat validation: 21 threads, 52,956,289,794 bytes, 23 files under 1 MiB, no sensitive patterns — PASS
- Frozen runner dry-run: exactly 21 explicit completed-thread candidates totaling 49.3 GiB, no archive/source write — PASS
- Archive root absent and every selected source size/mtime unchanged after recovery — PASS

## Risks and recovery

### Risks or blockers

- Only about 5.7 GiB is currently free; first file needs about 7.36 GiB and at least 8 GiB is recommended before execution.
- Two active writer locks remain while Codex is open, including the current storage task and v8 task; pausing is insufficient, so execution must happen after fully quitting Codex.
- Same-volume archives are not an independent backup and Codex cannot directly load .jsonl.zst; restore the original JSONL path before use.

### Recovery or rollback points

- All 21 raw rollouts remain at their original ~/.codex/sessions paths and still match the frozen selection metadata.
- The review pack is docs/codex/recovered-subagent-summaries; the approved archive root is /Users/naoer/CodexSessionArchive and does not yet exist.

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

Quit Codex completely, close Chrome if clearing its cache, raise source-volume free space from about 5.7 GiB to at least 8 GiB, then run python3 scripts/codex/archive_approved_21.py --execute --acknowledge-codex-offline from the repository root.
