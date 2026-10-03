import { bcs } from '@mysten/sui/bcs'
import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { Transaction, TransactionDataBuilder } from '@mysten/sui/transactions'
import { fromBase64, toBase64 } from '@mysten/sui/utils'
import { verifyTransactionSignature } from '@mysten/sui/verify'
import { MAINNET_GENESIS_DIGEST } from './mainnet-chain'
import { equipmentEligibility, baseSelectionEligibility, packSelectionEligibility, equipmentRemovalIndex } from './equipment-eligibility'
import { equipmentReleaseKey, operationCheck, validateEquipmentOperationRecord, buildEquipmentOperationTransaction,
  equipmentValueKey, EquipmentNoChangeError,
  type EquipmentSnapshot, type EquipmentOperation, type EquipmentOperationRecord, type EquipmentOperationAdapter } from './equipment-operation'
import { captureNamedLoadout, validateNamedLoadoutContent } from './named-loadout'
import { planNamedLoadout } from './named-loadout-plan'
import { packAttachmentEligibility } from './equipment-pack-attachment'

/** Real gRPC/wallet adapter. Removal reads only sealed definitions/Base identity,
 * not access/Seal/candidate configuration. Close needs neither source. */
export function createEquipmentOperationAdapter(params: {
  client: SuiGrpcClient
  read: (operation?: EquipmentOperation) => Promise<EquipmentSnapshot>
  observed?: EquipmentSnapshot
  getAddress: () => string | null
  sign: (transaction: Transaction) => Promise<{ bytes: string; signature: string }>
  onSnapshot?: (snapshot: EquipmentSnapshot) => void
}): EquipmentOperationAdapter {
  const { client } = params
  async function chain() {
    const { response } = await client.ledgerService.getServiceInfo({})
    operationCheck(response.chainId === MAINNET_GENESIS_DIGEST, 'Mainnet equipment RPC required')
  }
  async function fresh(operation?: EquipmentOperation) { await chain(); return params.read(operation) }
  function writable(snapshot: EquipmentSnapshot, expectedOwner: string) {
    operationCheck(snapshot.release?.writesEnabled === true, 'Equipment signing is disabled until this release is accepted')
    operationCheck(params.getAddress() === expectedOwner && snapshot.owner === expectedOwner && !snapshot.listed,
      'Connect the current Soul owner wallet; listed Souls cannot change equipment')
  }
  function same(snapshot: EquipmentSnapshot, record: Pick<EquipmentOperationRecord,
    'soulId'|'stateId'|'owner'|'ownershipEpoch'|'equipmentId'|'revision'|'release'>) {
    operationCheck(snapshot.soulId === record.soulId && snapshot.stateId === record.stateId
      && snapshot.owner === record.owner && snapshot.ownershipEpoch === record.ownershipEpoch
      && (snapshot.equipment?.loadout.id ?? null) === record.equipmentId && (snapshot.equipment?.loadout.revision ?? '0') === record.revision
      && equipmentReleaseKey(snapshot.release) === equipmentReleaseKey(record.release), 'Equipment changed; refresh before signing')
  }
  async function epoch() {
    const { response } = await client.ledgerService.getEpoch({ readMask: { paths: ['epoch'] } })
    operationCheck(response.epoch?.epoch !== undefined, 'Current epoch unavailable')
    return response.epoch.epoch
  }
  function source(snapshot: EquipmentSnapshot) {
    const value = snapshot.source
    operationCheck(value?.access, 'Verified Maker source and access required')
    return { makerRootId: value.root.id, definitionRegistryId: value.definitions.id, packRegistryId: value.packs.id,
      makerAccessPassId: value.access.id, paymentCoinType: value.paymentCoinType }
  }
  function eligible(snapshot: EquipmentSnapshot, operation: EquipmentOperation) {
    if (operation.kind === 'attach-pack') {
      const result = packAttachmentEligibility(snapshot, operation.pack)
      operationCheck(result.allowed, result.reason)
      if (operation.attachment) operationCheck(equipmentValueKey(operation.attachment) === equipmentValueKey(result.attachment), 'Pack attachment plan changed')
      return
    }
    if (operation.kind === 'apply-loadout') { planNamedLoadout(snapshot,operation.content); return }
    if (operation.kind === 'select-pack') {
      const result = packSelectionEligibility(snapshot,operation); operationCheck(result.allowed,result.reason); return result.slot
    }
    if (operation.kind === 'select-base') {
      const result = baseSelectionEligibility(snapshot, operation); operationCheck(result.allowed, result.reason); return result.slot
    }
    if (operation.kind === 'create' || operation.kind === 'equip') {
      const result = equipmentEligibility(snapshot, operation.kind === 'equip' ? operation : undefined)
      operationCheck(result.allowed, result.reason)
      return result.slot
    } else {
      operationCheck(snapshot.equipment, 'No persistent equipment exists for this Soul')
      if (operation.kind === 'clear-selection') operationCheck(equipmentRemovalIndex(snapshot,
        { kind: 'selection', selectionIndex: operation.selectionIndex }) !== null, 'This selection cannot be cleared without unlocking its component')
      else if (operation.kind === 'close') operationCheck(snapshot.equipment.loadout.selection_count === '0'
        && snapshot.equipment.loadout.selections.every(row => row === null), 'Remove every selection before closing equipment')
      else operationCheck(snapshot.equipment.instances.some(row => row.kind === (operation.kind === 'unequip-base' ? 'base' : 'external')
        && row.item.id === operation.itemId), 'This component is not equipped on this Soul')
    }
  }
  async function loadoutLimits(tx: Transaction, bytes?: Uint8Array) {
    const { protocolConfig } = await client.core.getProtocolConfig()
    const limit = (key: string) => {
      const value = protocolConfig.attributes[key]
      operationCheck(typeof value === 'string' && /^[1-9][0-9]*$/.test(value), `Current protocol limit unavailable: ${key}`)
      return BigInt(value)
    }
    const data = tx.getData()
    operationCheck(BigInt(data.commands.length) <= limit('max_programmable_tx_commands'), 'Loadout exceeds the current protocol command limit; it cannot be split into transactions')
    const objectCount = data.inputs.filter(input => input.Object || input.UnresolvedObject).length + (data.gasData.payment?.length ?? 0)
    operationCheck(BigInt(objectCount) <= limit('max_input_objects'), 'Loadout exceeds the current protocol object limit')
    const maxBytes = limit('max_tx_size_bytes')
    if (bytes) operationCheck(BigInt(bytes.length) <= maxBytes, 'Loadout exceeds the current protocol transaction byte limit')
    for (const input of data.inputs) if (input.Pure) operationCheck(BigInt(fromBase64(input.Pure.bytes).length) <= limit('max_pure_argument_size'), 'Loadout exceeds the current protocol pure input limit')
  }
  async function simulateEquipment(bytes: Uint8Array) {
    const result = await client.core.simulateTransaction({ transaction:bytes,checksEnabled:true })
    operationCheck(result.$kind === 'Transaction', 'Equipment final-state simulation failed; nothing was signed')
  }
  return {
    async prepare(operation) {
      // Freeze browser input before the first asynchronous read; caller changes
      // and supplied plans cannot influence a prepared operation.
      operation = structuredClone(operation)
      if (operation.kind === 'apply-loadout') operation = { kind:'apply-loadout',content:structuredClone(validateNamedLoadoutContent(operation.content)) }
      const snapshot = await fresh(operation); const owner = params.getAddress()
      operationCheck(owner, 'Connect the current Soul owner wallet')
      writable(snapshot, owner)
      const previous = params.observed
      operationCheck(previous, 'Refresh equipment before acting')
      same(snapshot, { soulId: previous.soulId, stateId: previous.stateId, owner: previous.owner,
        ownershipEpoch: previous.ownershipEpoch, equipmentId: previous.equipment?.loadout.id ?? null,
        revision: previous.equipment?.loadout.revision ?? '0', release: previous.release })
      if (operation.kind === 'apply-loadout') {
        const plan = planNamedLoadout(snapshot,operation.content)
        if (!plan.commandCount) throw new EquipmentNoChangeError()
        operation = { ...operation,plan,previousContent:captureNamedLoadout(snapshot) }
      }
      const slot = operation.kind === 'apply-loadout' ? undefined : eligible(snapshot,operation)
      if (operation.kind === 'attach-pack') {
        const result = packAttachmentEligibility(snapshot, operation.pack)
        operationCheck(result.allowed, result.reason)
        operation = { kind: 'attach-pack', pack: operation.pack, attachment: result.attachment }
      }
      if (operation.kind === 'equip' || operation.kind === 'select-base' || operation.kind === 'select-pack') {
        operationCheck(slot !== null && slot !== undefined, 'Equipment target slot missing')
        operation = { ...operation, targetSelectionIndex: String(slot) }
      }
      const context = { stateId: snapshot.stateId, equipmentId: snapshot.equipment?.loadout.id ?? null,
        revision: snapshot.equipment?.loadout.revision ?? '0', release: snapshot.release, operation,
        ...(!['create', 'close'].includes(operation.kind) ? { updateSource: snapshot.updateSource ? structuredClone(snapshot.updateSource) : undefined } : {}),
        ...(['create','equip','select-base','select-pack','attach-pack','apply-loadout'].includes(operation.kind) ? { source: source(snapshot) } : {}),
        ...(operation.kind === 'create' ? { provenanceBindingId: snapshot.provenanceBindingId } : {}) }
      const tx = buildEquipmentOperationTransaction(context)
      const expirationEpoch = String(await epoch() + 1n)
      tx.setSender(owner); tx.setExpiration({ Epoch: expirationEpoch })
      if (operation.kind === 'apply-loadout') await loadoutLimits(tx)
      const bytes = await tx.build({ client })
      if (operation.kind === 'apply-loadout') await loadoutLimits(Transaction.from(bytes),bytes)
      if (!['create', 'close'].includes(operation.kind)) await simulateEquipment(bytes)
      operationCheck(params.getAddress() === owner, 'Wallet changed while preparing equipment')
      return validateEquipmentOperationRecord({ schema: 1, soulId: snapshot.soulId,
        owner, ownershipEpoch: snapshot.ownershipEpoch, ...context,
        bytes: toBase64(bytes), digest: TransactionDataBuilder.getDigestFromBytes(bytes),
        expirationEpoch, phase: 'PREPARED', signature: null })
    },
    async preflight(record, signing) {
      validateEquipmentOperationRecord(record)
      operationCheck(params.getAddress() === record.owner, 'Reconnect the wallet that prepared this operation')
      const snapshot = await fresh(signing ? record.operation : undefined)
      operationCheck(snapshot.release.writesEnabled && equipmentReleaseKey(snapshot.release) === equipmentReleaseKey(record.release),
        'Release changed or signing paused; query the saved transaction without rebuilding it')
      if (signing) {
        writable(snapshot, record.owner); same(snapshot, record)
        if (record.operation.kind === 'apply-loadout') {
          operationCheck(equipmentValueKey(planNamedLoadout(snapshot,record.operation.content)) === equipmentValueKey(record.operation.plan)
            && equipmentValueKey(captureNamedLoadout(snapshot)) === equipmentValueKey(record.operation.previousContent), 'Loadout plan changed; refresh before signing')
          const bytes = fromBase64(record.bytes)
          await loadoutLimits(Transaction.from(bytes),bytes)
        } else eligible(snapshot, record.operation)
        if (record.source) operationCheck(JSON.stringify(source(snapshot)) === JSON.stringify(record.source), 'Equipment source changed')
        if (record.operation.kind === 'create') operationCheck(snapshot.provenanceBindingId === record.provenanceBindingId, 'Equipment provenance changed')
        if (!['create', 'close'].includes(record.operation.kind)) {
          operationCheck(equipmentValueKey(snapshot.updateSource) === equipmentValueKey(record.updateSource), 'Equipment final validation source changed')
          await simulateEquipment(fromBase64(record.bytes))
        }
      }
      operationCheck(await epoch() <= BigInt(record.expirationEpoch),
        'Saved transaction expired; query its result. It will not be rebuilt or resent')
    },
    async sign(record) {
      operationCheck(params.getAddress() === record.owner, 'Wallet changed before signature')
      return params.sign(Transaction.from(fromBase64(record.bytes)))
    },
    async verifySignature(record) {
      operationCheck(record.signature, 'Equipment signature missing')
      await verifyTransactionSignature(fromBase64(record.bytes), record.signature, { address: record.owner, client })
    },
    async broadcast(record) {
      operationCheck(params.getAddress() === record.owner && record.signature, 'Wallet changed; query the saved transaction')
      await client.core.executeTransaction({ transaction: fromBase64(record.bytes), signatures: [record.signature] })
    },
    async query(record) {
      await chain()
      let response
      try {
        response = (await client.ledgerService.getTransaction({ digest: record.digest, readMask: { paths: [
          'digest','transaction.digest','transaction.bcs','effects.bcs','effects.transaction_digest','effects.status','checkpoint',
        ] } })).response
      } catch (error) {
        // Only the transport's exact status is absence. No message matching,
        // expired-intent deletion, or conversion of RPC errors into failure.
        if (error && typeof error === 'object' && 'code' in error && error.code === 'NOT_FOUND') return 'MISSING'
        throw error
      }
      const value = response.transaction
      operationCheck(value?.digest === record.digest && value.transaction?.digest === record.digest
        && value.transaction.bcs?.value && toBase64(value.transaction.bcs.value) === record.bytes
        && value.effects?.transactionDigest === record.digest && value.effects.bcs?.value,
      'Equipment transaction evidence mismatch')
      const bytes = value.effects.bcs.value
      const decoded = bcs.TransactionEffects.parse(bytes)
      operationCheck(toBase64(bcs.TransactionEffects.serialize(decoded).toBytes()) === toBase64(bytes), 'Noncanonical equipment effects')
      const effects = decoded.V2 ?? decoded.V1
      operationCheck(effects?.transactionDigest === record.digest && ['Success','Failure'].includes(effects.status.$kind)
        && value.effects.status?.success === (effects.status.$kind === 'Success'), 'Equipment transaction status mismatch')
      if (value.checkpoint === undefined) return 'PENDING'
      operationCheck(value.checkpoint >= 0n, 'Invalid equipment checkpoint')
      return effects.status.$kind === 'Success' ? 'SUCCEEDED' : 'FAILED'
    },
    async readback() { const snapshot = await fresh(); params.onSnapshot?.(snapshot) },
  }
}
