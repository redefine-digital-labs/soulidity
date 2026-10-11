#!/usr/bin/env python3
"""Compile real foreign packages against the standard's production interfaces.

No signer/RPC. Negative cases must fail for their intended privacy/ability rule,
not missing dependencies. Pair each failure with the successful consumer build.
"""
import argparse
import hashlib
import json
import re
import subprocess
from pathlib import Path

HEADER = '''module foreign_probe::attack;
use soulidity_standard::soul::{Self, Soul, Edit, ModuleKey};
use independent_ability::ability::{Self, Witness, Ability};
'''
CASES = {
    'legal_consumer': (True, '', '''
public fun read(s: &Soul): u64 { ability::score(s) }
public fun remove(s: &mut Soul, revision: u64): Ability { ability::remove(s, revision) }
public fun transfer(s: Soul, recipient: address) { transfer::public_transfer(s, recipient) }
'''),
    'private_root_uid': (False, r'private|restricted|visibility|field.*accessible', '''
public fun attack(s: &mut Soul): &mut UID { &mut s.id }
'''),
    'forge_witness': (False, r'private|restricted|visibility|only.*defining', '''
public fun attack(): Witness { Witness {} }
'''),
    'forge_dof_key': (False, r'private|restricted|visibility|only.*defining', '''
public fun attack(): ModuleKey<Witness> { ModuleKey<Witness> { name: b"ability" } }
'''),
    'forge_edit': (False, r'private|restricted|visibility|only.*defining', '''
public fun attack(root: ID, child: ID): Edit<Witness, Ability> {
    Edit<Witness, Ability> { soul: root, object: child, name: b"ability", revision: 0 }
}
'''),
    'discard_edit': (False, r"drop.*ability|ability.*drop|does not have.*drop", '''
public fun attack(s: &mut Soul, w: Witness, ctx: &mut TxContext) {
    let (v, ticket) = soul::begin_update<Witness, Ability>(s, w, b"ability", 1);
    let _ = ticket;
    transfer::public_transfer(v, ctx.sender())
}
'''),
    'store_edit': (False, r"store.*ability|ability.*store|does not have.*store", '''
public struct Stash has key { id: UID, ticket: Edit<Witness, Ability> }
'''),
    'copy_edit': (False, r"copy.*ability|ability.*copy|does not have.*copy", '''
public fun attack(ticket: Edit<Witness, Ability>): (Edit<Witness, Ability>, Edit<Witness, Ability>) {
    (copy ticket, ticket)
}
'''),
    'transfer_edit': (False, r"key.*ability|store.*ability|ability constraint|does not have", '''
public fun attack(ticket: Edit<Witness, Ability>, recipient: address) {
    transfer::public_transfer(ticket, recipient)
}
'''),
    'unwrap_edit': (False, r'private|restricted|visibility|only.*defining', '''
public fun attack(ticket: Edit<Witness, Ability>) {
    let Edit<Witness, Ability> { soul: _, object: _, name: _, revision: _ } = ticket;
}
'''),
}


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--cli', type=Path, required=True)
    ap.add_argument('--output', type=Path, required=True)
    args = ap.parse_args()
    root = Path(__file__).resolve().parents[1]
    cli = args.cli.resolve()
    out = args.output.resolve()
    out.mkdir(parents=True, exist_ok=True)
    rows = []
    for name, (should_compile, expected, body) in CASES.items():
        package = out / 'packages' / name
        (package / 'sources').mkdir(parents=True, exist_ok=True)
        manifest = ('[package]\nname = "ForeignProbe"\nedition = "2024"\n'
                    '[dependencies]\nIndependentAbility = { local = '
                    + json.dumps(str(root / 'move/standard_examples/ability'))
                    + ' }\n[addresses]\nforeign_probe = "0x0"\n')
        (package / 'Move.toml').write_text(manifest)
        source = HEADER + body
        (package / 'sources/attack.move').write_text(source)
        result = subprocess.run([str(cli), 'move', 'build', '--path', str(package)],
                                capture_output=True, text=True)
        diagnostic = re.sub(r'\x1b\[[0-9;]*m', '', result.stdout + result.stderr)
        (out / f'{name}.log').write_text(diagnostic)
        codes = sorted(set(re.findall(r'error\[(EC\d+)\]', diagnostic)))
        structural = [c for c in codes if c.startswith(('EC01', 'EC02', 'EC03'))]
        passed = (result.returncode == 0) if should_compile else (
            result.returncode != 0 and bool(re.search(expected, diagnostic, re.I | re.S))
            and bool(codes) and not structural and 'attack.move:' in diagnostic)
        row = {'case': name, 'exit': result.returncode, 'expected_compile': should_compile,
               'matched_intended_rule': passed, 'source_sha256': hashlib.sha256(source.encode()).hexdigest(),
               'error_codes': codes, 'unrelated_structural_errors': structural,
               'log': str(out / f'{name}.log')}
        rows.append(row)
        print(json.dumps(row), flush=True)
    (out / 'results.json').write_text(json.dumps({'rows': rows,
        'passed': all(r['matched_intended_rule'] for r in rows),
        'scope': 'production foreign-package compiler privacy/abilities, not live PTB/upgrade proof'}, indent=2) + '\n')
    return 0 if all(r['matched_intended_rule'] for r in rows) else 1


if __name__ == '__main__':
    raise SystemExit(main())
