import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { parse } from 'yaml'

const workflow = parse(readFileSync('.github/workflows/soulidity-fast-path-smoke.yml', 'utf8'))
const job = workflow.jobs['pr-gates'], steps = job.steps
const step = (name: string) => {
  const value = steps.find((candidate: { name?: string }) => candidate.name === name)
  expect(value, name).toBeDefined()
  return value
}
it('accepts a required per-run exact peer input without changing repository variables', () => {
  expect(workflow.on.workflow_dispatch?.inputs?.animacraft_commit_sha).toMatchObject({ required: true, type: 'string' })
  expect(job.env.ANIMACRAFT_COMMIT_SHA).toBe('${{ inputs.animacraft_commit_sha || vars.ANIMACRAFT_COMMIT_SHA }}')
})
it('requires an exact public peer commit and proves the checkout before source execution', () => {
  const validate = step('Require exact paired source revision'), checkout = step('Checkout paired Animacraft source')
  const verify = step('Verify paired source checkout')
  expect(validate.run).toContain('^[0-9a-f]{40}$')
  expect(validate.run).toContain('exit 1')
  expect(steps.indexOf(validate)).toBeLessThan(steps.indexOf(checkout))
  // Cross-product JS tests need the exact peer, but must not discover its suite.
  expect(steps.indexOf(verify)).toBeLessThan(steps.indexOf(step('Run TS unit + integration tests')))
  expect(job.env.ANIMACRAFT_WORKSPACE).toBe('${{ github.workspace }}/_paired/animacraft')
  const installPeer = step('Install paired Animacraft dependencies')
  expect(installPeer['working-directory']).toBe('_paired/animacraft')
  expect(installPeer.run).toBe('npm ci')
  expect(steps.indexOf(verify)).toBeLessThan(steps.indexOf(installPeer))
  expect(steps.indexOf(installPeer)).toBeLessThan(steps.indexOf(step('Run TS unit + integration tests')))
  expect(readFileSync('vitest.config.ts', 'utf8')).toContain("'_paired/**'")
  expect(steps.indexOf(checkout)).toBeLessThan(steps.indexOf(verify))
  expect(checkout.with).toMatchObject({ repository: 'redefine-digital-labs/animacraft',
    ref: '${{ env.ANIMACRAFT_COMMIT_SHA }}', path: '_paired/animacraft', 'persist-credentials': false })
  expect(job.env.ANIMACRAFT_COMMIT_SHA).toBe('${{ inputs.animacraft_commit_sha || vars.ANIMACRAFT_COMMIT_SHA }}')
  expect(verify.run).toContain('test "$(git -C _paired/animacraft rev-parse HEAD)" = "$ANIMACRAFT_COMMIT_SHA"')
  expect(verify.run.indexOf('rev-parse HEAD')).toBeLessThan(verify.run.indexOf('node --test'))
  expect(job.permissions).toEqual({ contents: 'read' })
})
it('pins the verified Linux archive and checks its digest before extraction/execution', () => {
  expect(job['runs-on']).toBe('ubuntu-24.04')
  expect(job.env).toMatchObject({ SUI_RELEASE: 'mainnet-v1.80.1',
    SUI_ARCHIVE: 'sui-mainnet-v1.80.1-ubuntu-x86_64.tgz',
    SUI_ARCHIVE_SHA256: '97f9aed10e0c2fe3204ce4639ac992e1449b17c14f22f30e9f903ead54ac7336' })
  const install = step('Install pinned Sui CLI').run
  expect(install).toContain('sha256sum --check --strict')
  expect(install.indexOf('sha256sum --check --strict')).toBeLessThan(install.indexOf('tar -xOzf'))
  expect(install.indexOf('tar -xOzf')).toBeLessThan(install.indexOf('"$binary" --version'))
  expect(install).toContain('sui 1.80.1-671ba71e69c7')
})
it('runs the complete paired graph and retains evidence, never a local-path or filtered substitute', () => {
  const gate = step('Run paired eight-package Move and joint gates')
  const quick = step('Verify test-only seal-cap reproducibility')
  expect(steps.indexOf(quick)).toBeLessThan(steps.indexOf(gate))
  expect(quick.run).toContain('ANIMACRAFT_SUI_ARCHIVE="$RUNNER_TEMP/$SUI_ARCHIVE"')
  expect(quick.run).toContain('git -C _paired/animacraft diff --exit-code HEAD -- move scripts test/harness')
  expect(gate.run).toContain('--animacraft-root "$GITHUB_WORKSPACE/_paired/animacraft"')
  expect(gate.run).toContain('--soulidity-root "$GITHUB_WORKSPACE"')
  expect(gate.run).toContain('--sui "$RUNNER_TEMP/sui-bin/sui" --check release-gates')
  expect(gate.env.TMPDIR).toBe('${{ runner.temp }}')
  const all = JSON.stringify(workflow)
  expect(all).not.toMatch(/suiup|sui@testnet|sui move (?:build|test) --path move\/soulidity|\/Users\//)
  const retain = step('Retain paired Move gate evidence')
  expect(retain.if).toBe('always()')
  expect(retain.with.path).toBe('${{ runner.temp }}/paired-move-evidence.tgz')
  expect(step('Bundle paired Move gate evidence').if).toBe('always()')
})
it('bundles actual colon-named check evidence without exposing it as invalid artifact paths', () => {
  const root = mkdtempSync(join(tmpdir(), 'paired-ci-evidence-'))
  try {
    const bundle = step('Bundle paired Move gate evidence')
    const execute = () => execFileSync('bash', ['-c', bundle.run], { env: { ...process.env, RUNNER_TEMP: root } })
    execute()
    const archive = join(root, 'paired-move-evidence.tgz')
    expect(existsSync(archive)).toBe(false)
    const graph = join(root, 'native-soul-v8-graph-fixture'); mkdirSync(graph)
    for (const name of ['graph.json', 'package:soulidity.json', 'package:soulidity.log']) writeFileSync(join(graph, name), '{}\n')
    writeFileSync(join(graph, 'not-gate-evidence.txt'), 'not part of the artifact')
    execute()
    expect(execFileSync('tar', ['-tzf', archive], { encoding: 'utf8' }).trim().split('\n').sort()).toEqual([
      'native-soul-v8-graph-fixture/graph.json', 'native-soul-v8-graph-fixture/package:soulidity.json',
      'native-soul-v8-graph-fixture/package:soulidity.log',
    ])
  } finally { rmSync(root, { recursive: true, force: true }) }
})
