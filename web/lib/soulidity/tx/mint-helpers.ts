/**
 * Shared PTB pieces for the three mint flows (native publish / import /
 * personal-join). Phase 2 moved every initial content slot into a single
 * `vector<InitialContentEntry>` argument, plus an optional
 * `vector<StateConfigEntry>` for SoulState.config_ext seeds. These helpers
 * compose the Move struct constructors and the `finalize_soul_state` call
 * so the three mint wrappers can stay tiny.
 */
import {
  Transaction,
  type TransactionArgument,
  type TransactionObjectArgument,
} from '@mysten/sui/transactions'
import { downloadPolicyToU8 } from '@/lib/soulidity/kinds'
import {
  type InitialContentEntryInput,
  type StateConfigEntryInput,
} from '@/lib/soulidity/tx/shared'

/**
 * Build the move-call result of `market::new_initial_content_entry` for one
 * input row. Returned argument is consumed by `tx.makeMoveVec` below.
 *
 * `tx.moveCall` returns a `TransactionResult` proxy. When the call has a
 * single by-value return slot (here: `InitialContentEntry`) the proxy is
 * also a `TransactionObjectArgument` for downstream commands; the cast
 * below pins that for the type-checker.
 */
function buildInitialContentEntryArg(
  tx: Transaction,
  packageId: string,
  entry: InitialContentEntryInput,
): TransactionObjectArgument {
  const result = tx.moveCall({
    target: `${packageId}::market::new_initial_content_entry`,
    arguments: [
      tx.pure.u32(entry.kind),
      tx.pure.string(entry.name),
      tx.pure.u64(BigInt(entry.slotReadModeMask)),
      tx.pure.u8(downloadPolicyToU8(entry.downloadPolicy)),
      tx.pure.bool(entry.setActive),
      tx.object(entry.blobObjectId),
    ],
  })
  return result as unknown as TransactionObjectArgument
}

function buildInitialContentVector(
  tx: Transaction,
  packageId: string,
  entries: ReadonlyArray<InitialContentEntryInput>,
): TransactionArgument {
  const args = entries.map((entry) => buildInitialContentEntryArg(tx, packageId, entry))
  return tx.makeMoveVec({
    type: `${packageId}::market::InitialContentEntry`,
    elements: args,
  })
}

function utf8Bytes(value: string): number[] {
  return Array.from(new TextEncoder().encode(value))
}

function buildStateConfigEntryArg(
  tx: Transaction,
  packageId: string,
  entry: StateConfigEntryInput,
): TransactionObjectArgument {
  const result = tx.moveCall({
    target: `${packageId}::market::new_state_config_entry`,
    arguments: [
      tx.pure.string(entry.key),
      tx.pure.vector('u8', utf8Bytes(entry.valueUtf8)),
    ],
  })
  return result as unknown as TransactionObjectArgument
}

function buildStateConfigVector(
  tx: Transaction,
  packageId: string,
  entries: ReadonlyArray<StateConfigEntryInput>,
): TransactionArgument {
  const args = entries.map((entry) => buildStateConfigEntryArg(tx, packageId, entry))
  return tx.makeMoveVec({
    type: `${packageId}::market::StateConfigEntry`,
    elements: args,
  })
}

export interface MintPtbInputs {
  initialContent: ReadonlyArray<InitialContentEntryInput>
  initialStateConfig: ReadonlyArray<StateConfigEntryInput>
}

/** Build the two `vector<...>` arguments shared by every mint wrapper. */
export function buildInitialContentArgs(
  tx: Transaction,
  packageId: string,
  inputs: MintPtbInputs,
): {
  initialContentVec: TransactionArgument
  initialStateConfigVec: TransactionArgument
} {
  return {
    initialContentVec: buildInitialContentVector(tx, packageId, inputs.initialContent),
    initialStateConfigVec: buildStateConfigVector(tx, packageId, inputs.initialStateConfig),
  }
}

/**
 * Append `market::finalize_soul_state` consuming the unshared `SoulState`
 * returned from a mint wrapper. Required before the PTB is signed —
 * otherwise the unshared state drops at end of TX, which Move treats as a
 * resource error.
 */
export function appendFinalizeSoulState(
  tx: Transaction,
  packageId: string,
  soulState: TransactionArgument,
): void {
  tx.moveCall({
    target: `${packageId}::market::finalize_soul_state`,
    arguments: [soulState],
  })
}
