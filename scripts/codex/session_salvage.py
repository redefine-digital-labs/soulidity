#!/usr/bin/env python3
"""Recover bounded, sanitized conclusions from selected Codex subagent logs.

The command is a dry run unless ``--execute`` is supplied.  It only inspects
explicitly named, old, inactive subagent rollout files and only considers
assistant/agent message records near the end of each JSONL.  Prompts,
reasoning, tool calls, tool outputs, world state, and binary/image payloads are
never copied into the recovery pack.

This is a best-effort conclusion salvage tool, not a Codex session reader.  A
full verified ``.jsonl.zst`` archive remains necessary for exact restoration.
"""

from __future__ import annotations

import argparse
from dataclasses import dataclass
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import re
import sqlite3
import stat
import subprocess
import sys
import tempfile
from typing import Iterable
import uuid


TOOL_VERSION = "1.0.0"
DEFAULT_MIN_IDLE_DAYS = 7.0
DEFAULT_TAIL_BYTES = 64 * 1024**2
DEFAULT_MAX_RECORD_BYTES = 4 * 1024**2
DEFAULT_MAX_MESSAGES = 8
DEFAULT_MAX_TEXT_BYTES = 24 * 1024
MAX_PACK_BYTES = 1024 * 1024
UUID_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"
)
SECRET_WORDS = (
    "api[_-]?key|token|secret|password|passwd|authorization|private[_-]?key|"
    "mnemonic|seed[_-]?phrase|client[_-]?secret"
)
PEM_RE = re.compile(
    r"-----BEGIN [^-\n]+-----.*?-----END [^-\n]+-----", re.IGNORECASE | re.DOTALL
)
BEARER_RE = re.compile(r"(?i)\bBearer\s+[A-Za-z0-9._~+/=-]{12,}")
SECRET_ASSIGN_RE = re.compile(
    rf"(?i)(\b(?:{SECRET_WORDS})\b\s*(?:=|:)\s*)([^\s,;]+|\"[^\"]*\"|'[^']*')"
)
LONG_BLOB_RE = re.compile(r"(?<![A-Za-z0-9+/=])[A-Za-z0-9+/=_-]{160,}(?![A-Za-z0-9+/=])")
DATA_URL_RE = re.compile(r"data:[^\s,;]+;base64,[A-Za-z0-9+/=\r\n]+", re.IGNORECASE)
SENSITIVE_QUERY_RE = re.compile(
    rf"(?i)([?&](?:{SECRET_WORDS})=)[^&#\s]+"
)


class SalvageError(RuntimeError):
    """A fail-closed validation or extraction error."""


@dataclass(frozen=True)
class Snapshot:
    device: int
    inode: int
    size: int
    mtime_ns: int
    ctime_ns: int
    mode: int
    uid: int
    links: int


@dataclass(frozen=True)
class ThreadRecord:
    thread_id: str
    parent_thread_id: str
    rollout_path: Path
    agent_path: str
    updated_at: float


@dataclass(frozen=True)
class RecoveredMessage:
    timestamp: str
    source_kind: str
    text: str
    sha256: str


@dataclass(frozen=True)
class Recovery:
    record: ThreadRecord
    snapshot: Snapshot
    scanned_bytes: int
    skipped_oversized_records: int
    terminal_signal: str
    messages: tuple[RecoveredMessage, ...]


def absolute(path: Path) -> Path:
    return Path(os.path.abspath(os.path.expanduser(os.fspath(path))))


def path_within(path: Path, root: Path) -> bool:
    try:
        path.relative_to(root)
        return True
    except ValueError:
        return False


def parse_uuid(value: str) -> str:
    normalized = value.strip().lower()
    if not UUID_RE.fullmatch(normalized):
        raise argparse.ArgumentTypeError(f"invalid thread UUID: {value!r}")
    return normalized


def human_bytes(value: int) -> str:
    amount = float(value)
    for unit in ("B", "KiB", "MiB", "GiB", "TiB"):
        if amount < 1024 or unit == "TiB":
            return f"{int(amount)} B" if unit == "B" else f"{amount:.1f} {unit}"
        amount /= 1024
    raise AssertionError("unreachable")


def snapshot(path: Path) -> Snapshot:
    metadata = os.lstat(path)
    return Snapshot(
        device=metadata.st_dev,
        inode=metadata.st_ino,
        size=metadata.st_size,
        mtime_ns=metadata.st_mtime_ns,
        ctime_ns=metadata.st_ctime_ns,
        mode=metadata.st_mode,
        uid=metadata.st_uid,
        links=metadata.st_nlink,
    )


def assert_plain_file(path: Path, source: Path, thread_id: str) -> Snapshot:
    if not path_within(path, source):
        raise SalvageError(f"rollout is outside source root: {thread_id}")
    if path.is_symlink() or not path.name.endswith(f"{thread_id}.jsonl"):
        raise SalvageError(f"unsafe rollout path: {thread_id}")
    state = snapshot(path)
    if not stat.S_ISREG(state.mode) or state.uid != os.getuid() or state.links != 1:
        raise SalvageError(f"unsafe rollout metadata: {thread_id}")
    return state


def rollout_is_open(path: Path) -> bool:
    command = ["/usr/sbin/lsof", "-w", "-Fpn", "--", os.fspath(path)]
    try:
        result = subprocess.run(command, capture_output=True, text=True, check=False)
    except OSError as error:
        raise SalvageError(f"cannot run lsof: {error}") from error
    if result.returncode not in (0, 1):
        raise SalvageError(f"lsof failed for {path}")
    observed = {
        int(line[1:])
        for line in result.stdout.splitlines()
        if line.startswith("p") and line[1:].isdigit()
    }
    # The post-read race check runs while this process deliberately holds a
    # read-only descriptor.  Ignore only that known descriptor owner; any
    # other PID remains a fail-closed active-use signal.
    return any(process_id != os.getpid() for process_id in observed)


def load_records(state_db: Path, thread_ids: list[str]) -> dict[str, ThreadRecord]:
    uri = f"file:{state_db}?mode=ro"
    try:
        connection = sqlite3.connect(uri, uri=True)
        connection.execute("PRAGMA query_only=ON")
        placeholders = ",".join("?" for _ in thread_ids)
        rows = connection.execute(
            f"""
            SELECT c.id, e.parent_thread_id, c.rollout_path,
                   COALESCE(c.agent_path, c.agent_nickname, c.name, ''),
                   COALESCE(c.updated_at_ms / 1000.0, c.updated_at)
            FROM threads AS c
            JOIN thread_spawn_edges AS e ON e.child_thread_id = c.id
            WHERE c.id IN ({placeholders}) AND c.thread_source = 'subagent'
            """,
            thread_ids,
        ).fetchall()
    except sqlite3.Error as error:
        raise SalvageError(f"cannot read Codex state database: {error}") from error
    finally:
        if "connection" in locals():
            connection.close()
    records: dict[str, ThreadRecord] = {}
    for row in rows:
        records[row[0]] = ThreadRecord(
            thread_id=row[0],
            parent_thread_id=row[1],
            rollout_path=absolute(Path(row[2])),
            agent_path=row[3] or f"subagent-{row[0][:8]}",
            updated_at=float(row[4]),
        )
    missing = sorted(set(thread_ids) - records.keys())
    if missing:
        raise SalvageError("IDs are not registered subagents: " + ", ".join(missing))
    return records


def sanitize(text: str) -> str:
    value = text.replace("/Users/naoer", "~")
    value = PEM_RE.sub("[REDACTED PRIVATE MATERIAL]", value)
    value = DATA_URL_RE.sub("[REDACTED DATA URL]", value)
    value = BEARER_RE.sub("Bearer [REDACTED]", value)
    value = SECRET_ASSIGN_RE.sub(lambda match: match.group(1) + "[REDACTED]", value)
    value = SENSITIVE_QUERY_RE.sub(lambda match: match.group(1) + "[REDACTED]", value)
    value = LONG_BLOB_RE.sub("[REDACTED LONG ENCODED VALUE]", value)
    return value.replace("\x00", "�").strip()


def message_text(payload: dict[str, object], outer_type: str) -> tuple[str, str] | None:
    payload_type = payload.get("type")
    if outer_type == "event_msg" and payload_type == "agent_message":
        message = payload.get("message")
        return ("agent_message", message) if isinstance(message, str) else None
    if outer_type == "response_item" and payload_type == "message":
        if payload.get("role") != "assistant":
            return None
        content = payload.get("content")
        fragments: list[str] = []
        if isinstance(content, str):
            fragments.append(content)
        elif isinstance(content, list):
            for item in content:
                if isinstance(item, dict) and item.get("type") in ("output_text", "text"):
                    text = item.get("text")
                    if isinstance(text, str):
                        fragments.append(text)
        return ("assistant_message", "\n".join(fragments)) if fragments else None
    if outer_type == "response_item" and payload_type == "agent_message":
        content = payload.get("content")
        return ("inter_agent_message", content) if isinstance(content, str) else None
    return None


def tail_records(
    descriptor: int,
    size: int,
    *,
    tail_bytes: int,
    max_record_bytes: int,
) -> tuple[list[dict[str, object]], int, int]:
    requested = min(size, tail_bytes)
    start = size - requested
    data = os.pread(descriptor, requested, start)
    if start:
        newline = data.find(b"\n")
        data = b"" if newline < 0 else data[newline + 1 :]
    records: list[dict[str, object]] = []
    oversized = 0
    for raw in data.splitlines():
        if len(raw) > max_record_bytes:
            oversized += 1
            continue
        try:
            value = json.loads(raw)
        except (UnicodeDecodeError, json.JSONDecodeError):
            continue
        if isinstance(value, dict):
            records.append(value)
    return records, len(data), oversized


def recover_one(
    record: ThreadRecord,
    source: Path,
    *,
    min_idle_days: float,
    tail_bytes: int,
    max_record_bytes: int,
    max_messages: int,
    max_text_bytes: int,
) -> Recovery:
    before = assert_plain_file(record.rollout_path, source, record.thread_id)
    cutoff = dt.datetime.now(dt.timezone.utc).timestamp() - min_idle_days * 86400
    if max(record.updated_at, before.mtime_ns / 1_000_000_000) > cutoff:
        raise SalvageError(f"rollout is too recent: {record.thread_id}")
    if rollout_is_open(record.rollout_path):
        raise SalvageError(f"rollout is open by a process: {record.thread_id}")
    flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0)
    descriptor = os.open(record.rollout_path, flags)
    try:
        if snapshot_from_fd(descriptor) != before:
            raise SalvageError(f"rollout changed while opening: {record.thread_id}")
        records, scanned_bytes, oversized = tail_records(
            descriptor,
            before.size,
            tail_bytes=tail_bytes,
            max_record_bytes=max_record_bytes,
        )
        candidates: list[RecoveredMessage] = []
        terminal_signal = "unknown"
        seen: set[str] = set()
        for value in records:
            outer_type = value.get("type")
            payload = value.get("payload")
            if not isinstance(outer_type, str) or not isinstance(payload, dict):
                continue
            if outer_type == "event_msg" and payload.get("type") == "turn_aborted":
                terminal_signal = "turn_aborted"
            extracted = message_text(payload, outer_type)
            if extracted is None:
                continue
            kind, raw_text = extracted
            clean = sanitize(raw_text)
            if not clean:
                continue
            digest = hashlib.sha256(clean.encode("utf-8")).hexdigest()
            if digest in seen:
                continue
            seen.add(digest)
            candidates.append(
                RecoveredMessage(
                    timestamp=str(value.get("timestamp", "")),
                    source_kind=kind,
                    text=clean,
                    sha256=digest,
                )
            )
        selected: list[RecoveredMessage] = []
        used = 0
        for item in reversed(candidates):
            encoded = item.text.encode("utf-8")
            remaining = max_text_bytes - used
            if remaining <= 0 or len(selected) >= max_messages:
                break
            if len(encoded) > remaining:
                if not selected:
                    clipped = encoded[:remaining].decode("utf-8", "ignore").rstrip()
                    clipped += "\n\n[RECOVERY TEXT TRUNCATED]"
                    item = RecoveredMessage(
                        timestamp=item.timestamp,
                        source_kind=item.source_kind,
                        text=clipped,
                        sha256=item.sha256,
                    )
                    selected.append(item)
                break
            selected.append(item)
            used += len(encoded)
        selected.reverse()
        if snapshot_from_fd(descriptor) != before or snapshot(record.rollout_path) != before:
            raise SalvageError(f"rollout changed during extraction: {record.thread_id}")
        if rollout_is_open(record.rollout_path):
            raise SalvageError(f"rollout became active: {record.thread_id}")
        return Recovery(
            record=record,
            snapshot=before,
            scanned_bytes=scanned_bytes,
            skipped_oversized_records=oversized,
            terminal_signal=terminal_signal,
            messages=tuple(selected),
        )
    finally:
        os.close(descriptor)


def snapshot_from_fd(descriptor: int) -> Snapshot:
    metadata = os.fstat(descriptor)
    return Snapshot(
        device=metadata.st_dev,
        inode=metadata.st_ino,
        size=metadata.st_size,
        mtime_ns=metadata.st_mtime_ns,
        ctime_ns=metadata.st_ctime_ns,
        mode=metadata.st_mode,
        uid=metadata.st_uid,
        links=metadata.st_nlink,
    )


def slug(record: ThreadRecord) -> str:
    parts = [part for part in record.agent_path.split("/") if part and part != "root"]
    base = "--".join(parts) or f"subagent-{record.thread_id[:8]}"
    safe = re.sub(r"[^A-Za-z0-9._-]+", "-", base).strip(".-")
    return f"{safe}-{record.thread_id[:8]}"


def quote_markdown(text: str) -> str:
    return "\n".join(">" if not line else f"> {line}" for line in text.splitlines())


def recovery_markdown(item: Recovery) -> str:
    lines = [
        f"# {item.record.agent_path}",
        "",
        f"- Thread ID: `{item.record.thread_id}`",
        f"- Parent thread ID: `{item.record.parent_thread_id}`",
        f"- Source: `{item.record.rollout_path}`",
        f"- Source size: {human_bytes(item.snapshot.size)} ({item.snapshot.size} bytes)",
        f"- Source mtime ns: `{item.snapshot.mtime_ns}`",
        f"- Tail inspected: {human_bytes(item.scanned_bytes)}",
        f"- Oversized non-message records skipped: {item.skipped_oversized_records}",
        f"- Tail terminal signal: `{item.terminal_signal}`",
        f"- Recovered message count: {len(item.messages)}",
        "",
        "Only sanitized agent/assistant messages are included below. Prompts, reasoning, tool",
        "calls, tool outputs, world state, and binary payloads were excluded.",
        "",
    ]
    if not item.messages:
        lines.extend(
            [
                "## Recovery result",
                "",
                "No bounded agent conclusion message was recoverable from the inspected tail.",
                "Keep the full compressed archive for this thread.",
                "",
            ]
        )
    for index, message in enumerate(item.messages, start=1):
        lines.extend(
            [
                f"## Recovered message {index}",
                "",
                f"- Timestamp: `{message.timestamp or 'unknown'}`",
                f"- Record kind: `{message.source_kind}`",
                f"- Sanitized text SHA-256: `{message.sha256}`",
                "",
                quote_markdown(message.text),
                "",
            ]
        )
    return "\n".join(lines).rstrip() + "\n"


def selection_manifest(recoveries: Iterable[Recovery], source: Path) -> dict[str, object]:
    items = list(recoveries)
    return {
        "schema_version": 1,
        "tool": {"name": "codex-session-salvage", "version": TOOL_VERSION},
        "created_at_utc": dt.datetime.now(dt.timezone.utc)
        .isoformat(timespec="seconds")
        .replace("+00:00", "Z"),
        "source_root": os.fspath(source),
        "total_threads": len(items),
        "total_source_bytes": sum(item.snapshot.size for item in items),
        "threads": [
            {
                "thread_id": item.record.thread_id,
                "parent_thread_id": item.record.parent_thread_id,
                "agent_path": item.record.agent_path,
                "source_path": os.fspath(item.record.rollout_path),
                "source_size": item.snapshot.size,
                "source_mtime_ns": item.snapshot.mtime_ns,
                "recovered_messages": len(item.messages),
                "terminal_signal": item.terminal_signal,
                "summary_file": f"{slug(item.record)}.md",
            }
            for item in items
        ],
    }


def index_markdown(recoveries: list[Recovery]) -> str:
    total = sum(item.snapshot.size for item in recoveries)
    lines = [
        "# Recovered Codex subagent conclusions",
        "",
        "This pack contains bounded, sanitized conclusion messages recovered from explicitly",
        "selected old subagent rollout logs. It is a review aid, not a full session backup and",
        "not authority over current source, tests, commits, or specifications.",
        "",
        f"- Selected threads: {len(recoveries)}",
        f"- Original source bytes: {total} ({human_bytes(total)})",
        f"- Threads with recovered messages: {sum(bool(item.messages) for item in recoveries)}",
        "- Raw rollout files changed or removed: no",
        "- Full restoration requires the separately verified `.jsonl.zst` archive.",
        "",
        "| Agent | Source size | Messages | Tail state | Recovery file |",
        "|---|---:|---:|---|---|",
    ]
    for item in sorted(recoveries, key=lambda value: value.snapshot.size, reverse=True):
        filename = f"{slug(item.record)}.md"
        label = item.record.agent_path.replace("|", "\\|")
        lines.append(
            f"| `{label}` | {human_bytes(item.snapshot.size)} | {len(item.messages)} | "
            f"`{item.terminal_signal}` | [{filename}]({filename}) |"
        )
    lines.extend(
        [
            "",
            "Review every recovered item against current repository files and tests before",
            "treating an old conclusion as true. Never delete a raw rollout solely because a",
            "message appears in this pack.",
            "",
        ]
    )
    return "\n".join(lines)


def write_exclusive(path: Path, payload: bytes) -> None:
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o644)
    try:
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(payload)
            handle.flush()
            os.fsync(handle.fileno())
    except BaseException:
        try:
            os.close(descriptor)
        except OSError:
            pass
        raise


def publish_pack(output_dir: Path, recoveries: list[Recovery], source: Path) -> None:
    if output_dir.exists():
        raise SalvageError(f"output already exists; refusing overwrite: {output_dir}")
    output_parent = output_dir.parent
    output_parent.mkdir(parents=True, exist_ok=True)
    temporary = Path(
        tempfile.mkdtemp(prefix=f".{output_dir.name}.", suffix=".partial", dir=output_parent)
    )
    try:
        payloads: dict[str, bytes] = {
            "README.md": index_markdown(recoveries).encode("utf-8"),
            "selection.json": (
                json.dumps(selection_manifest(recoveries, source), indent=2, sort_keys=True)
                + "\n"
            ).encode("utf-8"),
        }
        for item in recoveries:
            payloads[f"{slug(item.record)}.md"] = recovery_markdown(item).encode("utf-8")
        total = sum(len(value) for value in payloads.values())
        if total > MAX_PACK_BYTES:
            raise SalvageError(
                f"recovery pack exceeds {human_bytes(MAX_PACK_BYTES)} safety limit"
            )
        for name, payload in payloads.items():
            write_exclusive(temporary / name, payload)
        os.rename(temporary, output_dir)
        directory_descriptor = os.open(output_parent, os.O_RDONLY)
        try:
            os.fsync(directory_descriptor)
        finally:
            os.close(directory_descriptor)
    finally:
        if temporary.exists():
            for child in temporary.iterdir():
                child.unlink(missing_ok=True)
            temporary.rmdir()


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=Path("~/.codex/sessions"))
    parser.add_argument("--state-db", type=Path, default=Path("~/.codex/state_5.sqlite"))
    parser.add_argument("--repo-root", type=Path, default=Path.cwd())
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--thread-id", action="append", type=parse_uuid, required=True)
    parser.add_argument("--min-idle-days", type=float, default=DEFAULT_MIN_IDLE_DAYS)
    parser.add_argument("--tail-bytes", type=int, default=DEFAULT_TAIL_BYTES)
    parser.add_argument("--max-record-bytes", type=int, default=DEFAULT_MAX_RECORD_BYTES)
    parser.add_argument("--max-messages", type=int, default=DEFAULT_MAX_MESSAGES)
    parser.add_argument("--max-text-bytes", type=int, default=DEFAULT_MAX_TEXT_BYTES)
    parser.add_argument("--execute", action="store_true", help="write the recovery pack")
    return parser


def run(args: argparse.Namespace) -> int:
    source = absolute(args.source)
    state_db = absolute(args.state_db)
    repo_root = absolute(args.repo_root)
    output_dir = absolute(args.output_dir)
    if len(args.thread_id) != len(set(args.thread_id)):
        raise SalvageError("duplicate --thread-id values")
    allowed_root = repo_root / "docs" / "codex" / "recovered-subagent-summaries"
    if output_dir != allowed_root:
        raise SalvageError(f"output must be exactly {allowed_root}")
    if not source.is_dir() or source.is_symlink():
        raise SalvageError(f"unsafe source directory: {source}")
    if not state_db.is_file() or state_db.is_symlink():
        raise SalvageError(f"unsafe state database: {state_db}")
    records = load_records(state_db, args.thread_id)
    recoveries: list[Recovery] = []
    for thread_id in args.thread_id:
        item = recover_one(
            records[thread_id],
            source,
            min_idle_days=args.min_idle_days,
            tail_bytes=args.tail_bytes,
            max_record_bytes=args.max_record_bytes,
            max_messages=args.max_messages,
            max_text_bytes=args.max_text_bytes,
        )
        recoveries.append(item)
        print(
            f"RECOVER {thread_id} {human_bytes(item.snapshot.size)} "
            f"messages={len(item.messages)} state={item.terminal_signal}"
        )
    total = sum(item.snapshot.size for item in recoveries)
    print(f"Selected: {len(recoveries)} threads, {total} bytes ({human_bytes(total)})")
    print(f"Output: {output_dir}")
    if not args.execute:
        print("DRY RUN: no recovery files were created.")
        return 0
    publish_pack(output_dir, recoveries, source)
    print(f"WROTE {len(recoveries) + 2} recovery files; source rollouts retained")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    try:
        return run(parser.parse_args(argv))
    except (SalvageError, OSError, ValueError) as error:
        print(f"ERROR: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
