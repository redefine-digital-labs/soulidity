import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { deriveDynamicFieldID, normalizeStructTag, toBase64 } from '@mysten/sui/utils'
import { profileReadStep } from '@soulidity/sdk'
import { collectionCommandRaw } from '../../collections/collection-command-plan'
import { historicalMoveObjectType } from '../../sui/historical-object'
import { commerceCheck, commerceId, decodeCommerce } from './economics-read'
import { IncomeReceiptFieldBcs, IncomeRequestBcs } from './economics-bcs'

export const MAX_INCOME_RETIREMENT_RECEIPTS = 2048
const MAX_PAGES = 64
const PAGE_SIZE = 50

/** Authenticate every field against the committed Table count. A direct
 * missing-field response alone cannot distinguish absence from partial RPC data. */
export async function assertRetirementReceiptAbsent(input: {
  client: SuiGrpcClient; rootId: string; table: { id: string; size: string }
  requestType: string; receiptType: string; receiptFieldId: string; signal: AbortSignal; errorPrefix: string
  authenticateKey: (contents: Uint8Array, objectId: string) => Uint8Array
}) {
  const { client, rootId, table, requestType, receiptType, receiptFieldId, signal, errorPrefix, authenticateKey } = input
  function check(value: unknown, code: string): asserts value { commerceCheck(value, errorPrefix + '_' + code) }
  const size = BigInt(table.size)
  check(commerceId(table.id) && table.id !== rootId && size <= MAX_INCOME_RETIREMENT_RECEIPTS, 'TABLE_BOUND')
  if (size === 0n) return
  const ledger = client.ledgerService, state = client.stateService
  check(typeof ledger.batchGetObjects === 'function' && typeof state?.listDynamicFields === 'function', 'TABLE_READER')
  const batch = ledger.batchGetObjects.bind(ledger), list = state.listDynamicFields.bind(state)
  const cursors = new Set<string>(), fields = new Set<string>()
  const fieldType = normalizeStructTag(`0x2::dynamic_field::Field<${requestType},${receiptType}>`)
  let pageToken: Uint8Array | undefined
  for (let i = 0; i < MAX_PAGES; i++) {
    const { response } = await profileReadStep(signal, () => list({ parent: table.id, pageSize: PAGE_SIZE, pageToken,
      readMask: { paths: ['parent', 'field_id'] } }, { abort: signal }))
    const rows = structuredClone(response.dynamicFields), next = response.nextPageToken?.slice()
    check(Array.isArray(rows) && rows.length <= PAGE_SIZE && BigInt(fields.size + rows.length) <= size
      && (!next || rows.length > 0), 'TABLE_PAGE')
    const requests = rows.map(row => {
      check(row.parent === table.id && row.fieldId && commerceId(row.fieldId) && !fields.has(row.fieldId),
        'TABLE_MEMBER')
      fields.add(row.fieldId)
      return { objectId: row.fieldId }
    })
    if (requests.length) {
      const { response: objects } = await profileReadStep(signal, () => batch({ requests,
        readMask: { paths: ['object_id','version','digest','bcs'] } }, { abort: signal }))
      check(objects.objects.length === requests.length, 'TABLE_OBJECT_COUNT')
      for (const [index, item] of objects.objects.entries()) {
        const row = item.result.oneofKind === 'object' ? item.result.object : undefined
        check(row?.objectId === requests[index].objectId && row.version && row.digest && row.bcs?.value instanceof Uint8Array
          && row.bcs.value.length > 0 && row.bcs.value.length <= 4096, 'TABLE_OBJECT')
        const object = collectionCommandRaw({ objectId: row.objectId, version: String(row.version), digest: row.digest, bcs: toBase64(row.bcs.value) })
        const move = object.data.Move
        check(move && object.owner.ObjectOwner === table.id && historicalMoveObjectType(move.type) === fieldType, 'TABLE_TYPE')
        const key = authenticateKey(move.contents, row.objectId)
        check(row.objectId === deriveDynamicFieldID(table.id, requestType, key), 'RECEIPT_BINDING')
        check(row.objectId !== receiptFieldId, 'RECEIPT_EXISTS')
      }
    }
    if (!next) {
      check(BigInt(fields.size) === size, 'TABLE_INCOMPLETE')
      signal.throwIfAborted()
      return
    }
    check(next instanceof Uint8Array && next.length > 0 && next.length <= 16384, 'TABLE_CURSOR')
    const encoded = toBase64(next)
    check(!cursors.has(encoded), 'TABLE_CURSOR')
    cursors.add(encoded)
    pageToken = next
  }
  check(false, 'TABLE_INCOMPLETE')
}

export function assertIncomeReceiptAbsent(input: Omit<Parameters<typeof assertRetirementReceiptAbsent>[0], 'authenticateKey'> & { revision: string }) {
  const { rootId, revision, errorPrefix } = input
  return assertRetirementReceiptAbsent({ ...input, authenticateKey(contents, objectId) {
    const field = decodeCommerce(IncomeReceiptFieldBcs, contents), { actor, attempt } = field.name, receipt = field.value
    commerceCheck(field.id === objectId && commerceId(actor) && attempt.length === 32 && attempt.some(n => n !== 0)
      && receipt.root === rootId && receipt.actor === actor
      && toBase64(Uint8Array.from(receipt.attempt)) === toBase64(Uint8Array.from(attempt))
      && BigInt(receipt.after_revision) === BigInt(receipt.before_revision) + 1n
      && BigInt(receipt.after_revision) <= BigInt(revision), errorPrefix + '_RECEIPT_BINDING')
    return IncomeRequestBcs.serialize(field.name).toBytes()
  } })
}
