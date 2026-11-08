import { expect, it, vi } from 'vitest'
import { bcs } from '@mysten/sui/bcs'
import { Transaction } from '@mysten/sui/transactions'
import { fromBase64 } from '@mysten/sui/utils'
import { activityEvidenceFixture, activityGenesis, aid, adigest } from './fixtures/activity-transaction-evidence'
import { verifyNativePublicReadPaidV2Interfaces, prepareInterfaceCheckedNativePublicReadPaidV2Kind } from '../../web/lib/soulidity/commerce/native-public-read-paid-interface-v2'
import type { NativePublicReadPaidPurchaseV2 } from '../../web/lib/soulidity/commerce/native-public-read-paid-transaction-v2'

// Controlled package + RPC metadata, not deployed code qualification.
import {publicReadPaidAbiV2Fixture as fixture} from './fixtures/commerce-public-read-paid-abi-v2'
it('verifies exact generic HostV2 buy/quote ABI and linked Config type without granting signing or delivery', async () => {
  const { run, client } = await fixture()
  expect(await run()).toMatchObject({ format: 'native-public-read-v2', interfaceVerified: true, requiresQualifiedSourceAndFormatAdoption: true, notSigningQualification: true, notDeliveryProof: true })
  expect(client.core.getMoveFunction.mock.calls.map(([r]: any) => r.name)).toEqual(['buy_public_read_paid_v2', 'quote_public_read_paid_v2'])
})
it.each(['chain', 'host-origin', 'link-origin', 'dependency', 'callable', 'v1-state', 'kiosk-mutable', 'host-readonly', 'generic-index', 'constraints', 'entry', 'buy-return', 'quote-return', 'quote-kind'])('rejects mismatched actual V2 interfaces: %s', async variant => {
  const { n, np, buy, quote, client, run } = await fixture()
  if (variant === 'chain') client.core.getChainIdentifier.mockResolvedValue({ chainIdentifier: 'wrong' })
  if (variant === 'host-origin') { np.typeOriginTable = np.typeOriginTable.filter(t => t.datatypeName !== 'PublicReadHostV2'); n.rehashPackage() }
  if (variant === 'link-origin') { np.typeOriginTable = np.typeOriginTable.filter(t => t.datatypeName !== 'PublicReadLinkV2'); n.rehashPackage() }
  if (variant === 'dependency') { np.linkageTable.get(aid(44))!.upgradedVersion = '3'; n.rehashPackage() }
  if (variant === 'callable') buy.packageId = aid(99)
  if (variant === 'v1-state') buy.parameters[3].body.datatype.typeName = `${aid(42)}::birth::State`
  if (variant === 'kiosk-mutable') buy.parameters[2].reference = 'mutable'
  if (variant === 'host-readonly') buy.parameters[3].reference = 'immutable'
  if (variant === 'generic-index') buy.parameters[10].body.datatype.typeParameters[0] = { $kind: 'typeParameter', index: 1 }
  if (variant === 'constraints') buy.typeParameters[0].constraints = ['store']
  if (variant === 'entry') buy.isEntry = true
  if (variant === 'buy-return') buy.returns = [{ reference: null, body: { $kind: 'u64' } }]
  if (variant === 'quote-return') quote.returns.pop()
  if (variant === 'quote-kind') quote.parameters[2].body.$kind = 'u64'
  await expect(run()).rejects.toThrow()
})
it('captures package and ABI readers before the first asynchronous observation', async () => {
  const { client, run } = await fixture()
  client.core.getChainIdentifier.mockImplementation(async () => {
    client.ledgerService.getObject = () => { throw Error('REPLACED_PACKAGE_READER') }
    client.core.getMoveFunction = () => { throw Error('REPLACED_ABI_READER') }
    return { chainIdentifier: activityGenesis }
  })
  expect(await run()).toMatchObject({ interfaceVerified: true, notSigningQualification: true })
})
function intent(): NativePublicReadPaidPurchaseV2 {
  const shared = (n: number) => ({ objectId: aid(n), initialSharedVersion: '1' })
  return { format: 'native-public-read-v2', buyer: aid(71), nativeCallablePackageId: aid(43), coinType: '0x2::sui::SUI', config: shared(75), registry: shared(78), kiosk: shared(80), host: shared(94), kind: 1,
    quote: { hash: new Uint8Array(32).fill(1), total: '104' }, entryHash: null, feeRevision: '8', quoteExpiryMs: '2000', attempt: new Uint8Array(32).fill(2), paymentCoin: { objectId: aid(81), version: '9', digest: adigest(81), balance: '1000' } }
}
it('returns only the interface-checked unsigned original intent kind despite caller mutation during await', async () => {
  const f = await fixture(), p = intent()
  f.client.core.getChainIdentifier.mockImplementation(async () => { p.kind = 99; p.quote.total = '999'; return { chainIdentifier: activityGenesis } })
  const result = await prepareInterfaceCheckedNativePublicReadPaidV2Kind({ client: f.client, native: f.n.deployment, foundation: f.f.deployment, signal: new AbortController().signal, intent: p })
  const data = Transaction.fromKind(result.kindBytes).getData(), arg = data.commands[1].MoveCall!.arguments[4]
  if (arg.$kind !== 'Input') throw Error('kind input required')
  expect(bcs.u32().parse(fromBase64(data.inputs[arg.Input].Pure!.bytes))).toBe(1)
  expect(result).toMatchObject({ interfaces: { interfaceVerified: true }, requiresFullPacketFundingAndSimulation: true, notSigningQualification: true, notDeliveryProof: true })
  expect(data.gasData.payment).toBeNull()
})
it('rejects a mismatched intent/package before network reads', async () => {
  const f = await fixture(), p = intent(); p.nativeCallablePackageId = aid(99)
  await expect(prepareInterfaceCheckedNativePublicReadPaidV2Kind({ client: f.client, native: f.n.deployment, foundation: f.f.deployment, signal: new AbortController().signal, intent: p })).rejects.toThrow('PUBLIC_PAID_V2_ABI_INTENT_PACKAGE')
  expect(f.client.core.getChainIdentifier).not.toHaveBeenCalled()
})
