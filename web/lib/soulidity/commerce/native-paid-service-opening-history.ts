import { bcs } from '@mysten/sui/bcs'
import { toBase64 } from '@mysten/sui/utils'
import { TransactionDataBuilder } from '@mysten/sui/transactions'
import { profileReadStep } from '@soulidity/sdk'
import { readHistoricalMoveObject, historicalObjectOutput } from '../../sui/historical-object'
import { readHistoricalParentTransaction } from '../../sui/historical-parent-lineage'
import { readPinnedMovePackage } from '../../sui/pinned-move-package'
import { publicMutationCanonical } from '../../sui/public-mutation-journal'
import { CanonicalOwnedAccountBcs } from '../canonical-native-workbench'
import { NativePaidServiceBcs } from './native-paid-service-read'
import { buildNativePaidServiceOpening } from './native-paid-service-opening-transaction'
import { proveNativePaidContentServiceHistory } from './native-paid-content-service-history'
import { commerceCheck, decodeCommerce } from './economics-read'

/** Original service creation and Account authority handoff only. Parent first
 * authenticates the purchase; every service ancestor is independently finalized.
 * Opening call/source, original Soul/tree, Kiosk custody and full opening effect
 * qualification remain separate. No current Account/service authority inferred.
 */
export async function proveNativePaidServiceOpeningHistory(input: Parameters<typeof proveNativePaidContentServiceHistory>[0] & { checkpoint: string }) {
  const saved = structuredClone({ intent: input.intent, packet: input.packet, gas: input.gas, effects: input.effects, offer: input.offer,
    soulId: input.soulId, stateId: input.stateId, ledgerId: input.ledgerId, native: input.native, content: input.content, foundation: input.foundation,
    standard: input.standard, custody: input.custody, checkpoint: input.checkpoint })
  const { client, signal } = input, p = saved.intent
  await proveNativePaidContentServiceHistory({ ...saved, client, signal })
  const native = await readPinnedMovePackage(client, saved.native, signal), standard = await readPinnedMovePackage(client, saved.standard, signal), custody = await readPinnedMovePackage(client, saved.custody, signal)
  const type = (origins: Map<string, string>, module: string, name: string) => { const origin = origins.get(`${module}::${name}`)
    commerceCheck(origin, 'PAID_OPENING_ORIGIN'); return `${origin}::${module}::${name}` }
  const serviceType = `${type(standard.origins, 'soul', 'SourceService')}<${type(native.origins, 'birth', 'NativeModule')},${type(native.origins, 'birth', 'State')}>`
  let root = await readHistoricalMoveObject({ client, effects: saved.effects, transactionDigest: saved.packet.digest, objectId: p.service.objectId, type: serviceType, mode: 'input', signal })
  const snapshot = decodeCommerce(NativePaidServiceBcs, root.bytes), seen = new Set<string>()
  const trail: Array<{ version: string; transactionDigest: string; checkpoint: string }> = []
  let maxCheckpoint = saved.checkpoint
  for (let hop = 0; hop < 64; hop++) {
    signal.throwIfAborted()
    const value = decodeCommerce(NativePaidServiceBcs, root.bytes), previous = root.object.previousTransaction
    commerceCheck(root.object.owner.Shared?.initialSharedVersion === p.service.initialSharedVersion && !seen.has(previous)
      && !value.busy && BigInt(value.revision) <= BigInt(snapshot.revision)
      && publicMutationCanonical({ ...value, revision: null }) === publicMutationCanonical({ ...snapshot, revision: null }), 'PAID_OPENING_SERVICE_LINEAGE')
    seen.add(previous)
    const ancestor = await readHistoricalParentTransaction({ client, transactionDigest: previous, maxCheckpoint,
      chainIdentifier: '35834a8a', genesisDigest: '4btiuiMPvEENsttpZC7CZ53DruC3MAgfznDbASZ7DR6S', signal })
    commerceCheck(ancestor.executionStatus === 'Success', 'PAID_OPENING_FAILED_ANCESTOR')
    const output = historicalObjectOutput(ancestor.effects, p.service.objectId)
    commerceCheck(output.version === root.reference.version && output.digest === root.reference.digest
      && output.owner.Shared?.initialSharedVersion === p.service.initialSharedVersion, 'PAID_OPENING_ROOT_REFERENCE')
    const refs = ancestor.sharedInputs.filter(ref => ref.objectId === p.service.objectId)
    commerceCheck(output.created ? refs.length === 0 : refs.length === 1 && refs[0].mutable
      && String(refs[0].initialSharedVersion) === p.service.initialSharedVersion, 'PAID_OPENING_SHARED_INPUT')
    trail.push({ version: String(output.version), transactionDigest: previous, checkpoint: ancestor.checkpoint })
    if (output.created) {
      const accountType = type(custody.origins, 'account', 'Account')
      const readAccount = (mode: 'input' | 'mutated') => readHistoricalMoveObject({ client, effects: ancestor.effects, transactionDigest: previous,
        objectId: value.account, type: accountType, mode, signal })
      const beforeObject = await readAccount('input'), afterObject = await readAccount('mutated')
      const before = decodeCommerce(CanonicalOwnedAccountBcs, beforeObject.bytes), after = decodeCommerce(CanonicalOwnedAccountBcs, afterObject.bytes)
      commerceCheck(beforeObject.object.owner.AddressOwner === value.authority.owner && afterObject.object.owner.AddressOwner === value.authority.owner
        && before.id === value.account && before.owner === value.authority.owner && before.kiosk === value.authority.kiosk && before.authority
        && publicMutationCanonical(before.authority) === publicMutationCanonical(value.authority)
        && publicMutationCanonical(after) === publicMutationCanonical({ ...before, authority: null }), 'PAID_OPENING_ACCOUNT_HANDOFF')
      const row = (await profileReadStep(signal, () => client.ledgerService.getTransaction({ digest: previous, readMask: { paths: ['digest', 'transaction.bcs'] } }, { abort: signal }))).response.transaction
      const bytes = row?.transaction?.bcs?.value
      commerceCheck(row?.digest === previous && bytes instanceof Uint8Array && bytes.length > 0 && bytes.length <= 1024 * 1024, 'PAID_OPENING_PACKET')
      const tx = bcs.TransactionData.parse(bytes)
      commerceCheck(toBase64(bcs.TransactionData.serialize(tx).toBytes()) === toBase64(bytes)
        && TransactionDataBuilder.getDigestFromBytes(bytes) === previous && tx.V1.sender === value.authority.owner, 'PAID_OPENING_OWNER_SENDER')
      const expectedKind = await buildNativePaidServiceOpening({ owner: value.authority.owner, nativeCallablePackageId: saved.native.callablePackageId, coinType: p.coinType,
        soulId: value.root, registry: p.registry, config: p.config, kiosk: p.kiosk, account: { objectId: value.account, version: String(beforeObject.reference.version), digest: beforeObject.reference.digest },
        rootRevision: value.revision, expiresMs: value.expires }).build({ onlyTransactionKind: true })
      commerceCheck(toBase64(expectedKind) === toBase64(bcs.TransactionKind.serialize(tx.V1.kind).toBytes()), 'PAID_OPENING_WHOLE_KIND')
      return { proof: 'original-paid-service-creation-account-handoff-only' as const, transactionDigest: saved.packet.digest,
        serviceId: value.id, accountId: value.account, owner: value.authority.owner, capId: value.authority.cap.id,
        openingTransactionDigest: previous, openingCheckpoint: ancestor.checkpoint, openingRevision: value.revision, trail,
        openingCallMatched: true as const, requiresOriginalOpeningSourceQualification: true as const, requiresCompleteOpeningEffectsProof: true as const,
        notCurrentAuthority: true as const, notContentDeliveryProof: true as const }
    }
    root = await readHistoricalMoveObject({ client, effects: ancestor.effects, transactionDigest: previous, objectId: p.service.objectId, type: serviceType, mode: 'input', signal })
    commerceCheck(root.reference.version < output.version && BigInt(decodeCommerce(NativePaidServiceBcs, root.bytes).revision) < BigInt(value.revision), 'PAID_OPENING_PRIOR_VERSION'); maxCheckpoint = ancestor.checkpoint
  }
  throw Error('PAID_OPENING_HOP_BOUND')
}
