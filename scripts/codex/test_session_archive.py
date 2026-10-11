#!/usr/bin/env python3
"""Safety-focused integration tests for session_archive.py using synthetic data."""

from __future__ import annotations

from contextlib import redirect_stderr, redirect_stdout
import importlib.util
import io
from pathlib import Path
import sqlite3
import tempfile
import time
import unittest
from unittest import mock


SCRIPT_PATH = Path(__file__).with_name("session_archive.py")
THREAD_ID = "11111111-1111-4111-8111-111111111111"
PARENT_ID = "22222222-2222-4222-8222-222222222222"


def load_module():
    spec = importlib.util.spec_from_file_location("session_archive_under_test", SCRIPT_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError("unable to load session_archive.py")
    module = importlib.util.module_from_spec(spec)
    # dataclasses resolves annotations through sys.modules while decorating.
    import sys

    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


class SessionArchiveIntegrationTest(unittest.TestCase):
    def setUp(self) -> None:
        # macOS /var is a symlink to /private/var; use the canonical plain path
        # so the production symlink-rejection guard remains exercised.
        self.temporary = tempfile.TemporaryDirectory(
            prefix="codex-session-archive-test-", dir="/private/tmp"
        )
        self.root = Path(self.temporary.name)
        self.source = self.root / "sessions"
        self.lock_dir = self.root / "thread-writer-locks"
        self.archive = self.root / "archive"
        self.state_db = self.root / "state.sqlite"
        self.relative = Path("2026/01/02") / f"rollout-synthetic-{THREAD_ID}.jsonl"
        self.rollout = self.source / self.relative
        self.rollout.parent.mkdir(parents=True)
        self.rollout.parent.chmod(0o755)
        self.lock_dir.mkdir()
        self.payload = (b'{"type":"synthetic-test-record"}\n' * 128) + b"opaque-tail\n"
        self.rollout.write_bytes(self.payload)
        old = time.time() - 10 * 86400
        self.rollout.touch()
        import os

        os.utime(self.rollout, (old, old))
        with sqlite3.connect(self.state_db) as connection:
            connection.executescript(
                """
                CREATE TABLE threads (
                    id TEXT PRIMARY KEY,
                    rollout_path TEXT,
                    updated_at INTEGER,
                    updated_at_ms INTEGER,
                    thread_source TEXT
                );
                CREATE TABLE thread_spawn_edges (
                    parent_thread_id TEXT,
                    child_thread_id TEXT,
                    status TEXT
                );
                """
            )
            connection.execute(
                "INSERT INTO threads VALUES (?, ?, ?, ?, 'subagent')",
                (THREAD_ID, str(self.rollout), int(old), int(old * 1000)),
            )
            connection.execute(
                "INSERT INTO thread_spawn_edges VALUES (?, ?, 'open')",
                (PARENT_ID, THREAD_ID),
            )
        self.module = load_module()

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def run_main(self, arguments: list[str]) -> tuple[int, str, str]:
        stdout = io.StringIO()
        stderr = io.StringIO()
        with redirect_stdout(stdout), redirect_stderr(stderr):
            result = self.module.main(arguments)
        return result, stdout.getvalue(), stderr.getvalue()

    def selection_args(self) -> list[str]:
        return [
            "--source",
            str(self.source),
            "--state-db",
            str(self.state_db),
            "--lock-dir",
            str(self.lock_dir),
        ]

    def test_default_scan_is_read_only_and_fail_closed(self) -> None:
        before = self.rollout.stat()
        result, stdout, stderr = self.run_main(["scan", *self.selection_args()])
        self.assertEqual(result, 0, stderr)
        self.assertIn("eligible: 0 files", stdout)
        self.assertIn("quiescent-legacy-opt-in-required: 1", stdout)
        after = self.rollout.stat()
        self.assertEqual((before.st_ino, before.st_size, before.st_mtime_ns),
                         (after.st_ino, after.st_size, after.st_mtime_ns))
        self.assertFalse(self.archive.exists())

    def test_dry_run_creates_nothing(self) -> None:
        result, stdout, stderr = self.run_main(
            [
                "archive",
                *self.selection_args(),
                "--allow-quiescent-legacy",
                "--archive-root",
                str(self.archive),
            ]
        )
        self.assertEqual(result, 0, stderr)
        self.assertIn("DRY RUN", stdout)
        self.assertTrue(self.rollout.exists())
        self.assertFalse(self.archive.exists())

    def test_same_volume_execute_requires_explicit_gate(self) -> None:
        result, _stdout, stderr = self.run_main(
            [
                "archive",
                *self.selection_args(),
                "--allow-quiescent-legacy",
                "--archive-root",
                str(self.archive),
                "--execute",
            ]
        )
        self.assertEqual(result, 2)
        self.assertIn("requires explicit --allow-same-volume", stderr)
        self.assertTrue(self.rollout.exists())
        self.assertFalse(self.archive.exists())

    def test_verified_archive_remove_verify_and_restore(self) -> None:
        generous_space = 20 * 1024**3
        with mock.patch.object(self.module, "available_bytes", return_value=generous_space):
            result, stdout, stderr = self.run_main(
                [
                    "archive",
                    *self.selection_args(),
                    "--allow-quiescent-legacy",
                    "--archive-root",
                    str(self.archive),
                    "--execute",
                    "--allow-same-volume",
                    "--remove-source",
                    "--acknowledge-codex-offline",
                ]
            )
        self.assertEqual(result, 0, stderr)
        self.assertIn("1 archived, 1 source files removed", stdout)
        self.assertFalse(self.rollout.exists())

        result, stdout, stderr = self.run_main(
            ["verify", "--archive-root", str(self.archive), "--thread-id", THREAD_ID]
        )
        self.assertEqual(result, 0, stderr)
        self.assertIn(f"VERIFIED {THREAD_ID}", stdout)

        result, stdout, stderr = self.run_main(
            [
                "restore",
                "--archive-root",
                str(self.archive),
                "--source",
                str(self.source),
                "--thread-id",
                THREAD_ID,
            ]
        )
        self.assertEqual(result, 0, stderr)
        self.assertIn("DRY RUN", stdout)
        self.assertFalse(self.rollout.exists())

        with mock.patch.object(self.module, "available_bytes", return_value=generous_space):
            result, stdout, stderr = self.run_main(
                [
                    "restore",
                    "--archive-root",
                    str(self.archive),
                    "--source",
                    str(self.source),
                    "--thread-id",
                    THREAD_ID,
                    "--execute",
                ]
            )
        self.assertEqual(result, 0, stderr)
        self.assertIn(f"RESTORED {THREAD_ID}", stdout)
        self.assertEqual(self.rollout.read_bytes(), self.payload)

        self.rollout.write_bytes(b"different synthetic content\n")
        result, _stdout, stderr = self.run_main(
            [
                "restore",
                "--archive-root",
                str(self.archive),
                "--source",
                str(self.source),
                "--thread-id",
                THREAD_ID,
            ]
        )
        self.assertEqual(result, 2)
        self.assertIn("different content", stderr)

    def test_finalize_existing_archive_is_dry_run_idempotent_and_verified(self) -> None:
        generous_space = 20 * 1024**3
        with mock.patch.object(self.module, "available_bytes", return_value=generous_space):
            result, stdout, stderr = self.run_main(
                [
                    "archive",
                    *self.selection_args(),
                    "--completed-thread-id",
                    THREAD_ID,
                    "--archive-root",
                    str(self.archive),
                    "--execute",
                    "--allow-same-volume",
                ]
            )
        self.assertEqual(result, 0, stderr)
        self.assertIn("source retained", stdout)
        self.assertTrue(self.rollout.exists())

        finalize = [
            "finalize",
            "--archive-root",
            str(self.archive),
            "--source",
            str(self.source),
            "--state-db",
            str(self.state_db),
            "--lock-dir",
            str(self.lock_dir),
            "--thread-id",
            THREAD_ID,
        ]
        result, stdout, stderr = self.run_main(finalize)
        self.assertEqual(result, 0, stderr)
        self.assertIn("retained by dry-run", stdout)
        self.assertTrue(self.rollout.exists())

        result, stdout, stderr = self.run_main(
            [*finalize, "--execute", "--acknowledge-codex-offline"]
        )
        self.assertEqual(result, 0, stderr)
        self.assertIn("removed after existing archive verification", stdout)
        self.assertFalse(self.rollout.exists())

        result, stdout, stderr = self.run_main(
            [*finalize, "--execute", "--acknowledge-codex-offline"]
        )
        self.assertEqual(result, 0, stderr)
        self.assertIn("already removed (archive verified)", stdout)

    def test_finalize_refuses_source_changed_after_archive(self) -> None:
        generous_space = 20 * 1024**3
        with mock.patch.object(self.module, "available_bytes", return_value=generous_space):
            result, _stdout, stderr = self.run_main(
                [
                    "archive",
                    *self.selection_args(),
                    "--completed-thread-id",
                    THREAD_ID,
                    "--archive-root",
                    str(self.archive),
                    "--execute",
                    "--allow-same-volume",
                ]
            )
        self.assertEqual(result, 0, stderr)
        self.rollout.write_bytes(b"changed after verified archive\n")
        result, _stdout, stderr = self.run_main(
            [
                "finalize",
                "--archive-root",
                str(self.archive),
                "--source",
                str(self.source),
                "--state-db",
                str(self.state_db),
                "--lock-dir",
                str(self.lock_dir),
                "--thread-id",
                THREAD_ID,
                "--execute",
                "--acknowledge-codex-offline",
            ]
        )
        self.assertEqual(result, 2)
        self.assertIn("source metadata no longer matches archive", stderr)
        self.assertTrue(self.rollout.exists())

    def test_archive_retains_source_if_codex_reactivates_before_unlink(self) -> None:
        generous_space = 20 * 1024**3
        lock_snapshots = [frozenset(), frozenset(), frozenset(), frozenset({"active"})]

        def active_locks(_lock_dir):
            return lock_snapshots.pop(0) if lock_snapshots else frozenset({"active"})

        with (
            mock.patch.object(self.module, "available_bytes", return_value=generous_space),
            mock.patch.object(self.module, "active_writer_ids", side_effect=active_locks),
        ):
            result, stdout, stderr = self.run_main(
                [
                    "archive",
                    *self.selection_args(),
                    "--completed-thread-id",
                    THREAD_ID,
                    "--archive-root",
                    str(self.archive),
                    "--execute",
                    "--allow-same-volume",
                    "--remove-source",
                    "--acknowledge-codex-offline",
                ]
            )
        self.assertEqual(result, 0, stderr)
        self.assertIn("Codex became active before removal", stdout)
        self.assertTrue(self.rollout.exists())
        self.assertTrue((self.archive / "manifests" / THREAD_ID / "manifest.json").exists())


if __name__ == "__main__":
    unittest.main()
