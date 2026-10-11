#!/usr/bin/env python3
"""Invariants for the frozen 21-thread offline archive runner."""

from __future__ import annotations

from contextlib import redirect_stderr, redirect_stdout
import importlib.util
import io
from pathlib import Path
import sys
import unittest
from unittest import mock


SCRIPT_PATH = Path(__file__).with_name("archive_approved_21.py")


def load_module():
    spec = importlib.util.spec_from_file_location("approved_archive_under_test", SCRIPT_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError("unable to load archive_approved_21.py")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


class ApprovedArchiveTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.module = load_module()

    def test_frozen_selection_matches_recovery_pack(self) -> None:
        approved = self.module.load_approved_selection()
        self.assertEqual(len(approved), 21)
        self.assertEqual(
            {entry["thread_id"] for entry in approved},
            set(self.module.APPROVED_THREAD_IDS),
        )
        self.assertEqual(
            sum(entry["source_size"] for entry in approved),
            self.module.EXPECTED_TOTAL_BYTES,
        )
        sizes = [entry["source_size"] for entry in approved]
        self.assertEqual(sizes, sorted(sizes))

    def test_archive_command_has_only_fixed_explicit_ids(self) -> None:
        command = self.module.archive_command(
            list(self.module.APPROVED_THREAD_IDS), execute=False
        )
        self.assertNotIn("--execute", command)
        self.assertNotIn("--allow-quiescent-legacy", command)
        self.assertIn("--remove-source", command)
        self.assertEqual(command.count("--completed-thread-id"), 21)
        self.assertEqual(command[command.index("--archive-root") + 1], str(self.module.ARCHIVE_ROOT))

    def test_execute_requires_offline_acknowledgement(self) -> None:
        stdout = io.StringIO()
        stderr = io.StringIO()
        with (
            redirect_stdout(stdout),
            redirect_stderr(stderr),
            mock.patch.object(self.module.subprocess, "run") as run,
        ):
            result = self.module.main(["--execute"])
        self.assertEqual(result, 2)
        self.assertIn("requires --acknowledge-codex-offline", stderr.getvalue())
        run.assert_not_called()


if __name__ == "__main__":
    unittest.main()
