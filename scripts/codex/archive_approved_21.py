#!/usr/bin/env python3
"""Resume-safe runner for the 21 explicitly approved old subagent rollouts.

This intentionally has no selector flags: the approved UUID set, recovery-pack
manifest, source root, and archive root are fixed.  The default is a dry run.
Execution is only permitted with both ``--execute`` and
``--acknowledge-codex-offline`` and delegates every archive/finalize operation
to the fail-closed session_archive.py implementation.
"""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import stat
import subprocess
import sys


SCRIPT_DIR = Path(__file__).resolve().parent
REPOSITORY_ROOT = SCRIPT_DIR.parents[1]
ARCHIVE_TOOL = SCRIPT_DIR / "session_archive.py"
SELECTION_FILE = (
    REPOSITORY_ROOT
    / "docs"
    / "codex"
    / "recovered-subagent-summaries"
    / "selection.json"
)
SOURCE_ROOT = Path("/Users/naoer/.codex/sessions")
STATE_DB = Path("/Users/naoer/.codex/state_5.sqlite")
LOCK_DIR = Path("/Users/naoer/.codex/thread-writer-locks")
ARCHIVE_ROOT = Path("/Users/naoer/CodexSessionArchive")
EXPECTED_TOTAL_BYTES = 52_956_289_794
RECOMMENDED_INITIAL_FREE_BYTES = 8 * 1024**3

APPROVED_THREAD_IDS = (
    "019fc24b-4db6-7323-932d-cc28ef173b5a",
    "019fc1fc-f63a-7a50-9654-741735631d87",
    "019fc1fb-dfbc-7613-af37-8b19afef267e",
    "019fc227-8e1f-7fa2-8e12-7e2a5a905aa0",
    "019fc1fc-61c2-7072-9abe-72c7d33184ef",
    "019fc1db-9ad8-7c40-bdc0-3b7c66fc8361",
    "019fc1dc-d017-77d0-88ff-dfca20369186",
    "019fc0f7-a4b3-7970-9c54-38980fe575a0",
    "019fc192-5d14-7291-be17-00953c98fef9",
    "019fc191-6ecb-72c1-975f-06fcabaea733",
    "019fc191-db35-7e82-9b43-5144866005fe",
    "019fc0eb-473d-7582-9502-5ef1912e707a",
    "019fc0a5-a248-7001-bb5a-2348bc1d3a2a",
    "019fc0a6-0e10-7f50-89ef-9e84106c9202",
    "019fc091-2eea-7f80-af60-c208d853d6eb",
    "019fc090-be94-77e1-a6ec-6c33c889a812",
    "019fc091-7fcc-7033-b2f3-31a7862ee7b9",
    "019fc02d-b9aa-7853-93e2-22251aeed561",
    "019fc038-1afa-7b90-9416-1b82d2cc11aa",
    "019fbff2-a145-78a3-baa7-9766bf5b7dbd",
    "019fbe7d-c759-7691-8b98-98d3c6204c14",
)


class ApprovedArchiveError(RuntimeError):
    """The frozen approval pack or offline execution preconditions are invalid."""


def human_bytes(value: int) -> str:
    amount = float(value)
    for unit in ("B", "KiB", "MiB", "GiB", "TiB"):
        if amount < 1024 or unit == "TiB":
            return f"{int(amount)} B" if unit == "B" else f"{amount:.2f} {unit}"
        amount /= 1024
    raise AssertionError("unreachable")


def load_approved_selection() -> list[dict[str, object]]:
    metadata = os.lstat(SELECTION_FILE)
    if not stat.S_ISREG(metadata.st_mode) or stat.S_ISLNK(metadata.st_mode):
        raise ApprovedArchiveError(f"selection is not a plain file: {SELECTION_FILE}")
    if metadata.st_uid != os.getuid() or metadata.st_size > 1024 * 1024:
        raise ApprovedArchiveError("selection ownership/size is unsafe")
    try:
        payload = json.loads(SELECTION_FILE.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as error:
        raise ApprovedArchiveError(f"cannot read selection: {error}") from error
    if not isinstance(payload, dict) or payload.get("schema_version") != 1:
        raise ApprovedArchiveError("unsupported recovery selection schema")
    if payload.get("source_root") != str(SOURCE_ROOT):
        raise ApprovedArchiveError("recovery selection source root changed")
    threads = payload.get("threads")
    if not isinstance(threads, list) or len(threads) != len(APPROVED_THREAD_IDS):
        raise ApprovedArchiveError("recovery selection does not contain exactly 21 threads")
    by_id: dict[str, dict[str, object]] = {}
    total = 0
    for entry in threads:
        if not isinstance(entry, dict):
            raise ApprovedArchiveError("recovery selection contains a malformed thread")
        thread_id = entry.get("thread_id")
        source_size = entry.get("source_size")
        source_path = entry.get("source_path")
        if not isinstance(thread_id, str) or thread_id in by_id:
            raise ApprovedArchiveError("recovery selection has a duplicate/invalid UUID")
        if not isinstance(source_size, int) or isinstance(source_size, bool) or source_size <= 0:
            raise ApprovedArchiveError(f"invalid source size for {thread_id}")
        if not isinstance(source_path, str):
            raise ApprovedArchiveError(f"invalid source path for {thread_id}")
        source = Path(source_path)
        try:
            source.relative_to(SOURCE_ROOT)
        except ValueError as error:
            raise ApprovedArchiveError(f"source escapes session root: {thread_id}") from error
        if not source.name.endswith(f"{thread_id}.jsonl"):
            raise ApprovedArchiveError(f"source filename/UUID mismatch: {thread_id}")
        total += source_size
        by_id[thread_id] = entry
    if set(by_id) != set(APPROVED_THREAD_IDS):
        raise ApprovedArchiveError("recovery selection UUID set changed")
    if total != EXPECTED_TOTAL_BYTES or payload.get("total_source_bytes") != total:
        raise ApprovedArchiveError("recovery selection byte total changed")
    if payload.get("total_threads") != len(APPROVED_THREAD_IDS):
        raise ApprovedArchiveError("recovery selection thread total changed")
    # Smallest first minimizes the initial same-volume temporary-space peak.
    return sorted(by_id.values(), key=lambda item: int(item["source_size"]))


def common_selection_arguments() -> list[str]:
    return [
        "--source",
        str(SOURCE_ROOT),
        "--state-db",
        str(STATE_DB),
        "--lock-dir",
        str(LOCK_DIR),
    ]


def archive_command(thread_ids: list[str], *, execute: bool) -> list[str]:
    command = [
        sys.executable,
        str(ARCHIVE_TOOL),
        "archive",
        *common_selection_arguments(),
        "--archive-root",
        str(ARCHIVE_ROOT),
        "--allow-same-volume",
        "--remove-source",
        "--acknowledge-codex-offline",
    ]
    for thread_id in thread_ids:
        command.extend(("--completed-thread-id", thread_id))
    if execute:
        command.append("--execute")
    return command


def finalize_command(thread_id: str, *, execute: bool) -> list[str]:
    command = [
        sys.executable,
        str(ARCHIVE_TOOL),
        "finalize",
        "--archive-root",
        str(ARCHIVE_ROOT),
        *common_selection_arguments(),
        "--thread-id",
        thread_id,
        "--acknowledge-codex-offline",
    ]
    if execute:
        command.append("--execute")
    return command


def run_checked(command: list[str]) -> None:
    sys.stdout.flush()
    result = subprocess.run(command, cwd=REPOSITORY_ROOT, check=False)
    if result.returncode != 0:
        raise ApprovedArchiveError(
            f"archive operation stopped safely with exit code {result.returncode}"
        )


def available_bytes(path: Path) -> int:
    stats = os.statvfs(path)
    return stats.f_bavail * stats.f_frsize


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Dry-run or execute the frozen 21-thread Soulidity archive approval."
    )
    parser.add_argument("--execute", action="store_true", help="archive and remove verified sources")
    parser.add_argument(
        "--acknowledge-codex-offline",
        action="store_true",
        help="assert the Codex app and all Codex tasks are fully closed",
    )
    parser.add_argument(
        "--validate-only",
        action="store_true",
        help="only validate the frozen selection pack; do not scan sessions",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    try:
        args = parse_args(argv)
        approved = load_approved_selection()
        print(
            f"Frozen approval valid: {len(approved)} threads, "
            f"{human_bytes(EXPECTED_TOTAL_BYTES)}",
            flush=True,
        )
        print(f"Archive root (fixed): {ARCHIVE_ROOT}", flush=True)
        if args.validate_only:
            return 0
        if args.execute and not args.acknowledge_codex_offline:
            raise ApprovedArchiveError(
                "--execute also requires --acknowledge-codex-offline"
            )
        free = available_bytes(SOURCE_ROOT)
        print(f"Current source-volume free space: {human_bytes(free)}")
        if free < RECOMMENDED_INITIAL_FREE_BYTES:
            print(
                "WARNING: less than the recommended 8 GiB is free; the underlying "
                "5 GiB reserve gate will refuse writes if the first file cannot fit."
            )

        if not args.execute:
            pending: list[str] = []
            for entry in approved:
                thread_id = str(entry["thread_id"])
                source = Path(str(entry["source_path"]))
                manifest_directory = ARCHIVE_ROOT / "manifests" / thread_id
                if manifest_directory.exists():
                    state = "finalize existing verified archive" if source.exists() else "already archived"
                    print(f"RESUME PLAN {thread_id}: {state}")
                elif source.exists():
                    pending.append(thread_id)
                else:
                    raise ApprovedArchiveError(
                        f"neither source nor manifest exists for approved thread {thread_id}"
                    )
            if pending:
                run_checked(archive_command(pending, execute=False))
            print("DRY RUN COMPLETE: no archive or source file was written or removed.")
            return 0

        completed = 0
        for entry in approved:
            thread_id = str(entry["thread_id"])
            source = Path(str(entry["source_path"]))
            manifest_directory = ARCHIVE_ROOT / "manifests" / thread_id
            if manifest_directory.exists():
                run_checked(finalize_command(thread_id, execute=True))
            else:
                if not source.exists():
                    raise ApprovedArchiveError(
                        f"source is missing without an archive manifest: {thread_id}"
                    )
                run_checked(archive_command([thread_id], execute=True))
                # If archiving completed but a late activity check retained the
                # source, finalize performs the same full verification before a
                # second removal attempt.  It is also the crash-resume path.
                if source.exists():
                    run_checked(finalize_command(thread_id, execute=True))
            if source.exists():
                raise ApprovedArchiveError(f"verified source was unexpectedly retained: {thread_id}")
            if not (manifest_directory / "manifest.json").is_file():
                raise ApprovedArchiveError(f"archive manifest is missing after success: {thread_id}")
            completed += 1
            print(f"APPROVED SET PROGRESS: {completed}/{len(approved)}")
        print(
            "APPROVED SET COMPLETE: all 21 sources were removed only after per-item "
            "archive verification; archives remain restorable."
        )
        return 0
    except (ApprovedArchiveError, OSError) as error:
        print(f"ERROR: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
