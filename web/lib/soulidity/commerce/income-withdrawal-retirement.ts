import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { deriveDynamicFieldID, fromBase58, fromHex, toBase58 } from '@mysten/sui/utils'
import { Transaction } from '@mysten/sui/transactions'
import { MAINNET_GENESIS_DIGEST } from '../../animacraft/mainnet-chain'
import { readEpochExpiry } from '../../sui/epoch-expiry'
import { validateEpochCheckpoint, type EpochCheckpoint } from '../../sui/epoch-checkpoint'
import { publicMutationCanonical as canonical } from '../../sui/public-mutation-journal'
import { commerceCheck as check, commerceId, readEconomicsIncome } from './economics-read'
import { IncomeRequestBcs } from './economics-bcs'
import { verifyFoundationIncomeRetirementSourceV1, type IncomeExecutionRegistryV1 } from './income-execution-source-v1'
import { captureIncomeOriginalLedger, captureIncomeReceiptTableMethods } from './income-original-ledger'
import { assertIncomeReceiptAbsent, MAX_INCOME_RETIREMENT_RECEIPTS } from './income-retirement-receipt-table'
import type { importIncomeWithdrawalRecoveryRecord } from './income-withdrawal-recovery-record'

export interface IncomeWithdrawalRetirementEvidence {
  checkpoint: EpochCheckpoint
  config: { version: string; digest: string; ledgerRevision: string }
  sourceManifestSha256: string
  tableId: string
  tableSize: string
  receiptFieldId: string
}

export function validateIncomeWithdrawalRetirementEvidence(value: IncomeWithdrawalRetirementEvidence, expirationEpoch: string) {
  const keys = (row: object | undefined, expected: string[]) =>
    row && Object.keys(row).sort().join() === expected.sort().join()
  const uint = (v: unknown) => typeof v === 'string' && /^(0|[1-9][0-9]{0,19})$/.test(v) && BigInt(v) <= 18446744073709551615n
  check(value && keys(value, ['checkpoint', 'config', 'sourceManifestSha256', 'tableId', 'tableSize', 'receiptFieldId'])
    && keys(value.checkpoint, ['bytes', 'digest', 'epoch', 'sequenceNumber'])
    && keys(value.config, ['version', 'digest', 'ledgerRevision'])
    && commerceId(value.tableId) && commerceId(value.receiptFieldId) && value.tableId !== value.receiptFieldId
    && typeof value.sourceManifestSha256 === 'string' && /^[0-9a-f]{64}$/.test(value.sourceManifestSha256)
    && uint(value.tableSize) && BigInt(value.tableSize) <= MAX_INCOME_RETIREMENT_RECEIPTS
    && uint(value.config.version) && BigInt(value.config.version) > 0n && uint(value.config.ledgerRevision)
    && BigInt(value.tableSize) <= BigInt(value.config.ledgerRevision)
    && typeof value.config.digest === 'string' && value.config.digest.length <= 44, 'WITHDRAW_RETIREMENT_EVIDENCE')
  const bytes = fromBase58(value.config.digest)
  check(bytes.length === 32 && toBase58(bytes) === value.config.digest, 'WITHDRAW_RETIREMENT_CONFIG_DIGEST')
  validateEpochCheckpoint(value.checkpoint, expirationEpoch)
  return value
}

export function captureIncomeWithdrawalRetirementClient(source: SuiGrpcClient): SuiGrpcClient {
  const client = captureIncomeOriginalLedger(source)
  const { batchGetObjects, listDynamicFields } = captureIncomeReceiptTableMethods(source)
  return { core: { getChainIdentifier: source.core?.getChainIdentifier?.bind(source.core) },
    ledgerService: { ...client.ledgerService, batchGetObjects },
    stateService: { listDynamicFields } } as unknown as SuiGrpcClient
}

export async function verifyIncomeWithdrawalRetirement<T extends { status: string }>(input: {
  client: SuiGrpcClient; original: ReturnType<typeof importIncomeWithdrawalRecoveryRecord>; signal: AbortSignal
  executionRegistry: IncomeExecutionRegistryV1; saved?: IncomeWithdrawalRetirementEvidence; queryOriginal: () => Promise<T>
}) {
  const { signal, executionRegistry, queryOriginal } = input, original = structuredClone(input.original)
  const client = captureIncomeWithdrawalRetirementClient(input.client)
  const saved = input.saved && validateIncomeWithdrawalRetirementEvidence(structuredClone(input.saved), original.packet.expirationEpoch)
  const checkpoint = await readEpochExpiry(client, original.packet.expirationEpoch, signal, MAINNET_GENESIS_DIGEST, saved?.checkpoint, 'WITHDRAW_RETIREMENT')
  const target = original.target
  const source = await verifyFoundationIncomeRetirementSourceV1({ registry: executionRegistry, client, target, signal })
  const { requestType, receiptType, initialSharedVersion, sourceManifestSha256 } = source
  const before = await readEconomicsIncome({ client, target, signal })
  const shared = Transaction.from(original.packet.bytes).getData().inputs[0].Object?.SharedObject
  check(shared?.objectId === target.configId && shared.initialSharedVersion === initialSharedVersion
    && before.initialSharedVersion === initialSharedVersion && BigInt(before.ledger.revision) >= BigInt(original.intent.revision),
  'WITHDRAW_RETIREMENT_CONFIG_SCOPE')

  const table = before.config.income.requests
  const key = IncomeRequestBcs.serialize({ actor: original.intent.actor, attempt: fromHex(original.intent.attemptHex) }).toBytes()
  const receiptFieldId = deriveDynamicFieldID(table.id, requestType, key)
  const evidence = validateIncomeWithdrawalRetirementEvidence({ checkpoint, sourceManifestSha256, tableId: table.id,
    tableSize: table.size, receiptFieldId, config: { version: before.object.version, digest: before.object.digest,
      ledgerRevision: before.ledger.revision } }, original.packet.expirationEpoch)
  if (saved) {
    check(saved.sourceManifestSha256 === sourceManifestSha256 && saved.tableId === table.id && saved.receiptFieldId === receiptFieldId
      && BigInt(evidence.tableSize) >= BigInt(saved.tableSize) && BigInt(evidence.config.ledgerRevision) >= BigInt(saved.config.ledgerRevision)
      && BigInt(evidence.config.version) >= BigInt(saved.config.version)
      && (evidence.config.version !== saved.config.version || canonical(evidence.config) === canonical(saved.config)
        && evidence.tableSize === saved.tableSize), 'WITHDRAW_RETIREMENT_STORED_SCOPE')
  }

  await assertIncomeReceiptAbsent({ client, rootId: target.configId, revision: before.ledger.revision,
    table, requestType, receiptType, receiptFieldId, signal, errorPrefix: 'WITHDRAW_RETIREMENT' })
  const observed = await queryOriginal()
  check(observed.status === 'MISSING', 'WITHDRAW_RETIREMENT_ORIGINAL_FOUND')
  const after = await readEconomicsIncome({ client, target, signal })
  check(canonical(after.object) === canonical(before.object)
    && canonical(after.config.income.requests) === canonical(table), 'WITHDRAW_RETIREMENT_CONFIG_CHANGED')
  signal.throwIfAborted()
  return { evidence, observed }
}
