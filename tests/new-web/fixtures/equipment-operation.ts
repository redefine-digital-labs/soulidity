import { Transaction, TransactionDataBuilder } from '@mysten/sui/transactions'
import { toBase64, toBase58 } from '@mysten/sui/utils'
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import { buildEquipmentOperationTransaction, type EquipmentOperationRecord, type EquipmentOperation } from '../../../web/lib/animacraft/equipment-operation'
export const eid = (n: number) => `0x${n.toString(16).padStart(64,'0')}`
export const signer = Ed25519Keypair.fromSecretKey(new Uint8Array(32).fill(7))
export const release = { network: 'mainnet' as const, protocolConfigId: eid(1), soulidityCallablePackageId: eid(5),
  soulidityCallableDigest: toBase58(new Uint8Array(32).fill(2)), runtimeOriginalPackageId: eid(70), runtimeCallablePackageId: eid(71),
  runtimeCallableDigest: toBase58(new Uint8Array(32).fill(3)), writesEnabled: true }
export async function equipmentOperationFixture(operation: EquipmentOperation = { kind: 'unequip-base', itemId: eid(84) },
  packDefinitions?: NonNullable<EquipmentOperationRecord['updateSource']>['packDefinitions'], revision = '1') {
  const context = { release: structuredClone(release), stateId: eid(14), equipmentId: operation.kind === 'create' ? null : eid(80),
    revision: operation.kind === 'create' ? '0' : revision, operation,
    ...(!['create', 'close'].includes(operation.kind) ? { updateSource: { definitionRegistryId: eid(81), baseRegistryId: eid(85),
      ...(packDefinitions ? { packDefinitions } : {}) } } : {}),
    ...(['create','equip','select-base','select-pack','attach-pack','apply-loadout'].includes(operation.kind) ? { source: { makerRootId: eid(10), definitionRegistryId: eid(81),
      packRegistryId: eid(82), makerAccessPassId: eid(83), paymentCoinType: `${eid(2)}::sui::SUI` } } : {}),
    ...(operation.kind === 'create' ? { provenanceBindingId: eid(13) } : {}) }
  let tx = buildEquipmentOperationTransaction(context)
  const owned = new Set<string>()
  if (operation.kind === 'apply-loadout') {
    owned.add(eid(83))
    for (const removal of operation.plan!.removals) if (removal.kind !== 'selection') owned.add(removal.itemId)
    for (const addition of operation.plan!.additions) {
      if (addition.kind === 'equip') owned.add(addition.item.itemId)
      if (addition.kind === 'select-pack') owned.add(addition.selection.passId)
    }
  } else if (operation.kind === 'create') { owned.add(eid(13)); owned.add(eid(83)) }
  else if (operation.kind === 'attach-pack') { owned.add(eid(83)); owned.add(operation.pack.passId) }
  else if (operation.kind === 'equip' || operation.kind === 'select-base' || operation.kind === 'select-pack') {
    owned.add(eid(83)); if (operation.kind === 'equip') owned.add(operation.item.itemId)
    if (operation.kind === 'select-pack') owned.add(operation.selection.passId)
    if (operation.replaces && operation.replaces.kind !== 'selection') owned.add(operation.replaces.itemId)
  } else if (operation.kind !== 'close' && operation.kind !== 'clear-selection') owned.add(operation.itemId)
  const data = tx.getData()
  tx = Transaction.from(JSON.stringify({ ...data, inputs: data.inputs.map(input => {
    if (!input.UnresolvedObject) return input
    const objectId = input.UnresolvedObject.objectId
    return owned.has(objectId)
      ? { Object: { ImmOrOwnedObject: { objectId, version: '2', digest: release.soulidityCallableDigest } } }
      : { Object: { SharedObject: { objectId, initialSharedVersion: '1',
        mutable: objectId === eid(80) || objectId === eid(14) && ['close','create'].includes(operation.kind) } } }
  }) }))
  const owner = signer.toSuiAddress()
  tx.setSender(owner); tx.setGasOwner(owner); tx.setGasPrice('1000'); tx.setGasBudget('1000000')
  tx.setGasPayment([{ objectId: eid(200), version: '1', digest: release.soulidityCallableDigest }]); tx.setExpiration({ Epoch: '10' })
  const bytes = await tx.build()
  const record: EquipmentOperationRecord = { schema: 1, soulId: eid(12), owner,
    ownershipEpoch: '0', ...context, bytes: toBase64(bytes),
    digest: TransactionDataBuilder.getDigestFromBytes(bytes), expirationEpoch: '10', phase: 'PREPARED', signature: null }
  return { record, tx, bytes }
}
