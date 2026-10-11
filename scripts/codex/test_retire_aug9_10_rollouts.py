#!/usr/bin/env python3
"""Safety invariants for the frozen Aug 9-10 permanent retirement runner."""

from __future__ import annotations

from contextlib import redirect_stderr, redirect_stdout
import importlib.util
import hashlib
import io
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest import mock


SCRIPT_PATH = Path(__file__).with_name("retire_aug9_10_rollouts.py")


def load_module():
    spec = importlib.util.spec_from_file_location("retire_aug9_10_under_test", SCRIPT_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError("unable to load retire_aug9_10_rollouts.py")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


class RetireAug910Test(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.module = load_module()

    def test_frozen_selection_and_durable_artifacts_match(self) -> None:
        approved = self.module.load_selection()
        self.assertEqual(len(approved), 12)
        self.assertEqual(
            sum(entry["recovered_messages"] for entry in approved),
            self.module.EXPECTED_TOTAL_MESSAGES,
        )
        self.assertEqual(
            sum(entry["source_size"] for entry in approved),
            self.module.EXPECTED_TOTAL_BYTES,
        )
        self.assertEqual(
            {entry["thread_id"] for entry in approved}, set(self.module.APPROVED)
        )
        sizes = [entry["source_size"] for entry in approved]
        self.assertEqual(sizes, sorted(sizes))

    def test_archive_command_is_exact_and_has_no_legacy_selector(self) -> None:
        thread_id = next(iter(self.module.APPROVED))
        command = self.module.archive_command([thread_id], execute=True)
        self.assertEqual(command.count("--completed-thread-id"), 1)
        self.assertEqual(command[command.index("--completed-thread-id") + 1], thread_id)
        self.assertNotIn("--allow-quiescent-legacy", command)
        self.assertIn("--remove-source", command)
        self.assertIn("--acknowledge-codex-offline", command)
        self.assertIn("--allow-same-volume", command)
        self.assertIn("--execute", command)

    def test_execute_requires_both_irreversibility_gates(self) -> None:
        stdout = io.StringIO()
        stderr = io.StringIO()
        with (
            redirect_stdout(stdout),
            redirect_stderr(stderr),
            mock.patch.object(self.module.subprocess, "run") as run,
        ):
            result = self.module.main(["--execute", "--acknowledge-codex-offline"])
        self.assertEqual(result, 2)
        self.assertIn("requires both", stderr.getvalue())
        run.assert_not_called()

    def test_manifest_relative_path_rejects_traversal(self) -> None:
        with self.assertRaises(self.module.RetirementError):
            self.module.safe_relative("../outside.jsonl.zst", suffix=".jsonl.zst")

    def test_verified_temporary_archive_cleanup_writes_receipt_first(self) -> None:
        thread_id = next(iter(self.module.APPROVED))
        with tempfile.TemporaryDirectory(dir="/private/tmp") as temporary:
            root = Path(temporary)
            archive_root = root / "archive"
            receipt_file = root / "receipts" / "receipt.json"
            relative_archive = Path("objects/2026/08/09") / f"rollout-{thread_id}.jsonl.zst"
            archive_path = archive_root / relative_archive
            archive_path.parent.mkdir(parents=True)
            archive_payload = b"verified temporary archive"
            archive_path.write_bytes(archive_payload)
            source_path = self.module.SOURCE_ROOT / "2026/08/09" / f"rollout-{thread_id}.jsonl"
            entry = {
                "thread_id": thread_id,
                "source_path": str(source_path),
                "source_size": 1234,
                "source_mtime_ns": 5678,
            }
            manifest = {
                "schema_version": 1,
                "thread": {"id": thread_id, "source": "subagent"},
                "source": {
                    "relative_path": source_path.relative_to(self.module.SOURCE_ROOT).as_posix(),
                    "size": 1234,
                    "mtime_ns": 5678,
                    "sha256": "1" * 64,
                },
                "archive": {
                    "relative_path": relative_archive.as_posix(),
                    "size": len(archive_payload),
                    "sha256": hashlib.sha256(archive_payload).hexdigest(),
                },
            }
            manifest_raw = (
                json.dumps(manifest, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
                + "\n"
            ).encode()
            manifest_dir = archive_root / "manifests" / thread_id
            manifest_dir.mkdir(parents=True)
            (manifest_dir / "manifest.json").write_bytes(manifest_raw)
            sidecar = f"{hashlib.sha256(manifest_raw).hexdigest()}  manifest.json\n".encode()
            (manifest_dir / "manifest.sha256").write_bytes(sidecar)
            receipt = self.module.new_receipt(10_000)

            with (
                mock.patch.object(self.module, "ARCHIVE_ROOT", archive_root),
                mock.patch.object(self.module, "RECEIPT_FILE", receipt_file),
                mock.patch.object(self.module, "run_checked") as verify,
            ):
                self.module.cleanup_verified_archive(entry, receipt)

            verify.assert_called_once()
            self.assertFalse(archive_path.exists())
            self.assertFalse(manifest_dir.exists())
            self.assertTrue(receipt_file.exists())
            self.assertEqual(receipt["items"][thread_id]["status"], "complete")
            self.assertEqual(
                receipt["items"][thread_id]["archive_sha256"],
                hashlib.sha256(archive_payload).hexdigest(),
            )


if __name__ == "__main__":
    unittest.main()
