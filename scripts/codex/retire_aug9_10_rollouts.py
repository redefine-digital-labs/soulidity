#!/usr/bin/env python3
"""Permanently retire the 12 approved Aug 9-10 Codex subagent rollouts.

The default mode is a read-only preflight.  Execute mode is deliberately
offline-only and fail-closed:

1. validate the frozen 12-thread selection and all 24 durable summaries/minutes;
2. create a temporary zstd archive for one exact thread ID;
3. let session_archive.py verify it and remove only the matching source JSONL;
4. verify the archive again and durably record its hashes/manifest in the repo;
5. remove that temporary archive body and manifest, then continue to the next ID.

The compact receipt makes the operation resumable without leaving broken
entries in CodexSessionArchive.  The full raw conversations are intentionally
irrecoverable after an item reaches ``complete``; the approved summaries and
minutes are the retained copy.
"""

from __future__ import annotations

import argparse
from contextlib import contextmanager
from datetime import datetime, timezone
import fcntl
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import stat
import subprocess
import sys
import tempfile
from typing import Iterator


SCRIPT_DIR = Path(__file__).resolve().parent
REPOSITORY_ROOT = SCRIPT_DIR.parents[1]
ARCHIVE_TOOL = SCRIPT_DIR / "session_archive.py"
SUMMARY_DIR = REPOSITORY_ROOT / "docs" / "codex" / "recovered-subagent-summaries"
MINUTES_DIR = REPOSITORY_ROOT / "docs" / "codex" / "recovered-subagent-minutes"
SELECTION_FILE = SUMMARY_DIR / "selection-aug9-10-20260902.json"
RECEIPT_FILE = MINUTES_DIR / "DELETION-RECEIPT-20260902-aug9-10.json"
SOURCE_ROOT = Path("/Users/naoer/.codex/sessions")
STATE_DB = Path("/Users/naoer/.codex/state_5.sqlite")
LOCK_DIR = Path("/Users/naoer/.codex/thread-writer-locks")
ARCHIVE_ROOT = Path("/Users/naoer/CodexSessionArchive")
BATCH_ID = "20260902-aug9-10"
EXPECTED_SELECTION_SHA256 = (
    "68ed54385a8b0aaf08cb1d36dd2abc24a91ec6b75e420e13ea59b77e6dcb8694"
)
EXPECTED_TOTAL_BYTES = 37_982_623_910
EXPECTED_TOTAL_MESSAGES = 87
EXPECTED_PARENT_ID = "019f5069-93af-7eb1-9308-6f7b7ddcaab0"


# Frozen against the already-reviewed durable recovery files.  Execute mode
# refuses to start if even one byte of a summary or structured minute changes.
APPROVED = {
    "019fe62f-deaa-7273-8779-95c588ce40a2": {
        "summary_file": "audit_release_v7-019fe62f.md",
        "summary_sha256": "ea6790502d44e03bf36795325d5c5e04641ce7b348bfaf7e87af0d98bfdc9a2c",
        "minute_sha256": "4511a5ad455c33a844c0b1b86724513a5ad5d8e15ca4e3081915bfae2021d9c7",
    },
    "019fe632-9ec1-7512-bf87-8979b0f050f0": {
        "summary_file": "audit_soulidity_v7-019fe632.md",
        "summary_sha256": "9ec8d57a918d2c0ce07def59babc56dd4e41e31c57b1f7411b6b5e2821b46548",
        "minute_sha256": "58f25e0d5227a32db465b842c8bc0f93182547c5cb44700e2aafb3b2c3f1ef0d",
    },
    "019fe724-92db-7c00-ab47-9bf7606e4b6a": {
        "summary_file": "wardrobe_slot_policy-019fe724.md",
        "summary_sha256": "7ff900e022cfd6158146142c0af7b7abbe22390972f6a87a945b29bd123b4105",
        "minute_sha256": "ad3f5f25ff1c5c111705873e509b486a16be32c785ac21a155912d1ab48a394b",
    },
    "019fe636-7279-7bf1-a901-cf25c8e70947": {
        "summary_file": "audit_pack_publish-019fe636.md",
        "summary_sha256": "93affb1f457112c5508ee1c8ed68a072e3933c0d02f17cc97209fe807b52546e",
        "minute_sha256": "ecf50659e383c7229f5a174647c57d5a5cd06f7619f90a09b28f467076180d29",
    },
    "019fe76e-b8ef-7e60-958b-dacadc46a931": {
        "summary_file": "pack_i18n-019fe76e.md",
        "summary_sha256": "3baef4e582d726c6c3f7ade810db6af63dac030585eb0edd633718c555dcc032",
        "minute_sha256": "0d669d5984c8d56faa302a4e24e3dc5f79aa357a934e5ccba0fab9998571fdcb",
    },
    "019fe89b-a197-7b61-b047-7a58fdafe4c1": {
        "summary_file": "pack_chain_abi_audit-019fe89b.md",
        "summary_sha256": "03b4e6721cae61e164b8b76cfdde2f0253a866483f91a6140e9a399e9e7b9721",
        "minute_sha256": "e7389c807b6e0f7be0d49908982d9768be7161390f990c673362ea6bf3f1b4ff",
    },
    "019fe89d-da3e-7471-a311-fcf5f69aa1d4": {
        "summary_file": "pack_publication_reuse-019fe89d.md",
        "summary_sha256": "752a8b5004b2cb53df32e1ad7b694340b7ed003fdca896fa0493c2d80b3a5313",
        "minute_sha256": "b85e74a94ef74e8a18c7717eac91553d3c83e666e82bb5f827cd006cdfb83cb7",
    },
    "019fe947-1680-7c32-bd37-7b97129e56d0": {
        "summary_file": "pack_release_ui_i18n-019fe947.md",
        "summary_sha256": "b2ea4ba4440f047f8dd2a5ee64bd87dff8e1b9358b3ecce469d8c182dbd45279",
        "minute_sha256": "707b9450ad60bb380a684a24da8f1a40d6bfb21876eb3843ecbfe34ece02be43",
    },
    "019fe967-6c88-7761-9d6e-dc7832a508b0": {
        "summary_file": "pack_publication_store-019fe967.md",
        "summary_sha256": "bc6b731a8f52a7a6db4d5c76b71e043d134c4e168aabec7e912813d0e87ccd0d",
        "minute_sha256": "0e2f9e94c0288caf83f29ca6a1de06936c85ad08d94589708a087d727928dd91",
    },
    "019fea58-d3f3-7880-9a20-6466419e4349": {
        "summary_file": "pack_publication_store2-019fea58.md",
        "summary_sha256": "e58bc0ba027658888a9df9194587d1c37aecaad18126ea22448c56f91a99e6e0",
        "minute_sha256": "125762a088d43b992750ace3d19a2024473e4db5227884bf2c63d152a8676a7a",
    },
    "019feae5-0e89-75b3-be5b-de68165d3f46": {
        "summary_file": "pack_commerce_ui-019feae5.md",
        "summary_sha256": "81a5ec3201d831cbae557e815b5d6dc03d371040c165c6f1388b6ea1345c73a5",
        "minute_sha256": "5998a251feb8b1e99958be83f1e6a5f7602930f663dd458470873add30bb92e2",
    },
    "019feae8-8c73-7143-aee6-160f369c5e51": {
        "summary_file": "pack_recovery_store-019feae8.md",
        "summary_sha256": "6ba98fadbf0ea1528ae3da3154ccbabaf32df9f49e5d6547c496a1ea81ada836",
        "minute_sha256": "d63c67e448852e6c49c900d3d4147d4d229297953d4822dda8ef48f0038de8f4",
    },
}


class RetirementError(RuntimeError):
    """A frozen input, verification gate, or resume invariant failed."""


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def human_bytes(value: int) -> str:
    amount = float(value)
    for unit in ("B", "KiB", "MiB", "GiB", "TiB"):
        if amount < 1024 or unit == "TiB":
            return f"{int(amount)} B" if unit == "B" else f"{amount:.2f} {unit}"
        amount /= 1024
    raise AssertionError("unreachable")


def sha256_bytes(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def sha256_path(path: Path) -> tuple[str, int]:
    flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0)
    descriptor = os.open(path, flags)
    try:
        metadata = os.fstat(descriptor)
        if not stat.S_ISREG(metadata.st_mode) or metadata.st_nlink != 1:
            raise RetirementError(f"not a single-linked regular file: {path}")
        digest = hashlib.sha256()
        total = 0
        while True:
            chunk = os.read(descriptor, 1024 * 1024)
            if not chunk:
                break
            digest.update(chunk)
            total += len(chunk)
        return digest.hexdigest(), total
    finally:
        os.close(descriptor)


def require_owned_regular(path: Path, *, max_bytes: int | None = None) -> os.stat_result:
    metadata = os.lstat(path)
    if not stat.S_ISREG(metadata.st_mode) or stat.S_ISLNK(metadata.st_mode):
        raise RetirementError(f"not a plain file: {path}")
    if metadata.st_uid != os.getuid() or metadata.st_nlink != 1:
        raise RetirementError(f"unsafe owner/link count: {path}")
    if max_bytes is not None and metadata.st_size > max_bytes:
        raise RetirementError(f"file is unexpectedly large: {path}")
    return metadata


def safe_relative(value: object, *, suffix: str) -> Path:
    if not isinstance(value, str) or not value.endswith(suffix):
        raise RetirementError("manifest contains an invalid relative path")
    pure = PurePosixPath(value)
    if pure.is_absolute() or any(part in ("", ".", "..") for part in pure.parts):
        raise RetirementError("manifest relative path is unsafe")
    return Path(*pure.parts)


def available_bytes(path: Path) -> int:
    stats = os.statvfs(path)
    return stats.f_bavail * stats.f_frsize


def load_selection() -> list[dict[str, object]]:
    require_owned_regular(SELECTION_FILE, max_bytes=1024 * 1024)
    raw = SELECTION_FILE.read_bytes()
    if sha256_bytes(raw) != EXPECTED_SELECTION_SHA256:
        raise RetirementError("frozen selection SHA-256 changed")
    try:
        payload = json.loads(raw)
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise RetirementError(f"selection JSON is invalid: {error}") from error
    if not isinstance(payload, dict) or payload.get("schema_version") != 1:
        raise RetirementError("unsupported selection schema")
    if payload.get("source_root") != str(SOURCE_ROOT):
        raise RetirementError("selection source root changed")
    threads = payload.get("threads")
    if not isinstance(threads, list) or len(threads) != len(APPROVED):
        raise RetirementError("selection does not contain exactly 12 threads")

    by_id: dict[str, dict[str, object]] = {}
    total_bytes = 0
    total_messages = 0
    for entry in threads:
        if not isinstance(entry, dict):
            raise RetirementError("selection contains a malformed thread")
        thread_id = entry.get("thread_id")
        if not isinstance(thread_id, str) or thread_id in by_id or thread_id not in APPROVED:
            raise RetirementError("selection contains an unexpected/duplicate thread ID")
        approved = APPROVED[thread_id]
        if entry.get("parent_thread_id") != EXPECTED_PARENT_ID:
            raise RetirementError(f"parent ID changed for {thread_id}")
        if entry.get("summary_file") != approved["summary_file"]:
            raise RetirementError(f"durable filename changed for {thread_id}")
        source_size = entry.get("source_size")
        messages = entry.get("recovered_messages")
        source_path = entry.get("source_path")
        mtime_ns = entry.get("source_mtime_ns")
        if not isinstance(source_size, int) or isinstance(source_size, bool) or source_size <= 0:
            raise RetirementError(f"invalid source size for {thread_id}")
        if not isinstance(messages, int) or isinstance(messages, bool) or messages <= 0:
            raise RetirementError(f"invalid recovered message count for {thread_id}")
        if not isinstance(mtime_ns, int) or isinstance(mtime_ns, bool) or mtime_ns <= 0:
            raise RetirementError(f"invalid source mtime for {thread_id}")
        if not isinstance(source_path, str):
            raise RetirementError(f"invalid source path for {thread_id}")
        source = Path(source_path)
        try:
            source.relative_to(SOURCE_ROOT)
        except ValueError as error:
            raise RetirementError(f"source escapes session root: {thread_id}") from error
        if not source.name.endswith(f"{thread_id}.jsonl"):
            raise RetirementError(f"source filename/ID mismatch: {thread_id}")

        for directory, digest_key in (
            (SUMMARY_DIR, "summary_sha256"),
            (MINUTES_DIR, "minute_sha256"),
        ):
            artifact = directory / str(approved["summary_file"])
            require_owned_regular(artifact, max_bytes=1024 * 1024)
            digest, _ = sha256_path(artifact)
            if digest != approved[digest_key]:
                raise RetirementError(f"durable artifact hash changed: {artifact}")

        total_bytes += source_size
        total_messages += messages
        by_id[thread_id] = entry

    if set(by_id) != set(APPROVED):
        raise RetirementError("selection ID set changed")
    if total_bytes != EXPECTED_TOTAL_BYTES or payload.get("total_source_bytes") != total_bytes:
        raise RetirementError("selection byte total changed")
    if total_messages != EXPECTED_TOTAL_MESSAGES:
        raise RetirementError("selection does not contain exactly 87 recovered messages")
    if payload.get("total_threads") != len(APPROVED):
        raise RetirementError("selection thread total changed")
    return sorted(by_id.values(), key=lambda item: int(item["source_size"]))


def validate_source(entry: dict[str, object]) -> bool:
    path = Path(str(entry["source_path"]))
    if not path.exists():
        return False
    metadata = require_owned_regular(path)
    if metadata.st_size != entry["source_size"] or metadata.st_mtime_ns != entry["source_mtime_ns"]:
        raise RetirementError(f"source metadata changed: {entry['thread_id']}")
    return True


def common_source_arguments() -> list[str]:
    return [
        "--source", str(SOURCE_ROOT),
        "--state-db", str(STATE_DB),
        "--lock-dir", str(LOCK_DIR),
    ]


def archive_command(thread_ids: list[str], *, execute: bool) -> list[str]:
    command = [
        sys.executable,
        str(ARCHIVE_TOOL),
        "archive",
        *common_source_arguments(),
        "--archive-root", str(ARCHIVE_ROOT),
        "--allow-same-volume",
        "--remove-source",
        "--acknowledge-codex-offline",
        "--compression-level", "1",
    ]
    for thread_id in thread_ids:
        command.extend(("--completed-thread-id", thread_id))
    if execute:
        command.append("--execute")
    return command


def finalize_command(thread_id: str) -> list[str]:
    return [
        sys.executable,
        str(ARCHIVE_TOOL),
        "finalize",
        "--archive-root", str(ARCHIVE_ROOT),
        *common_source_arguments(),
        "--thread-id", thread_id,
        "--execute",
        "--acknowledge-codex-offline",
    ]


def verify_command(thread_id: str) -> list[str]:
    return [
        sys.executable,
        str(ARCHIVE_TOOL),
        "verify",
        "--archive-root", str(ARCHIVE_ROOT),
        "--thread-id", thread_id,
    ]


def run_checked(command: list[str]) -> None:
    sys.stdout.flush()
    result = subprocess.run(command, cwd=REPOSITORY_ROOT, check=False)
    if result.returncode != 0:
        raise RetirementError(f"verified archive operation stopped with exit code {result.returncode}")


def manifest_paths(thread_id: str) -> tuple[Path, Path, Path]:
    directory = ARCHIVE_ROOT / "manifests" / thread_id
    return directory, directory / "manifest.json", directory / "manifest.sha256"


def load_manifest(
    entry: dict[str, object],
) -> tuple[dict[str, object], bytes, bytes, Path]:
    thread_id = str(entry["thread_id"])
    _directory, manifest_path, sidecar_path = manifest_paths(thread_id)
    require_owned_regular(manifest_path, max_bytes=1024 * 1024)
    require_owned_regular(sidecar_path, max_bytes=4096)
    raw = manifest_path.read_bytes()
    manifest_hash = sha256_bytes(raw)
    sidecar_raw = sidecar_path.read_bytes()
    try:
        sidecar = sidecar_raw.decode("ascii").strip()
    except UnicodeDecodeError as error:
        raise RetirementError(f"manifest sidecar is not ASCII: {thread_id}") from error
    if sidecar != f"{manifest_hash}  manifest.json":
        raise RetirementError(f"manifest sidecar mismatch: {thread_id}")
    try:
        manifest = json.loads(raw)
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise RetirementError(f"manifest JSON is invalid: {thread_id}") from error
    if not isinstance(manifest, dict) or manifest.get("schema_version") != 1:
        raise RetirementError(f"unexpected manifest schema: {thread_id}")
    thread = manifest.get("thread")
    source = manifest.get("source")
    archive = manifest.get("archive")
    if not isinstance(thread, dict) or thread.get("id") != thread_id:
        raise RetirementError(f"manifest thread mismatch: {thread_id}")
    if not isinstance(source, dict) or not isinstance(archive, dict):
        raise RetirementError(f"manifest metadata is malformed: {thread_id}")
    expected_relative = Path(str(entry["source_path"])).relative_to(SOURCE_ROOT).as_posix()
    if source.get("relative_path") != expected_relative:
        raise RetirementError(f"manifest source path mismatch: {thread_id}")
    if source.get("size") != entry["source_size"] or source.get("mtime_ns") != entry["source_mtime_ns"]:
        raise RetirementError(f"manifest source metadata mismatch: {thread_id}")
    archive_relative = safe_relative(archive.get("relative_path"), suffix=".jsonl.zst")
    archive_path = ARCHIVE_ROOT / archive_relative
    try:
        archive_path.relative_to(ARCHIVE_ROOT)
    except ValueError as error:
        raise RetirementError(f"archive path escapes root: {thread_id}") from error
    return manifest, raw, sidecar_raw, archive_path


def new_receipt(free_before: int) -> dict[str, object]:
    return {
        "schema_version": 1,
        "batch_id": BATCH_ID,
        "operation": "verified permanent removal after durable conclusion recovery",
        "created_at_utc": utc_now(),
        "updated_at_utc": utc_now(),
        "selection_file": str(SELECTION_FILE.relative_to(REPOSITORY_ROOT)),
        "selection_sha256": EXPECTED_SELECTION_SHA256,
        "expected_threads": len(APPROVED),
        "expected_recovered_messages": EXPECTED_TOTAL_MESSAGES,
        "expected_source_bytes": EXPECTED_TOTAL_BYTES,
        "source_volume_available_before": free_before,
        "source_volume_available_after": None,
        "items": {},
        "complete": False,
    }


def load_receipt() -> dict[str, object] | None:
    if not RECEIPT_FILE.exists():
        return None
    require_owned_regular(RECEIPT_FILE, max_bytes=4 * 1024 * 1024)
    try:
        receipt = json.loads(RECEIPT_FILE.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as error:
        raise RetirementError(f"cannot read receipt: {error}") from error
    if not isinstance(receipt, dict) or receipt.get("schema_version") != 1:
        raise RetirementError("unsupported deletion receipt schema")
    if receipt.get("batch_id") != BATCH_ID or receipt.get("selection_sha256") != EXPECTED_SELECTION_SHA256:
        raise RetirementError("deletion receipt belongs to a different approval batch")
    items = receipt.get("items")
    if not isinstance(items, dict) or not set(items).issubset(APPROVED):
        raise RetirementError("deletion receipt contains unexpected items")
    return receipt


def write_receipt(receipt: dict[str, object]) -> None:
    receipt["updated_at_utc"] = utc_now()
    payload = (json.dumps(receipt, ensure_ascii=False, sort_keys=True, indent=2) + "\n").encode()
    RECEIPT_FILE.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary_name = tempfile.mkstemp(
        prefix=f".{RECEIPT_FILE.name}.", suffix=".partial", dir=RECEIPT_FILE.parent
    )
    temporary = Path(temporary_name)
    try:
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(payload)
            handle.flush()
            os.fsync(handle.fileno())
        os.chmod(temporary, 0o600)
        os.replace(temporary, RECEIPT_FILE)
        directory_fd = os.open(RECEIPT_FILE.parent, os.O_RDONLY)
        try:
            os.fsync(directory_fd)
        finally:
            os.close(directory_fd)
    finally:
        temporary.unlink(missing_ok=True)


@contextmanager
def exclusive_archive_lock() -> Iterator[None]:
    lock_path = ARCHIVE_ROOT / ".session-archive.lock"
    descriptor = os.open(
        lock_path,
        os.O_RDWR | os.O_CREAT | getattr(os, "O_NOFOLLOW", 0),
        0o600,
    )
    try:
        metadata = os.fstat(descriptor)
        if not stat.S_ISREG(metadata.st_mode) or metadata.st_uid != os.getuid():
            raise RetirementError("unsafe archive lock file")
        try:
            fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as error:
            raise RetirementError("another archive operation is active") from error
        yield
    finally:
        os.close(descriptor)


def unlink_verified(path: Path, *, expected_sha256: str, expected_size: int) -> None:
    before = require_owned_regular(path)
    if before.st_size != expected_size:
        raise RetirementError(f"verified file size changed before removal: {path}")
    digest, size = sha256_path(path)
    after = os.lstat(path)
    if digest != expected_sha256 or size != expected_size:
        raise RetirementError(f"verified file hash changed before removal: {path}")
    if (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns) != (
        after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns
    ):
        raise RetirementError(f"verified file changed during removal check: {path}")
    path.unlink()
    directory_fd = os.open(path.parent, os.O_RDONLY)
    try:
        os.fsync(directory_fd)
    finally:
        os.close(directory_fd)


def receipt_item_matches(item: object, entry: dict[str, object]) -> bool:
    return (
        isinstance(item, dict)
        and item.get("thread_id") == entry["thread_id"]
        and item.get("source_path") == entry["source_path"]
        and item.get("source_size") == entry["source_size"]
        and item.get("source_mtime_ns") == entry["source_mtime_ns"]
    )


def cleanup_verified_archive(
    entry: dict[str, object], receipt: dict[str, object]
) -> None:
    thread_id = str(entry["thread_id"])
    items = receipt["items"]
    assert isinstance(items, dict)
    manifest_directory, manifest_path, sidecar_path = manifest_paths(thread_id)
    prior = items.get(thread_id)

    if manifest_path.exists():
        manifest, manifest_raw, sidecar_raw, archive_path = load_manifest(entry)
        manifest_hash = sha256_bytes(manifest_raw)
        archive = manifest["archive"]
        source = manifest["source"]
        assert isinstance(archive, dict) and isinstance(source, dict)
        if archive_path.exists():
            run_checked(verify_command(thread_id))
            archive_hash = archive.get("sha256")
            archive_size = archive.get("size")
            source_hash = source.get("sha256")
            if not isinstance(archive_hash, str) or not isinstance(source_hash, str):
                raise RetirementError(f"manifest hashes are malformed: {thread_id}")
            if not isinstance(archive_size, int) or isinstance(archive_size, bool):
                raise RetirementError(f"manifest archive size is malformed: {thread_id}")
            item = {
                "thread_id": thread_id,
                "source_path": entry["source_path"],
                "source_size": entry["source_size"],
                "source_mtime_ns": entry["source_mtime_ns"],
                "source_sha256": source_hash,
                "archive_relative_path": archive_path.relative_to(ARCHIVE_ROOT).as_posix(),
                "archive_size": archive_size,
                "archive_sha256": archive_hash,
                "manifest_sha256": manifest_hash,
                "manifest_size": len(manifest_raw),
                "manifest_sidecar_sha256": sha256_bytes(sidecar_raw),
                "manifest_sidecar_size": len(sidecar_raw),
                "manifest": manifest,
                "verified_at_utc": utc_now(),
                "status": "verified_pending_archive_cleanup",
            }
            items[thread_id] = item
            write_receipt(receipt)
            with exclusive_archive_lock():
                unlink_verified(
                    archive_path,
                    expected_sha256=archive_hash,
                    expected_size=archive_size,
                )
            item["archive_body_removed_at_utc"] = utc_now()
            item["status"] = "archive_removed_pending_manifest_cleanup"
            write_receipt(receipt)
            prior = item
        else:
            if not receipt_item_matches(prior, entry):
                raise RetirementError(
                    f"archive body missing without a durable pending receipt: {thread_id}"
                )
            assert isinstance(prior, dict)
            if prior.get("manifest_sha256") != manifest_hash:
                raise RetirementError(f"retained manifest changed after archive cleanup: {thread_id}")
    elif not receipt_item_matches(prior, entry):
        raise RetirementError(f"manifest missing without a durable receipt: {thread_id}")

    assert isinstance(prior, dict)
    if Path(str(entry["source_path"])).exists():
        raise RetirementError(f"source still exists before manifest cleanup: {thread_id}")

    if manifest_directory.exists():
        expected_manifest_hash = prior.get("manifest_sha256")
        if not isinstance(expected_manifest_hash, str):
            raise RetirementError(f"receipt manifest hash is malformed: {thread_id}")
        expected_manifest_size = prior.get("manifest_size")
        expected_sidecar_hash = prior.get("manifest_sidecar_sha256")
        expected_sidecar_size = prior.get("manifest_sidecar_size")
        if not isinstance(expected_manifest_size, int):
            raise RetirementError(f"receipt manifest size is malformed: {thread_id}")
        if not isinstance(expected_sidecar_hash, str) or not isinstance(expected_sidecar_size, int):
            raise RetirementError(f"receipt sidecar metadata is malformed: {thread_id}")
        with exclusive_archive_lock():
            if manifest_path.exists():
                unlink_verified(
                    manifest_path,
                    expected_sha256=expected_manifest_hash,
                    expected_size=expected_manifest_size,
                )
            if sidecar_path.exists():
                unlink_verified(
                    sidecar_path,
                    expected_sha256=expected_sidecar_hash,
                    expected_size=expected_sidecar_size,
                )
            try:
                manifest_directory.rmdir()
            except OSError as error:
                raise RetirementError(
                    f"manifest directory is not empty: {manifest_directory}"
                ) from error
            parent_fd = os.open(manifest_directory.parent, os.O_RDONLY)
            try:
                os.fsync(parent_fd)
            finally:
                os.close(parent_fd)

    prior["manifest_removed_at_utc"] = prior.get("manifest_removed_at_utc", utc_now())
    prior["status"] = "complete"
    write_receipt(receipt)


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Preflight or permanently retire the frozen Aug 9-10 12-thread batch."
    )
    parser.add_argument("--execute", action="store_true", help="perform permanent verified removal")
    parser.add_argument(
        "--acknowledge-codex-offline",
        action="store_true",
        help="assert Codex/ChatGPT and all Codex tasks are fully closed",
    )
    parser.add_argument(
        "--acknowledge-permanent-removal",
        action="store_true",
        help="accept that full raw conversations cannot be restored from the retained minutes",
    )
    parser.add_argument(
        "--validate-only",
        action="store_true",
        help="validate the frozen selection and durable artifacts without scanning sessions",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    try:
        args = parse_args(argv)
        approved = load_selection()
        print(
            f"Frozen batch valid: {len(approved)} threads, "
            f"{EXPECTED_TOTAL_MESSAGES} recovered messages, "
            f"{human_bytes(EXPECTED_TOTAL_BYTES)}",
            flush=True,
        )
        print(f"Receipt: {RECEIPT_FILE}", flush=True)
        if args.validate_only:
            return 0
        if args.execute and not (
            args.acknowledge_codex_offline and args.acknowledge_permanent_removal
        ):
            raise RetirementError(
                "--execute requires both --acknowledge-codex-offline and "
                "--acknowledge-permanent-removal"
            )

        pending: list[str] = []
        completed = 0
        receipt = load_receipt()
        receipt_items = receipt.get("items", {}) if receipt else {}
        assert isinstance(receipt_items, dict)
        for entry in approved:
            thread_id = str(entry["thread_id"])
            source_exists = validate_source(entry)
            manifest_directory, manifest_path, _sidecar_path = manifest_paths(thread_id)
            item = receipt_items.get(thread_id)
            if source_exists and not manifest_directory.exists():
                pending.append(thread_id)
            elif source_exists and manifest_path.exists():
                print(f"RESUME {thread_id}: verified archive exists; source needs finalization")
            elif not source_exists and manifest_path.exists():
                print(f"RESUME {thread_id}: source removed; verified archive needs cleanup")
            elif not source_exists and receipt_item_matches(item, entry):
                if isinstance(item, dict) and item.get("status") == "complete":
                    completed += 1
                    print(f"COMPLETE {thread_id}: already retired")
                else:
                    print(f"RESUME {thread_id}: finish receipt-backed metadata cleanup")
            else:
                raise RetirementError(f"source/archive/receipt state is inconsistent: {thread_id}")

        if not args.execute:
            if pending:
                run_checked(archive_command(pending, execute=False))
            print(
                f"PRECHECK COMPLETE: {len(pending)} pending, {completed} already complete; "
                "nothing was written or removed."
            )
            return 0

        free_before = available_bytes(SOURCE_ROOT)
        if receipt is None:
            receipt = new_receipt(free_before)
            write_receipt(receipt)
        print(f"Source-volume free before/resume: {human_bytes(free_before)}")

        done = 0
        for entry in approved:
            thread_id = str(entry["thread_id"])
            source = Path(str(entry["source_path"]))
            manifest_directory, manifest_path, _sidecar_path = manifest_paths(thread_id)
            items = receipt["items"]
            assert isinstance(items, dict)
            item = items.get(thread_id)

            if source.exists():
                if not manifest_path.exists():
                    if manifest_directory.exists():
                        raise RetirementError(
                            f"incomplete manifest exists while source remains: {thread_id}"
                        )
                    if not validate_source(entry):
                        raise RetirementError(f"source vanished before archive: {thread_id}")
                    run_checked(archive_command([thread_id], execute=True))
                if source.exists():
                    run_checked(finalize_command(thread_id))
                if source.exists():
                    raise RetirementError(
                        f"source was retained after verified finalization: {thread_id}"
                    )

            if manifest_directory.exists():
                cleanup_verified_archive(entry, receipt)
            else:
                if not receipt_item_matches(item, entry) or not isinstance(item, dict):
                    raise RetirementError(f"missing source/archive without matching receipt: {thread_id}")
                if item.get("status") != "complete":
                    item["manifest_removed_at_utc"] = item.get("manifest_removed_at_utc", utc_now())
                    item["status"] = "complete"
                    write_receipt(receipt)

            done += 1
            free_now = available_bytes(SOURCE_ROOT)
            print(
                f"BATCH PROGRESS {done}/{len(approved)}; "
                f"source-volume free {human_bytes(free_now)}",
                flush=True,
            )

        for entry in approved:
            thread_id = str(entry["thread_id"])
            source = Path(str(entry["source_path"]))
            manifest_directory, _manifest_path, _sidecar_path = manifest_paths(thread_id)
            item = receipt["items"].get(thread_id)  # type: ignore[index]
            if source.exists() or manifest_directory.exists():
                raise RetirementError(f"final filesystem check failed: {thread_id}")
            if not isinstance(item, dict) or item.get("status") != "complete":
                raise RetirementError(f"final receipt check failed: {thread_id}")

        free_after = available_bytes(SOURCE_ROOT)
        receipt["source_volume_available_after"] = free_after
        receipt["observed_available_bytes_delta"] = free_after - int(
            receipt["source_volume_available_before"]
        )
        receipt["completed_at_utc"] = utc_now()
        receipt["complete"] = True
        write_receipt(receipt)
        print(
            "BATCH COMPLETE: all 12 exact source rollouts and their temporary archive "
            f"copies were removed; observed free-space delta "
            f"{human_bytes(free_after - int(receipt['source_volume_available_before']))}."
        )
        return 0
    except (RetirementError, OSError) as error:
        print(f"ERROR: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
