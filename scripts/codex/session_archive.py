#!/usr/bin/env python3
"""Fail-closed local archiving for old Codex subagent rollout logs.

The default operation is a read-only scan.  Archiving is also a dry run unless
--execute is supplied.  Source removal has two additional gates:
--remove-source and --acknowledge-codex-offline.

Rollout JSONL is never parsed or printed.  Commands that must verify content
treat it as an opaque byte stream for zstd compression and SHA-256 hashing.
Compressed .jsonl.zst files are not directly loadable by Codex; restore the
original .jsonl path before attempting to inspect or resume a session.

This is a conservative local maintenance tool, not a documented Codex storage
API.  Re-run a dry scan after Codex upgrades before executing an archive.
"""

from __future__ import annotations

import argparse
from collections import Counter
from contextlib import contextmanager, nullcontext
from dataclasses import dataclass
import datetime as dt
import fcntl
import hashlib
import json
import math
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import sqlite3
import stat
import subprocess
import sys
import tempfile
import time
from typing import BinaryIO, Iterator
import uuid


TOOL_NAME = "codex-session-archive"
TOOL_VERSION = "1.1.0"
MANIFEST_SCHEMA_VERSION = 1
DEFAULT_MIN_IDLE_DAYS = 7.0
DEFAULT_RESERVE_BYTES = 5 * 1024**3
MIN_SAME_VOLUME_RESERVE_BYTES = 5 * 1024**3
WORST_CASE_FLOOR_BYTES = 256 * 1024**2
COPY_BUFFER_BYTES = 8 * 1024**2
MAX_METADATA_FILE_BYTES = 1024 * 1024
UUID_PATTERN = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"
)
SHA256_PATTERN = re.compile(r"^[0-9a-f]{64}$")


class SessionArchiveError(RuntimeError):
    """A safety check or archive operation failed."""


@dataclass(frozen=True)
class ThreadRecord:
    thread_id: str
    parent_thread_id: str
    rollout_path: Path
    updated_at: float


@dataclass(frozen=True)
class FileSnapshot:
    device: int
    inode: int
    size: int
    mtime_ns: int
    ctime_ns: int
    mode: int
    uid: int
    link_count: int


@dataclass(frozen=True)
class Candidate:
    record: ThreadRecord
    relative_path: Path
    snapshot: FileSnapshot
    selection_signal: str


@dataclass(frozen=True)
class ScanResult:
    source: Path
    total_jsonl_files: int
    total_jsonl_bytes: int
    source_available_bytes: int
    child_records: int
    active_writer_ids: frozenset[str]
    candidates: tuple[Candidate, ...]
    skipped: Counter[str]


@dataclass(frozen=True)
class VerifiedArchive:
    thread_id: str
    manifest: dict[str, object]
    archive_path: Path
    archive_size: int
    archive_sha256: str
    decompressed_size: int
    decompressed_sha256: str


def utc_now() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def human_bytes(value: int) -> str:
    units = ("B", "KiB", "MiB", "GiB", "TiB")
    amount = float(value)
    for unit in units:
        if amount < 1024.0 or unit == units[-1]:
            return f"{amount:.1f} {unit}" if unit != "B" else f"{int(amount)} B"
        amount /= 1024.0
    raise AssertionError("unreachable")


def parse_byte_size(value: str) -> int:
    match = re.fullmatch(r"\s*(\d+(?:\.\d+)?)\s*([kmgt]?i?b)?\s*", value, re.IGNORECASE)
    if not match:
        raise argparse.ArgumentTypeError(f"invalid byte size: {value!r}")
    amount = float(match.group(1))
    suffix = (match.group(2) or "B").lower()
    factors = {
        "b": 1,
        "kb": 1000,
        "kib": 1024,
        "mb": 1000**2,
        "mib": 1024**2,
        "gb": 1000**3,
        "gib": 1024**3,
        "tb": 1000**4,
        "tib": 1024**4,
    }
    result = int(amount * factors[suffix])
    if result < 0:
        raise argparse.ArgumentTypeError("byte size must be non-negative")
    return result


def parse_uuid(value: str) -> str:
    normalized = value.strip().lower()
    if not UUID_PATTERN.fullmatch(normalized):
        raise argparse.ArgumentTypeError(f"invalid thread UUID: {value!r}")
    return normalized


def absolute_path(path: Path) -> Path:
    return Path(os.path.abspath(os.path.expanduser(os.fspath(path))))


def path_within(path: Path, root: Path) -> bool:
    try:
        path.relative_to(root)
        return True
    except ValueError:
        return False


def assert_no_symlink_components(path: Path, *, allow_missing: bool) -> None:
    path = absolute_path(path)
    if not path.is_absolute():
        raise SessionArchiveError(f"path must be absolute: {path}")
    cursor = Path(path.anchor)
    missing_seen = False
    for part in path.parts[1:]:
        cursor /= part
        if missing_seen:
            continue
        try:
            metadata = os.lstat(cursor)
        except FileNotFoundError:
            if not allow_missing:
                raise SessionArchiveError(f"required path does not exist: {cursor}")
            missing_seen = True
            continue
        if stat.S_ISLNK(metadata.st_mode):
            raise SessionArchiveError(f"refusing symlink path component: {cursor}")


def existing_directory(path: Path, *, private: bool = False) -> Path:
    path = absolute_path(path)
    assert_no_symlink_components(path, allow_missing=False)
    metadata = os.lstat(path)
    if not stat.S_ISDIR(metadata.st_mode):
        raise SessionArchiveError(f"not a directory: {path}")
    if metadata.st_uid != os.getuid():
        raise SessionArchiveError(f"directory is not owned by current user: {path}")
    if private and stat.S_IMODE(metadata.st_mode) & 0o077:
        raise SessionArchiveError(f"directory must not be accessible by group/others: {path}")
    return path


def existing_regular_file(path: Path) -> Path:
    path = absolute_path(path)
    assert_no_symlink_components(path, allow_missing=False)
    metadata = os.lstat(path)
    if not stat.S_ISREG(metadata.st_mode):
        raise SessionArchiveError(f"not a regular file: {path}")
    if metadata.st_uid != os.getuid():
        raise SessionArchiveError(f"file is not owned by current user: {path}")
    return path


def nearest_existing_ancestor(path: Path) -> Path:
    cursor = absolute_path(path)
    while True:
        try:
            os.lstat(cursor)
            return cursor
        except FileNotFoundError:
            parent = cursor.parent
            if parent == cursor:
                raise SessionArchiveError(f"no existing ancestor for {path}")
            cursor = parent


def available_bytes(path: Path) -> int:
    stats = os.statvfs(path)
    return stats.f_bavail * stats.f_frsize


def fsync_directory(path: Path) -> None:
    descriptor = os.open(path, os.O_RDONLY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def ensure_owned_directory(path: Path, *, private: bool) -> None:
    """Create a directory without following symlinks and validate its ownership."""
    path = absolute_path(path)
    assert_no_symlink_components(path, allow_missing=True)
    missing: list[Path] = []
    cursor = path
    while not cursor.exists() and not cursor.is_symlink():
        missing.append(cursor)
        if cursor.parent == cursor:
            break
        cursor = cursor.parent
    if not cursor.exists() or cursor.is_symlink():
        raise SessionArchiveError(f"cannot find a safe existing parent for {path}")
    ancestor = os.lstat(cursor)
    if not stat.S_ISDIR(ancestor.st_mode):
        raise SessionArchiveError(f"path component is not a directory: {cursor}")
    for component in reversed(missing):
        os.mkdir(component, 0o700)
        created = os.lstat(component)
        if not stat.S_ISDIR(created.st_mode) or stat.S_ISLNK(created.st_mode):
            raise SessionArchiveError(f"failed to create a plain directory: {component}")
        if created.st_uid != os.getuid():
            raise SessionArchiveError(f"created directory is not owned by current user: {component}")
    assert_no_symlink_components(path, allow_missing=False)
    metadata = os.lstat(path)
    if not stat.S_ISDIR(metadata.st_mode):
        raise SessionArchiveError(f"not a directory: {path}")
    if metadata.st_uid != os.getuid():
        raise SessionArchiveError(f"directory is not owned by current user: {path}")
    mode = stat.S_IMODE(metadata.st_mode)
    if private and mode & 0o077:
        raise SessionArchiveError(f"directory permissions are too broad ({mode:04o}): {path}")
    if not private and mode & 0o022:
        raise SessionArchiveError(f"directory is writable by group/others ({mode:04o}): {path}")


def ensure_private_directory(path: Path) -> None:
    ensure_owned_directory(path, private=True)


def snapshot_from_stat(metadata: os.stat_result) -> FileSnapshot:
    return FileSnapshot(
        device=metadata.st_dev,
        inode=metadata.st_ino,
        size=metadata.st_size,
        mtime_ns=metadata.st_mtime_ns,
        ctime_ns=metadata.st_ctime_ns,
        mode=metadata.st_mode,
        uid=metadata.st_uid,
        link_count=metadata.st_nlink,
    )


def capture_snapshot(path: Path) -> FileSnapshot:
    return snapshot_from_stat(os.lstat(path))


def validate_rollout_file(path: Path, source: Path, thread_id: str) -> tuple[Path, FileSnapshot]:
    path = absolute_path(path)
    if not path_within(path, source):
        raise SessionArchiveError("rollout path escapes the configured session source")
    assert_no_symlink_components(path, allow_missing=False)
    snapshot = capture_snapshot(path)
    if not stat.S_ISREG(snapshot.mode):
        raise SessionArchiveError("rollout path is not a regular file")
    if snapshot.uid != os.getuid():
        raise SessionArchiveError("rollout file is not owned by current user")
    if snapshot.link_count != 1:
        raise SessionArchiveError("rollout file has multiple hard links")
    if not path.name.endswith(f"{thread_id}.jsonl"):
        raise SessionArchiveError("rollout filename does not match its thread UUID")
    relative = path.relative_to(source)
    if any(part in ("", ".", "..") for part in relative.parts):
        raise SessionArchiveError("unsafe rollout relative path")
    return relative, snapshot


def normalize_epoch(value: object) -> float:
    try:
        result = float(value)
    except (TypeError, ValueError):
        return 0.0
    if result > 100_000_000_000:
        result /= 1000.0
    return result


def readonly_sqlite(path: Path) -> sqlite3.Connection:
    path = existing_regular_file(path)
    # Do not use immutable=1: a live Codex database can have current rows in WAL.
    uri = f"{path.as_uri()}?mode=ro"
    connection = sqlite3.connect(uri, uri=True, timeout=1.0)
    connection.execute("PRAGMA query_only = ON")
    return connection


def load_thread_records(state_db: Path, parent_thread: str | None) -> dict[str, ThreadRecord]:
    with readonly_sqlite(state_db) as connection:
        thread_columns = {
            row[1] for row in connection.execute("PRAGMA table_info(threads)").fetchall()
        }
        edge_columns = {
            row[1] for row in connection.execute("PRAGMA table_info(thread_spawn_edges)").fetchall()
        }
        required_threads = {"id", "rollout_path", "updated_at", "thread_source"}
        required_edges = {"parent_thread_id", "child_thread_id"}
        if not required_threads.issubset(thread_columns) or not required_edges.issubset(edge_columns):
            raise SessionArchiveError("state database lacks required thread/subagent metadata columns")
        updated_ms = "t.updated_at_ms" if "updated_at_ms" in thread_columns else "NULL"
        sql = f"""
            SELECT e.child_thread_id,
                   e.parent_thread_id,
                   t.rollout_path,
                   t.updated_at,
                   {updated_ms}
              FROM thread_spawn_edges AS e
              JOIN threads AS t ON t.id = e.child_thread_id
             WHERE t.thread_source = 'subagent'
        """
        parameters: list[object] = []
        if parent_thread is not None:
            sql += " AND e.parent_thread_id = ?"
            parameters.append(parent_thread)
        rows = connection.execute(sql, parameters).fetchall()

    records: dict[str, ThreadRecord] = {}
    for child_id, parent_id, rollout_path, updated_at, updated_at_ms in rows:
        child = str(child_id).lower()
        parent = str(parent_id).lower()
        if not UUID_PATTERN.fullmatch(child) or not UUID_PATTERN.fullmatch(parent):
            continue
        if not isinstance(rollout_path, str) or not rollout_path:
            continue
        timestamp = normalize_epoch(updated_at_ms) or normalize_epoch(updated_at)
        records[child] = ThreadRecord(
            thread_id=child,
            parent_thread_id=parent,
            rollout_path=absolute_path(Path(rollout_path)),
            updated_at=timestamp,
        )
    return records


def resolve_lsof() -> str:
    preferred = Path("/usr/sbin/lsof")
    if preferred.is_file():
        return str(preferred)
    located = shutil.which("lsof")
    if not located:
        raise SessionArchiveError("lsof is required to identify active Codex writers")
    return located


def run_lsof(arguments: list[str]) -> list[str]:
    result = subprocess.run(
        [resolve_lsof(), "-w", "-Fpn", *arguments],
        check=False,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        errors="replace",
    )
    if result.returncode not in (0, 1):
        raise SessionArchiveError(f"lsof failed with exit status {result.returncode}")
    if result.stderr.strip():
        raise SessionArchiveError("lsof reported an error; refusing to infer inactivity")
    return result.stdout.splitlines()


def active_writer_ids(lock_directory: Path) -> set[str]:
    lock_directory = existing_directory(lock_directory)
    active: set[str] = set()
    for line in run_lsof(["+D", str(lock_directory)]):
        if not line.startswith("n"):
            continue
        opened_path = absolute_path(Path(line[1:]))
        if opened_path.parent != lock_directory:
            continue
        match = re.fullmatch(r"([0-9a-f-]{36})\.lock", opened_path.name)
        if match and UUID_PATTERN.fullmatch(match.group(1)):
            active.add(match.group(1))
    return active


def rollout_open_by_other_process(path: Path, *, ignored_pids: set[int] | None = None) -> bool:
    ignored = ignored_pids or set()
    opened_by: set[int] = set()
    for line in run_lsof(["--", str(path)]):
        if line.startswith("p") and line[1:].isdigit():
            opened_by.add(int(line[1:]))
    return bool(opened_by - ignored)


def session_totals(source: Path) -> tuple[int, int]:
    count = 0
    total = 0
    for directory, directory_names, file_names in os.walk(source, followlinks=False):
        directory_path = Path(directory)
        safe_directories: list[str] = []
        for name in directory_names:
            child = directory_path / name
            metadata = os.lstat(child)
            if stat.S_ISDIR(metadata.st_mode) and not stat.S_ISLNK(metadata.st_mode):
                safe_directories.append(name)
        directory_names[:] = safe_directories
        for name in file_names:
            if not name.endswith(".jsonl"):
                continue
            path = directory_path / name
            metadata = os.lstat(path)
            if stat.S_ISREG(metadata.st_mode) and not stat.S_ISLNK(metadata.st_mode):
                count += 1
                total += metadata.st_size
    return count, total


def build_scan(args: argparse.Namespace) -> ScanResult:
    source = existing_directory(args.source)
    state_db = existing_regular_file(args.state_db)
    lock_directory = existing_directory(args.lock_dir)
    records = load_thread_records(state_db, args.parent_thread)
    completed = set(args.completed_thread_id)
    missing_completed = completed - set(records)
    if missing_completed:
        raise SessionArchiveError(
            "completed thread ID is not a matching subagent child: " + ", ".join(sorted(missing_completed))
        )

    active = active_writer_ids(lock_directory)
    protected = set(args.protect_thread)
    now = time.time()
    minimum_idle = args.min_idle_days * 86400.0
    skipped: Counter[str] = Counter()
    candidates: list[Candidate] = []

    for record in records.values():
        if record.thread_id in protected:
            skipped["explicitly-protected"] += 1
            continue
        if record.thread_id in active:
            skipped["active-writer-lock"] += 1
            continue
        try:
            relative, snapshot = validate_rollout_file(record.rollout_path, source, record.thread_id)
        except (FileNotFoundError, PermissionError, SessionArchiveError, OSError):
            skipped["missing-or-unsafe-rollout"] += 1
            continue
        if record.updated_at <= 0:
            skipped["missing-update-time"] += 1
            continue
        file_idle = now - (snapshot.mtime_ns / 1_000_000_000)
        database_idle = now - record.updated_at
        if file_idle < minimum_idle or database_idle < minimum_idle:
            skipped["recent"] += 1
            continue
        if record.thread_id in completed:
            signal = "explicit-completed-thread"
        elif args.allow_quiescent_legacy:
            signal = "quiescent-legacy"
        else:
            skipped["quiescent-legacy-opt-in-required"] += 1
            continue
        try:
            if rollout_open_by_other_process(record.rollout_path):
                skipped["rollout-open-by-process"] += 1
                continue
        except SessionArchiveError:
            raise
        candidates.append(
            Candidate(
                record=record,
                relative_path=relative,
                snapshot=snapshot,
                selection_signal=signal,
            )
        )

    total_files, total_bytes = session_totals(source)
    candidates.sort(key=lambda item: (item.snapshot.size, item.record.thread_id))
    return ScanResult(
        source=source,
        total_jsonl_files=total_files,
        total_jsonl_bytes=total_bytes,
        source_available_bytes=available_bytes(source),
        child_records=len(records),
        active_writer_ids=frozenset(active),
        candidates=tuple(candidates),
        skipped=skipped,
    )


def scan_payload(result: ScanResult, args: argparse.Namespace) -> dict[str, object]:
    return {
        "mode": "read-only",
        "source": str(result.source),
        "source_available_bytes": result.source_available_bytes,
        "total_jsonl_files": result.total_jsonl_files,
        "total_jsonl_bytes": result.total_jsonl_bytes,
        "subagent_child_records": result.child_records,
        "active_writer_locks": len(result.active_writer_ids),
        "min_idle_days": args.min_idle_days,
        "allow_quiescent_legacy": bool(args.allow_quiescent_legacy),
        "eligible": [
            {
                "thread_id": candidate.record.thread_id,
                "relative_path": candidate.relative_path.as_posix(),
                "size": candidate.snapshot.size,
                "selection_signal": candidate.selection_signal,
            }
            for candidate in result.candidates
        ],
        "skipped": dict(sorted(result.skipped.items())),
    }


def print_scan(result: ScanResult, args: argparse.Namespace) -> None:
    if getattr(args, "json", False):
        print(json.dumps(scan_payload(result, args), ensure_ascii=False, sort_keys=True, indent=2))
        return
    print("Codex session archive scan (read-only)")
    print(f"source: {result.source}")
    print(
        f"session JSONL: {result.total_jsonl_files} files, "
        f"{human_bytes(result.total_jsonl_bytes)}"
    )
    print(f"source available: {human_bytes(result.source_available_bytes)}")
    print(f"SQLite subagent child records: {result.child_records}")
    print(f"active writer locks: {len(result.active_writer_ids)}")
    print(f"minimum idle: {args.min_idle_days:g} days")
    print(f"quiescent legacy opt-in: {'yes' if args.allow_quiescent_legacy else 'no'}")
    print(f"eligible: {len(result.candidates)} files")
    if result.candidates:
        print(f"eligible bytes: {human_bytes(sum(item.snapshot.size for item in result.candidates))}")
        for candidate in result.candidates:
            print(
                f"  {candidate.record.thread_id}  {human_bytes(candidate.snapshot.size)}  "
                f"{candidate.selection_signal}  {candidate.relative_path.as_posix()}"
            )
    if result.skipped:
        print("skipped:")
        for reason, count in sorted(result.skipped.items()):
            print(f"  {reason}: {count}")


def resolve_zstd() -> str:
    located = shutil.which("zstd")
    if not located:
        raise SessionArchiveError("zstd is required for archive, verify, and restore")
    return located


def zstd_version(zstd: str) -> str:
    result = subprocess.run(
        [zstd, "--version"],
        check=False,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        errors="replace",
    )
    if result.returncode != 0:
        raise SessionArchiveError("unable to query zstd version")
    return result.stdout.strip().splitlines()[0][:200]


def safe_subprocess_error(prefix: str, result: subprocess.CompletedProcess[bytes]) -> SessionArchiveError:
    detail = result.stderr.decode("utf-8", errors="replace").strip()
    if detail:
        detail = detail[-1000:]
        return SessionArchiveError(f"{prefix}: {detail}")
    return SessionArchiveError(f"{prefix} (exit status {result.returncode})")


def sha256_descriptor(descriptor: int) -> tuple[str, int]:
    digest = hashlib.sha256()
    total = 0
    os.lseek(descriptor, 0, os.SEEK_SET)
    while True:
        chunk = os.read(descriptor, COPY_BUFFER_BYTES)
        if not chunk:
            break
        digest.update(chunk)
        total += len(chunk)
    return digest.hexdigest(), total


def sha256_path(path: Path) -> tuple[str, int]:
    flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0)
    descriptor = os.open(path, flags)
    try:
        metadata = os.fstat(descriptor)
        if not stat.S_ISREG(metadata.st_mode):
            raise SessionArchiveError(f"not a regular file: {path}")
        return sha256_descriptor(descriptor)
    finally:
        os.close(descriptor)


def compress_descriptor(
    source_descriptor: int,
    output: BinaryIO,
    *,
    zstd: str,
    level: int,
) -> tuple[str, int]:
    digest = hashlib.sha256()
    total = 0
    os.lseek(source_descriptor, 0, os.SEEK_SET)
    process = subprocess.Popen(
        [zstd, "-q", "-T0", f"-{level}", "-c"],
        stdin=subprocess.PIPE,
        stdout=output,
        stderr=subprocess.PIPE,
    )
    assert process.stdin is not None
    assert process.stderr is not None
    broken_pipe = False
    try:
        while True:
            chunk = os.read(source_descriptor, COPY_BUFFER_BYTES)
            if not chunk:
                break
            digest.update(chunk)
            total += len(chunk)
            try:
                process.stdin.write(chunk)
            except BrokenPipeError:
                broken_pipe = True
                break
    finally:
        try:
            process.stdin.close()
        except BrokenPipeError:
            broken_pipe = True
    stderr = process.stderr.read()
    return_code = process.wait()
    if broken_pipe or return_code != 0:
        detail = stderr.decode("utf-8", errors="replace").strip()[-1000:]
        raise SessionArchiveError(f"zstd compression failed: {detail or return_code}")
    output.flush()
    os.fsync(output.fileno())
    return digest.hexdigest(), total


def zstd_test(path: Path, zstd: str) -> None:
    result = subprocess.run(
        [zstd, "-q", "-t", "--", str(path)],
        check=False,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.PIPE,
    )
    if result.returncode != 0:
        raise safe_subprocess_error("zstd integrity test failed", result)


def decompressed_sha256(path: Path, zstd: str) -> tuple[str, int]:
    digest = hashlib.sha256()
    total = 0
    process = subprocess.Popen(
        [zstd, "-q", "-d", "-c", "--", str(path)],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    assert process.stdout is not None
    assert process.stderr is not None
    while True:
        chunk = process.stdout.read(COPY_BUFFER_BYTES)
        if not chunk:
            break
        digest.update(chunk)
        total += len(chunk)
    stderr = process.stderr.read()
    return_code = process.wait()
    if return_code != 0:
        detail = stderr.decode("utf-8", errors="replace").strip()[-1000:]
        raise SessionArchiveError(f"zstd decompression failed: {detail or return_code}")
    return digest.hexdigest(), total


def write_decompressed(path: Path, output: BinaryIO, zstd: str) -> tuple[str, int]:
    digest = hashlib.sha256()
    total = 0
    process = subprocess.Popen(
        [zstd, "-q", "-d", "-c", "--", str(path)],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    assert process.stdout is not None
    assert process.stderr is not None
    while True:
        chunk = process.stdout.read(COPY_BUFFER_BYTES)
        if not chunk:
            break
        digest.update(chunk)
        total += len(chunk)
        output.write(chunk)
    stderr = process.stderr.read()
    return_code = process.wait()
    if return_code != 0:
        detail = stderr.decode("utf-8", errors="replace").strip()[-1000:]
        raise SessionArchiveError(f"zstd restore failed: {detail or return_code}")
    output.flush()
    os.fsync(output.fileno())
    return digest.hexdigest(), total


def check_space(destination: Path, source_size: int, reserve_bytes: int) -> None:
    available = available_bytes(destination)
    overhead = max(WORST_CASE_FLOOR_BYTES, math.ceil(source_size * 0.02))
    required = source_size + overhead + reserve_bytes
    if available < required:
        raise SessionArchiveError(
            "insufficient destination space: "
            f"available {human_bytes(available)}, require at least {human_bytes(required)} "
            f"({human_bytes(reserve_bytes)} reserve)"
        )


def archive_paths(archive_root: Path, candidate: Candidate) -> tuple[Path, Path]:
    archive_relative = Path("objects") / candidate.relative_path
    archive_path = archive_root / Path(f"{archive_relative.as_posix()}.zst")
    manifest_directory = archive_root / "manifests" / candidate.record.thread_id
    if not path_within(archive_path, archive_root) or not path_within(manifest_directory, archive_root):
        raise SessionArchiveError("derived archive path escapes archive root")
    return archive_path, manifest_directory


def canonical_json_bytes(value: dict[str, object]) -> bytes:
    rendered = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return (rendered + "\n").encode("utf-8")


def write_exclusive(path: Path, payload: bytes, mode: int = 0o600) -> None:
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0)
    descriptor = os.open(path, flags, mode)
    try:
        with os.fdopen(descriptor, "wb", closefd=False) as handle:
            handle.write(payload)
            handle.flush()
            os.fsync(handle.fileno())
    finally:
        os.close(descriptor)


def publish_archive(partial_path: Path, final_path: Path) -> None:
    if final_path.exists():
        raise SessionArchiveError(f"archive destination already exists: {final_path}")
    os.link(partial_path, final_path, follow_symlinks=False)
    fsync_directory(final_path.parent)
    partial_path.unlink()


def publish_manifest_directory(
    archive_root: Path,
    manifest_directory: Path,
    manifest: dict[str, object],
) -> None:
    parent = manifest_directory.parent
    ensure_private_directory(parent)
    if manifest_directory.exists():
        raise SessionArchiveError(f"manifest already exists for {manifest_directory.name}")
    temporary = parent / f".{manifest_directory.name}.{uuid.uuid4().hex}.partial"
    os.mkdir(temporary, 0o700)
    try:
        manifest_bytes = canonical_json_bytes(manifest)
        manifest_hash = hashlib.sha256(manifest_bytes).hexdigest()
        write_exclusive(temporary / "manifest.json", manifest_bytes)
        sidecar = f"{manifest_hash}  manifest.json\n".encode("ascii")
        write_exclusive(temporary / "manifest.sha256", sidecar)
        fsync_directory(temporary)
        os.rename(temporary, manifest_directory)
        fsync_directory(parent)
    finally:
        if temporary.exists():
            for child in temporary.iterdir():
                child.unlink(missing_ok=True)
            temporary.rmdir()


@contextmanager
def archive_lock(archive_root: Path, *, exclusive: bool, create: bool) -> Iterator[None]:
    lock_path = archive_root / ".session-archive.lock"
    if not lock_path.exists() and not create:
        with nullcontext():
            yield
        return
    flags = os.O_RDWR | getattr(os, "O_NOFOLLOW", 0)
    if create:
        flags |= os.O_CREAT
    descriptor = os.open(lock_path, flags, 0o600)
    try:
        metadata = os.fstat(descriptor)
        if not stat.S_ISREG(metadata.st_mode) or metadata.st_uid != os.getuid():
            raise SessionArchiveError("unsafe archive lock file")
        operation = fcntl.LOCK_EX if exclusive else fcntl.LOCK_SH
        try:
            fcntl.flock(descriptor, operation | fcntl.LOCK_NB)
        except BlockingIOError as error:
            raise SessionArchiveError("another archive/verify operation is running") from error
        yield
    finally:
        os.close(descriptor)


def confirm_record_unchanged(args: argparse.Namespace, candidate: Candidate) -> bool:
    records = load_thread_records(args.state_db, args.parent_thread)
    current = records.get(candidate.record.thread_id)
    return current == candidate.record


def candidate_is_inactive(args: argparse.Namespace, candidate: Candidate) -> bool:
    active = active_writer_ids(args.lock_dir)
    if candidate.record.thread_id in active:
        return False
    return not rollout_open_by_other_process(
        candidate.record.rollout_path,
        ignored_pids={os.getpid()},
    )


def create_manifest(
    *,
    candidate: Candidate,
    archive_root: Path,
    archive_path: Path,
    source_sha256: str,
    archive_sha256: str,
    archive_size: int,
    decompressed_hash: str,
    decompressed_size: int,
    zstd_release: str,
    compression_level: int,
    min_idle_days: float,
    source_removal_requested: bool,
) -> dict[str, object]:
    return {
        "schema_version": MANIFEST_SCHEMA_VERSION,
        "tool": {"name": TOOL_NAME, "version": TOOL_VERSION},
        "created_at_utc": utc_now(),
        "thread": {
            "id": candidate.record.thread_id,
            "parent_id": candidate.record.parent_thread_id,
            "source": "subagent",
        },
        "selection": {
            "signal": candidate.selection_signal,
            "min_idle_seconds": int(min_idle_days * 86400),
        },
        "source": {
            "relative_path": candidate.relative_path.as_posix(),
            "size": candidate.snapshot.size,
            "mtime_ns": candidate.snapshot.mtime_ns,
            "ctime_ns": candidate.snapshot.ctime_ns,
            "mode": stat.S_IMODE(candidate.snapshot.mode),
            "sha256": source_sha256,
        },
        "archive": {
            "relative_path": archive_path.relative_to(archive_root).as_posix(),
            "size": archive_size,
            "sha256": archive_sha256,
            "compression": "zstd",
            "compression_level": compression_level,
            "zstd_version": zstd_release,
            "zstd_tested": True,
            "decompressed_size": decompressed_size,
            "decompressed_sha256": decompressed_hash,
        },
        "source_removal_requested": source_removal_requested,
        "codex_native_readable": False,
    }


def archive_one(
    args: argparse.Namespace,
    result: ScanResult,
    candidate: Candidate,
    archive_root: Path,
    zstd: str,
    zstd_release: str,
) -> str:
    archive_path, manifest_directory = archive_paths(archive_root, candidate)
    if archive_path.exists() or manifest_directory.exists():
        raise SessionArchiveError(
            f"archive or manifest already exists for {candidate.record.thread_id}; refusing overwrite"
        )
    if not confirm_record_unchanged(args, candidate):
        raise SessionArchiveError(f"thread metadata changed: {candidate.record.thread_id}")
    if not candidate_is_inactive(args, candidate):
        raise SessionArchiveError(f"thread became active: {candidate.record.thread_id}")
    if capture_snapshot(candidate.record.rollout_path) != candidate.snapshot:
        raise SessionArchiveError(f"rollout changed since scan: {candidate.record.thread_id}")

    ensure_private_directory(archive_path.parent)
    check_space(archive_root, candidate.snapshot.size, args.reserve_bytes)
    source_flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0)
    source_descriptor = os.open(candidate.record.rollout_path, source_flags)
    partial_path: Path | None = None
    try:
        if snapshot_from_stat(os.fstat(source_descriptor)) != candidate.snapshot:
            raise SessionArchiveError(f"rollout changed while opening: {candidate.record.thread_id}")
        temporary_descriptor, temporary_name = tempfile.mkstemp(
            prefix=f".{archive_path.name}.", suffix=".partial", dir=archive_path.parent
        )
        partial_path = Path(temporary_name)
        try:
            with os.fdopen(temporary_descriptor, "w+b") as output:
                source_hash, source_size = compress_descriptor(
                    source_descriptor,
                    output,
                    zstd=zstd,
                    level=args.compression_level,
                )
        except BaseException:
            try:
                os.close(temporary_descriptor)
            except OSError:
                pass
            raise

        if source_size != candidate.snapshot.size:
            raise SessionArchiveError("source byte count changed during compression")
        if snapshot_from_stat(os.fstat(source_descriptor)) != candidate.snapshot:
            raise SessionArchiveError("source metadata changed during compression")
        if capture_snapshot(candidate.record.rollout_path) != candidate.snapshot:
            raise SessionArchiveError("source path changed during compression")
        if not candidate_is_inactive(args, candidate):
            raise SessionArchiveError("thread became active during compression")

        zstd_test(partial_path, zstd)
        archive_hash, archive_size = sha256_path(partial_path)
        decompressed_hash, decompressed_size = decompressed_sha256(partial_path, zstd)
        if decompressed_hash != source_hash:
            raise SessionArchiveError("decompressed SHA-256 does not match source SHA-256")
        if decompressed_size != source_size:
            raise SessionArchiveError("decompressed byte count does not match source byte count")

        publish_archive(partial_path, archive_path)
        partial_path = None
        manifest = create_manifest(
            candidate=candidate,
            archive_root=archive_root,
            archive_path=archive_path,
            source_sha256=source_hash,
            archive_sha256=archive_hash,
            archive_size=archive_size,
            decompressed_hash=decompressed_hash,
            decompressed_size=decompressed_size,
            zstd_release=zstd_release,
            compression_level=args.compression_level,
            min_idle_days=args.min_idle_days,
            source_removal_requested=args.remove_source,
        )
        publish_manifest_directory(archive_root, manifest_directory, manifest)

        if not args.remove_source:
            return "retained"
        if active_writer_ids(args.lock_dir):
            return "retained (Codex became active before removal)"
        if not confirm_record_unchanged(args, candidate):
            return "retained (metadata changed before removal)"
        if not candidate_is_inactive(args, candidate):
            return "retained (thread became active before removal)"
        if capture_snapshot(candidate.record.rollout_path) != candidate.snapshot:
            return "retained (source changed before removal)"
        if snapshot_from_stat(os.fstat(source_descriptor)) != candidate.snapshot:
            return "retained (open source changed before removal)"
        os.unlink(candidate.record.rollout_path)
        fsync_directory(candidate.record.rollout_path.parent)
        return "removed"
    finally:
        os.close(source_descriptor)
        if partial_path is not None:
            partial_path.unlink(missing_ok=True)


def validate_relative_path(value: object, *, expected_suffix: str) -> Path:
    if not isinstance(value, str) or not value:
        raise SessionArchiveError("manifest contains an invalid relative path")
    pure = PurePosixPath(value)
    if pure.is_absolute() or any(part in ("", ".", "..") for part in pure.parts):
        raise SessionArchiveError("manifest relative path is unsafe")
    if not value.endswith(expected_suffix):
        raise SessionArchiveError("manifest relative path has an unexpected suffix")
    return Path(*pure.parts)


def read_small_file(path: Path) -> bytes:
    flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0)
    descriptor = os.open(path, flags)
    try:
        metadata = os.fstat(descriptor)
        if not stat.S_ISREG(metadata.st_mode):
            raise SessionArchiveError(f"metadata path is not a regular file: {path}")
        if metadata.st_size > MAX_METADATA_FILE_BYTES:
            raise SessionArchiveError(f"metadata file is unexpectedly large: {path}")
        chunks: list[bytes] = []
        remaining = metadata.st_size
        while remaining:
            chunk = os.read(descriptor, min(remaining, 64 * 1024))
            if not chunk:
                break
            chunks.append(chunk)
            remaining -= len(chunk)
        payload = b"".join(chunks)
        if len(payload) != metadata.st_size:
            raise SessionArchiveError(f"metadata file changed while reading: {path}")
        return payload
    finally:
        os.close(descriptor)


def require_dict(value: object, label: str) -> dict[str, object]:
    if not isinstance(value, dict):
        raise SessionArchiveError(f"manifest {label} must be an object")
    return value


def require_nonnegative_int(value: object, label: str) -> int:
    if not isinstance(value, int) or isinstance(value, bool) or value < 0:
        raise SessionArchiveError(f"manifest {label} must be a non-negative integer")
    return value


def require_sha256(value: object, label: str) -> str:
    if not isinstance(value, str) or not SHA256_PATTERN.fullmatch(value):
        raise SessionArchiveError(f"manifest {label} is not a SHA-256 digest")
    return value


def load_manifest(archive_root: Path, thread_id: str) -> dict[str, object]:
    manifest_directory = archive_root / "manifests" / thread_id
    assert_no_symlink_components(manifest_directory, allow_missing=False)
    manifest_path = manifest_directory / "manifest.json"
    sidecar_path = manifest_directory / "manifest.sha256"
    manifest_bytes = read_small_file(manifest_path)
    sidecar_bytes = read_small_file(sidecar_path)
    try:
        sidecar = sidecar_bytes.decode("ascii").strip()
    except UnicodeDecodeError as error:
        raise SessionArchiveError("manifest SHA-256 sidecar is not ASCII") from error
    expected_sidecar = f"{hashlib.sha256(manifest_bytes).hexdigest()}  manifest.json"
    if sidecar != expected_sidecar:
        raise SessionArchiveError(f"manifest SHA-256 mismatch for {thread_id}")
    try:
        manifest = json.loads(manifest_bytes)
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise SessionArchiveError(f"manifest JSON is invalid for {thread_id}") from error
    if not isinstance(manifest, dict):
        raise SessionArchiveError("manifest root must be an object")
    if manifest.get("schema_version") != MANIFEST_SCHEMA_VERSION:
        raise SessionArchiveError("unsupported manifest schema version")
    thread = require_dict(manifest.get("thread"), "thread")
    if thread.get("id") != thread_id or thread.get("source") != "subagent":
        raise SessionArchiveError("manifest thread identity/source mismatch")
    source = require_dict(manifest.get("source"), "source")
    archive = require_dict(manifest.get("archive"), "archive")
    validate_relative_path(source.get("relative_path"), expected_suffix=".jsonl")
    validate_relative_path(archive.get("relative_path"), expected_suffix=".jsonl.zst")
    require_nonnegative_int(source.get("size"), "source.size")
    require_nonnegative_int(source.get("mtime_ns"), "source.mtime_ns")
    require_nonnegative_int(source.get("ctime_ns"), "source.ctime_ns")
    require_nonnegative_int(source.get("mode"), "source.mode")
    require_sha256(source.get("sha256"), "source.sha256")
    require_nonnegative_int(archive.get("size"), "archive.size")
    require_sha256(archive.get("sha256"), "archive.sha256")
    require_nonnegative_int(archive.get("decompressed_size"), "archive.decompressed_size")
    require_sha256(archive.get("decompressed_sha256"), "archive.decompressed_sha256")
    if archive.get("compression") != "zstd" or archive.get("zstd_tested") is not True:
        raise SessionArchiveError("manifest does not record a tested zstd archive")
    return manifest


def verify_manifest(archive_root: Path, thread_id: str, zstd: str) -> VerifiedArchive:
    manifest = load_manifest(archive_root, thread_id)
    source = require_dict(manifest["source"], "source")
    archive = require_dict(manifest["archive"], "archive")
    archive_relative = validate_relative_path(
        archive["relative_path"], expected_suffix=".jsonl.zst"
    )
    archive_path = archive_root / archive_relative
    if not path_within(archive_path, archive_root):
        raise SessionArchiveError("manifest archive path escapes archive root")
    assert_no_symlink_components(archive_path, allow_missing=False)
    before = capture_snapshot(archive_path)
    if not stat.S_ISREG(before.mode) or before.link_count != 1:
        raise SessionArchiveError("archive is not a single-linked regular file")
    archive_hash, archive_size = sha256_path(archive_path)
    if archive_size != require_nonnegative_int(archive["size"], "archive.size"):
        raise SessionArchiveError("archive size does not match manifest")
    if archive_hash != require_sha256(archive["sha256"], "archive.sha256"):
        raise SessionArchiveError("archive SHA-256 does not match manifest")
    zstd_test(archive_path, zstd)
    decompressed_hash, decompressed_size = decompressed_sha256(archive_path, zstd)
    source_hash = require_sha256(source["sha256"], "source.sha256")
    source_size = require_nonnegative_int(source["size"], "source.size")
    if decompressed_hash != source_hash or decompressed_size != source_size:
        raise SessionArchiveError("decompressed content does not match source manifest")
    if decompressed_hash != require_sha256(
        archive["decompressed_sha256"], "archive.decompressed_sha256"
    ):
        raise SessionArchiveError("decompressed SHA-256 does not match archive manifest")
    if decompressed_size != require_nonnegative_int(
        archive["decompressed_size"], "archive.decompressed_size"
    ):
        raise SessionArchiveError("decompressed size does not match archive manifest")
    if capture_snapshot(archive_path) != before:
        raise SessionArchiveError("archive changed during verification")
    return VerifiedArchive(
        thread_id=thread_id,
        manifest=manifest,
        archive_path=archive_path,
        archive_size=archive_size,
        archive_sha256=archive_hash,
        decompressed_size=decompressed_size,
        decompressed_sha256=decompressed_hash,
    )


def manifest_thread_ids(archive_root: Path, requested: list[str]) -> list[str]:
    if requested:
        return sorted(set(requested))
    directory = archive_root / "manifests"
    assert_no_symlink_components(directory, allow_missing=False)
    ids: list[str] = []
    for child in directory.iterdir():
        if child.is_dir() and not child.is_symlink() and UUID_PATTERN.fullmatch(child.name):
            ids.append(child.name)
    return sorted(ids)


def validate_archive_root_relationship(source: Path, archive_root: Path) -> None:
    if path_within(archive_root, source) or path_within(source, archive_root):
        raise SessionArchiveError("archive root and session source must not contain one another")


def command_scan(args: argparse.Namespace) -> int:
    result = build_scan(args)
    print_scan(result, args)
    return 0


def command_archive(args: argparse.Namespace) -> int:
    result = build_scan(args)
    print_scan(result, args)
    archive_root = absolute_path(args.archive_root)
    assert_no_symlink_components(archive_root, allow_missing=True)
    validate_archive_root_relationship(result.source, archive_root)
    archive_device_path = nearest_existing_ancestor(archive_root)
    same_volume = os.lstat(result.source).st_dev == os.lstat(archive_device_path).st_dev
    print(f"archive root: {archive_root}")
    print(f"archive/source same volume: {'yes' if same_volume else 'no'}")
    print(f"archive mode: {'execute' if args.execute else 'dry-run'}")
    print(f"source removal requested: {'yes' if args.remove_source else 'no'}")
    print("Codex cannot load .jsonl.zst directly; restore the JSONL before use.")

    if not result.candidates:
        print("No eligible subagent rollout files.")
        return 0
    for candidate in result.candidates:
        archive_path, _ = archive_paths(archive_root, candidate)
        print(
            f"PLAN {candidate.record.thread_id} {human_bytes(candidate.snapshot.size)} "
            f"-> {archive_path}"
        )
    if not args.execute:
        print("DRY RUN: no archive directories/files were created and no source was removed.")
        return 0
    if same_volume and not args.allow_same_volume:
        raise SessionArchiveError(
            "executing on the source volume requires explicit --allow-same-volume"
        )
    if same_volume and args.reserve_bytes < MIN_SAME_VOLUME_RESERVE_BYTES:
        raise SessionArchiveError("same-volume execution requires at least a 5 GiB reserve")
    if args.remove_source and not args.acknowledge_codex_offline:
        raise SessionArchiveError(
            "source removal requires --acknowledge-codex-offline in addition to --remove-source"
        )
    if args.remove_source and active_writer_ids(args.lock_dir):
        raise SessionArchiveError(
            "Codex still has active writer locks; refusing source removal despite acknowledgement"
        )

    ensure_private_directory(archive_root)
    actual_same_volume = os.lstat(result.source).st_dev == os.lstat(archive_root).st_dev
    if actual_same_volume != same_volume:
        raise SessionArchiveError("archive filesystem changed while creating archive root")
    zstd = resolve_zstd()
    release = zstd_version(zstd)
    archived = 0
    removed = 0
    with archive_lock(archive_root, exclusive=True, create=True):
        for candidate in result.candidates:
            source_state = archive_one(args, result, candidate, archive_root, zstd, release)
            archived += 1
            if source_state == "removed":
                removed += 1
            print(f"ARCHIVED {candidate.record.thread_id}; source {source_state}")
    print(f"Completed: {archived} archived, {removed} source files removed.")
    return 0


def command_verify(args: argparse.Namespace) -> int:
    archive_root = existing_directory(args.archive_root, private=True)
    zstd = resolve_zstd()
    thread_ids = manifest_thread_ids(archive_root, args.thread_id)
    if not thread_ids:
        raise SessionArchiveError("no archive manifests found")
    with archive_lock(archive_root, exclusive=False, create=False):
        for thread_id in thread_ids:
            verified = verify_manifest(archive_root, thread_id, zstd)
            print(
                f"VERIFIED {verified.thread_id} "
                f"archive={human_bytes(verified.archive_size)} "
                f"restored={human_bytes(verified.decompressed_size)}"
            )
    print(f"Verified {len(thread_ids)} archive(s).")
    return 0


def finalize_source_target(
    source_root: Path,
    state_db: Path,
    thread_id: str,
    manifest: dict[str, object],
) -> tuple[Path, ThreadRecord]:
    thread = require_dict(manifest["thread"], "thread")
    parent_id = thread.get("parent_id")
    records = load_thread_records(state_db, None)
    record = records.get(thread_id)
    if record is None:
        raise SessionArchiveError(f"thread is no longer a registered subagent: {thread_id}")
    if record.parent_thread_id != parent_id:
        raise SessionArchiveError(f"thread parent changed since archive: {thread_id}")
    target = restore_target(source_root, manifest)
    if record.rollout_path != target:
        raise SessionArchiveError(f"thread rollout path changed since archive: {thread_id}")
    return target, record


def finalize_one_source(
    args: argparse.Namespace,
    archive_root: Path,
    source_root: Path,
    thread_id: str,
    zstd: str,
) -> str:
    verified = verify_manifest(archive_root, thread_id, zstd)
    target, _record = finalize_source_target(
        source_root, args.state_db, thread_id, verified.manifest
    )
    if not target.exists():
        return "already removed (archive verified)"
    relative, before = validate_rollout_file(target, source_root, thread_id)
    source_metadata = require_dict(verified.manifest["source"], "source")
    expected_relative = validate_relative_path(
        source_metadata["relative_path"], expected_suffix=".jsonl"
    )
    if relative != expected_relative:
        raise SessionArchiveError(f"source relative path changed: {thread_id}")
    expected_size = require_nonnegative_int(source_metadata["size"], "source.size")
    expected_mtime = require_nonnegative_int(source_metadata["mtime_ns"], "source.mtime_ns")
    expected_ctime = require_nonnegative_int(source_metadata["ctime_ns"], "source.ctime_ns")
    expected_mode = require_nonnegative_int(source_metadata["mode"], "source.mode")
    expected_hash = require_sha256(source_metadata["sha256"], "source.sha256")
    if (
        before.size != expected_size
        or before.mtime_ns != expected_mtime
        or before.ctime_ns != expected_ctime
        or stat.S_IMODE(before.mode) != expected_mode
    ):
        raise SessionArchiveError(f"source metadata no longer matches archive: {thread_id}")
    if rollout_open_by_other_process(target):
        raise SessionArchiveError(f"source is open by a process: {thread_id}")

    flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0)
    descriptor = os.open(target, flags)
    try:
        if snapshot_from_stat(os.fstat(descriptor)) != before:
            raise SessionArchiveError(f"source changed while opening: {thread_id}")
        source_hash, source_size = sha256_descriptor(descriptor)
        if source_hash != expected_hash or source_size != expected_size:
            raise SessionArchiveError(f"source content no longer matches archive: {thread_id}")
        if capture_snapshot(target) != before:
            raise SessionArchiveError(f"source changed during final verification: {thread_id}")
        if rollout_open_by_other_process(target, ignored_pids={os.getpid()}):
            raise SessionArchiveError(f"source became active: {thread_id}")
        if not args.execute:
            return "verified; retained by dry-run"
        if active_writer_ids(args.lock_dir):
            raise SessionArchiveError("Codex acquired an active writer lock; refusing removal")
        # Re-read the DB at the last possible point before unlinking so a
        # resumed/replaced thread cannot inherit the archived path unnoticed.
        current_target, _current_record = finalize_source_target(
            source_root, args.state_db, thread_id, verified.manifest
        )
        if current_target != target or capture_snapshot(target) != before:
            raise SessionArchiveError(f"source or metadata changed before removal: {thread_id}")
        if snapshot_from_stat(os.fstat(descriptor)) != before:
            raise SessionArchiveError(f"open source changed before removal: {thread_id}")
        os.unlink(target)
        fsync_directory(target.parent)
        return "removed after existing archive verification"
    finally:
        os.close(descriptor)


def command_finalize(args: argparse.Namespace) -> int:
    archive_root = existing_directory(args.archive_root, private=True)
    source_root = existing_directory(args.source)
    state_db = existing_regular_file(args.state_db)
    lock_dir = existing_directory(args.lock_dir)
    args.state_db = state_db
    args.lock_dir = lock_dir
    validate_archive_root_relationship(source_root, archive_root)
    if args.execute and not args.acknowledge_codex_offline:
        raise SessionArchiveError(
            "source removal requires --acknowledge-codex-offline with --execute"
        )
    active = active_writer_ids(lock_dir)
    if args.execute and active:
        raise SessionArchiveError(
            "Codex still has active writer locks; refusing source finalization"
        )
    zstd = resolve_zstd()
    mode = "execute" if args.execute else "dry-run"
    print(f"Finalize mode: {mode}")
    print(f"Archive root: {archive_root}")
    print(f"Source root: {source_root}")
    print(f"Requested threads: {len(args.thread_id)}")
    removed = 0
    with archive_lock(archive_root, exclusive=True, create=False):
        for thread_id in sorted(set(args.thread_id)):
            state = finalize_one_source(
                args, archive_root, source_root, thread_id, zstd
            )
            if state.startswith("removed"):
                removed += 1
            print(f"FINALIZE {thread_id}: {state}")
    if not args.execute:
        print("DRY RUN: archives and matching sources verified; no source was removed.")
    else:
        print(f"Finalized {len(set(args.thread_id))} archive(s); removed {removed} source file(s).")
    return 0


def restore_target(source_root: Path, manifest: dict[str, object]) -> Path:
    source = require_dict(manifest["source"], "source")
    relative = validate_relative_path(source["relative_path"], expected_suffix=".jsonl")
    target = source_root / relative
    if not path_within(target, source_root):
        raise SessionArchiveError("restore target escapes session source")
    assert_no_symlink_components(target, allow_missing=True)
    return target


def command_restore(args: argparse.Namespace) -> int:
    archive_root = existing_directory(args.archive_root, private=True)
    source_root = existing_directory(args.source)
    validate_archive_root_relationship(source_root, archive_root)
    zstd = resolve_zstd()
    with archive_lock(archive_root, exclusive=False, create=False):
        verified = verify_manifest(archive_root, args.thread_id, zstd)
        target = restore_target(source_root, verified.manifest)
        source_metadata = require_dict(verified.manifest["source"], "source")
        expected_hash = require_sha256(source_metadata["sha256"], "source.sha256")
        expected_size = require_nonnegative_int(source_metadata["size"], "source.size")
        if target.exists():
            assert_no_symlink_components(target, allow_missing=False)
            current_hash, current_size = sha256_path(target)
            if current_hash == expected_hash and current_size == expected_size:
                print(f"ALREADY RESTORED {args.thread_id}: {target}")
                return 0
            raise SessionArchiveError(f"restore target already exists with different content: {target}")
        print(f"RESTORE PLAN {args.thread_id}: {verified.archive_path} -> {target}")
        if not args.execute:
            print("DRY RUN: archive verified; no JSONL was written.")
            return 0

        check_space(source_root, expected_size, args.reserve_bytes)
        # Codex normally creates its session date directories as 0755.  Allow
        # existing owner-controlled directories while still rejecting any
        # group/world-writable or symlinked component.
        ensure_owned_directory(target.parent, private=False)
        temporary_descriptor, temporary_name = tempfile.mkstemp(
            prefix=f".{target.name}.", suffix=".restore.partial", dir=target.parent
        )
        temporary = Path(temporary_name)
        try:
            with os.fdopen(temporary_descriptor, "w+b") as output:
                restored_hash, restored_size = write_decompressed(
                    verified.archive_path, output, zstd
                )
                if restored_hash != expected_hash or restored_size != expected_size:
                    raise SessionArchiveError("restored JSONL does not match manifest")
                mode = require_nonnegative_int(source_metadata["mode"], "source.mode") & 0o777
                os.fchmod(output.fileno(), mode)
            mtime_ns = require_nonnegative_int(source_metadata["mtime_ns"], "source.mtime_ns")
            os.utime(temporary, ns=(mtime_ns, mtime_ns), follow_symlinks=False)
            os.link(temporary, target, follow_symlinks=False)
            fsync_directory(target.parent)
            temporary.unlink()
        finally:
            temporary.unlink(missing_ok=True)
        print(f"RESTORED {args.thread_id}: {target}")
    return 0


def add_selection_arguments(parser: argparse.ArgumentParser) -> None:
    parser.add_argument(
        "--source",
        type=Path,
        default=Path.home() / ".codex" / "sessions",
        help="Codex session source (default: ~/.codex/sessions)",
    )
    parser.add_argument(
        "--state-db",
        type=Path,
        default=Path.home() / ".codex" / "state_5.sqlite",
        help="Codex state SQLite database opened immutable/read-only",
    )
    parser.add_argument(
        "--lock-dir",
        type=Path,
        default=Path.home() / ".codex" / "thread-writer-locks",
        help="Codex thread writer lock directory",
    )
    parser.add_argument(
        "--min-idle-days",
        type=float,
        default=DEFAULT_MIN_IDLE_DAYS,
        help="minimum DB and file idle age (default: 7 days)",
    )
    parser.add_argument(
        "--allow-quiescent-legacy",
        action="store_true",
        help="explicitly allow aged/no-writer legacy children without a terminal ledger",
    )
    parser.add_argument(
        "--completed-thread-id",
        type=parse_uuid,
        action="append",
        default=[],
        help="known-terminal child thread UUID; repeatable",
    )
    parser.add_argument(
        "--protect-thread",
        type=parse_uuid,
        action="append",
        default=[],
        help="thread UUID that must never be selected; repeatable",
    )
    parser.add_argument(
        "--parent-thread",
        type=parse_uuid,
        help="limit selection to direct children of one parent thread",
    )


def validate_args(args: argparse.Namespace) -> None:
    if hasattr(args, "min_idle_days") and args.min_idle_days < 0:
        raise SessionArchiveError("--min-idle-days must be non-negative")
    if hasattr(args, "compression_level") and not 1 <= args.compression_level <= 19:
        raise SessionArchiveError("--compression-level must be between 1 and 19")
    if hasattr(args, "reserve_bytes") and args.reserve_bytes < 0:
        raise SessionArchiveError("--reserve must be non-negative")


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Safely scan, archive, verify, and restore old Codex subagent JSONL. "
            "The default command is a read-only scan."
        )
    )
    parser.add_argument("--version", action="version", version=f"%(prog)s {TOOL_VERSION}")
    subparsers = parser.add_subparsers(dest="command", required=True)

    scan = subparsers.add_parser("scan", help="read-only session health and eligibility scan")
    add_selection_arguments(scan)
    scan.add_argument("--json", action="store_true", help="emit metadata-only JSON")
    scan.set_defaults(handler=command_scan)

    archive = subparsers.add_parser("archive", help="create verified zstd archives; dry-run by default")
    add_selection_arguments(archive)
    archive.add_argument("--archive-root", type=Path, required=True, help="archive destination root")
    archive.add_argument("--execute", action="store_true", help="perform archive writes")
    archive.add_argument(
        "--remove-source",
        action="store_true",
        help="after verified durable archive+manifest, remove original JSONL",
    )
    archive.add_argument(
        "--acknowledge-codex-offline",
        action="store_true",
        help="assert Codex is offline; required with --execute --remove-source",
    )
    archive.add_argument(
        "--allow-same-volume",
        action="store_true",
        help="explicitly permit source/archive on the same filesystem",
    )
    archive.add_argument(
        "--reserve",
        dest="reserve_bytes",
        type=parse_byte_size,
        default=DEFAULT_RESERVE_BYTES,
        help="free bytes to retain after worst-case temporary output (default: 5GiB)",
    )
    archive.add_argument(
        "--compression-level",
        type=int,
        default=6,
        help="zstd compression level 1-19 (default: 6)",
    )
    archive.set_defaults(handler=command_archive, json=False)

    verify = subparsers.add_parser("verify", help="verify manifest, zstd frame, hashes, and sizes")
    verify.add_argument("--archive-root", type=Path, required=True, help="archive destination root")
    verify.add_argument(
        "--thread-id",
        type=parse_uuid,
        action="append",
        default=[],
        help="archive thread UUID; repeatable; default verifies all",
    )
    verify.set_defaults(handler=command_verify)

    finalize = subparsers.add_parser(
        "finalize",
        help="verify existing archives and remove matching sources; dry-run by default",
    )
    finalize.add_argument(
        "--archive-root", type=Path, required=True, help="existing archive destination root"
    )
    finalize.add_argument(
        "--thread-id",
        type=parse_uuid,
        action="append",
        required=True,
        help="archive thread UUID to finalize; repeatable",
    )
    finalize.add_argument(
        "--source",
        type=Path,
        default=Path.home() / ".codex" / "sessions",
        help="Codex session source (default: ~/.codex/sessions)",
    )
    finalize.add_argument(
        "--state-db",
        type=Path,
        default=Path.home() / ".codex" / "state_5.sqlite",
        help="Codex state SQLite database opened read-only",
    )
    finalize.add_argument(
        "--lock-dir",
        type=Path,
        default=Path.home() / ".codex" / "thread-writer-locks",
        help="Codex thread writer lock directory",
    )
    finalize.add_argument("--execute", action="store_true", help="remove verified sources")
    finalize.add_argument(
        "--acknowledge-codex-offline",
        action="store_true",
        help="assert Codex is offline; required with --execute",
    )
    finalize.set_defaults(handler=command_finalize)

    restore = subparsers.add_parser("restore", help="restore one JSONL; dry-run and no-overwrite")
    restore.add_argument("--archive-root", type=Path, required=True, help="archive destination root")
    restore.add_argument("--thread-id", type=parse_uuid, required=True, help="archive thread UUID")
    restore.add_argument(
        "--source",
        type=Path,
        default=Path.home() / ".codex" / "sessions",
        help="restore session root (default: ~/.codex/sessions)",
    )
    restore.add_argument("--execute", action="store_true", help="write the restored JSONL")
    restore.add_argument(
        "--reserve",
        dest="reserve_bytes",
        type=parse_byte_size,
        default=DEFAULT_RESERVE_BYTES,
        help="free bytes to retain beyond restored size (default: 5GiB)",
    )
    restore.set_defaults(handler=command_restore)
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    arguments = list(sys.argv[1:] if argv is None else argv)
    if not arguments:
        arguments = ["scan"]
    try:
        args = parse_args(arguments)
        validate_args(args)
        previous_umask = os.umask(0o077)
        try:
            return int(args.handler(args))
        finally:
            os.umask(previous_umask)
    except KeyboardInterrupt:
        print("ERROR: interrupted; source files were not removed without completed verification", file=sys.stderr)
        return 130
    except (SessionArchiveError, OSError, sqlite3.Error) as error:
        print(f"ERROR: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
