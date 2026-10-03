import { bcs } from '@mysten/sui/bcs'
import { Transaction } from '@mysten/sui/transactions'
import { fromBase64, toBase64 } from '@mysten/sui/utils'
import { createSoulAuthoringTransactionComposer } from './soul-authoring-transaction'
import { createSoulAuthoringPacketParser, soulAuthoringPacketCheck as check, type SoulAuthoringPacketRecord } from './soul-authoring-packet'
import { parseSoulAuthoringPreparation, type SoulAuthoringPreparation } from './soul-authoring-store'

type Data = ReturnType<Transaction['getData']>
type Command = Data['commands'][number]
type Argument = NonNullable<Command['MoveCall']>['arguments'][number]
const commandBytes = (c: Command) => toBase64(bcs.Command.serialize(c as Parameters<typeof bcs.Command.serialize>[0]).toBytes())
/** Build the expected business graph ONLY from the frozen author intent and
 * historically proved registered Blob IDs. Never adopt the observed suffix as
 * its own template. Walrus verifier owns precisely its supplied command set. */
export function assertSoulAuthoringBusinessGraph(params: {
  preparation: SoulAuthoringPreparation; record: SoulAuthoringPacketRecord
  walrusCommandIndices: readonly number[]; registeredBlobIds: readonly string[]
}) {
  const prepared = parseSoulAuthoringPreparation(params.preparation)
  const record = createSoulAuthoringPacketParser(prepared).parse(params.record)
  const actual = Transaction.from(fromBase64(record.packet.bytes)).getData(), template = new Transaction()
  const composer = createSoulAuthoringTransactionComposer(prepared.manifest, prepared.preparation)
  let fileIndices: readonly number[]
  if (record.plan.step.kind === 'REGISTER') {
    composer.appendRegistrationBusiness(template, record.plan.step.kiosk)
    fileIndices = prepared.preparation.manifest.files.map(f => f.index)
  } else {
    const stage = composer.prepareMintBusiness(prepared.preparation, params.registeredBlobIds, record.plan.step.chunk)
    stage.append(template); fileIndices = stage.fileIndices
  }
  const expected = template.getData(), excluded = [...params.walrusCommandIndices]
  check(new Set(excluded).size === excluded.length && excluded.every(i => Number.isSafeInteger(i) && i >= 0 && i < actual.commands.length), 'WALRUS_COMMAND_INDICES')
  const skip = new Set(excluded), business = actual.commands.flatMap((_, i) => skip.has(i) ? [] : [i])
  check(business.length === expected.commands.length, 'BUSINESS_COMMAND_COUNT')
  const inputs = new Map<number, number>(), used = new Set<number>()
  function objectId(value: Data['inputs'][number]) {
    return value.Object?.SharedObject?.objectId ?? value.Object?.ImmOrOwnedObject?.objectId ?? value.Object?.Receiving?.objectId
  }
  function bindInput(wantedIndex: number, observed: Argument): Argument {
    check(observed.$kind === 'Input' && actual.inputs[observed.Input], 'BUSINESS_INPUT_REQUIRED')
    const at = observed.Input, wanted = expected.inputs[wantedIndex], got = actual.inputs[at]
    check(wanted, 'EXPECTED_INPUT_MISSING')
    check(!inputs.has(wantedIndex) || inputs.get(wantedIndex) === at, 'BUSINESS_INPUT_ALIAS_CHANGED')
    if (wanted.Pure) check(got.Pure?.bytes === wanted.Pure.bytes, 'BUSINESS_PURE_MISMATCH')
    else if (wanted.UnresolvedObject) check(!got.Object?.Receiving && objectId(got) === wanted.UnresolvedObject.objectId, 'BUSINESS_OBJECT_MISMATCH')
    else if (wanted.Object) check(JSON.stringify(wanted.Object) === JSON.stringify(got.Object), 'BUSINESS_REFERENCE_MISMATCH')
    else check(false, 'UNSUPPORTED_BUSINESS_INPUT')
    inputs.set(wantedIndex, at); used.add(at)
    return { $kind: 'Input', Input: at }
  }
  function argument(wanted: Argument, got: Argument): Argument {
    if (wanted.$kind === 'Input') return bindInput(wanted.Input, got)
    if (wanted.$kind === 'Result') {
      check(business[wanted.Result] !== undefined, 'BUSINESS_RESULT_SCOPE')
      return { $kind: 'Result', Result: business[wanted.Result] }
    }
    if (wanted.$kind === 'NestedResult') {
      check(business[wanted.NestedResult[0]] !== undefined, 'BUSINESS_RESULT_SCOPE')
      return { $kind: 'NestedResult', NestedResult: [business[wanted.NestedResult[0]], wanted.NestedResult[1]] }
    }
    check(false, 'BUSINESS_GAS_REFERENCE_FORBIDDEN')
  }
  function argumentsOf(c: Command): Argument[] {
    if (c.MoveCall) return c.MoveCall.arguments
    if (c.MakeMoveVec) return c.MakeMoveVec.elements
    if (c.TransferObjects) return [...c.TransferObjects.objects, c.TransferObjects.address]
    if (c.SplitCoins) return [c.SplitCoins.coin, ...c.SplitCoins.amounts]
    if (c.MergeCoins) return [c.MergeCoins.destination, ...c.MergeCoins.sources]
    check(false, 'UNSUPPORTED_TRANSACTION_COMMAND')
  }
  function remap(wanted: Command, observed: Command): Command {
    check(wanted.$kind === observed.$kind, 'BUSINESS_COMMAND_KIND')
    const next = structuredClone(wanted), want = argumentsOf(next), got = argumentsOf(observed)
    check(want.length === got.length, 'BUSINESS_ARGUMENT_COUNT')
    const mapped = want.map((arg, i) => argument(arg, got[i]))
    if (next.MoveCall) next.MoveCall.arguments = mapped
    else if (next.MakeMoveVec) next.MakeMoveVec.elements = mapped
    else if (next.TransferObjects) { next.TransferObjects.objects = mapped.slice(0, -1); next.TransferObjects.address = mapped.at(-1)! }
    else if (next.SplitCoins) { next.SplitCoins.coin = mapped[0]; next.SplitCoins.amounts = mapped.slice(1) }
    else if (next.MergeCoins) { next.MergeCoins.destination = mapped[0]; next.MergeCoins.sources = mapped.slice(1) }
    return next
  }
  expected.commands.forEach((command, index) => {
    const observed = actual.commands[business[index]]
    check(commandBytes(remap(command, observed)) === commandBytes(observed), 'BUSINESS_COMMAND_MISMATCH')
  })
  // Every actual input must belong to either the independently checked business
  // graph or the already proved uploader graph. Reject unattached hidden inputs.
  for (const index of excluded) for (const arg of argumentsOf(actual.commands[index])) if (arg.$kind === 'Input') {
    check(actual.inputs[arg.Input], 'WALRUS_INPUT_MISSING'); used.add(arg.Input)
  }
  check(used.size === actual.inputs.length, 'UNCLAIMED_TRANSACTION_INPUT')
  const objects = new Set(actual.inputs.map(objectId).filter((id): id is string => Boolean(id)))
  check(actual.gasData.payment && actual.gasData.payment.every(coin => !objects.has(coin.objectId))
    && new Set(actual.gasData.payment.map(coin => coin.objectId)).size === actual.gasData.payment.length, 'GAS_INPUT_ALIAS')
  return { record, businessCommandIndices: business, fileIndices: [...fileIndices], inputIndices: [...inputs.entries()] }
}
