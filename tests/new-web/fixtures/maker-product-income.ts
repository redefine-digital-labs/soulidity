import { controlledIncomeExecutionModel } from './income-controlled-qualification'
import { createIncomeExecutionRegistryV1 } from '../../../web/lib/soulidity/commerce/income-execution-source-v1'
import { bcs, TypeTagSerializer } from '@mysten/sui/bcs'
import { normalizeStructTag } from '@mysten/sui/utils'
import { vi } from 'vitest'
import { incomeEntryFixture } from './income-entry'
import { activityHash, aid, adigest } from './activity-transaction-evidence'
import { CurrentMakerProductBcs } from '../../../web/lib/animacraft/current-maker-product-bcs'
import { MakerProductControlBcs, type MakerProductIncomeTarget } from '../../../web/lib/soulidity/commerce/maker-product-income-read'
import { readMakerProductIncome } from '../../../web/lib/soulidity/commerce/maker-product-income-read'
import { buildMakerProductIncomeWithdrawal } from '../../../web/lib/soulidity/commerce/maker-product-income-transaction'
import { IncomeWithdrawnBcs } from '../../../web/lib/soulidity/commerce/maker-product-income-proof'
import { IncomeRequestBcs, IncomeReceiptFieldBcs } from '../../../web/lib/soulidity/commerce/economics-bcs'
import { createMakerProductIncomeRecoveryRecord, exportMakerProductIncomeRecoveryRecord } from '../../../web/lib/soulidity/commerce/maker-product-income-recovery-record'
import { deriveDynamicFieldID, toBase64, toHex, normalizeSuiAddress } from '@mysten/sui/utils'
import { TransactionDataBuilder } from '@mysten/sui/transactions'
import { readPinnedMovePackage } from '../../../web/lib/sui/pinned-move-package'
import { publicMutationCanonical } from '../../../web/lib/sui/public-mutation-journal'
import { MAINNET_GENESIS_DIGEST } from '../../../web/lib/animacraft/mainnet-chain'
import { makerProductIncomeManifestHash, type MakerProductIncomeManifest } from '../../../web/lib/soulidity/commerce/maker-product-income-source'
import { incomeWithdrawalAbiFixture } from './commerce-income-withdrawal-abi'
import { ActivityFixtureEventsBcs } from './activity-transaction-evidence'
import { createRootMakerProductIncomeController } from '../../../web/lib/soulidity/commerce/maker-product-income-controller'

/** Synthetic full Objects for current Product/Control/dependency reads. This
 * fixture grants no real source, wallet, signing or deployed-package authority.
 */
export async function makerProductIncomeFixture(actorOverride?: string) {
  const x = await incomeEntryFixture(), rows = new Map<string, any>(), actor = actorOverride ?? x.input.actor
  if (actorOverride) {
    const ref = x.input.gas.coins[0], key = `${ref.objectId}:${ref.version}`
    const prior = structuredClone(x.rows.get(key)), raw = bcs.Object.parse(prior.bcs.value)
    raw.owner = bcs.Owner.parse(bcs.Owner.serialize({ AddressOwner: actor }).toBytes())
    prior.owner.address = actor
    prior.bcs.value = bcs.Object.serialize(raw).toBytes()
    prior.digest = activityHash('Object', prior.bcs.value)
    x.rows.set(key, prior)
    ref.digest = prior.digest
  }
  const productId = aid(92), controlId = aid(93), protocolId = x.input.target.configId, original = aid(90), callable = aid(91)
  const rawPackage = bcs.Object.serialize({ data: { Package: { id: callable, version: '2', moduleMap: new Map([['maker_catalog', new Uint8Array([1])]]),
    typeOriginTable: ['Product', 'Control'].map(datatypeName => ({ moduleName: 'maker_catalog', datatypeName, package: original })),
    linkageTable: new Map([[x.input.target.foundation.originalPackageId, { upgradedId: x.input.target.foundation.callablePackageId, upgradedVersion: '2' }]]) } }, owner: { Immutable: true }, previousTransaction: adigest(9), storageRebate: '0' }).toBytes()
  const manufacturing = { originalPackageId: original, callablePackageId: callable, callableDigest: activityHash('Object', rawPackage) }
  const pkg = { objectId: callable, version: 2n, digest: manufacturing.callableDigest, owner: { kind: 4 }, bcs: { value: rawPackage } }
  const target: MakerProductIncomeTarget = { chainIdentifier: '35834a8a', protocolId, productId, coinType: x.input.target.coinType, manufacturing, foundation: x.input.target.foundation }
  const productType = `${original}::maker_catalog::Product<${target.coinType}>`, controlType = `${original}::maker_catalog::Control`
  const table = (n: number) => ({ id: aid(n), size: '0' })
  const product = CurrentMakerProductBcs.parse(CurrentMakerProductBcs.serialize({ id: productId, protocol: protocolId, creator: actor,
    market: { schema: 1, config: protocolId, snapshot_revision: '8', platform: aid(70), control_fee_bps: 250, equipment_fee_bps: 250, control_royalty_bps: 500, creator: actor },
    primary: { schema: 1, config: protocolId, snapshot_revision: '8', platform: aid(70), bps: 250, complete_fee: '10' },
    maker: null, parent_version: '0', parent_snapshot: null, version: '1', lifecycle: 2,
    versions: table(94), access: table(95), income: { root: productId, revision: '8', funds: '150', collected: '150', withdrawn: '0', requests: table(96) },
    issued: table(97), completes: table(98), attempts: table(99), payments: table(100), physical_registries: table(101) }).toBytes())
  function put(id: string, type: string, contents: Uint8Array, owner: any, version = 9, previousTransaction = adigest(9)) {
    const raw = bcs.Object.serialize({ data: { Move: { type: { Other: TypeTagSerializer.parseFromStr(type).struct! }, hasPublicTransfer: true, version, contents } }, owner, previousTransaction, storageRebate: '0' }).toBytes()
    const row = { objectId: id, objectType: normalizeStructTag(type), previousTransaction, contents: { value: contents }, version: BigInt(version), digest: activityHash('Object', raw), bcs: { value: raw }, owner: owner.AddressOwner ? { kind: 1, address: owner.AddressOwner } : owner.ObjectOwner ? { kind: 2, address: owner.ObjectOwner } : { kind: 3, version: 1n } }; rows.set(id, row); return row
  }
  const setProduct = () => put(productId, productType, CurrentMakerProductBcs.serialize(product).toBytes(), { Shared: { initialSharedVersion: '1' } })
  const setControl = (owner = actor, boundProduct = productId) => put(controlId, controlType, MakerProductControlBcs.serialize({ id: controlId, product: boundProduct }).toBytes(), { AddressOwner: owner })
  setProduct(); setControl()
  const read = x.client.ledgerService.getObject
  x.client.ledgerService.getObject = vi.fn(async (r: any, options?: any) => r.objectId === callable ? { response: { object: pkg } } : rows.has(r.objectId) ? { response: { object: rows.get(r.objectId) } } : read(r, options))
  const abi = incomeWithdrawalAbiFixture(callable, original)
  abi.moduleName = 'maker_catalog'; abi.parameters[0].body.datatype.typeName = `${original}::maker_catalog::Product`; abi.parameters[1].body.datatype.typeName = `${original}::maker_catalog::Control`
  x.client.core.getMoveFunction = vi.fn(async () => ({ function: structuredClone(abi) }))
  return { ...x, foundationRows: x.rows, target, actor, productId, controlId, productType, controlType, product, rows, pkg, setProduct, setControl, put,
    control: { actor, objectId: controlId }, signal: new AbortController().signal }
}

export async function makerProductIncomeInstallation(x: Awaited<ReturnType<typeof makerProductIncomeFixture>>) {
  const packages: any = {}
  for (const role of ['manufacturing', 'foundation'] as const) {
    const pkg = await readPinnedMovePackage(x.client, x.target[role], x.signal)
    packages[role] = { version: String(pkg.version), moduleHashes: [...pkg.moduleHashes].map(([name, row]) => ({ name, sha256: row.sha256, byteLength: String(row.byteLength) })).sort((a, b) => a.name < b.name ? -1 : 1),
      typeOrigins: [...pkg.origins].map(([name, packageId]) => ({ name, packageId })).sort((a, b) => a.name < b.name ? -1 : 1),
      linkage: [...pkg.linkage].map(([originalPackageId, row]) => ({ originalPackageId, upgradedId: row.upgradedId, upgradedVersion: row.upgradedVersion })).sort((a, b) => a.originalPackageId < b.originalPackageId ? -1 : 1) }
  }
  const source = { commitSha: 'a'.repeat(40), treeSha256: 'b'.repeat(64), buildSha256: 'c'.repeat(64), dependencyLockSha256: 'd'.repeat(64) }, { productId, ...deployment } = x.target
  const manifest: MakerProductIncomeManifest = { schema: 'soulidity.maker-product-income-source.v1', genesisDigest: MAINNET_GENESIS_DIGEST, deployment, packages, sources: { manufacturing: source, foundation: { ...source } }, sourceAuditSha256: 'e'.repeat(64) }
  const manifestText = publicMutationCanonical(manifest)
  return { manifest, manifestText, installation: { manifestText, acceptedManifestSha256: makerProductIncomeManifestHash(manifestText), acceptedSourceAuditSha256: manifest.sourceAuditSha256 } }
}

export async function makerProductIncomeWitness(attemptByte = 1, actor?: string, addressGas = false) {
  const x = await makerProductIncomeFixture(actor), snapshot = await readMakerProductIncome(x), f = x.f
  const intent = { actor: x.actor, controlId: x.controlId, recipient: x.draft.recipient, amount: '50', revision: '8', attempt: new Uint8Array(32).fill(attemptByte) }
  const gas = x.input.gas, tx = buildMakerProductIncomeWithdrawal(snapshot, intent)
  tx.setGasOwner(x.actor); tx.setGasBudget(gas.budget); tx.setGasPrice(gas.price)
  tx.setGasPayment(addressGas ? [] : gas.coins)
  tx.setExpiration(addressGas ? { ValidDuring: { chain: MAINNET_GENESIS_DIGEST, minEpoch: '5', maxEpoch: '6',
    minTimestamp: null, maxTimestamp: null, nonce: 73 } } : { Epoch: 6 })
  const bytes = await tx.build(), packet = { bytes: toBase64(bytes), digest: TransactionDataBuilder.getDigestFromBytes(bytes), expirationEpoch: '6', phase: 'PREPARED' as const, signature: null }
  Object.assign(f.transactionData.V1, bcs.TransactionData.parse(bytes).V1); f.rehashTransaction()
  const allRows = new Map<string, any>(), changes: any[] = []
  const add = (row: any) => { allRows.set(`${row.objectId}:${row.version}`, row); return row }
  const productBefore = add(x.rows.get(x.productId)), controlBefore = add(x.rows.get(x.controlId)), gasBefore = addressGas ? null : add(x.foundationRows.get(`${x.gasId}:2`))
  const effect = (before: any | null, after: any) => {
    add(after); changes.push([after.objectId, { inputState: before ? { Exist: [[String(before.version), before.digest], bcs.Object.parse(before.bcs.value).owner] } : { NotExist: true },
      outputState: { ObjectWrite: [after.digest, bcs.Object.parse(after.bcs.value).owner] }, idOperation: before ? { None: true } : { Created: true } }])
  }
  const receipt = { root: x.productId, actor: x.actor, attempt: intent.attempt, recipient: intent.recipient, amount: '50', before_revision: '8', after_revision: '9', balance: '100', total_collected: '150', total_withdrawn: '50' }
  const productAfter = structuredClone(x.product)
  productAfter.income = { ...productAfter.income, revision: '9', funds: '100', withdrawn: '50', requests: { ...productAfter.income.requests, size: '1' } }
  effect(productBefore, x.put(x.productId, x.productType, CurrentMakerProductBcs.serialize(productAfter).toBytes(), { Shared: { initialSharedVersion: '1' } }, 10, packet.digest))
  effect(controlBefore, x.put(x.controlId, x.controlType, MakerProductControlBcs.serialize({ id: x.controlId, product: x.productId }).toBytes(), { AddressOwner: x.actor }, 10, packet.digest))
  const keyType = `${x.target.foundation.originalPackageId}::revenue::Request`, receiptType = `${x.target.foundation.originalPackageId}::revenue::Receipt`
  const name = { actor: x.actor, attempt: intent.attempt }, fieldId = deriveDynamicFieldID(x.product.income.requests.id, keyType, IncomeRequestBcs.serialize(name).toBytes())
  effect(null, x.put(fieldId, `0x2::dynamic_field::Field<${keyType},${receiptType}>`, IncomeReceiptFieldBcs.serialize({ id: fieldId, name, value: receipt }).toBytes(), { ObjectOwner: x.product.income.requests.id }, 10, packet.digest))
  const payoutId = aid(112), coin = bcs.struct('Coin', { id: bcs.Address, balance: bcs.u64() })
  effect(null, x.put(payoutId, `0x2::coin::Coin<${x.target.coinType}>`, coin.serialize({ id: payoutId, balance: '50' }).toBytes(), { AddressOwner: intent.recipient }, 10, packet.digest))
  if (addressGas) {
    const type = normalizeStructTag('0x2::balance::Balance<0x2::sui::SUI>')
    const id = deriveDynamicFieldID(normalizeSuiAddress('0xacc'), `0x2::accumulator::Key<${type}>`, bcs.Address.serialize(x.actor).toBytes())
    changes.push([id, { inputState: { NotExist: true }, outputState: { AccumulatorWriteV1: {
      address: { address: x.actor, ty: type }, operation: { Split: true }, value: { Integer: '3' },
    } }, idOperation: { None: true } }])
    x.client.core.listOwnedObjects = vi.fn(async () => ({ objects: [], hasNextPage: false, cursor: null })) as typeof x.client.core.listOwnedObjects
    x.client.stateService = { ...x.client.stateService, getBalance: vi.fn(async () => ({
      response: { balance: { coinType: normalizeStructTag('0x2::sui::SUI'), balance: 1000n, coinBalance: 0n, addressBalance: 1000n } },
    })) } as unknown as typeof x.client.stateService
  } else effect(gasBefore, x.put(x.gasId, '0x2::coin::Coin<0x2::sui::SUI>', coin.serialize({ id: x.gasId, balance: '997' }).toBytes(), { AddressOwner: x.actor }, 10, packet.digest))
  f.effectsData.V2!.changedObjects = changes; f.effectsData.V2!.gasObjectIndex = addressGas ? null : 4
  f.eventsData.data = [{ package_id: x.target.manufacturing.callablePackageId, transaction_module: 'maker_catalog', sender: x.actor,
    type_: { address: x.target.foundation.originalPackageId, module: 'revenue', name: 'Withdrawn', typeParams: [] }, contents: IncomeWithdrawnBcs.serialize({ receipt }).toBytes() }]
  f.rehashEvents()
  x.rows.set(x.productId, productBefore); x.rows.set(x.controlId, controlBefore); x.rows.delete(x.gasId); x.rows.delete(payoutId); x.rows.delete(fieldId)
  const read = x.client.ledgerService.getObject
  x.client.ledgerService.getObject = vi.fn(async (r: any, options?: any) => r.version !== undefined ? { response: { object: allRows.get(`${r.objectId}:${r.version}`) } } : read(r, options))
  const record = createMakerProductIncomeRecoveryRecord({ target: x.target, packet, intent })
  const raw = { digest: packet.digest, transaction: { bcs: { value: bytes } }, effects: { bcs: { value: bcs.TransactionEffects.serialize(f.effectsData).toBytes() }, transactionDigest: packet.digest, status: { success: true } },
    events: { bcs: { value: ActivityFixtureEventsBcs.serialize(f.eventsData).toBytes() } }, signatures: [], objects: { objects: structuredClone([...allRows.values()]) } }
  x.client.transactionExecutionService.simulateTransaction = vi.fn(async () => ({ response: { transaction: raw, commandOutputs: [] } }))
  const result = { ...x, draft: { ...x.draft, attemptHex: toHex(intent.attempt) }, snapshot, packet, intent, record, originalText: exportMakerProductIncomeRecoveryRecord(record), allRows, effects: bcs.TransactionEffects.parse(bcs.TransactionEffects.serialize(f.effectsData).toBytes()), events: f.eventsData, fieldId, payoutId }
  const source=await makerProductIncomeInstallation(result),executionModels=[controlledIncomeExecutionModel()]
  return{...result,executionModels,executionRegistry:createIncomeExecutionRegistryV1({models:executionModels,makerSources:[source.installation]})}
}

export async function makerProductIncomeControllerFixture(attemptByte = 1, actor?: string, addressGas = false) {
  const x = await makerProductIncomeWitness(attemptByte, actor, addressGas), source = await makerProductIncomeInstallation(x)
  const controller = createRootMakerProductIncomeController({ installations: [source.installation], executionModels:x.executionModels, client: () => x.client })
  const selection = { target: x.target, actor: x.actor, controlId: x.controlId, installedSourceId: source.installation.acceptedManifestSha256 }
  return { ...x, ...source, controller, selection }
}
