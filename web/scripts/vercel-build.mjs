import { spawnSync } from 'node:child_process'

export function resolveVercelBuildPlan(env = process.env) {
  const production = env.VERCEL_ENV === 'production'
  if (production && !String(env.DIRECT_URL || env.DATABASE_URL || '').trim()) {
    throw new Error('Production Vercel builds require DIRECT_URL or DATABASE_URL before migrations can run.')
  }
  return production
    ? ['prisma:migrate:deploy', 'build']
    : ['build']
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
