import { build } from 'esbuild'
import { expect, it } from 'vitest'

it('resolves the public gate in a browser bundle with no dynamic process.env access', async () => {
  const gate = `0x${'a'.repeat(64)}`
  const result = await build({ entryPoints: ['packages/soulidity-sdk/src/env.ts'], bundle: true,
    platform: 'browser', format: 'iife', globalName: 'GateEnv', write: false,
    define: { 'process.env.NEXT_PUBLIC_SOULIDITY_PROTOCOL_GATE_ID': JSON.stringify(gate), 'process.env': '{}' },
  })
  const env = new Function(`${result.outputFiles[0].text}; return GateEnv;`)() as {
    getRequiredSoulidityEnv(name: string): string
  }
  expect(env.getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_PROTOCOL_GATE_ID')).toBe(gate)
})
