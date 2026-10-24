import { afterEach, expect, it, vi } from 'vitest'
import { buildAddSoulToCollectionTx, buildBatchAddSoulToCollectionTx } from '../../packages/soulidity-sdk/src/tx/collection'
const id = (n: number) => `0x${n.toString(16).padStart(64, '0')}`
afterEach(() => vi.unstubAllEnvs())
function env() {
  vi.stubEnv('NEXT_PUBLIC_SOULIDITY_CALLABLE_PACKAGE_ID', id(1))
  vi.stubEnv('NEXT_PUBLIC_SOULIDITY_MARKET_CONFIG_V2_ID', id(2))
}
it.each(['single', 'batch'] as const)('%s binding uses config, collection and state with the V2 wallet entry', variant => {
  env()
  const tx = variant === 'single' ? buildAddSoulToCollectionTx({ collectionObjectId: id(3), stateObjectId: id(4) })
    : buildBatchAddSoulToCollectionTx({ collectionObjectId: id(3), binds: [{ stateObjectId: id(4) }, { stateObjectId: id(5) }] })
  const data = tx.getData(), calls = data.commands.map(command => command.MoveCall!)
  expect(calls).toHaveLength(variant === 'single' ? 1 : 2)
  for (const [index, call] of calls.entries()) {
    expect(call.package).toBe(id(1)); expect(call.module).toBe('market'); expect(call.function).toBe('add_soul_to_collection_v2')
    expect(call.arguments).toHaveLength(3)
    expect(call.arguments.map(arg => data.inputs[(arg as { Input: number }).Input].UnresolvedObject?.objectId)).toEqual([id(2), id(3), id(4 + index)])
  }
})
it.each(['single', 'batch'] as const)('%s binding fails clearly without the required V2 config', variant => {
  env(); vi.stubEnv('NEXT_PUBLIC_SOULIDITY_MARKET_CONFIG_V2_ID', '')
  expect(() => variant === 'single' ? buildAddSoulToCollectionTx({ collectionObjectId: id(3), stateObjectId: id(4) })
    : buildBatchAddSoulToCollectionTx({ collectionObjectId: id(3), binds: [{ stateObjectId: id(4) }] })).toThrow('NEXT_PUBLIC_SOULIDITY_MARKET_CONFIG_V2_ID')
})
