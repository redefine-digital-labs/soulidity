import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { parse } from 'yaml'

const removed = [
  'scripts/phase2-smoke.ts', 'scripts/phase2-mainnet-prepare.ts',
  'scripts/phase2-mainnet-fund.ts', 'scripts/phase2-mainnet-execute-rest.ts',
  'scripts/phase2-retry-failed.ts', 'scripts/phase2-finish-skipped.ts',
  'scripts/smoke-soulidity.ts', 'scripts/lib/phase2-content-mutation.ts',
  'scripts/lib/phase2-append-envelope.ts', 'tests/new-web/phase2-append-envelope.test.ts',
  'scripts/scenarios/soulidity-smoke-matrix.example.json', '.env.soulidity-smoke.example',
]
it.each(removed)('does not retain obsolete signing/mirror smoke artifact %s', path => {
  expect(existsSync(path)).toBe(false)
})
it('has no obsolete command aliases or dangling executable references', () => {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
  for (const name of ['smoke:soulidity', 'smoke:phase2', 'phase2:prepare', 'phase2:fund'])
    expect(pkg.scripts[name]).toBeUndefined()
  const files = execFileSync('rg', ['--files', 'scripts', 'web', 'packages', '.github',
    '-g', '*.ts', '-g', '*.tsx', '-g', '*.mjs', '-g', '*.js', '-g', '*.json', '-g', '*.yml',
    '-g', '!**/node_modules/**', '-g', '!**/dist/**'], { encoding: 'utf8' }).trim().split('\n')
  const names = removed.map(path => path.split('/').at(-1)!.replace(/\.(ts|json)$/, ''))
  const offenders = files.flatMap(file => {
    const source = readFileSync(file, 'utf8')
    return names.filter(name => source.includes(name)).map(name => `${file}: ${name}`)
  })
  expect(offenders).toEqual([])
})
it('removes live testnet signing and secret injection while preserving every PR check', () => {
  const text = readFileSync('.github/workflows/soulidity-fast-path-smoke.yml', 'utf8')
  const workflow = parse(text)
  expect(Object.keys(workflow.jobs)).toEqual(['pr-gates'])
  // Manual paired-source checks are unsigned; the retired signing smoke is not.
  expect(workflow.on.workflow_dispatch.inputs).toEqual({ animacraft_commit_sha: {
    description: 'Exact reviewed Animacraft commit for this paired release check', required: true, type: 'string',
  } })
  expect(workflow.jobs['pr-gates'].permissions).toEqual({ contents: 'read' })
  expect(text).not.toMatch(/secrets\.|SMOKE_|run_testnet_smoke/)
  expect(workflow.on.pull_request.paths).toContain('tests/scripts/retired-smoke-entry.test.ts')
  const commands = workflow.jobs['pr-gates'].steps.map((step: { run?: string }) => step.run).filter(Boolean)
  for (const required of ['npm test', 'npm --prefix web run typecheck', 'npm --prefix web run lint',
    'npm --prefix packages/soulidity-sdk run typecheck']) expect(commands).toContain(required)
  expect(commands.join('\n')).toContain('--check release-gates')
  expect(commands).toContain('pnpm run build:shared && pnpm run build:backend && pnpm exec tsc --noEmit -p tsconfig.node.json')
  expect(text).toContain('not full G3 or S13 live acceptance')
})
