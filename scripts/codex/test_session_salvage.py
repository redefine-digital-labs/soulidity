#!/usr/bin/env python3
"""Tests for the bounded Codex subagent conclusion salvage tool."""

from __future__ import annotations

from contextlib import redirect_stderr, redirect_stdout
import importlib.util
import io
import json
import os
from pathlib import Path
import sqlite3
import tempfile
import time
import unittest
from unittest import mock


SCRIPT = Path(__file__).with_name("session_salvage.py")
THREAD_ID = "11111111-1111-4111-8111-111111111111"
PARENT_ID = "22222222-2222-4222-8222-222222222222"


def load_module():
    spec = importlib.util.spec_from_file_location("session_salvage_under_test", SCRIPT)
    if spec is None or spec.loader is None:
        raise RuntimeError("unable to load session_salvage.py")
    module = importlib.util.module_from_spec(spec)
    import sys

    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


class SessionSalvageTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory(
            prefix="codex-session-salvage-test-", dir="/private/tmp"
        )
        self.root = Path(self.temporary.name)
        self.repo = self.root / "repo"
        self.source = self.root / "sessions"
        self.output = self.repo / "docs/codex/recovered-subagent-summaries"
        self.db = self.root / "state.sqlite"
        self.rollout = self.source / "2026/01/01" / f"rollout-test-{THREAD_ID}.jsonl"
        self.rollout.parent.mkdir(parents=True)
        self.repo.mkdir()
        records = [
            {"type": "session_meta", "payload": {"prompt": "DO NOT COPY PROMPT"}},
            {
                "timestamp": "2026-01-01T00:00:00Z",
                "type": "response_item",
                "payload": {
                    "type": "function_call_output",
                    "output": "DO NOT COPY TOOL OUTPUT",
                },
            },
            {
                "timestamp": "2026-01-01T00:01:00Z",
                "type": "event_msg",
                "payload": {
                    "type": "agent_message",
                    "message": "Finding: tests pass. API_KEY=super-secret-value "
                    + "A" * 220,
                },
            },
            {
                "timestamp": "2026-01-01T00:01:01Z",
                "type": "response_item",
                "payload": {
                    "type": "message",
                    "role": "assistant",
                    "content": [
                        {
                            "type": "output_text",
                            "text": "Finding: tests pass. API_KEY=super-secret-value "
                            + "A" * 220,
                        }
                    ],
                },
            },
            {
                "timestamp": "2026-01-01T00:02:00Z",
                "type": "event_msg",
                "payload": {"type": "turn_aborted", "reason": "interrupted"},
            },
        ]
        self.rollout.write_text(
            "\n".join(json.dumps(record) for record in records) + "\n", encoding="utf-8"
        )
        old = time.time() - 10 * 86400
        os.utime(self.rollout, (old, old))
        with sqlite3.connect(self.db) as connection:
            connection.executescript(
                """
                CREATE TABLE threads (
                    id TEXT PRIMARY KEY,
                    rollout_path TEXT,
                    updated_at INTEGER,
                    updated_at_ms INTEGER,
                    thread_source TEXT,
                    agent_path TEXT,
                    agent_nickname TEXT,
                    name TEXT
                );
                CREATE TABLE thread_spawn_edges (
                    parent_thread_id TEXT,
                    child_thread_id TEXT,
                    status TEXT
                );
                """
            )
            connection.execute(
                "INSERT INTO threads VALUES (?, ?, ?, ?, 'subagent', '/root/test_agent', '', '')",
                (THREAD_ID, str(self.rollout), int(old), int(old * 1000)),
            )
            connection.execute(
                "INSERT INTO thread_spawn_edges VALUES (?, ?, 'open')",
                (PARENT_ID, THREAD_ID),
            )
        self.module = load_module()

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def arguments(self, *, execute: bool = False) -> list[str]:
        values = [
            "--source",
            str(self.source),
            "--state-db",
            str(self.db),
            "--repo-root",
            str(self.repo),
            "--output-dir",
            str(self.output),
            "--thread-id",
            THREAD_ID,
        ]
        if execute:
            values.append("--execute")
        return values

    def invoke(self, values: list[str]) -> tuple[int, str, str]:
        stdout, stderr = io.StringIO(), io.StringIO()
        with mock.patch.object(self.module, "rollout_is_open", return_value=False):
            with redirect_stdout(stdout), redirect_stderr(stderr):
                result = self.module.main(values)
        return result, stdout.getvalue(), stderr.getvalue()

    def test_dry_run_creates_nothing(self) -> None:
        result, stdout, stderr = self.invoke(self.arguments())
        self.assertEqual(result, 0, stderr)
        self.assertIn("DRY RUN", stdout)
        self.assertFalse(self.output.exists())

    def test_execute_only_keeps_sanitized_agent_messages(self) -> None:
        before = self.rollout.stat()
        result, stdout, stderr = self.invoke(self.arguments(execute=True))
        self.assertEqual(result, 0, stderr)
        self.assertIn("source rollouts retained", stdout)
        recovery = next(self.output.glob("test_agent-*.md")).read_text(encoding="utf-8")
        self.assertIn("Finding: tests pass", recovery)
        self.assertIn("[REDACTED]", recovery)
        self.assertIn("[REDACTED LONG ENCODED VALUE]", recovery)
        self.assertNotIn("super-secret-value", recovery)
        self.assertNotIn("DO NOT COPY PROMPT", recovery)
        self.assertNotIn("DO NOT COPY TOOL OUTPUT", recovery)
        self.assertEqual(recovery.count("Finding: tests pass"), 1)
        manifest = json.loads((self.output / "selection.json").read_text())
        self.assertEqual(manifest["total_threads"], 1)
        self.assertEqual(manifest["threads"][0]["terminal_signal"], "turn_aborted")
        after = self.rollout.stat()
        self.assertEqual(
            (before.st_ino, before.st_size, before.st_mtime_ns),
            (after.st_ino, after.st_size, after.st_mtime_ns),
        )

    def test_refuses_output_outside_fixed_repository_location(self) -> None:
        values = self.arguments()
        index = values.index("--output-dir") + 1
        values[index] = str(self.repo / "elsewhere")
        result, _stdout, stderr = self.invoke(values)
        self.assertEqual(result, 2)
        self.assertIn("output must be exactly", stderr)

    def test_open_check_ignores_only_its_own_reader_pid(self) -> None:
        own = os.getpid()
        with mock.patch.object(
            self.module.subprocess,
            "run",
            return_value=mock.Mock(returncode=0, stdout=f"p{own}\nn{self.rollout}\n"),
        ):
            self.assertFalse(self.module.rollout_is_open(self.rollout))
        with mock.patch.object(
            self.module.subprocess,
            "run",
            return_value=mock.Mock(
                returncode=0,
                stdout=f"p{own}\nn{self.rollout}\np999999\nn{self.rollout}\n",
            ),
        ):
            self.assertTrue(self.module.rollout_is_open(self.rollout))


if __name__ == "__main__":
    unittest.main()
