import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { expect, it } from 'vitest'
import { Transaction } from '@mysten/sui/transactions'
import { fromHex } from '@mysten/sui/utils'
// Exercise the standalone script's pure builder without importing/running main,
// which signs sessions and contacts real services when explicitly invoked.
const source = readFileSync('web/scripts/e2e-agent-decrypt.ts', 'utf8')
const builderSource = source.slice(source.indexOf('function buildSealApprovalTx('), source.indexOf('// --- AES-GCM decrypt ---'))
const js = ts.transpileModule(builderSource, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText
const build = new Function('Transaction', 'hexToBytes', 'SUI_CLOCK_OBJECT_ID', `${js}; return buildSealApprovalTx`)(Transaction, fromHex, '0x6') as (p: any, id: string) => Transaction
const id = (n: number) => `0x${n.toString(16).padStart(64, '0')}`
it.each(['owner', 'granted_agent', 'public', 'paid_access'])('operational %s Seal builder preserves document first and gate second', suffix => {
  const policy = { packageId: id(1), callablePackageId: id(10), protocolGateId: id(70), stateObjectId: id(2), contentObjectId: id(3),
    moduleName: suffix === 'paid_access' ? 'paid_access' : 'content', functionName: `seal_approve_content_${suffix}`,
    kind: 2, name: 'skill', versionIndex: 0, soulGrantObjectId: id(5), paidAccessListOnChainId: id(6) }
  const data = build(policy, '0x0102').getData(), call = data.commands[0].MoveCall!
  expect(data.inputs[call.arguments[0].Input!].Pure).toBeDefined()
  expect(data.inputs[call.arguments[1].Input!].UnresolvedObject?.objectId).toBe(id(70))
  expect(data.inputs[call.arguments[2].Input!].UnresolvedObject?.objectId).toBe(id(2))
})
it('operational Seal builder rejects a missing gate', () => {
  expect(() => build({ packageId: id(1), protocolGateId: '' }, '0x0102')).toThrow('protocolGateId')
})
