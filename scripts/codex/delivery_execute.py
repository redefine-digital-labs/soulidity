#!/usr/bin/env python3
"""Guarded merge/stage entry for the current two-repository release.

No shell interpolation, arbitrary command execution, wallet or signing support.
Staging keeps aliases unchanged; production promotion has separate G3/G4 checks.
"""
import argparse
import hashlib
import json
import subprocess
from pathlib import Path

from delivery_gate import REPOS, check_item, check_authorization, live_ci, require


def execute(item, action, site, release_dir=None):
    check_item(item)
    require(site in REPOS, 'Unknown site')
    require(action in {'merge', 'stage'}, 'Unknown release action')
    check_authorization(item, 'merge' if action == 'merge' else 'deploy', REPOS[site])
    for member in REPOS:
        live_ci(item, member)
    candidate = item['pair'][site]
    if action == 'merge':
        # gh verifies the PR head again server-side, closing the inspect/merge race.
        require(isinstance(candidate.get('pr'), int) and candidate['pr'] > 0, 'Exact PR required')
        return subprocess.run(['gh', 'pr', 'merge', str(candidate['pr']), '--repo', REPOS[site],
                               '--merge', '--match-head-commit', candidate['commit']], check=True)
    require(release_dir is not None, 'Exact release directory required')
    release_dir = Path(release_dir).resolve()
    binding = item['execution'].get('staging_entry')
    require(binding and release_dir == Path(binding['directory']).resolve(), 'Unreviewed staging directory')
    entry = release_dir / 'stage.mjs'
    require(hashlib.sha256(entry.read_bytes()).hexdigest() == binding['sha256'], 'Staging entry changed')
    manifest = json.loads((release_dir / 'source-manifest.json').read_text())
    require(all(manifest[s]['commit'] == item['pair'][s]['commit'] for s in REPOS), 'Stale staging candidate')
    # stage.mjs additionally checks upload hashes, project identity, aliases and
    # an exclusive intent file; an uncertain outcome must be queried, not retried.
    return subprocess.run(['node', str(entry), site], check=True, cwd=release_dir)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['merge', 'stage'])
    parser.add_argument('--site', choices=list(REPOS), required=True)
    parser.add_argument('--item', type=Path, required=True)
    parser.add_argument('--release-dir', type=Path)
    args = parser.parse_args()
    execute(json.loads(args.item.read_text()), args.action, args.site, args.release_dir)
