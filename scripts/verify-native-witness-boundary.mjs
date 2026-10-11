#!/usr/bin/env node
// Compiler visibility boundary only; this is not a native mint runtime test.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = path.join(root, 'move/soulidity/probes/native_witness_private');
let rejected = false;
try {
  execFileSync('sui', ['move', 'build', '--path', target, '--warnings-are-errors'],
    { encoding: 'utf8', stdio: 'pipe' });
} catch (error) {
  const diagnostic = `${error.stdout ?? ''}\n${error.stderr ?? ''}`.replace(/\u001b\[[0-9;]*m/g, '');
  const errors = [...diagnostic.matchAll(/error\[([^\]]+)\]/g)].map(match => match[1]);
  assert.deepEqual(errors, ['EC04001', 'EC04001', 'EC04001'], diagnostic);
  assert.match(diagnostic, /Invalid call to 'public\(package\)' visible function 'soulidity::animacraft_v8_binding::owner_witness'/);
  assert.match(diagnostic, /Invalid call to 'public\(package\)' visible function 'soulidity::animacraft_v8_binding::read_owner_witness'/);
  assert.match(diagnostic, /Invalid call to 'public\(package\)' visible function 'soulidity::animacraft_v8_binding::mint_witness'/);
  rejected = true;
}
assert(rejected, 'An external package unexpectedly obtained private native Soul witnesses');
process.stdout.write('PASS: external owner/read-owner/mint witness factories rejected specifically for package visibility.\n');
