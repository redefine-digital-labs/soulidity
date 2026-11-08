import { controlledFoundationIncomeQualification, attachControlledIncomeProtocol } from './income-controlled-qualification'
import { bcs, TypeTagSerializer } from '@mysten/sui/bcs'
import { Transaction } from '@mysten/sui/transactions'
import { deriveDynamicFieldID, normalizeStructTag, toBase64 } from '@mysten/sui/utils'
import { activityEvidenceFixture, activityHash, aid, adigest } from './activity-transaction-evidence'
import { EconomicsConfigBcs, EconomicsAdminBcs, IncomeRequestBcs, IncomeReceiptFieldBcs } from '../../../web/lib/soulidity/commerce/economics-bcs'
import { IncomeWithdrawnBcs, readIncomeWithdrawalHistory } from '../../../web/lib/soulidity/commerce/income-withdrawal-history'

type CreditInput = {
  target: { foundation: { originalPackageId: string; callablePackageId: string; callableDigest: string }; coinType: string }
  packageBytes: Uint8Array
  config: { objectId: string; version: bigint; digest: string; bcs: { value: Uint8Array }; contents: { value: Uint8Array } }
  amount: string
}

export async function incomeRecoveryImportFixture(credit?: CreditInput, actorOverride?: string) {
  const f = await activityEvidenceFixture(), pkg = f.packageData.data.Package!
  if (credit) {
    Object.assign(f.packageData, bcs.Object.parse(credit.packageBytes))
    Object.assign(f.deployment, credit.target.foundation)
    f.summaryData.sequence_number = '101'
  } else {
    pkg.moduleMap = new Map([['revenue', new Uint8Array([1])], ['economics', new Uint8Array([2])]])
    pkg.typeOriginTable = ['economics::Config', 'economics::Admin', 'revenue::Request', 'revenue::Receipt', 'revenue::Withdrawn'].map(key => {
      const [moduleName, datatypeName] = key.split('::'); return { moduleName, datatypeName, package: f.deployment.originalPackageId }
    })
  }
  f.rehashPackage()
  const configId = credit?.config.objectId ?? aid(60), adminId = aid(61), recipient = aid(62), payoutId = aid(64), actor = actorOverride ?? f.sender
  const outputVersion = credit ? Number(credit.config.version) + 1 : 10
  const amount = credit?.amount ?? '50'
  const coinType = credit?.target.coinType ?? normalizeStructTag('0x2::sui::SUI'), attempt = new Uint8Array(32).fill(1), rows = new Map<string, any>(), changes: any[] = []
  const config = credit ? EconomicsConfigBcs.parse(credit.config.contents.value) : EconomicsConfigBcs.parse(EconomicsConfigBcs.serialize({ id: configId, revision: 8, primary_bps: 250, secondary_bps: 250,
    complete_fee: 10, recipient: aid(70), paused: true, income: { root: configId, revision: 8, funds: 150, collected: 150, withdrawn: 0,
      requests: { id: aid(63), size: 0 } }, schema: 3, enabled: false, payment_coin: { name: coinType },
    original_package: f.deployment.originalPackageId, callable_package: f.deployment.callablePackageId, commitment: new Uint8Array(32).fill(1),
    native_binding: null, release_binding: null, minimum_release: 2, roles: { roles: Array.from({ length: 6 }, () => ({
      original: f.deployment.originalPackageId, callable: f.deployment.callablePackageId, marker: null, version: 1, pinned: false, frozen: false })) } }).toBytes())
  function object(id: string, type: string, contents: Uint8Array, owner: any, version: number) {
    const previousTransaction = version === outputVersion ? f.ledger.digest : adigest(9)
    const bytes = bcs.Object.serialize({ data: { Move: { type: { Other: TypeTagSerializer.parseFromStr(type).struct! },
      hasPublicTransfer: true, version, contents } }, owner, previousTransaction, storageRebate: 0 }).toBytes()
    const raw = bcs.Object.parse(bytes), row = { objectId: id, objectType: normalizeStructTag(type), version: BigInt(version),
      digest: activityHash('Object', bytes), previousTransaction, bcs: { value: bytes }, contents: { value: contents },
      owner: owner.AddressOwner ? { kind: 1, address: owner.AddressOwner } : owner.ObjectOwner ? { kind: 2, address: owner.ObjectOwner } : { kind: 3, version: 1n } }
    rows.set(`${id}:${version}`, row); return { row, owner: raw.owner }
  }
  function effect(id: string, a: ReturnType<typeof object> | null, b: ReturnType<typeof object>) {
    changes.push([id, { inputState: a ? { Exist: [[String(a.row.version), a.row.digest], a.owner] } : { NotExist: true },
      outputState: { ObjectWrite: [b.row.digest, b.owner] }, idOperation: a ? { None: true } : { Created: true } }])
  }
  const configType = `${f.deployment.originalPackageId}::economics::Config<${coinType}>`, adminType = `${f.deployment.originalPackageId}::economics::Admin`
  const table = config.income.requests.id, revision = config.income.revision
  const configBefore = credit ? { row: credit.config, owner: bcs.Object.parse(credit.config.bcs.value).owner }
    : object(configId, configType, EconomicsConfigBcs.serialize(config).toBytes(), { Shared: { initialSharedVersion: 1 } }, 9)
  rows.set(`${configId}:${configBefore.row.version}`, configBefore.row)
  const adminBytes = EconomicsAdminBcs.serialize({ id: adminId, config: configId }).toBytes()
  const adminBefore = object(adminId, adminType, adminBytes, { AddressOwner: actor }, 9)
  const coinCodec = bcs.struct('Coin', { id: bcs.Address, balance: bcs.u64() })
  const gasType = normalizeStructTag('0x2::coin::Coin<0x2::sui::SUI>')
  const gasBefore = object(aid(8), gasType, coinCodec.serialize({ id: aid(8), balance: 1000 }).toBytes(), { AddressOwner: actor }, 2)
  const tx = new Transaction(); tx.setSender(actor); tx.setGasOwner(actor); tx.setGasPrice(1); tx.setGasBudget(1000)
  tx.setGasPayment([{ objectId: aid(8), version: '2', digest: gasBefore.row.digest }]); tx.setExpiration({ Epoch: 6 })
  tx.moveCall({ target: `${f.deployment.callablePackageId}::economics::withdraw_income`, typeArguments: [coinType], arguments: [
    tx.sharedObjectRef({ objectId: configId, initialSharedVersion: 1, mutable: true }),
    tx.objectRef({ objectId: adminId, version: 9, digest: adminBefore.row.digest }), tx.pure.u64(revision), tx.pure.u64(amount), tx.pure.address(recipient), tx.pure.vector('u8', Array.from(attempt)),
  ] })
  const raw = bcs.TransactionData.parse(await tx.build()); Object.assign(f.transactionData.V1, raw.V1); f.rehashTransaction()
  const receipt = { root: configId, actor, attempt, recipient, amount, before_revision: revision,
    after_revision: String(BigInt(revision) + 1n), balance: String(BigInt(config.income.funds) - BigInt(amount)),
    total_collected: config.income.collected, total_withdrawn: String(BigInt(config.income.withdrawn) + BigInt(amount)) }
  f.eventsData.data = [{ package_id: f.deployment.callablePackageId, transaction_module: 'economics', sender: actor,
    type_: { address: f.deployment.originalPackageId, module: 'revenue', name: 'Withdrawn', typeParams: [] }, contents: IncomeWithdrawnBcs.serialize({ receipt }).toBytes() }]
  config.income = { root: configId, revision: receipt.after_revision, funds: receipt.balance, collected: receipt.total_collected,
    withdrawn: receipt.total_withdrawn, requests: { id: table, size: String(BigInt(config.income.requests.size) + 1n) } }
  effect(configId, configBefore, object(configId, configType, EconomicsConfigBcs.serialize(config).toBytes(), { Shared: { initialSharedVersion: 1 } }, outputVersion))
  effect(adminId, adminBefore, object(adminId, adminType, adminBytes, { AddressOwner: actor }, outputVersion))
  const keyType = `${f.deployment.originalPackageId}::revenue::Request`, request = { actor, attempt }
  const fieldId = deriveDynamicFieldID(table, keyType, IncomeRequestBcs.serialize(request).toBytes())
  effect(fieldId, null, object(fieldId, `0x2::dynamic_field::Field<${keyType},${f.deployment.originalPackageId}::revenue::Receipt>`,
    IncomeReceiptFieldBcs.serialize({ id: fieldId, name: request, value: receipt }).toBytes(), { ObjectOwner: table }, outputVersion))
  effect(payoutId, null, object(payoutId, `0x2::coin::Coin<${coinType}>`, bcs.struct('Coin', { id: bcs.Address, balance: bcs.u64() }).serialize({ id: payoutId, balance: amount }).toBytes(), { AddressOwner: recipient }, outputVersion))
  effect(aid(8), gasBefore, object(aid(8), gasType, coinCodec.serialize({ id: aid(8), balance: 997 }).toBytes(), { AddressOwner: actor }, outputVersion))
  f.effectsData.V2!.lamportVersion = String(outputVersion); f.effectsData.V2!.changedObjects = changes; f.effectsData.V2!.gasObjectIndex = 4; f.rehashEvents()
  f.client.ledgerService.getObject.mockImplementation(async ({ objectId, version }: any) => ({ response: { object: version === undefined ? f.pkg : rows.get(`${objectId}:${version}`) } }))
  return { f, rows, payoutId, params: { client: f.client as any, target: { chainIdentifier: '35834a8a', foundation: { originalPackageId:f.deployment.originalPackageId,callablePackageId:f.deployment.callablePackageId,callableDigest:f.deployment.callableDigest }, configId, coinType },
    packet: { bytes: toBase64(f.ledger.transaction.bcs.value), digest: f.ledger.digest, expirationEpoch: '6', phase: 'SIGNED' as const, signature: 'fixture' },
    intent: { actor, adminId, recipient, amount, revision, attempt }, signal: new AbortController().signal } }
}

import {createIncomeWithdrawalRecoveryRecord,exportIncomeWithdrawalRecoveryRecord} from '../../../web/lib/soulidity/commerce/income-withdrawal-recovery-record'
export async function portableIncomeRecoveryImportFixture(){const x=await incomeRecoveryImportFixture(),p=x.params.target.foundation;x.params.target.foundation={originalPackageId:p.originalPackageId,callablePackageId:p.callablePackageId,callableDigest:p.callableDigest} as typeof p;return {...x,text:exportIncomeWithdrawalRecoveryRecord(createIncomeWithdrawalRecoveryRecord(x.params))}}

/** Explicit qualified successor used by positive proof/preflight tests. Raw
 * import/query fixtures above remain unqualified unless a caller supplies it. */
export async function qualifiedIncomeRecoveryImportFixture(actor?: string){
 const x=await incomeRecoveryImportFixture(undefined, actor),qualification=controlledFoundationIncomeQualification(x.params.target,x.f.pkg.bcs.value)
 attachControlledIncomeProtocol(x.f,x.params.client)
 return{...x,...qualification,params:{...x.params,executionRegistry:qualification.executionRegistry}}
}

export async function qualifiedPortableIncomeRecoveryImportFixture(){const x=await qualifiedIncomeRecoveryImportFixture();return{...x,text:exportIncomeWithdrawalRecoveryRecord(createIncomeWithdrawalRecoveryRecord(x.params))}}
