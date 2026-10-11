#!/usr/bin/env node
// Compile rejection only; this does not replace native cross-package VM tests.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
let rejected = false
try {
  execFileSync('sui', ['move', 'build', '--path', path.join(root, 'move/soulidity/probes/equipment_guard'), '--warnings-are-errors'],
    { encoding: 'utf8', stdio: 'pipe' })
} catch (error) {
  const diagnostic = `${error.stdout ?? ''}\n${error.stderr ?? ''}`.replace(/\u001b\[[0-9;]*m/g, '')
  assert.deepEqual([...diagnostic.matchAll(/error\[([^\]]+)\]/g)].map(m => m[1]), ['EC05001'], diagnostic)
  assert.match(diagnostic, /SoulEquipmentUpdateV8' does not have the ability 'drop'/)
  rejected = true
}
assert(rejected, 'An unfinished Soul equipment update was unexpectedly droppable')
process.stdout.write('PASS: unfinished Soul equipment guard rejected specifically for missing drop ability.\n')
