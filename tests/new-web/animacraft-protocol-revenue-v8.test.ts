// @vitest-environment node
import { bcs, TypeTagSerializer } from '@mysten/sui/bcs'
import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { Transaction } from '@mysten/sui/transactions'
import { deriveDynamicFieldID, normalizeStructTag, toBase64 } from '@mysten/sui/utils'
import { describe, expect, it } from 'vitest'
import { readOriginalProtocolWithdrawalV8, readProtocolRevenueV8 } from '../../web/lib/animacraft/protocol-revenue-v8'
import { equipmentProtocolCommitment } from '../../web/lib/animacraft/native-equipment-source'
import { EquipmentProtocolBcs } from '../../web/lib/animacraft/native-equipment-source-bcs'
import { EquipmentMarketProtocolTreasuryBcs } from '../../web/lib/animacraft/native-equipment-market-bcs'
import { activityEvidenceFixture, activityGenesis, activityHash, adigest, aid } from './fixtures/activity-transaction-evidence'

const moduleName = 'protocol_config_v8'
const eventName = 'ProtocolRevenueV8Withdrawn'
const configId = aid(30), adminId = aid(31), treasuryId = aid(32), operator = aid(33), recipient = aid(34)
const payoutId = aid(35), gasId = aid(36)
const coinType = '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC'
const address = bcs.Address, u64 = bcs.u64()
const Admin = bcs.struct('AdminFixture', { id: address, version: u64, config: address })
const Coin = bcs.struct('CoinFixture', { id: address, balance: u64 })
const Withdraw = bcs.tuple([address, address, address, address, u64])
type Owner = { AddressOwner: string } | { Shared: { initialSharedVersion: string } }

async function fixture(overrides: {
  noTreasury?: boolean; liveZero?: boolean; drift?: 'config' | 'treasury'; badCommitment?: boolean;
  badCap?: boolean; badBirth?: boolean; wrongTarget?: boolean; wrongCoin?: boolean; badEvent?: boolean;
  badPayout?: 'owner' | 'amount' | 'coin'; badDebit?: boolean; badCounter?: boolean; extraEffect?: boolean;
  noExpiration?: boolean; status?: 'missing' | 'pending';
  gasMode?: 'coin' | 'address'; sponsored?: boolean; badGas?: 'owner' | 'amount';
  badEpoch?: 'chain' | 'min' | 'max';
} = {}) {
  const f = await activityEvidenceFixture()
  const core = f.deployment, pkg = f.packageData.data.Package!
  pkg.moduleMap = new Map([[moduleName, new Uint8Array([1])]])
  pkg.typeOriginTable = ['ProtocolConfigV8', 'ProtocolAdminCapV8', 'ProtocolTreasuryV8', eventName]
    .map(datatypeName => ({ moduleName, datatypeName, package: core.originalPackageId }))
  f.rehashPackage()
  const configType = `${core.originalPackageId}::${moduleName}::ProtocolConfigV8`
  const treasuryType = `${core.originalPackageId}::${moduleName}::ProtocolTreasuryV8<${coinType}>`
  const capType = `${core.originalPackageId}::${moduleName}::ProtocolAdminCapV8`
  const paymentType = `0x2::coin::Coin<${coinType}>`
  const suiType = '0x2::coin::Coin<0x2::sui::SUI>'
  const shared = { Shared: { initialSharedVersion: '1' } }, owned = { AddressOwner: operator }
  const gasOwner = overrides.sponsored ? aid(77) : operator
  const gasOwned = { AddressOwner: overrides.badGas === 'owner' ? aid(78) : gasOwner }
  const rows = new Map<string, ReturnType<typeof object>>()
  const live = new Map<string, ReturnType<typeof object>>()
  function object(objectId: string, objectType: string, version: number, owner: Owner,
    contents: Uint8Array, previousTransaction = adigest(12)) {
    const type = objectType === suiType ? { GasCoin: true } : { Other: TypeTagSerializer.parseFromStr(objectType).struct! }
    const raw = bcs.Object.serialize({ data: { Move: { type, version, hasPublicTransfer: true, contents } },
      owner, previousTransaction, storageRebate: '0' }).toBytes()
    return { objectId, objectType: normalizeStructTag(objectType), version: BigInt(version), digest: activityHash('Object', raw),
      owner: 'AddressOwner' in owner ? { kind: 1, address: owner.AddressOwner }
        : { kind: 3, version: BigInt(owner.Shared.initialSharedVersion) },
      bcs: { value: raw }, contents: { value: contents }, previousTransaction }
  }
  function add(...args: Parameters<typeof object>) {
    const row = object(...args)
    rows.set(`${row.objectId}:${row.version}`, row)
    live.set(row.objectId, row)
    return row
  }
  const gasIn = add(gasId, suiType, 2, gasOwned, Coin.serialize({ id: gasId, balance: '1001' }).toBytes())
  const admin = add(adminId, capType, 2, owned,
    Admin.serialize({ id: adminId, version: '8', config: overrides.badCap ? aid(70) : configId }).toBytes())
  const tx = new Transaction()
  tx.setSender(operator)
  tx.setGasOwner(gasOwner)
  tx.setGasPrice(1)
  tx.setGasBudget(1000)
  if (overrides.gasMode === 'address') {
    tx.setGasPayment([])
    tx.setExpiration({ ValidDuring: {
      minEpoch: overrides.badEpoch === 'min' ? '6' : '4',
      maxEpoch: overrides.badEpoch === 'max' ? '4' : '6',
      minTimestamp: null, maxTimestamp: null, nonce: 2,
      chain: overrides.badEpoch === 'chain' ? adigest(66) : activityGenesis,
    } })
  } else {
    tx.setGasPayment([{ objectId: gasId, version: '2', digest: gasIn.digest }])
    if (!overrides.noExpiration) tx.setExpiration({ Epoch: 6 })
  }
  tx.moveCall({ target: `${core.callablePackageId}::${moduleName}::${overrides.wrongTarget ? 'deposit_protocol_revenue_v8' : 'withdraw_protocol_revenue_v8'}`,
    typeArguments: [overrides.wrongCoin ? '0x2::sui::SUI' : coinType],
    arguments: [
      tx.sharedObjectRef({ objectId: configId, initialSharedVersion: '1', mutable: false }),
      tx.objectRef({ objectId: adminId, version: '2', digest: admin.digest }),
      tx.sharedObjectRef({ objectId: treasuryId, initialSharedVersion: overrides.badBirth ? '2' : '1', mutable: true }),
      tx.pure.u64(30), tx.pure.address(recipient),
    ] })
  const bytes = await tx.build()
  f.transactionData.V1 = bcs.TransactionData.parse(bytes).V1!
  f.rehashTransaction()
  const digest = f.ledger.digest
  const config = {
    id: configId, version: '8', core_original_package_id: core.originalPackageId, core_callable_package_id: core.callablePackageId,
    revision: '1', treasury_id: overrides.noTreasury ? null : treasuryId, payment_coin_type: coinType,
    primary_content_fee_bps: 500, fixed_complete_fee_atomic: '1000', maker_market_fee_bps: 500,
    soul_market_fee_bps: 500, enabled: false, commitment: [] as number[],
  }
  const configBytes = (revision: string) => EquipmentProtocolBcs.serialize({ ...config, revision,
    commitment: overrides.badCommitment ? Array(32).fill(3) : equipmentProtocolCommitment({ ...config, revision }) }).toBytes()
  const configIn = add(configId, configType, 3, shared, configBytes('1'))
  const treasuryBytes = (balance: string, withdrawn: string) => EquipmentMarketProtocolTreasuryBcs.serialize({
    id: treasuryId, version: '8', config_id: configId, revenue: { value: balance }, total_collected: '100', total_withdrawn: withdrawn,
  }).toBytes()
  const treasuryIn = add(treasuryId, treasuryType, 4, shared, treasuryBytes('100', '0'))
  const treasuryOut = add(treasuryId, treasuryType, 10, shared,
    treasuryBytes(overrides.badDebit ? '69' : '70', overrides.badCounter ? '32' : overrides.badDebit ? '31' : '30'), digest)
  const payout = add(payoutId, overrides.badPayout === 'coin' ? suiType : paymentType, 10,
    { AddressOwner: overrides.badPayout === 'owner' ? operator : recipient },
    Coin.serialize({ id: payoutId, balance: overrides.badPayout === 'amount' ? '31' : '30' }).toBytes(), digest)
  const gasOut = add(gasId, suiType, 10, gasOwned,
    Coin.serialize({ id: gasId, balance: overrides.badGas === 'amount' ? '997' : '998' }).toBytes(), digest)
  if (overrides.liveZero) add(treasuryId, treasuryType, 12, shared, treasuryBytes('0', '100'))
  let liveReads = 0
  f.client.ledgerService.getObject.mockImplementation(async (...args: unknown[]) => {
    const { objectId, version } = args[0] as { objectId: string; version?: bigint }
    if (objectId === core.callablePackageId) return { response: { object: f.pkg } }
    if (version === undefined && objectId === (overrides.drift === 'config' ? configId : treasuryId) && overrides.drift) {
      if (++liveReads === 2) {
        const update = overrides.drift === 'config'
          ? object(configId, configType, 13, shared, configBytes('2'))
          : object(treasuryId, treasuryType, 13, shared, treasuryBytes('69', '31'))
        return { response: { object: update } }
      }
    }
    return { response: { object: version === undefined ? live.get(objectId) : rows.get(`${objectId}:${version}`) } }
  })

  type EffectsInput = NonNullable<Parameters<typeof bcs.TransactionEffects.serialize>[0]['V2']>
  const change = (before: ReturnType<typeof object> | null, after: ReturnType<typeof object>, owner: Owner): EffectsInput['changedObjects'][number] =>
    [after.objectId, { inputState: before ? { Exist: [[String(before.version), before.digest], owner] } : { NotExist: true },
      outputState: { ObjectWrite: [after.digest, owner] }, idOperation: before ? { None: true } : { Created: true } }]
  const e = f.effectsData.V2!
  const changedObjects = [change(treasuryIn, treasuryOut, shared), change(null, payout, { AddressOwner: payout.owner.address! })]
  if (overrides.gasMode === 'address') {
    const balance = '0x2::balance::Balance<0x2::sui::SUI>', owner = gasOwned.AddressOwner
    const id = deriveDynamicFieldID('0xacc', `0x2::accumulator::Key<${balance}>`, bcs.Address.serialize(owner).toBytes())
    changedObjects.push([id, { inputState: { NotExist: true }, idOperation: { None: true }, outputState: {
      AccumulatorWriteV1: { address: { address: owner, ty: TypeTagSerializer.parseFromStr(balance) }, operation: { Split: true },
        value: { Integer: overrides.badGas === 'amount' ? '4' : '3' } },
    } }])
  } else changedObjects.push(change(gasIn, gasOut, gasOwned))
  if (overrides.extraEffect) changedObjects.push([aid(80), changedObjects[0][1]])
  f.effectsData.V2 = bcs.TransactionEffects.parse(bcs.TransactionEffects.serialize({ V2: { ...e,
    gasObjectIndex: overrides.gasMode === 'address' ? null : 2, changedObjects,
    unchangedConsensusObjects: [[configId, { ReadOnlyRoot: ['3', configIn.digest] }]],
  } }).toBytes()).V2!
  f.eventsData.data = [{
    package_id: core.callablePackageId, transaction_module: moduleName, sender: operator,
    type_: { address: core.originalPackageId, module: moduleName, name: eventName, typeParams: [] },
    contents: Withdraw.serialize([configId, treasuryId, operator, recipient, overrides.badEvent ? '31' : '30']).toBytes(),
  }]
  f.rehashEvents()
  if (overrides.status === 'missing') f.client.ledgerService.getTransaction.mockRejectedValue({ code: 'NOT_FOUND' })
  if (overrides.status === 'pending') delete f.ledger.checkpoint
  return { client: f.client as unknown as SuiGrpcClient, signal: new AbortController().signal, target: {
    core: { originalPackageId: core.originalPackageId, callablePackageId: core.callablePackageId, callableDigest: core.callableDigest },
    configId, coinType,
  }, original: { bytes: toBase64(bytes), digest }, f }
}

describe('current Animacraft Core protocol revenue', () => {
  it('reports an uninitialized Config without inventing a zero balance', async () => {
    const p = await fixture({ noTreasury: true })
    await expect(readProtocolRevenueV8(p)).resolves.toMatchObject({ status: 'AWAITING_TREASURY', treasury: null, enabled: false })
    expect(p.f.client.ledgerService.getObject).toHaveBeenCalledTimes(3)
  })
  it('reads a real zero balance and withdrawn counter for a paused Config', async () => {
    await expect(readProtocolRevenueV8(await fixture({ liveZero: true }))).resolves.toMatchObject({ status: 'READY', enabled: false,
      treasury: { objectId: treasuryId, version: '12', balanceAtomic: '0', totalCollectedAtomic: '100', totalWithdrawnAtomic: '100' } })
  })
  it.each([['config', 'CURRENT_CONFIG_CHANGED'], ['treasury', 'CURRENT_TREASURY_CHANGED']] as const)('rejects %s drift', async (drift, code) => {
    await expect(readProtocolRevenueV8(await fixture({ drift }))).rejects.toThrow(code)
  })
  it('rejects a self-consistent object digest with an incorrect Config commitment', async () => {
    await expect(readProtocolRevenueV8(await fixture({ badCommitment: true }))).rejects.toThrow('CONFIG_BINDING')
  })
})

describe('original Animacraft Core protocol revenue withdrawal', () => {
  it.each([false, true])('proves the exact authorized payout and separates SUI gas (no expiration %s)', async noExpiration => {
    const p = await fixture({ noExpiration })
    await expect(readOriginalProtocolWithdrawalV8(p)).resolves.toMatchObject({
      status: 'SUCCEEDED', checkpoint: '100', transactionDigest: p.original.digest, receipt: {
        coinType, operator, recipient, amountAtomic: '30', treasuryId,
        treasuryBefore: { balanceAtomic: '100' }, treasuryAfter: { balanceAtomic: '70' }, payout: { objectId: payoutId },
        gas: { netGasCharge: '3' },
      },
    })
  })
  it.each(['coin', 'address'] as const)('keeps the sponsor separate from the operator with %s gas', async gasMode => {
    const p = await fixture({ gasMode, sponsored: true })
    await expect(readOriginalProtocolWithdrawalV8(p)).resolves.toMatchObject({
      status: 'SUCCEEDED', receipt: { operator, recipient, gas: { owner: aid(77), netGasCharge: '3' } },
    })
  })
  it.each([
    [{ wrongTarget: true }, 'WITHDRAWAL_GRAPH'], [{ wrongCoin: true }, 'WITHDRAWAL_GRAPH'],
    [{ badCap: true }, 'ADMIN_BINDING'], [{ badBirth: true }, 'SHARED_INPUT_BINDING'], [{ badEvent: true }, 'WITHDRAWAL_EVENT_BINDING'],
    [{ badPayout: 'owner' as const }, 'RECIPIENT_COIN'], [{ badPayout: 'amount' as const }, 'RECIPIENT_COIN'],
    [{ badPayout: 'coin' as const }, 'REFERENCE_MISMATCH'], [{ badDebit: true }, 'TREASURY_DEBIT'],
    [{ badCounter: true }, 'TREASURY_BINDING'], [{ extraEffect: true }, 'EFFECTS_SCOPE'],
    [{ gasMode: 'coin', badGas: 'owner' }, 'SUI_GAS_SETTLEMENT_INPUT'],
    [{ gasMode: 'address', badGas: 'owner' }, 'ADDRESS_BALANCE_EFFECTS_WRITE_MISMATCH'],
    [{ gasMode: 'address', badGas: 'amount' }, 'ADDRESS_BALANCE_EFFECTS_WRITE_MISMATCH'],
    [{ gasMode: 'address', badEpoch: 'chain' }, 'VALID_DURING'],
    [{ gasMode: 'address', badEpoch: 'min' }, 'RAW_EFFECTS_MISMATCH'],
    [{ gasMode: 'address', badEpoch: 'max' }, 'RAW_EFFECTS_MISMATCH'],
  ] as const)('rejects inconsistent evidence %j', async (overrides, code) => {
    await expect(readOriginalProtocolWithdrawalV8(await fixture(overrides))).rejects.toThrow(code)
  })
  it.each([['missing', 'MISSING'], ['pending', 'PENDING']] as const)('preserves %s original evidence', async (status, result) => {
    const p = await fixture({ status })
    await expect(readOriginalProtocolWithdrawalV8(p)).resolves.toEqual({ status: result, transactionDigest: p.original.digest })
  })
  it('reports a finalized failure without a withdrawal receipt', async () => {
    const p = await fixture()
    p.f.effectsData.V2!.status = { $kind: 'Failure', Failure: { error: { $kind: 'InsufficientGas', InsufficientGas: true }, command: null } }
    p.f.rehashEffects()
    await expect(readOriginalProtocolWithdrawalV8(p)).resolves.toEqual({
      status: 'FAILED', checkpoint: '100', transactionDigest: p.original.digest,
    })
  })
  it('rejects a saved digest that does not identify the original bytes', async () => {
    const p = await fixture()
    p.original.digest = adigest(77)
    await expect(readOriginalProtocolWithdrawalV8(p)).rejects.toThrow('PACKET_DIGEST')
    expect(p.f.client.ledgerService.getTransaction).not.toHaveBeenCalled()
  })
  it('rejects exact effects omitted from the original checkpoint', async () => {
    const p = await fixture()
    p.f.contentsData.V2!.transactions[1].digest.effects = adigest(77)
    p.f.rehashContents()
    await expect(readOriginalProtocolWithdrawalV8(p)).rejects.toThrow('CHECKPOINT_MEMBERSHIP')
  })
})
