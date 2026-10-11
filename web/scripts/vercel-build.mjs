import { spawnSync } from 'node:child_process'

export function resolveVercelBuildPlan() {
  // Both environments publish the same static app. There is no database step.
  return ['build']
}

function runStep(step) {
  const result = spawnSync('npm', ['run', step], {
    env: process.env,
    stdio: 'inherit',
  })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}

const plan = resolveVercelBuildPlan()
if (process.argv.includes('--print-plan')) {
  process.stdout.write(`${JSON.stringify(plan)}\n`)
} else {
  plan.forEach(runStep)
}
