import { bcs } from '@mysten/sui/bcs'
import { SuiGrpcClient } from '@mysten/sui/grpc'
import type { SuiJsonRpcClient } from '@mysten/sui/jsonRpc'
import {
  fromBase64,
  fromBase58,
  normalizeSuiAddress,
  toBase64,
  toHex,
} from '@mysten/sui/utils'

export type SuiGrpcNetwork = 'mainnet' | 'testnet' | 'devnet'

const SUI_GRPC_FULLNODE_URL: Record<SuiGrpcNetwork, string> = {
  mainnet: 'https://fullnode.mainnet.sui.io:443',
  testnet: 'https://fullnode.testnet.sui.io:443',
  devnet: 'https://fullnode.devnet.sui.io:443',
}

type LegacyOptions = {
  showBalanceChanges?: boolean
  showContent?: boolean
  showDisplay?: boolean
  showEffects?: boolean
  showEvents?: boolean
  showInput?: boolean
  showObjectChanges?: boolean
  showOwner?: boolean
  showRawContent?: boolean
  showRawInput?: boolean
  showType?: boolean
}

type CoreOwner =
  | { $kind: 'AddressOwner'; AddressOwner: string }
  | { $kind: 'ObjectOwner'; ObjectOwner: string }
  | { $kind: 'Shared'; Shared: { initialSharedVersion: string } }
  | { $kind: 'Immutable'; Immutable: true }
  | { $kind: string; [key: string]: unknown }

type CoreObject = {
  objectId: string
  version: string
  digest: string
  owner: CoreOwner
  type: string
  json?: Record<string, unknown> | null
  display?: {
    output: Record<string, unknown> | null
    errors: Record<string, string> | null
  } | null
  previousTransaction?: string | null
}

type CoreExecutionStatus = {
  success: boolean
  error: unknown
}

type CoreChangedObject = {
  objectId: string
  inputState: string
  outputState: string
  outputVersion: string | null
  outputDigest: string | null
  outputOwner: CoreOwner | null
  idOperation: string
}

type CoreTransaction = {
  digest: string
  status: CoreExecutionStatus
  effects?: {
    transactionDigest: string
    status: CoreExecutionStatus
    gasUsed: Record<string, string>
    changedObjects: CoreChangedObject[]
  }
  events?: Array<{
    packageId: string
    module: string
    sender: string
    eventType: string
    bcs: Uint8Array
    json: Record<string, unknown> | null
  }>
  objectTypes?: Record<string, string>
  transaction?: Record<string, unknown>
  balanceChanges?: unknown[]
}

type CoreTransactionResult = {
  $kind: 'Transaction' | 'FailedTransaction'
  Transaction?: CoreTransaction
  FailedTransaction?: CoreTransaction
  commandResults?: Array<{
    returnValues: Array<{ bcs: Uint8Array }>
    mutatedReferences: Array<{ bcs: Uint8Array }>
  }>
}

function includeFor(options?: LegacyOptions) {
  return {
    balanceChanges: Boolean(options?.showBalanceChanges),
    effects: Boolean(options?.showEffects || options?.showObjectChanges),
    events: Boolean(options?.showEvents),
    objectTypes: Boolean(options?.showObjectChanges),
    transaction: Boolean(options?.showInput),
    bcs: Boolean(options?.showRawInput),
  }
}

function errorText(value: unknown): string {
  if (value instanceof Error) return value.message
  if (value && typeof value === 'object' && 'message' in value) {
    return String((value as { message?: unknown }).message)
  }
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function isGrpcNotFoundError(value: unknown): boolean {
  if (value && typeof value === 'object' && 'code' in value) {
    const rawCode = (value as { code?: unknown }).code
    const code = String(rawCode).toUpperCase()
    if (code === 'NOT_FOUND' || code === '5') return true
  }
  return false
}

function isObjectNotFoundError(value: unknown): boolean {
  return isGrpcNotFoundError(value)
    || /^Object 0x[0-9a-f]+ not found$/i.test(errorText(value).trim())
}

function isDynamicFieldNotFoundError(value: unknown): boolean {
  return isGrpcNotFoundError(value)
    || /^Dynamic field .+ not found$/i.test(errorText(value).trim())
}

function transactionBytes(value: string | Uint8Array): Uint8Array {
  return typeof value === 'string' ? fromBase64(value) : value
}

/**
 * Core API Move types use fully padded account addresses, while the legacy
 * JSON-RPC surface used the shortest hexadecimal spelling (notably `0x2`).
 * Keep this compatibility adapter faithful at its boundary so downstream
 * callers do not have to know which transport produced an object type.
 */
function legacyMoveType(type: string | undefined): string | undefined {
  return type?.replace(/0x[0-9a-fA-F]+(?=::)/g, (address) => {
    const compact = address.slice(2).replace(/^0+/, '')
    return `0x${compact || '0'}`
  })
}

function legacyObjectData(object: CoreObject, options?: LegacyOptions) {
  return {
    objectId: object.objectId,
    version: object.version,
    digest: object.digest,
    type: legacyMoveType(object.type),
    owner: object.owner,
    previousTransaction: object.previousTransaction ?? null,
    content: options?.showContent
      ? {
          dataType: 'moveObject',
          type: legacyMoveType(object.type),
          hasPublicTransfer: true,
          fields: object.json ?? {},
        }
      : undefined,
    display: options?.showDisplay
      ? {
          data: object.display?.output ?? null,
          error: object.display?.errors ?? null,
        }
      : undefined,
  }
}

function legacyObjectChange(
  change: CoreChangedObject,
  objectTypes: Record<string, string>,
) {
  // Objects created and consumed within the same transaction have no durable
  // output state and were omitted by the JSON-RPC objectChanges projection.
  if (change.inputState === 'DoesNotExist' && change.outputState === 'DoesNotExist') {
    return null
  }
  if (change.outputState === 'PackageWrite') {
    return {
      type: 'published',
      packageId: change.objectId,
      version: change.outputVersion,
      digest: change.outputDigest,
    }
  }
  const common = {
    objectId: change.objectId,
    objectType: legacyMoveType(objectTypes[change.objectId]),
    version: change.outputVersion,
    digest: change.outputDigest,
    owner: change.outputOwner,
  }
  if (change.outputState === 'DoesNotExist' || change.idOperation === 'Deleted') {
    return { type: 'deleted', ...common }
  }
  if (change.idOperation === 'Created') return { type: 'created', ...common }
  return { type: 'mutated', ...common }
}

function legacyTransactionResult(result: CoreTransactionResult) {
  const transaction = result.Transaction ?? result.FailedTransaction
  if (!transaction) throw new Error('Sui Core API returned no transaction payload')
  const status = transaction.effects?.status ?? transaction.status
  const objectTypes = transaction.objectTypes ?? {}
  const effects = transaction.effects
  return {
    digest: transaction.digest,
    effects: {
      transactionDigest: effects?.transactionDigest ?? transaction.digest,
      status: {
        status: status.success ? 'success' : 'failure',
        error: status.success ? null : errorText(status.error),
      },
      gasUsed: effects?.gasUsed,
    },
    objectChanges: effects?.changedObjects
      .map((change) => legacyObjectChange(change, objectTypes))
      .filter((change) => change !== null),
    events: transaction.events?.map((event, eventSeq) => ({
      id: { txDigest: transaction.digest, eventSeq: String(eventSeq) },
      packageId: event.packageId,
      transactionModule: event.module,
      sender: event.sender,
      type: event.eventType,
      parsedJson: event.json ?? undefined,
      bcs: toBase64(event.bcs),
    })),
    transaction: transaction.transaction
      ? { data: transaction.transaction }
      : undefined,
    balanceChanges: transaction.balanceChanges,
    results: result.commandResults?.map((command) => ({
      returnValues: command.returnValues.map((value) => [
        Array.from(value.bcs),
        'unknown',
      ]),
      mutableReferenceOutputs: command.mutatedReferences.map((value) => [
        Array.from(value.bcs),
        'unknown',
      ]),
    })),
    error: status.success ? undefined : errorText(status.error),
  }
}

function dynamicFieldNameBcs(name: { type: string; value?: unknown; bcs?: Uint8Array }) {
  if (name.bcs instanceof Uint8Array) return name.bcs
  const normalizedType = name.type.replace(/^0x0+/, '0x')
  if (normalizedType === 'address') {
    return bcs.Address.serialize(normalizeSuiAddress(String(name.value))).toBytes()
  }
  if (normalizedType === 'u8') {
    return bcs.u8().serialize(Number(name.value)).toBytes()
  }
  if (normalizedType === 'u64') {
    return bcs.u64().serialize(BigInt(String(name.value))).toBytes()
  }
  if (/::string::String$/.test(normalizedType)) {
    return bcs.string().serialize(String(name.value)).toBytes()
  }
  if (/::market::PersonalKioskOwnerKey$/.test(normalizedType)) {
    const value = name.value as { owner?: unknown } | null
    return bcs
      .struct('PersonalKioskOwnerKey', { owner: bcs.Address })
      .serialize({ owner: normalizeSuiAddress(String(value?.owner)) })
      .toBytes()
  }
  throw new Error(
    `Unsupported dynamic-field name type ${name.type}; add an explicit BCS codec before using it`,
  )
}

/**
 * The legacy dApp Kit still expects the JSON-RPC method surface. This adapter
 * keeps that public shape while every network request uses Sui's supported
 * gRPC Core API. It can be deleted once the React app moves to dapp-kit v2.
 */
export class SuiGrpcJsonRpcCompatClient {
  readonly grpc: SuiGrpcClient
  readonly core: SuiGrpcClient['core']
  readonly network: SuiGrpcNetwork
  readonly cache: SuiGrpcClient['cache']
  readonly base: SuiGrpcClient['base']

  constructor(network: SuiGrpcNetwork, grpcClient?: SuiGrpcClient) {
    this.network = network
    this.grpc = grpcClient ?? new SuiGrpcClient({
      network,
      baseUrl: SUI_GRPC_FULLNODE_URL[network],
    })
    this.core = this.grpc.core
    this.cache = this.grpc.cache
    this.base = this.grpc.base
  }

  $extend(...registrations: Parameters<SuiGrpcClient['$extend']>) {
    return this.grpc.$extend(...registrations)
  }

  get mvr() {
    return this.grpc.mvr
  }

  async getChainIdentifier() {
    const { chainIdentifier } = await this.core.getChainIdentifier()
    // SuiJsonRpcClient historically returned the first four genesis-digest
    // bytes as lowercase hex, while the Core API returns the full base58
    // digest. Preserve the public method contract for existing callers.
    return toHex(fromBase58(chainIdentifier).slice(0, 4))
  }

  async getBalance(input: { owner: string; coinType?: string }) {
    const { balance } = await this.core.getBalance(input)
    return {
      coinType: balance.coinType,
      coinObjectCount: 0,
      totalBalance: balance.balance,
      lockedBalance: {},
    }
  }

  async getCoins(input: {
    owner: string
    coinType?: string
    cursor?: string | null
    limit?: number | null
  }) {
    const page = await this.core.listCoins({
      owner: input.owner,
      coinType: input.coinType,
      cursor: input.cursor,
      limit: input.limit ?? undefined,
    })
    return {
      data: page.objects.map((coin) => ({
        coinType: coin.type.replace(/^.*::coin::Coin<(.+)>$/, '$1'),
        coinObjectId: coin.objectId,
        version: coin.version,
        digest: coin.digest,
        balance: coin.balance,
        previousTransaction: null,
      })),
      nextCursor: page.cursor,
      hasNextPage: page.hasNextPage,
    }
  }

  async getObject(input: { id: string; options?: LegacyOptions }) {
    try {
      const { object } = await this.core.getObject({
        objectId: input.id,
        include: {
          json: Boolean(input.options?.showContent),
          display: Boolean(input.options?.showDisplay),
          previousTransaction: true,
        },
      })
      return { data: legacyObjectData(object as CoreObject, input.options), error: null }
    } catch (error) {
      if (!isObjectNotFoundError(error)) throw error
      return { data: null, error: { code: 'notFound', message: errorText(error) } }
    }
  }

  async multiGetObjects(input: { ids: string[]; options?: LegacyOptions }) {
    const { objects } = await this.core.getObjects({
      objectIds: input.ids,
      include: {
        json: Boolean(input.options?.showContent),
        display: Boolean(input.options?.showDisplay),
        previousTransaction: true,
      },
    })
    return objects.map((entry) =>
      entry instanceof Error
        ? { data: null, error: { code: 'notFound', message: entry.message } }
        : { data: legacyObjectData(entry as CoreObject, input.options), error: null })
  }

  async getOwnedObjects(input: {
    owner: string
    filter?: { StructType?: string }
    options?: LegacyOptions
    cursor?: string | null
    limit?: number | null
  }) {
    const page = await this.core.listOwnedObjects({
      owner: input.owner,
      type: input.filter?.StructType,
      cursor: input.cursor,
      limit: input.limit ?? undefined,
      include: {
        json: Boolean(input.options?.showContent),
        display: Boolean(input.options?.showDisplay),
        previousTransaction: true,
      },
    })
    return {
      data: page.objects.map((object) => ({
        data: legacyObjectData(object as CoreObject, input.options),
        error: null,
      })),
      nextCursor: page.cursor,
      hasNextPage: page.hasNextPage,
    }
  }

  async getDynamicFields(input: {
    parentId: string
    cursor?: string | null
    limit?: number | null
  }) {
    const page = await this.core.listDynamicFields({
      parentId: input.parentId,
      cursor: input.cursor,
      limit: input.limit ?? undefined,
    })
    return {
      data: page.dynamicFields.map((field) => ({
        name: { type: field.name.type, bcs: field.name.bcs },
        bcsName: toBase64(field.name.bcs),
        type: field.$kind,
        objectType: field.valueType,
        objectId: field.fieldId,
      })),
      nextCursor: page.cursor,
      hasNextPage: page.hasNextPage,
    }
  }

  async getDynamicFieldObject(input: {
    parentId: string
    name: { type: string; value?: unknown; bcs?: Uint8Array }
  }) {
    try {
      const { dynamicField } = await this.core.getDynamicField({
        parentId: input.parentId,
        name: {
          type: input.name.type,
          bcs: dynamicFieldNameBcs(input.name),
        },
      })
      return this.getObject({
        id: dynamicField.fieldId,
        options: { showContent: true, showOwner: true, showType: true },
      })
    } catch (error) {
      if (!isDynamicFieldNotFoundError(error)) throw error
      return { data: null, error: { code: 'dynamicFieldNotFound', message: errorText(error) } }
    }
  }

  async getTransactionBlock(input: { digest: string; options?: LegacyOptions }) {
    const result = await this.core.getTransaction({
      digest: input.digest,
      include: includeFor(input.options),
    })
    return legacyTransactionResult(result as unknown as CoreTransactionResult)
  }

  async waitForTransaction(input: {
    digest: string
    options?: LegacyOptions
    timeout?: number
    pollInterval?: number
  }) {
    const result = await this.core.waitForTransaction({
      digest: input.digest,
      include: includeFor(input.options),
      timeout: input.timeout,
      pollSchedule: input.pollInterval ? [0, input.pollInterval] : undefined,
    })
    return legacyTransactionResult(result as unknown as CoreTransactionResult)
  }

  async dryRunTransactionBlock(input: {
    transactionBlock: string | Uint8Array
  }) {
    const result = await this.core.simulateTransaction({
      transaction: transactionBytes(input.transactionBlock),
      include: {
        effects: true,
        events: true,
        objectTypes: true,
        balanceChanges: true,
        commandResults: true,
      },
    })
    return legacyTransactionResult(result as unknown as CoreTransactionResult)
  }

  async devInspectTransactionBlock(input: {
    sender: string
    transactionBlock: string | Uint8Array | Parameters<SuiGrpcClient['simulateTransaction']>[0]['transaction']
  }) {
    if (
      typeof input.transactionBlock === 'object'
      && !(input.transactionBlock instanceof Uint8Array)
      && 'setSenderIfNotSet' in input.transactionBlock
      && typeof input.transactionBlock.setSenderIfNotSet === 'function'
    ) {
      input.transactionBlock.setSenderIfNotSet(input.sender)
    }
    const transaction = typeof input.transactionBlock === 'string'
      ? fromBase64(input.transactionBlock)
      : input.transactionBlock
    const result = await this.core.simulateTransaction({
      transaction,
      checksEnabled: false,
      include: {
        effects: true,
        events: true,
        objectTypes: true,
        commandResults: true,
      },
    })
    return legacyTransactionResult(result as unknown as CoreTransactionResult)
  }

  async executeTransactionBlock(input: {
    transactionBlock: string | Uint8Array
    signature: string | string[]
    options?: LegacyOptions
  }) {
    const result = await this.core.executeTransaction({
      transaction: transactionBytes(input.transactionBlock),
      signatures: Array.isArray(input.signature) ? input.signature : [input.signature],
      include: includeFor(input.options),
    })
    return legacyTransactionResult(result as unknown as CoreTransactionResult)
  }

  async signAndExecuteTransaction(input: {
    transaction: Parameters<SuiGrpcClient['signAndExecuteTransaction']>[0]['transaction']
    signer: Parameters<SuiGrpcClient['signAndExecuteTransaction']>[0]['signer']
    options?: LegacyOptions
  }) {
    const result = await this.grpc.signAndExecuteTransaction({
      transaction: input.transaction,
      signer: input.signer,
      include: includeFor(input.options),
    })
    return legacyTransactionResult(result as unknown as CoreTransactionResult)
  }

  async getNormalizedMoveFunction(input: {
    package: string
    module: string
    function: string
  }) {
    const { function: moveFunction } = await this.core.getMoveFunction({
      packageId: input.package,
      moduleName: input.module,
      name: input.function,
    })
    return moveFunction
  }

  async getNormalizedMoveStruct(input: {
    package: string
    module: string
    struct: string
  }): Promise<unknown> {
    const { response } = await this.grpc.movePackageService.getDatatype({
      packageId: input.package,
      moduleName: input.module,
      name: input.struct,
    })
    return response.datatype
  }
}

export function createSuiGrpcCompatClient(
  network: SuiGrpcNetwork,
): SuiJsonRpcClient {
  return new SuiGrpcJsonRpcCompatClient(network) as unknown as SuiJsonRpcClient
}

export function getSuiGrpcFullnodeUrl(network: SuiGrpcNetwork): string {
  return SUI_GRPC_FULLNODE_URL[network]
}
