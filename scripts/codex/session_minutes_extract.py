#!/usr/bin/env python3
"""Stream verified Codex archives into small, sanitized meeting-minutes inputs.

This tool never writes a decompressed rollout. It verifies the immutable archive
metadata, streams zstd output through SHA-256/byte-count checks, and retains only
sanitized user/agent text plus aggregate record/tool statistics. Reasoning,
tool outputs, environment snapshots, and binary payloads are excluded.
"""

from __future__ import annotations

import argparse
from collections import Counter
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys
from typing import Any
import uuid


TOOL_VERSION = "1.0.0"
CHUNK_BYTES = 1024 * 1024
MAX_RECORD_BYTES = 8 * 1024 * 1024
MAX_MESSAGE_BYTES = 96 * 1024
MAX_THREAD_TEXT_BYTES = 4 * 1024 * 1024
UUID_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"
)
SECRET_WORDS = (
    "api[_-]?key|token|secret|password|passwd|authorization|private[_-]?key|"
    "mnemonic|seed[_-]?phrase|client[_-]?secret"
)
PEM_RE = re.compile(
    r"-----BEGIN [^-\n]+-----.*?-----END [^-\n]+-----", re.I | re.S
)
BEARER_RE = re.compile(r"(?i)\bBearer\s+[A-Za-z0-9._~+/=-]{12,}")
SECRET_ASSIGN_RE = re.compile(
    rf"(?i)(\b(?:{SECRET_WORDS})\b\s*(?:=|:)\s*)"
    r"([^\s,;]+|\"[^\"]*\"|'[^']*')"
)
SENSITIVE_QUERY_RE = re.compile(rf"(?i)([?&](?:{SECRET_WORDS})=)[^&#\s]+")
DATA_URL_RE = re.compile(r"data:[^\s,;]+;base64,[A-Za-z0-9+/=\r\n]+", re.I)
LONG_BLOB_RE = re.compile(
    r"(?<![A-Za-z0-9+/=])[A-Za-z0-9+/=_-]{160,}(?![A-Za-z0-9+/=])"
)


class ExtractError(RuntimeError):
    pass


def parse_uuid(value: str) -> str:
    normalized = value.strip().lower()
    if not UUID_RE.fullmatch(normalized):
        raise argparse.ArgumentTypeError(f"invalid thread UUID: {value!r}")
    return normalized


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while chunk := handle.read(4 * CHUNK_BYTES):
            digest.update(chunk)
    return digest.hexdigest()


def sanitize(text: str) -> str:
    value = text.replace("/Users/naoer", "~")
    value = PEM_RE.sub("[REDACTED PRIVATE MATERIAL]", value)
    value = DATA_URL_RE.sub("[REDACTED DATA URL]", value)
    value = BEARER_RE.sub("Bearer [REDACTED]", value)
    value = SECRET_ASSIGN_RE.sub(lambda match: match.group(1) + "[REDACTED]", value)
    value = SENSITIVE_QUERY_RE.sub(lambda match: match.group(1) + "[REDACTED]", value)
    value = LONG_BLOB_RE.sub("[REDACTED LONG ENCODED VALUE]", value)
    return value.replace("\x00", "�").strip()


def flatten_content(content: object) -> str:
    if isinstance(content, str):
        return content
    if not isinstance(content, list):
        return ""
    fragments: list[str] = []
    for item in content:
        if not isinstance(item, dict):
            continue
        if item.get("type") not in ("input_text", "output_text", "text"):
            continue
        text = item.get("text")
        if isinstance(text, str):
            fragments.append(text)
    return "\n".join(fragments)


def extract_message(record: dict[str, Any]) -> tuple[str, str, str] | None:
    outer_type = record.get("type")
    payload = record.get("payload")
    if not isinstance(outer_type, str) or not isinstance(payload, dict):
        return None
    payload_type = payload.get("type")
    timestamp = str(record.get("timestamp", ""))
    if outer_type == "event_msg" and payload_type in ("agent_message", "user_message"):
        message = payload.get("message")
        if isinstance(message, str):
            role = "assistant" if payload_type == "agent_message" else "user"
            return role, timestamp, message
    if outer_type == "response_item" and payload_type == "message":
        role = payload.get("role")
        if role not in ("assistant", "user"):
            return None
        text = flatten_content(payload.get("content"))
        return (str(role), timestamp, text) if text else None
    if outer_type == "response_item" and payload_type == "agent_message":
        content = payload.get("content")
        if isinstance(content, str):
            return "assistant", timestamp, content
    return None


def tool_name(record: dict[str, Any]) -> str | None:
    if record.get("type") != "response_item":
        return None
    payload = record.get("payload")
    if not isinstance(payload, dict):
        return None
    if payload.get("type") not in ("function_call", "custom_tool_call"):
        return None
    name = payload.get("name")
    return name if isinstance(name, str) and name else "unknown"


def secure_regular_file(path: Path, root: Path) -> os.stat_result:
    absolute = Path(os.path.abspath(path))
    try:
        absolute.relative_to(root)
    except ValueError as error:
        raise ExtractError(f"path escapes archive root: {path}") from error
    metadata = os.lstat(absolute)
    if not stat.S_ISREG(metadata.st_mode) or stat.S_ISLNK(metadata.st_mode):
        raise ExtractError(f"not a regular archive file: {path}")
    if metadata.st_uid != os.getuid() or metadata.st_nlink != 1:
        raise ExtractError(f"unsafe archive metadata: {path}")
    return metadata


def archive_is_open(path: Path) -> bool:
    result = subprocess.run(
        ["/usr/sbin/lsof", "-w", "-Fpn", "--", os.fspath(path)],
        capture_output=True,
        text=True,
        check=False,
    )
    if result.returncode not in (0, 1):
        raise ExtractError(f"lsof failed for {path}")
    return any(line.startswith("p") and line[1:].isdigit() for line in result.stdout.splitlines())


def load_manifest(root: Path, thread_id: str) -> tuple[dict[str, Any], Path]:
    manifest_dir = root / "manifests" / thread_id
    manifest_path = manifest_dir / "manifest.json"
    sidecar_path = manifest_dir / "manifest.sha256"
    secure_regular_file(manifest_path, root)
    secure_regular_file(sidecar_path, root)
    sidecar = sidecar_path.read_text(encoding="ascii").strip().split()[0]
    if sha256_file(manifest_path) != sidecar:
        raise ExtractError(f"manifest sidecar mismatch: {thread_id}")
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if manifest.get("thread", {}).get("id") != thread_id:
        raise ExtractError(f"manifest thread mismatch: {thread_id}")
    relative = manifest.get("archive", {}).get("relative_path")
    if not isinstance(relative, str) or not relative.endswith(f"{thread_id}.jsonl.zst"):
        raise ExtractError(f"unsafe archive relative path: {thread_id}")
    archive_path = Path(os.path.abspath(root / relative))
    secure_regular_file(archive_path, root)
    return manifest, archive_path


def parse_record(
    raw: bytes,
    *,
    record_types: Counter[str],
    tool_counts: Counter[str],
    messages: list[dict[str, str]],
    seen: set[tuple[str, str]],
    text_budget: list[int],
) -> bool:
    try:
        record = json.loads(raw)
    except (UnicodeDecodeError, json.JSONDecodeError):
        return False
    if not isinstance(record, dict):
        return False
    outer = record.get("type")
    record_types[str(outer)] += 1
    name = tool_name(record)
    if name:
        tool_counts[name] += 1
    extracted = extract_message(record)
    if extracted is None:
        return True
    role, timestamp, raw_text = extracted
    clean = sanitize(raw_text)
    if not clean:
        return True
    encoded = clean.encode("utf-8")
    if len(encoded) > MAX_MESSAGE_BYTES:
        clean = encoded[:MAX_MESSAGE_BYTES].decode("utf-8", "ignore").rstrip()
        clean += "\n\n[LONG MESSAGE TRUNCATED BY EXTRACTOR]"
        encoded = clean.encode("utf-8")
    digest = hashlib.sha256(encoded).hexdigest()
    key = (role, digest)
    if key in seen:
        return True
    if text_budget[0] + len(encoded) > MAX_THREAD_TEXT_BYTES:
        raise ExtractError("sanitized message corpus exceeds per-thread safety limit")
    seen.add(key)
    text_budget[0] += len(encoded)
    messages.append(
        {"role": role, "timestamp": timestamp, "sha256": digest, "text": clean}
    )
    return True


def stream_archive(manifest: dict[str, Any], archive_path: Path) -> dict[str, Any]:
    expected_archive_sha = manifest["archive"]["sha256"]
    if sha256_file(archive_path) != expected_archive_sha:
        raise ExtractError(f"archive SHA-256 mismatch: {archive_path.name}")
    if archive_is_open(archive_path):
        raise ExtractError(f"archive is open: {archive_path}")

    process = subprocess.Popen(
        ["/usr/bin/nice", "-n", "15", "/opt/homebrew/bin/zstd", "-q", "-dc", "--", os.fspath(archive_path)],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    assert process.stdout is not None
    assert process.stderr is not None
    digest = hashlib.sha256()
    decompressed_size = 0
    record_types: Counter[str] = Counter()
    tool_counts: Counter[str] = Counter()
    messages: list[dict[str, str]] = []
    seen: set[tuple[str, str]] = set()
    text_budget = [0]
    buffer = bytearray()
    skipping = False
    oversized_records = 0
    parsed_records = 0
    invalid_records = 0

    while chunk := process.stdout.read(CHUNK_BYTES):
        digest.update(chunk)
        decompressed_size += len(chunk)
        for piece_index, piece in enumerate(chunk.split(b"\n")):
            at_line_end = piece_index < len(chunk.split(b"\n")) - 1
            if not skipping:
                buffer.extend(piece)
                if len(buffer) > MAX_RECORD_BYTES:
                    buffer.clear()
                    skipping = True
                    oversized_records += 1
            if at_line_end:
                if not skipping and buffer:
                    if parse_record(
                        bytes(buffer),
                        record_types=record_types,
                        tool_counts=tool_counts,
                        messages=messages,
                        seen=seen,
                        text_budget=text_budget,
                    ):
                        parsed_records += 1
                    else:
                        invalid_records += 1
                buffer.clear()
                skipping = False
    if buffer and not skipping:
        if parse_record(
            bytes(buffer),
            record_types=record_types,
            tool_counts=tool_counts,
            messages=messages,
            seen=seen,
            text_budget=text_budget,
        ):
            parsed_records += 1
        else:
            invalid_records += 1
    stderr = process.stderr.read().decode("utf-8", "replace").strip()
    return_code = process.wait()
    if return_code != 0:
        raise ExtractError(f"zstd failed ({return_code}): {stderr[:500]}")
    expected_size = int(manifest["source"]["size"])
    expected_sha = manifest["source"]["sha256"]
    if decompressed_size != expected_size or digest.hexdigest() != expected_sha:
        raise ExtractError(f"decompressed verification mismatch: {archive_path.name}")
    if archive_is_open(archive_path):
        raise ExtractError(f"archive became open: {archive_path}")
    return {
        "schema_version": 1,
        "tool": {"name": "codex-session-minutes-extract", "version": TOOL_VERSION},
        "thread": manifest["thread"],
        "source": {
            "relative_path": manifest["source"]["relative_path"],
            "size": expected_size,
            "sha256": expected_sha,
        },
        "archive": {
            "relative_path": manifest["archive"]["relative_path"],
            "size": manifest["archive"]["size"],
            "sha256": expected_archive_sha,
        },
        "verification": {
            "manifest_sidecar": True,
            "archive_sha256": True,
            "decompressed_sha256": True,
            "decompressed_size": True,
            "open_handle_before_after": False,
        },
        "extraction": {
            "parsed_records": parsed_records,
            "invalid_records": invalid_records,
            "oversized_records_excluded": oversized_records,
            "record_types": dict(record_types),
            "tool_call_counts": dict(tool_counts),
            "message_count": len(messages),
            "sanitized_text_bytes": text_budget[0],
            "excluded": [
                "reasoning",
                "tool outputs",
                "environment/world state",
                "images and binary payloads",
            ],
        },
        "messages": messages,
    }


def write_exclusive(path: Path, payload: bytes) -> None:
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, "wb") as handle:
        handle.write(payload)
        handle.flush()
        os.fsync(handle.fileno())


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--archive-root", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--thread-id", action="append", type=parse_uuid, required=True)
    args = parser.parse_args(argv)
    if len(args.thread_id) != len(set(args.thread_id)):
        raise ExtractError("duplicate thread IDs")
    archive_root = Path(os.path.abspath(os.path.expanduser(args.archive_root)))
    output_dir = Path(os.path.abspath(os.path.expanduser(args.output_dir)))
    if output_dir.exists():
        raise ExtractError(f"output directory already exists: {output_dir}")
    output_dir.mkdir(mode=0o700, parents=True)
    try:
        for thread_id in args.thread_id:
            manifest, archive_path = load_manifest(archive_root, thread_id)
            print(f"VERIFY {thread_id} compressed_bytes={manifest['archive']['size']}", flush=True)
            result = stream_archive(manifest, archive_path)
            output = output_dir / f"{thread_id}.sanitized.json"
            write_exclusive(
                output,
                (json.dumps(result, ensure_ascii=False, indent=2) + "\n").encode("utf-8"),
            )
            print(
                f"EXTRACTED {thread_id} messages={result['extraction']['message_count']} "
                f"text_bytes={result['extraction']['sanitized_text_bytes']} "
                f"oversized_excluded={result['extraction']['oversized_records_excluded']}",
                flush=True,
            )
    except BaseException:
        print(f"FAIL-CLOSED: retained all archives; partial sanitized inputs are in {output_dir}", file=sys.stderr)
        raise
    print(f"COMPLETE output={output_dir} threads={len(args.thread_id)}", flush=True)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (ExtractError, OSError, ValueError, KeyError, json.JSONDecodeError) as error:
        print(f"ERROR: {error}", file=sys.stderr)
        raise SystemExit(2)
