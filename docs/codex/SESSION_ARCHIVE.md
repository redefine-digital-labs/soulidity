# Codex Session Archive Runbook

This runbook separates three different kinds of “compression”:

1. `/compact` shortens active model context inside the current task. It does not reclaim the raw rollout log on disk.
2. `CURRENT.md`, one linked handoff, source, tests, and Git preserve durable project memory without replaying chat.
3. `scripts/codex/session_archive.py` moves old subagent rollout bytes into verified offline `.jsonl.zst` archives. Codex cannot open those sessions until they are restored.

The archive script is a conservative local maintenance tool, not a documented Codex storage API. Re-run a dry scan after Codex upgrades.

## Conclusion salvage versus full archive

`scripts/codex/session_salvage.py` creates a bounded review pack from explicitly
approved inactive subagents. It only keeps sanitized assistant conclusion
messages from the tail of each rollout; prompts, reasoning, tool calls, tool
outputs, and binary payloads are excluded. This is intentionally lossy. Keep a
verified `.jsonl.zst` archive when exact restoration matters.

The frozen Soulidity recovery pack for the approved 21 old rollouts is at
`docs/codex/recovered-subagent-summaries/README.md`. It records 21 threads and
52,956,289,794 original bytes. Historical conclusions in that pack must still
be checked against current source and tests.

## Safe sequence

Run the default read-only health check:

```bash
python3 scripts/codex/session_archive.py scan
```

Preview old, inactive child sessions that lack a reliable terminal ledger:

```bash
python3 scripts/codex/session_archive.py scan --allow-quiescent-legacy
```

Prefer a FileVault-protected Mac volume or an encrypted external APFS volume. Create a private archive directory there, then preview the exact plan; preview mode creates nothing:

```bash
python3 scripts/codex/session_archive.py archive \
  --archive-root "/Volumes/EncryptedArchive/CodexSessions" \
  --allow-quiescent-legacy
```

For known completed subagents, use one or more `--completed-thread-id <UUID>` values instead of the legacy inference.

Only after the preview is correct, quit Codex so no writer locks remain. Run the command from Terminal with all destructive gates:

```bash
python3 scripts/codex/session_archive.py archive \
  --archive-root "/Volumes/EncryptedArchive/CodexSessions" \
  --allow-quiescent-legacy \
  --execute \
  --remove-source \
  --acknowledge-codex-offline
```

The script processes one file at a time. Before source removal it requires an old SQLite child record, no live writer lock, no process holding the rollout, unchanged file identity and metadata, a durable manifest, `zstd -t`, archive SHA-256, and decompressed SHA-256/byte equality. Any uncertainty retains the source.

## Frozen 21-thread same-volume procedure

`scripts/codex/archive_approved_21.py` is the resume-safe wrapper for the exact
21 rollouts approved on 2026-08-11. Its UUID set, source root, recovery
selection, byte total, and `/Users/naoer/CodexSessionArchive` destination are
fixed; it has no broad or legacy selector. It starts with the smallest source
and processes one item at a time so each verified source removal funds the next
archive.

While Codex is open, only run the preview:

```bash
cd "/Users/naoer/Documents/Claude/Projects/soulidity"
python3 scripts/codex/archive_approved_21.py
```

The validated 2026-08-11 preview selected exactly 21 files totaling
52,956,289,794 bytes and created nothing. At that time the source volume had
about 5.7 GiB free and two active Codex writer locks, so execution was correctly
deferred. The first/smallest file needs about 7.36 GiB free under the mandatory
5 GiB reserve; target at least 8 GiB before starting.

For the actual run:

1. Quit Codex completely with **Codex → Quit Codex**; pausing a task is not
   sufficient. Close Chrome too if its cache will be cleared.
2. From Terminal, confirm at least 8 GiB is available with
   `df -h /System/Volumes/Data`. The known regenerable caches included roughly
   1.5 GiB at `~/.cache/codex-runtimes`, 157 MiB at
   `~/Library/Caches/Codex`, and 1.4 GiB at `~/Library/Caches/Google` on the
   audit date. Only clear them while the owning apps are closed; they may need
   to be rebuilt or downloaded later. Do not touch `~/.codex/sessions`,
   `~/.codex/state_5.sqlite`, repository `.git`, assets, or worktrees.
3. Run the fixed executor from the repository root:

```bash
python3 scripts/codex/archive_approved_21.py \
  --execute \
  --acknowledge-codex-offline
```

If the run stops, do not delete any partial/archive file manually. Fix the
reported condition and run the same command again. A completed archive with a
matching manifest is fully reverified by `finalize` before its original source
can be removed. An archive object without a manifest is treated as an
incomplete fail-closed state and needs manual inspection while the source is
retained.

## Verify and restore

Verify every archive independently:

```bash
python3 scripts/codex/session_archive.py verify \
  --archive-root "/Volumes/EncryptedArchive/CodexSessions"
```

Restoration is dry-run and no-overwrite by default:

```bash
python3 scripts/codex/session_archive.py restore \
  --archive-root "/Volumes/EncryptedArchive/CodexSessions" \
  --thread-id "<UUID>"
```

After the plan and verification are correct, restore the original `.jsonl` path:

```bash
python3 scripts/codex/session_archive.py restore \
  --archive-root "/Volumes/EncryptedArchive/CodexSessions" \
  --thread-id "<UUID>" \
  --execute
```

The archive remains after restoration. If Codex does not immediately rediscover the restored task, restart the app. Never edit a manifest or place the archive inside `~/.codex/sessions`.

If a verified archive and manifest already exist but the original source was
retained because of an interruption or late activity, preview the idempotent
finalization first:

```bash
python3 scripts/codex/session_archive.py finalize \
  --archive-root "/Users/naoer/CodexSessionArchive" \
  --thread-id "<UUID>"
```

Only while Codex is fully closed may `--execute` and
`--acknowledge-codex-offline` be added. Finalization checks the manifest
sidecar, archive hash, zstd frame, decompressed hash and size, SQLite identity,
source metadata, source hash, open handles, and global writer locks again before
unlinking the source.

## Same-volume boundary

Same-volume execution is intentionally refused unless `--allow-same-volume` is supplied, and it always keeps at least a 5 GiB reserve plus worst-case per-file output space. An external or separately backed-up filesystem is safer because same-volume compression is not an independent backup and temporarily needs both copies.
