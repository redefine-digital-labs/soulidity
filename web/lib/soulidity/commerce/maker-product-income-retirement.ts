import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { deriveDynamicFieldID, fromBase58, fromHex, normalizeStructTag, toBase58, toBase64 } from '@mysten/sui/utils'
import { Transaction } from '@mysten/sui/transactions'
import { profileReadStep } from '@soulidity/sdk'
import { MAINNET_GENESIS_DIGEST } from '../../animacraft/mainnet-chain'
import { collectionCommandRaw } from '../../collections/collection-command-plan'
import { readEpochExpiry } from '../../sui/epoch-expiry'
import { validateEpochCheckpoint, type EpochCheckpoint } from '../../sui/epoch-checkpoint'
import { historicalMoveObjectType } from '../../sui/historical-object'
import { publicMutationCanonical } from '../../sui/public-mutation-journal'
import { commerceCheck as check, commerceId, decodeCommerce } from './economics-read'
import { IncomeReceiptFieldBcs, IncomeRequestBcs } from './economics-bcs'
import { verifyMakerIncomeRetirementSourceV1, type IncomeExecutionRegistryV1 } from './income-execution-source-v1'
import { readMakerProductIncome } from './maker-product-income-read'
import type { MakerProductIncomeRecoveryRecord } from './maker-product-income-recovery-record'

const MAX_RECEIPTS = 2048
const MAX_PAGES = 64
const PAGE_SIZE = 50
type Product = Awaited<ReturnType<typeof readMakerProductIncome>>

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
    && uint(value.tableSize) && BigInt(value.tableSize) <= MAX_RECEIPTS
    && uint(value.product.version) && BigInt(value.product.version) > 0n && uint(value.product.ledgerRevision)
    && typeof value.product.digest === 'string' && value.product.digest.length <= 44, 'MAKER_INCOME_RETIREMENT_EVIDENCE')
  const bytes = fromBase58(value.product.digest)
  check(bytes.length === 32 && toBase58(bytes) === value.product.digest, 'MAKER_INCOME_RETIREMENT_PRODUCT_DIGEST')
  validateEpochCheckpoint(value.checkpoint, expirationEpoch)
  return value
}

async function assertReceiptAbsent(input: {
  client: SuiGrpcClient; product: Product; requestType: string; receiptType: string; receiptFieldId: string; signal: AbortSignal
}) {
  const { client, product, requestType, receiptType, receiptFieldId, signal } = input
  const table = product.product.income.requests, size = BigInt(table.size)
  check(commerceId(table.id) && table.id !== product.object.objectId && size <= MAX_RECEIPTS, 'MAKER_INCOME_RETIREMENT_TABLE_BOUND')
  if (size === 0n) return
  const ledger = client.ledgerService, state = client.stateService
  check(typeof ledger.batchGetObjects === 'function' && typeof state?.listDynamicFields === 'function', 'MAKER_INCOME_RETIREMENT_TABLE_READER')
  const batch = ledger.batchGetObjects.bind(ledger), list = state.listDynamicFields.bind(state)
  const cursors = new Set<string>(), fields = new Set<string>()
  const fieldType = normalizeStructTag(`0x2::dynamic_field::Field<${requestType},${receiptType}>`)
  let pageToken: Uint8Array | undefined
  for (let i = 0; i < MAX_PAGES; i++) {
    const { response } = await profileReadStep(signal, () => list({ parent: table.id, pageSize: PAGE_SIZE, pageToken,
      readMask: { paths: ['parent', 'field_id'] } }, { abort: signal }))
    const rows = structuredClone(response.dynamicFields), next = response.nextPageToken?.slice()
    check(Array.isArray(rows) && rows.length <= PAGE_SIZE && BigInt(fields.size + rows.length) <= size
      && (!next || rows.length > 0), 'MAKER_INCOME_RETIREMENT_TABLE_PAGE')
    const requests = rows.map(row => {
      check(row.parent === table.id && row.fieldId && commerceId(row.fieldId) && !fields.has(row.fieldId),
        'MAKER_INCOME_RETIREMENT_TABLE_MEMBER')
      fields.add(row.fieldId)
      return { objectId: row.fieldId }
    })
    if (requests.length) {
      const { response: objects } = await profileReadStep(signal, () => batch({ requests,
        readMask: { paths: ['object_id','version','digest','bcs'] } }, { abort: signal }))
      check(objects.objects.length === requests.length, 'MAKER_INCOME_RETIREMENT_TABLE_OBJECT_COUNT')
      for (const [index, item] of objects.objects.entries()) {
        const row = item.result.oneofKind === 'object' ? item.result.object : undefined
        check(row?.objectId === requests[index].objectId && row.version && row.digest && row.bcs?.value instanceof Uint8Array
          && row.bcs.value.length > 0 && row.bcs.value.length <= 4096, 'MAKER_INCOME_RETIREMENT_TABLE_OBJECT')
        const object = collectionCommandRaw({ objectId: row.objectId, version: String(row.version), digest: row.digest, bcs: toBase64(row.bcs.value) })
        const move = object.data.Move
        check(move && object.owner.ObjectOwner === table.id && historicalMoveObjectType(move.type) === fieldType, 'MAKER_INCOME_RETIREMENT_TABLE_TYPE')
        const field = decodeCommerce(IncomeReceiptFieldBcs, move.contents), { actor, attempt } = field.name, receipt = field.value
        const key = IncomeRequestBcs.serialize(field.name).toBytes()
        check(field.id === row.objectId && field.id === deriveDynamicFieldID(table.id, requestType, key)
          && commerceId(actor) && attempt.length === 32 && attempt.some(n => n !== 0)
          && receipt.root === product.object.objectId && receipt.actor === actor
          && toBase64(Uint8Array.from(receipt.attempt)) === toBase64(Uint8Array.from(attempt))
          && BigInt(receipt.after_revision) === BigInt(receipt.before_revision) + 1n
          && BigInt(receipt.after_revision) <= BigInt(product.ledger.revision), 'MAKER_INCOME_RETIREMENT_RECEIPT_BINDING')
        check(field.id !== receiptFieldId, 'MAKER_INCOME_RETIREMENT_RECEIPT_EXISTS')
      }
    }
    if (!next) {
      check(BigInt(fields.size) === size, 'MAKER_INCOME_RETIREMENT_TABLE_INCOMPLETE')
      signal.throwIfAborted()
      return
    }
    check(next instanceof Uint8Array && next.length > 0 && next.length <= 16384, 'MAKER_INCOME_RETIREMENT_TABLE_CURSOR')
    const encoded = toBase64(next)
    check(!cursors.has(encoded), 'MAKER_INCOME_RETIREMENT_TABLE_CURSOR')
    cursors.add(encoded)
    pageToken = next
  }
  throw Error('COMMERCE_MAKER_INCOME_RETIREMENT_TABLE_INCOMPLETE')
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
  await assertReceiptAbsent({ client, product, requestType, receiptType, receiptFieldId, signal })
  const observed = await input.queryOriginal()
  check(observed.status === 'MISSING', 'MAKER_INCOME_RETIREMENT_ORIGINAL_FOUND')
  const after = await readMakerProductIncome({ client, target: original.target, signal })
  check(publicMutationCanonical(after.object) === publicMutationCanonical(product.object)
    && publicMutationCanonical(after.product.income.requests) === publicMutationCanonical(table), 'MAKER_INCOME_RETIREMENT_PRODUCT_CHANGED')
  signal.throwIfAborted()
  return { evidence, observed }
}
