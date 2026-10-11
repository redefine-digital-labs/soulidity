#!/usr/bin/env python3
"""Fail a release gate when compiled package size already exceeds protocol limits.

Read-only: no compiler, wallet, signer, RPC, deployment, or protocol overrides.
The package byte count is a PROVEN LOWER BOUND, not an exact MovePackage size:
Sui also includes type origins and dependency linkage. Passing the lower bound
therefore never establishes publication acceptance. Module handles are decoded
from actual bytecode; they are dependencies, not a complete authority graph.
"""
import argparse
import hashlib
import json
from pathlib import Path


def uleb(data, pos):
    result = shift = 0
    while True:
        if pos >= len(data) or shift > 63:
            raise ValueError('Invalid ULEB')
        value = data[pos]
        pos += 1
        result |= (value & 127) << shift
        if value < 128:
            return result, pos
        shift += 7


def module_handles(data):
    if data[:4] != bytes.fromhex('a11ceb0b'):
        raise ValueError('Expected compiled Move module')
    # Move v7, including the Sui flavor tag in the high byte. Reject other layouts.
    version = int.from_bytes(data[4:8], 'little')
    if version & 0xffffff != 7:
        raise ValueError('Unsupported bytecode layout: %s' % version)
    count, pos = uleb(data, 8)
    tables = {}
    for _ in range(count):
        kind = data[pos]
        offset, pos = uleb(data, pos + 1)
        size, pos = uleb(data, pos)
        if kind in tables:
            raise ValueError('Duplicate table')
        tables[kind] = (offset, size)
    base = pos
    def table(kind):
        offset, size = tables[kind]
        value = data[base + offset:base + offset + size]
        if len(value) != size:
            raise ValueError('Truncated table')
        return value
    identifiers, pos = [], 0
    raw = table(7)
    while pos < len(raw):
        size, pos = uleb(raw, pos)
        identifiers.append(raw[pos:pos + size].decode('utf8'))
        pos += size
    addresses = table(8)
    if len(addresses) % 32:
        raise ValueError('Invalid address table')
    addresses = [addresses[i:i + 32].hex() for i in range(0, len(addresses), 32)]
    handles, pos, raw = [], 0, table(1)
    while pos < len(raw):
        address, pos = uleb(raw, pos)
        name, pos = uleb(raw, pos)
        handles.append({'address': '0x' + addresses[address], 'module': identifiers[name]})
    # A compiled module ends with its self-module-handle index, after all table data.
    end = base + max(offset + size for offset, size in tables.values())
    self_index, end = uleb(data, end)
    if end != len(data):
        raise ValueError('Unexpected trailing module data')
    return handles[self_index], handles


def analyze(directory, protocol_path):
    protocol = json.loads(protocol_path.read_text())
    protocol = protocol.get('result', protocol)
    limits = protocol['attributes']
    package_limit = int(limits['max_move_package_size']['u64'])
    tx_limit = int(limits['max_tx_size_bytes']['u64'])
    rows = []
    for path in sorted(directory.glob('*.mv')):
        raw = path.read_bytes()
        identity, handles = module_handles(raw)
        if identity['module'] != path.stem:
            raise ValueError('File/self-module mismatch')
        rows.append({'module': path.stem, 'address': identity['address'], 'bytes': len(raw),
                     'sha256': hashlib.sha256(raw).hexdigest(), 'handles': handles})
    if not rows:
        raise ValueError('No compiled modules')
    names = {row['module'] for row in rows}
    graph = {row['module']: sorted({h['module'] for h in row['handles']
             if h['address'] == row['address'] and h['module'] in names
             and h['module'] != row['module']}) for row in rows}
    sizes = {row['module']: row['bytes'] + len(row['module'].encode()) for row in rows}
    def closure(name, seen):
        if name in seen:
            return
        seen.add(name)
        for dependency in graph[name]:
            closure(dependency, seen)
    closures = []
    for name in sorted(names):
        required = set()
        closure(name, required)
        closures.append({'entry_module': name, 'required_modules': sorted(required),
                         'package_size_lower_bound': 8 + sum(sizes[n] for n in required)})
    lower_bound = 8 + sum(sizes.values())
    return {'protocol_version': protocol['protocolVersion'], 'module_count': len(rows),
            'bytecode_bytes': sum(row['bytes'] for row in rows),
            'package_size_lower_bound': lower_bound, 'max_move_package_size': package_limit,
            'max_tx_size_bytes': tx_limit, 'package_known_oversize': lower_bound > package_limit,
            'gate_passed': False,
            'gate_result': 'FAIL_PROVEN_OVERSIZE' if lower_bound > package_limit else 'EXACT_SIZE_AND_REAL_PUBLISH_REQUIRED',
            'source': 'Sui MovePackage::size = 8 + module names/bytes + type origins + linkage',
            'limit': 'Lower bound omits type origin and linkage bytes. Module-handle closure is not a package partition or security/authority acceptance.',
            'modules': rows, 'dependency_graph': graph, 'dependency_closures': closures}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--bytecode-directory', type=Path, required=True)
    parser.add_argument('--protocol-json', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    result = analyze(args.bytecode_directory, args.protocol_json)
    args.output.write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps({k: result[k] for k in ['module_count', 'bytecode_bytes', 'package_size_lower_bound',
          'max_move_package_size', 'max_tx_size_bytes', 'gate_result']}))
    return 1 if result['package_known_oversize'] else 2


if __name__ == '__main__':
    raise SystemExit(main())
