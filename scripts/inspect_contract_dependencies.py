#!/usr/bin/env python3
"""Snapshot local Move source references; this is not a bytecode call graph."""
import argparse
import hashlib
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PACKAGES = ['soulidity_application', 'soulidity_standard', 'soulidity_model', 'soulidity_content', 'soulidity_v1', 'soulidity_foundation', 'soulidity_visual', 'soulidity_community']

def inspect():
    modules = {}
    for package in PACKAGES:
        for path in sorted((ROOT / 'move' / package / 'sources').glob('*.move')):
            raw = path.read_text()
            clean = re.sub(r'/\*.*?\*/', lambda m: '\n' * m[0].count('\n'), raw, flags=re.S)
            clean = re.sub(r'//[^\n]*', '', clean)
            module = re.search(r'\bmodule\s+(\w+::\w+)\s*[;{]', clean)[1]
            refs = {}
            for match in re.finditer(r'\b(soulidity_\w+::\w+)\b', clean):
                target = match[1]
                if target != module:
                    refs.setdefault(target, set()).add(clean[:match.start()].count('\n') + 1)
            modules[module] = {
                'package': package, 'path': str(path.relative_to(ROOT)),
                'sha256': hashlib.sha256(raw.encode()).hexdigest(),
                'dependencies': {k: sorted(v) for k, v in sorted(refs.items())},
            }
    unknown = sorted({r for m in modules.values() for r in m['dependencies'] if r not in modules})
    if unknown:
        raise ValueError(f'Unresolved local module references: {unknown}')
    edges = [{'from': name, 'to': target, 'lines': lines}
             for name, m in sorted(modules.items()) for target, lines in m['dependencies'].items()]
    package_edges = sorted({(modules[e['from']]['package'], modules[e['to']]['package'])
                            for e in edges if modules[e['from']]['package'] != modules[e['to']]['package']})
    return {'scope': 'production sources only; textual local module references, not calls or deployed ABI',
            'modules': modules, 'edges': edges, 'package_edges': package_edges,
            'counts': {p: sum(m['package'] == p for m in modules.values()) for p in PACKAGES}}

def mermaid(data):
    ids = {name: 'node' + str(i) for i, name in enumerate(sorted(data['modules']))}
    lines = ['flowchart LR']
    for i, package in enumerate(PACKAGES):
        lines.append(f'    subgraph package{i}["{package}: {data["counts"][package]} modules"]')
        for name, m in sorted(data['modules'].items()):
            if m['package'] == package:
                lines.append(f'        {ids[name]}["{name.split("::")[1]}"]')
        lines.append('    end')
    lines.extend(f'    {ids[e["from"]]} --> {ids[e["to"]]}' for e in data['edges'])
    return '\n'.join(lines) + '\n'

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    data = inspect()
    (args.output / 'source-dependencies.json').write_text(json.dumps(data, indent=2) + '\n')
    (args.output / 'all-modules.mmd').write_text(mermaid(data))
    table = ['# Current production source dependencies', '', data['scope'], '',
             'Arrow: consumer → referenced module. Not every reference is a runtime call.', '',
             '| Module | References | Source |', '|---|---|---|']
    for name, m in sorted(data['modules'].items()):
        deps = ', '.join(m['dependencies']) or 'No local dependency'
        table.append(f'| {name} | {deps} | [{m["path"]}]({ROOT / m["path"]}) |')
    (args.output / 'source-dependencies.md').write_text('\n'.join(table) + '\n')
    print(json.dumps({'counts': data['counts'], 'modules': len(data['modules']),
                      'edges': len(data['edges']), 'package_edges': data['package_edges']}))
