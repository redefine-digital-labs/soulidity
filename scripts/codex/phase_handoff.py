#!/usr/bin/env python3
"""Create a compact, durable Soulidity phase handoff.

The command never commits, pushes, or changes source files. It writes one new
Markdown handoff and, only with --update-current, atomically refreshes the
managed docs/codex/CURRENT.md pointer.
"""

from __future__ import annotations

import argparse
from contextlib import contextmanager
import datetime as dt
import fcntl
import hashlib
import os
from pathlib import Path
import re
import stat
import subprocess
import sys
import tempfile


MAX_STATUS_LINES = 40
MAX_HANDOFF_BYTES = 64 * 1024
MAX_LIST_ITEMS = 50
CURRENT_MARKER = "<!-- managed-by: scripts/codex/phase_handoff.py -->"


class HandoffError(RuntimeError):
    pass


def run_git(root: Path, *args: str, check: bool = True) -> str:
    result = subprocess.run(
        ["git", "-C", str(root), *args],
        check=False,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    if check and result.returncode != 0:
        detail = result.stderr.strip() or result.stdout.strip() or "unknown git error"
        raise HandoffError(f"git {' '.join(args)} failed: {detail}")
    return result.stdout.rstrip("\n")


def repository_root(candidate: Path) -> Path:
    top = run_git(candidate.resolve(), "rev-parse", "--show-toplevel")
    return Path(top).resolve()


def slugify(value: str) -> str:
    slug = re.sub(r"[^A-Za-z0-9]+", "-", value.strip()).strip("-").lower()
    return slug[:64] or "phase"


def bullets(values: list[str], empty: str) -> str:
    return "\n".join(f"- {value}" for value in values) if values else f"- {empty}"


def validate_args(args: argparse.Namespace) -> None:
    limits = {
        "phase": 80,
        "goal": 500,
        "summary": 2_000,
        "next_action": 1_000,
    }
    for name, limit in limits.items():
        value = getattr(args, name)
        if not value.strip():
            raise HandoffError(f"--{name.replace('_', '-')} must not be blank")
        if len(value.encode("utf-8")) > limit:
            raise HandoffError(f"--{name.replace('_', '-')} exceeds {limit} UTF-8 bytes")
        if name != "summary" and ("\n" in value or "\r" in value):
            raise HandoffError(f"--{name.replace('_', '-')} must be a single line")

    list_fields = (
        "scope",
        "non_goal",
        "decision",
        "changed_path",
        "asset",
        "commit_ref",
        "check",
        "risk",
        "recovery",
    )
    for name in list_fields:
        values = getattr(args, name)
        if len(values) > MAX_LIST_ITEMS:
            raise HandoffError(f"--{name.replace('_', '-')} may be repeated at most {MAX_LIST_ITEMS} times")
        for value in values:
            if not value.strip() or "\n" in value or "\r" in value:
                raise HandoffError(f"--{name.replace('_', '-')} values must be non-blank single lines")
            if len(value.encode("utf-8")) > 500:
                raise HandoffError(f"--{name.replace('_', '-')} value exceeds 500 UTF-8 bytes")

    if args.status == "complete":
        if not args.check:
            raise HandoffError("--status complete requires at least one --check ending in PASS")
        non_passing = [check for check in args.check if not re.search(r"(?:^|[\s:—-])PASS\s*$", check, re.I)]
        if non_passing:
            raise HandoffError("every --check for --status complete must end in PASS")


def git_snapshot(root: Path) -> dict[str, object]:
    branch = run_git(root, "symbolic-ref", "--quiet", "--short", "HEAD", check=False)
    if not branch:
        branch = "(detached HEAD)"
    commit = run_git(root, "rev-parse", "HEAD")
    status_lines = run_git(root, "status", "--short", "--untracked-files=normal").splitlines()
    if status_lines:
        status_label = f"dirty ({len(status_lines)} status entries)"
    else:
        status_label = "clean"
    return {
        "branch": branch,
        "commit": commit,
        "status_label": status_label,
        "status_lines": status_lines,
    }


def render_handoff(args: argparse.Namespace, root: Path, target: Path) -> str:
    now = dt.datetime.now().astimezone()
    snapshot = git_snapshot(root)
    status_lines = list(snapshot["status_lines"])
    preview = status_lines[:MAX_STATUS_LINES]
    omitted = len(status_lines) - len(preview)
    if preview:
        status_detail = "```text\n" + "\n".join(preview)
        if omitted:
            status_detail += f"\n... {omitted} additional status entries omitted"
        status_detail += "\n```"
    else:
        status_detail = "Working tree was clean."

    changed_paths = args.changed_path

    relative_target = target.relative_to(root)
    return f"""# Soulidity Phase Handoff: {args.phase}

## Snapshot

- Created: {now.isoformat(timespec="seconds")}
- Phase: {args.phase}
- Status: {args.status}
- Goal: {args.goal}
- Worktree: `{root}`
- Branch: `{snapshot['branch']}`
- Commit: `{snapshot['commit']}`
- Working tree: {snapshot['status_label']}
- Handoff: `{relative_target}`

## Outcome

{args.summary}

## Scope and non-goals

### In scope

{bullets(args.scope, "Use the goal statement as the recorded scope.")}

### Intentionally not done

{bullets(args.non_goal, "No additional non-goals recorded.")}

## Durable decisions

{bullets(args.decision, "No durable decisions recorded for this boundary.")}

## Changed paths and assets

### Changed paths

{bullets(changed_paths, "No changed paths recorded.")}

### Image and binary assets

{bullets(args.asset, "No image or binary assets recorded.")}

### Relevant commits

{bullets(args.commit_ref, "No additional commit references recorded.")}

## Verification

{bullets(args.check, "No verification command recorded; treat the phase as unverified.")}

## Risks and recovery

### Risks or blockers

{bullets(args.risk, "No additional risk recorded.")}

### Recovery or rollback points

{bullets(args.recovery, "Use the snapshot commit and preserve all uncommitted files shown below.")}

### Working-tree evidence

{status_detail}

## Exact next action

{args.next_action}
"""


def render_current(args: argparse.Namespace, root: Path, target: Path) -> str:
    now = dt.datetime.now().astimezone()
    snapshot = git_snapshot(root)
    relative_target = target.relative_to(root)
    checks = "; ".join(args.check) if args.check else "not recorded"
    decisions = "; ".join(args.decision) if args.decision else "see handoff"
    risks = "; ".join(args.risk) if args.risk else "see handoff and current Git status"
    return f"""{CURRENT_MARKER}

# Soulidity Current Phase

This is the compact entry point for continuing Soulidity work. Keep it short; link to source, tests, commits, and a handoff instead of copying chat history here.

- Stable cross-phase memory: `docs/codex/PROJECT_MEMORY.md`
- Last updated: {now.isoformat(timespec="seconds")}
- Status: {args.status}
- Phase: {args.phase}
- Goal: {args.goal}
- Constraints / non-goals: {'; '.join(args.non_goal) if args.non_goal else 'see handoff'}
- Acceptance checks: {checks}
- Worktree / branch / commit: `{root}` / `{snapshot['branch']}` / `{snapshot['commit']}`
- Durable decisions: {decisions}
- Verification: {checks}
- Risks / blockers: {risks}
- Exact next action: {args.next_action}
- Latest handoff: `{relative_target}`

Read the linked handoff before continuing. Start a new task if the goal or release phase changes materially.
"""


def write_new(path: Path, content: str) -> None:
    ensure_plain_directory(path.parent)
    if path.exists():
        raise HandoffError(f"refusing to overwrite existing handoff: {path}")
    descriptor, temporary_name = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    temporary = Path(temporary_name)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8", newline="\n") as handle:
            handle.write(content)
            handle.flush()
            os.fsync(handle.fileno())
        os.chmod(temporary, 0o644)
        os.link(temporary, path)
        directory_fd = os.open(path.parent, os.O_RDONLY)
        try:
            os.fsync(directory_fd)
        finally:
            os.close(directory_fd)
    finally:
        temporary.unlink(missing_ok=True)


def replace_managed(path: Path, content: str) -> None:
    ensure_plain_directory(path.parent)
    if path.exists() or path.is_symlink():
        target_stat = path.lstat()
        if stat.S_ISLNK(target_stat.st_mode) or not stat.S_ISREG(target_stat.st_mode):
            raise HandoffError(f"managed file must be a regular non-symlink file: {path}")
    descriptor, temporary_name = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    temporary = Path(temporary_name)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8", newline="\n") as handle:
            handle.write(content)
            handle.flush()
            os.fsync(handle.fileno())
        os.chmod(temporary, 0o644)
        os.replace(temporary, path)
        directory_fd = os.open(path.parent, os.O_RDONLY)
        try:
            os.fsync(directory_fd)
        finally:
            os.close(directory_fd)
    finally:
        temporary.unlink(missing_ok=True)


def path_within(path: Path, root: Path) -> bool:
    try:
        path.relative_to(root)
        return True
    except ValueError:
        return False


def ensure_plain_directory(path: Path) -> None:
    """Create missing directories while rejecting symlink path components."""
    missing: list[Path] = []
    cursor = path
    while not cursor.exists() and not cursor.is_symlink():
        missing.append(cursor)
        if cursor.parent == cursor:
            break
        cursor = cursor.parent
    if not cursor.exists() and not cursor.is_symlink():
        raise HandoffError(f"cannot find an existing parent for {path}")
    current_stat = cursor.lstat()
    if stat.S_ISLNK(current_stat.st_mode) or not stat.S_ISDIR(current_stat.st_mode):
        raise HandoffError(f"directory component is not a plain directory: {cursor}")
    for component in reversed(missing):
        component.mkdir(mode=0o755)
        current_stat = component.lstat()
        if stat.S_ISLNK(current_stat.st_mode) or not stat.S_ISDIR(current_stat.st_mode):
            raise HandoffError(f"directory component is not a plain directory: {component}")


def reject_symlink_components(path: Path, stop: Path) -> None:
    """Reject existing symlink/non-directory components without creating paths."""
    stop = stop.resolve()
    try:
        relative = path.relative_to(stop)
    except ValueError as exc:
        raise HandoffError(f"path escapes repository: {path}") from exc
    cursor = stop
    for part in relative.parts:
        cursor = cursor / part
        if not cursor.exists() and not cursor.is_symlink():
            continue
        current_stat = cursor.lstat()
        if stat.S_ISLNK(current_stat.st_mode) or not stat.S_ISDIR(current_stat.st_mode):
            raise HandoffError(f"directory component is not a plain directory: {cursor}")


def current_token(path: Path) -> tuple[int, int, int, int, str] | None:
    if not path.exists() and not path.is_symlink():
        return None
    item_stat = path.lstat()
    if stat.S_ISLNK(item_stat.st_mode) or not stat.S_ISREG(item_stat.st_mode):
        raise HandoffError(f"managed file must be a regular non-symlink file: {path}")
    data = path.read_bytes()
    if CURRENT_MARKER.encode("utf-8") not in data[:256]:
        raise HandoffError(f"refusing to replace CURRENT.md without the managed marker: {path}")
    return (
        item_stat.st_dev,
        item_stat.st_ino,
        item_stat.st_size,
        item_stat.st_mtime_ns,
        hashlib.sha256(data).hexdigest(),
    )


@contextmanager
def phase_lock(root: Path):
    common = Path(run_git(root, "rev-parse", "--git-common-dir"))
    if not common.is_absolute():
        common = root / common
    common = common.resolve()
    lock_path = common / "codex-phase-handoff.lock"
    if lock_path.exists() or lock_path.is_symlink():
        lock_stat = lock_path.lstat()
        if stat.S_ISLNK(lock_stat.st_mode) or not stat.S_ISREG(lock_stat.st_mode):
            raise HandoffError(f"handoff lock must be a regular non-symlink file: {lock_path}")
    flags = os.O_CREAT | os.O_RDWR
    if hasattr(os, "O_NOFOLLOW"):
        flags |= os.O_NOFOLLOW
    descriptor = os.open(lock_path, flags, 0o600)
    try:
        os.fchmod(descriptor, 0o600)
        fcntl.flock(descriptor, fcntl.LOCK_EX)
        yield
    finally:
        fcntl.flock(descriptor, fcntl.LOCK_UN)
        os.close(descriptor)


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", type=Path, default=Path.cwd(), help="repository or path inside it")
    parser.add_argument("--phase", required=True, help="short phase name")
    parser.add_argument("--goal", required=True, help="one bounded outcome")
    parser.add_argument("--status", choices=("in-progress", "complete", "paused", "blocked"), required=True)
    parser.add_argument("--summary", required=True, help="short outcome summary")
    parser.add_argument("--next-action", required=True, help="one exact next action")
    parser.add_argument("--scope", action="append", default=[], help="in-scope item; repeatable")
    parser.add_argument("--non-goal", action="append", default=[], help="intentional exclusion; repeatable")
    parser.add_argument("--decision", action="append", default=[], help="durable decision; repeatable")
    changed = parser.add_mutually_exclusive_group(required=True)
    changed.add_argument("--changed-path", action="append", default=[], help="relevant changed path; repeatable")
    changed.add_argument("--no-changed-paths", action="store_true", help="record that the phase changed no files")
    parser.add_argument("--asset", action="append", default=[], help="image or binary asset path; repeatable")
    parser.add_argument("--commit-ref", action="append", default=[], help="relevant commit; repeatable")
    parser.add_argument("--check", action="append", default=[], help="verification command and result; repeatable")
    parser.add_argument("--risk", action="append", default=[], help="risk or blocker; repeatable")
    parser.add_argument("--recovery", action="append", default=[], help="recovery point; repeatable")
    parser.add_argument("--output", type=Path, help="handoff path inside the repository")
    parser.add_argument("--update-current", action="store_true", help="atomically refresh docs/codex/CURRENT.md")
    parser.add_argument("--dry-run", action="store_true", help="print the handoff without writing files")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv or sys.argv[1:])
    try:
        validate_args(args)
        root = repository_root(args.repo)
        script_root = repository_root(Path(__file__).resolve().parent)
        if root != script_root:
            raise HandoffError(f"--repo must resolve to the Soulidity root containing this script: {script_root}")
        timestamp = dt.datetime.now().astimezone().strftime("%Y%m%d-%H%M%S")
        target = args.output or Path("docs/codex/handoffs") / f"{timestamp}-{slugify(args.phase)}.md"
        if not target.is_absolute():
            target = root / target
        target = Path(os.path.abspath(target))
        handoff_root = root / "docs/codex/handoffs"
        current_target = root / "docs/codex/CURRENT.md"
        if target.parent != handoff_root or target.suffix.lower() != ".md":
            raise HandoffError("handoff output must be a .md file directly under docs/codex/handoffs")
        if not path_within(handoff_root, root) or not path_within(current_target, root):
            raise HandoffError("docs/codex paths must stay inside the repository")
        reject_symlink_components(handoff_root, root)
        reject_symlink_components(current_target.parent, root)
        if args.dry_run:
            if target.exists() or target.is_symlink():
                raise HandoffError(f"refusing to overwrite existing handoff: {target}")
            if args.update_current:
                current_token(current_target)
            handoff = render_handoff(args, root, target)
            if len(handoff.encode("utf-8")) > MAX_HANDOFF_BYTES:
                raise HandoffError(f"rendered handoff exceeds {MAX_HANDOFF_BYTES} bytes")
            print(f"DRY RUN: would write {target}", file=sys.stderr)
            if args.update_current:
                print(f"DRY RUN: would update {current_target}", file=sys.stderr)
            print(handoff)
            return 0

        with phase_lock(root):
            if target.exists() or target.is_symlink():
                raise HandoffError(f"refusing to overwrite existing handoff: {target}")
            expected_current = current_token(current_target) if args.update_current else None
            handoff = render_handoff(args, root, target)
            if len(handoff.encode("utf-8")) > MAX_HANDOFF_BYTES:
                raise HandoffError(f"rendered handoff exceeds {MAX_HANDOFF_BYTES} bytes")
            write_new(target, handoff)
            if args.update_current:
                try:
                    current = render_current(args, root, target)
                    if len(current.encode("utf-8")) > MAX_HANDOFF_BYTES:
                        raise HandoffError(f"rendered CURRENT.md exceeds {MAX_HANDOFF_BYTES} bytes")
                    if current_token(current_target) != expected_current:
                        raise HandoffError("CURRENT.md changed while the handoff was being generated")
                    replace_managed(current_target, current)
                except (HandoffError, OSError) as exc:
                    raise HandoffError(f"handoff preserved at {target}; CURRENT.md was not updated: {exc}") from exc
            print(target)
        return 0
    except (HandoffError, OSError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
