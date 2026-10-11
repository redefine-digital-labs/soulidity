import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { expect, it } from 'vitest'

it('excludes generated SPA artifacts from Git and lint without excluding product source', () => {
  const generated = 'web/dist-spa/assets/boundary-probe.js'
  expect(execFileSync('git', ['check-ignore', '--no-index', generated], { encoding: 'utf8' }).trim()).toBe(generated)
  const result = execFileSync(process.execPath, ['--input-type=module', '-e', `
    import { ESLint } from 'eslint';
    const eslint = new ESLint();
    console.log(JSON.stringify({
      generated: await eslint.isPathIgnored('dist-spa/assets/boundary-probe.js'),
      source: await eslint.isPathIgnored('lib/hooks/use-wallet-sign.ts'),
    }));
  `], { cwd: resolve('web'), encoding: 'utf8' })
  expect(JSON.parse(result)).toEqual({ generated: true, source: false })
})
