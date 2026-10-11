'use client'

import type { WalrusClient } from '@mysten/walrus'
import { buildWalrusUploadPlan, isWalrusUploadQuoteFresh, quoteWalrusUpload,
  assertPrivateWalletBookmarksId, assertPrivateWalletBookmarksU64, assertPrivateWalletBookmarksHash,
  PRIVATE_WALLET_BOOKMARKS_MAX_CIPHERTEXT_BYTES, type WalrusUploadQuote } from '@soulidity/sdk'
import { sha256Hex } from '../upload/client-seal'
import { uploadDurableWalrusBlob, recoverDurableWalrusBlob, queryDurableWalrusBlobRecord, type DurableWalrusBlobResult } from '../upload/walrus-single-upload'
import { parseWalrusSingleRecord, readWalrusSingleRecord, walrusSingleKey, type WalrusSingleExecution, type WalrusSingleRecord } from '../upload/walrus-single-operation'

export { acknowledgeWalrusSingleBlobUpload } from '../upload/walrus-single-upload'
export type { DurableWalrusBlobResult } from '../upload/walrus-single-upload'

export interface PrivateBookmarkUploadConfig {
  network: 'mainnet'
  relayUrl: string
  wasmUrl: string
  storageEpochs: number
}
const MAX_TIP = BigInt(Number.MAX_SAFE_INTEGER)
const WASM_VERSION = '(?:0|[1-9][0-9]*)\\.(?:0|[1-9][0-9]*)\\.(?:0|[1-9][0-9]*)(?:-[0-9A-Za-z.-]+)?(?:\\+[0-9A-Za-z.-]+)?'
const LOCAL_WASM = new RegExp(`^/walrus/walrus_wasm@${WASM_VERSION}\\.wasm$`)
function check(condition: unknown, code: string): asserts condition {
  if (!condition) throw new Error(`PRIVATE_BOOKMARK_STORAGE_${code}`)
}
function publicUrl(value: unknown): string {
  check(typeof value === 'string' && value.length > 0 && value.length <= 2048, 'PUBLIC_URL_INVALID')
  let url: URL
  try { url = new URL(value) } catch { throw new Error('PRIVATE_BOOKMARK_STORAGE_PUBLIC_URL_INVALID') }
  check(url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash, 'PUBLIC_URL_INVALID')
  return url.href.replace(/\/+$/, '')
}
export function validatePrivateBookmarkUploadConfig(input: PrivateBookmarkUploadConfig): Readonly<PrivateBookmarkUploadConfig> {
  const value = structuredClone(input)
  check(value && typeof value === 'object' && Object.keys(value).length === 4
    && ['network', 'relayUrl', 'wasmUrl', 'storageEpochs'].every(key => Object.hasOwn(value, key)), 'CONFIG_INVALID')
  check(value.network === 'mainnet', 'MAINNET_REQUIRED')
  check(Number.isInteger(value.storageEpochs) && value.storageEpochs > 0 && value.storageEpochs <= 0xffff_ffff, 'EPOCHS_INVALID')
  const relayUrl = publicUrl(value.relayUrl)
  check(typeof value.wasmUrl === 'string' && value.wasmUrl.length <= 2048, 'WASM_URL_INVALID')
  const wasmUrl = LOCAL_WASM.test(value.wasmUrl) ? value.wasmUrl : publicUrl(value.wasmUrl)
  return Object.freeze({ network: 'mainnet', relayUrl, wasmUrl, storageEpochs: value.storageEpochs })
}

/** No default network, testnet relay, private env fallback or mutable CDN tag. */
export function getBrowserPrivateBookmarkUploadConfig(storageEpochs = 26): Readonly<PrivateBookmarkUploadConfig> {
  check(process.env.NEXT_PUBLIC_SUI_NETWORK === 'mainnet', 'MAINNET_REQUIRED')
  const relayUrl = process.env.NEXT_PUBLIC_WALRUS_UPLOAD_RELAY_URL
  check(typeof relayUrl === 'string' && relayUrl.length > 0, 'RELAY_REQUIRED')
  let wasmUrl = process.env.NEXT_PUBLIC_WALRUS_WASM_URL
  if (!wasmUrl) {
    const version = process.env.NEXT_PUBLIC_WALRUS_WASM_VERSION
    check(typeof version === 'string' && new RegExp(`^${WASM_VERSION}$`).test(version), 'PINNED_WASM_REQUIRED')
    wasmUrl = `/walrus/walrus_wasm@${version}.wasm`
  }
  return validatePrivateBookmarkUploadConfig({ network: 'mainnet', relayUrl, wasmUrl, storageEpochs })
}

function operation(owner: string, operationScope: string) {
  assertPrivateWalletBookmarksId(owner)
  check(typeof operationScope === 'string' && operationScope.length <= 1024, 'SCOPE_INVALID')
  const fields = operationScope.split(':')
  check(fields.length === 6 && fields[0] === 'private-bookmark', 'SCOPE_INVALID')
  check(fields[1] === '35834a8a', 'CHAIN_INVALID')
  for (const field of fields.slice(2, 5)) assertPrivateWalletBookmarksId(field)
  check(fields[4] === owner, 'OWNER_MISMATCH')
  assertPrivateWalletBookmarksHash(fields[5])
}
function factory(execution: WalrusSingleExecution, config: Readonly<PrivateBookmarkUploadConfig>) {
  return async (maxTip: bigint): Promise<WalrusClient> => {
    check(typeof maxTip === 'bigint' && maxTip >= 0n && maxTip <= MAX_TIP, 'RELAY_TIP_INVALID')
    const { WalrusClient } = await import('@mysten/walrus')
    // The SDK scopes this cache by Sui client, not relay. Do not reuse a tip
    // configuration learned from a different relay or approval ceiling.
    execution.client.cache.clear(['@mysten/walrus', 'upload-relay-tip-config'])
    return new WalrusClient({ suiClient: execution.client, network: config.network, wasmUrl: config.wasmUrl,
      uploadRelay: { host: config.relayUrl, sendTip: { max: Number(maxTip) } } })
  }
}
function assertRecovery(record: WalrusSingleRecord, owner: string, operationScope: string, config: Readonly<PrivateBookmarkUploadConfig>) {
  const intent = record.intent
  check(intent.owner === owner && intent.recipient === owner && intent.operationScope === operationScope
    && intent.network === config.network && intent.relayUrl === config.relayUrl
    && intent.storageEpochs === config.storageEpochs && intent.attachmentScope === null, 'RECOVERY_SCOPE_MISMATCH')
  check(intent.contentHash === intent.payloadHash && intent.payloadByteLength > 0
    && intent.payloadByteLength <= PRIVATE_WALLET_BOOKMARKS_MAX_CIPHERTEXT_BYTES, 'RECOVERY_CIPHERTEXT_MISMATCH')
  assertPrivateWalletBookmarksHash(intent.payloadHash)
}

/** Input is the EXACT already-persisted encrypted envelope, never plaintext.
 * The root's encrypted draft/WAL import checks must run before this call: loss
 * of an already-paid journal is not permission to create another payment. */
export async function uploadPrivateBookmarkCiphertext(input: {
  bytes: Uint8Array
  owner: string
  operationScope: string
  config: PrivateBookmarkUploadConfig
  execution: WalrusSingleExecution
  confirmQuote: (quote: WalrusUploadQuote) => Promise<boolean>
  verify: (signing: boolean) => Promise<void>
}): Promise<DurableWalrusBlobResult> {
  const config = validatePrivateBookmarkUploadConfig(input.config), owner = input.owner, operationScope = input.operationScope
  operation(owner, operationScope)
  check(input.bytes instanceof Uint8Array && input.bytes.length > 0
    && input.bytes.length <= PRIVATE_WALLET_BOOKMARKS_MAX_CIPHERTEXT_BYTES, 'CIPHERTEXT_BUDGET')
  const bytes = new Uint8Array(input.bytes), originalExecution = { ...input.execution }
  const verify = input.verify, confirmQuote = input.confirmQuote
  check(typeof verify === 'function' && typeof confirmQuote === 'function', 'CALLBACK_REQUIRED')
  const execution: WalrusSingleExecution = { ...originalExecution, sign: async transaction => {
    await verify(true)
    check(originalExecution.getAddress() === owner, 'WALLET_CHANGED')
    return originalExecution.sign(transaction)
  } }
  const createClient = factory(execution, config)
  try {
    const hash = await sha256Hex(bytes)
    return await uploadDurableWalrusBlob({
      intent: { network: config.network, owner, recipient: owner, operationScope, attachmentScope: null,
        contentHash: hash, payloadHash: hash, payloadByteLength: bytes.length, storageEpochs: config.storageEpochs, relayUrl: config.relayUrl },
      payload: bytes, execution, attachment: null, createClient,
      approve: async () => {
        await verify(false)
        check(originalExecution.getAddress() === owner, 'WALLET_CHANGED')
        const plan = buildWalrusUploadPlan({ files: [{ name: 'Private encrypted library', size: bytes.length, encryptedSize: bytes.length }],
          network: config.network, storageEpochs: config.storageEpochs, relayUrl: config.relayUrl, chunking: false, walletSignatureCount: 2 })
        const client = await createClient(MAX_TIP)
        // storageCost only multiplies prices; it does not enforce the Move
        // reserve_space maximum. Read the actual accounting horizon first.
        const current = await client.systemState(), maximumEpochs = current.future_accounting.length
        check(Number.isInteger(maximumEpochs) && maximumEpochs > 0 && maximumEpochs <= 0xffff_ffff
          && config.storageEpochs <= maximumEpochs, 'CURRENT_EPOCH_LIMIT_EXCEEDED')
        const quote = await quoteWalrusUpload(plan, { fetchStorageCost: (size, epochs) => client.storageCost(size, epochs),
          calculateRelayTip: async size => BigInt(await client.calculateUploadRelayTip({ size })) })
        check(quote.relayTipMist >= 0n && quote.relayTipMist <= MAX_TIP, 'RELAY_TIP_INVALID')
        for (const value of [quote.walStorageCost, quote.walWriteCost, quote.gasBudgetMist]) {
          assertPrivateWalletBookmarksU64(String(value))
        }
        check(quote.gasBudgetMist > 0n, 'GAS_BUDGET_INVALID')
        const shown = structuredClone(quote)
        shown.items.forEach(Object.freeze); Object.freeze(shown.items); Object.freeze(shown)
        check(await confirmQuote(shown), 'QUOTE_REJECTED')
        check(isWalrusUploadQuoteFresh(quote, plan), 'QUOTE_EXPIRED')
        return { relayTip: String(quote.relayTipMist), storageCost: String(quote.walStorageCost),
          writeCost: String(quote.walWriteCost), gasBudget: String(quote.gasBudgetMist), quoteId: quote.id }
      },
    })
  } finally { bytes.fill(0) }
}

/** Query the same durable register/certify packets; never sign or pay here. */
export async function recoverPrivateBookmarkStorage(input: {
  owner: string
  operationScope: string
  config: PrivateBookmarkUploadConfig
  execution: WalrusSingleExecution
}) {
  const config = validatePrivateBookmarkUploadConfig(input.config), owner = input.owner, operationScope = input.operationScope
  operation(owner, operationScope)
  const execution = { ...input.execution }, key = walrusSingleKey({ network: config.network, owner, operationScope })
  const existing = readWalrusSingleRecord(key)
  if (existing) assertRecovery(existing, owner, operationScope, config)
  const createClient = factory(execution, config)
  const result = await recoverDurableWalrusBlob({ key, operationScope, execution, attachment: null, createClient: async maxTip => {
    const current = readWalrusSingleRecord(key)
    check(current, 'RECOVERY_RECORD_MISSING')
    assertRecovery(current, owner, operationScope, config)
    return createClient(maxTip)
  } })
  if ('record' in result) {
    check(result.record, 'RECOVERY_RECORD_MISSING')
    assertRecovery(result.record, owner, operationScope, config)
  }
  return result
}

/** An imported public WAL remains evidence, not an instruction to install or pay.
 * Query exact packets and ciphertext without touching the local active journal. */
export async function queryPrivateBookmarkStorageRecord(input: {
  record: WalrusSingleRecord
  owner: string
  operationScope: string
  config: PrivateBookmarkUploadConfig
  execution: WalrusSingleExecution
}) {
  const config = validatePrivateBookmarkUploadConfig(input.config), owner = input.owner, operationScope = input.operationScope
  operation(owner, operationScope)
  const record = parseWalrusSingleRecord(input.record), execution = { ...input.execution }
  assertRecovery(record, owner, operationScope, config)
  return queryDurableWalrusBlobRecord({ record, operationScope, execution, attachment: null, createClient: factory(execution, config) })
}
