import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { deriveDynamicFieldID, fromBase58, fromHex, toBase58 } from '@mysten/sui/utils'
import { Transaction } from '@mysten/sui/transactions'
import { MAINNET_GENESIS_DIGEST } from '../../animacraft/mainnet-chain'
import { readEpochExpiry } from '../../sui/epoch-expiry'
import { validateEpochCheckpoint, type EpochCheckpoint } from '../../sui/epoch-checkpoint'
import { publicMutationCanonical } from '../../sui/public-mutation-journal'
import { commerceCheck as check, commerceId } from './economics-read'
import { IncomeRequestBcs } from './economics-bcs'
import { verifyMakerIncomeRetirementSourceV1, type IncomeExecutionRegistryV1 } from './income-execution-source-v1'
import { readMakerProductIncome } from './maker-product-income-read'
import type { MakerProductIncomeRecoveryRecord } from './maker-product-income-recovery-record'

import { assertIncomeReceiptAbsent, MAX_INCOME_RETIREMENT_RECEIPTS } from './income-retirement-receipt-table'

export interface MakerProductRetirementEvidence {
  checkpoint: EpochCheckpoint
  product: { version: string; digest: string; ledgerRevision: string }
  tableId: string
  tableSize: string
  receiptFieldId: string
}

export function validateMakerProductRetirementEvidence(value: MakerProductRetirementEvidence, expirationEpoch: string) {
  const keys = (row: object | undefined, expected: string[]) => row && Object.keys(row).sort().join() === expected.sort().join()
  const uint = (v: unknown) => typeof v === 'string' && /^(0|[1-9][0-9]{0,19})$/.test(v) && BigInt(v) <= 18446744073709551615n
  check(value && keys(value, ['checkpoint','product','tableId','tableSize','receiptFieldId'])
    && keys(value.checkpoint, ['bytes','digest','epoch','sequenceNumber']) && keys(value.product, ['version','digest','ledgerRevision'])
    && commerceId(value.tableId) && commerceId(value.receiptFieldId) && value.tableId !== value.receiptFieldId
    && uint(value.tableSize) && BigInt(value.tableSize) <= MAX_INCOME_RETIREMENT_RECEIPTS
    && uint(value.product.version) && BigInt(value.product.version) > 0n && uint(value.product.ledgerRevision)
    && typeof value.product.digest === 'string' && value.product.digest.length <= 44, 'MAKER_INCOME_RETIREMENT_EVIDENCE')
  const bytes = fromBase58(value.product.digest)
  check(bytes.length === 32 && toBase58(bytes) === value.product.digest, 'MAKER_INCOME_RETIREMENT_PRODUCT_DIGEST')
  validateEpochCheckpoint(value.checkpoint, expirationEpoch)
  return value
}

/** Positive, complete absence evidence under the qualified permanent receipt-table invariant. */
export async function verifyMakerProductRetirement<T extends { status: string }>(input: {
  client: SuiGrpcClient; original: MakerProductIncomeRecoveryRecord; signal: AbortSignal; executionRegistry: IncomeExecutionRegistryV1
  saved?: MakerProductRetirementEvidence; queryOriginal: () => Promise<T>
}) {
  const { client, signal, executionRegistry } = input, original = structuredClone(input.original)
  const saved = input.saved && validateMakerProductRetirementEvidence(structuredClone(input.saved), original.packet.expirationEpoch)
  const checkpoint = await readEpochExpiry(client, original.packet.expirationEpoch, signal, MAINNET_GENESIS_DIGEST, saved?.checkpoint,
    'MAKER_INCOME_RETIREMENT')
  const { requestType, receiptType } = await verifyMakerIncomeRetirementSourceV1({ registry: executionRegistry, client, target: original.target, signal })
  const product = await readMakerProductIncome({ client, target: original.target, signal })
  const shared = Transaction.from(original.packet.bytes).getData().inputs[0].Object?.SharedObject
  check(shared?.initialSharedVersion === product.initialSharedVersion && BigInt(product.ledger.revision) >= BigInt(original.intent.revision),
    'MAKER_INCOME_RETIREMENT_PRODUCT_SCOPE')
  const table = product.product.income.requests
  const key = IncomeRequestBcs.serialize({ actor: original.intent.actor, attempt: fromHex(original.intent.attemptHex) }).toBytes()
  const receiptFieldId = deriveDynamicFieldID(table.id, requestType, key)
  const evidence = validateMakerProductRetirementEvidence({ checkpoint, tableId: table.id, tableSize: table.size, receiptFieldId,
    product: { version: product.object.version, digest: product.object.digest, ledgerRevision: product.ledger.revision },
  }, original.packet.expirationEpoch)
  if (saved) check(saved.tableId === table.id && saved.receiptFieldId === receiptFieldId
    && BigInt(evidence.tableSize) >= BigInt(saved.tableSize) && BigInt(evidence.product.ledgerRevision) >= BigInt(saved.product.ledgerRevision)
    && BigInt(evidence.product.version) >= BigInt(saved.product.version)
    && (evidence.product.version !== saved.product.version || publicMutationCanonical(evidence.product) === publicMutationCanonical(saved.product)),
    'MAKER_INCOME_RETIREMENT_STORED_SCOPE')
  await assertIncomeReceiptAbsent({ client, rootId: product.object.objectId, revision: product.ledger.revision,
    table, requestType, receiptType, receiptFieldId, signal, errorPrefix: 'MAKER_INCOME_RETIREMENT' })
  const observed = await input.queryOriginal()
  check(observed.status === 'MISSING', 'MAKER_INCOME_RETIREMENT_ORIGINAL_FOUND')
  const after = await readMakerProductIncome({ client, target: original.target, signal })
  check(publicMutationCanonical(after.object) === publicMutationCanonical(product.object)
    && publicMutationCanonical(after.product.income.requests) === publicMutationCanonical(table), 'MAKER_INCOME_RETIREMENT_PRODUCT_CHANGED')
  signal.throwIfAborted()
  return { evidence, observed }
}
