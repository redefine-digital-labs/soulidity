import { queryMakerProductIncomeRecoveryRecord, type MakerProductIncomeRecoveryRecord } from './maker-product-income-recovery-record'
import type { HistoricalExecutionModelInstallationV1 } from '../../sui/historical-execution-frame-v1'
import { createIncomeExecutionRegistryV1, EMPTY_INCOME_EXECUTION_REGISTRY_V1, assertIncomeExecutionRegistrySupportsTargetV1, canVerifyMakerIncomeRetirementSourceV1 } from './income-execution-source-v1'
import { captureMakerProductIncomeClient } from './maker-product-income-client'
import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { fromHex } from '@mysten/sui/utils'
import { Transaction } from '@mysten/sui/transactions'
import { publicMutationCanonical } from '../../sui/public-mutation-journal'
import { commerceCheck, commerceId } from './economics-read'
import { readMakerProductIncome, parseMakerProductIncomeTarget, type MakerProductIncomeTarget } from './maker-product-income-read'
import { readMakerProductIncomeAddressGas } from './maker-product-income-gas'
import { readCommerceOwnedCoinInventory } from './owned-coin-inventory'
import { verifyMakerProductIncomeInterface } from './maker-product-income-interface'
import { parseRootMakerProductIncomeInstallation, verifyInstalledMakerProductIncomeSource, makerProductIncomeManifestHash, type RootMakerProductIncomeInstallation } from './maker-product-income-source'
import { browserMakerProductIncomeOriginalReader, makerProductIncomeFundKey, makerProductIncomeHeadCanClear, queryMakerProductIncomeOriginal } from '../maker-product-income-journal'
import { createMakerProductIncomeHost } from '../maker-product-income-host'
import { MakerProductIncomeRecoveryError, type MakerProductIncomeHost, type MakerProductIncomeHostRequest } from '../maker-product-income-host'
import { recheckMakerProductIncomeOriginal, cancelMakerProductIncomeOriginal, retireMakerProductIncomeOriginal } from '../maker-product-income-original-recovery'
import type { MakerProductIncomeOperation } from '../maker-product-income-journal'
import { executeMakerProductIncomeOriginal, type MakerProductIncomeExecutionInput } from '../maker-product-income-execution'

export interface MakerProductIncomeSelection { target: MakerProductIncomeTarget; actor: string | null; controlId: string; installedSourceId: string | null }
export interface MakerProductIncomeObservation {
  selection: MakerProductIncomeSelection; catalogVersion: string
  income: Awaited<ReturnType<typeof readMakerProductIncome>>
  previous: { digest: string; originalText: string; status: string } | null
  preparation: null | { source: Awaited<ReturnType<typeof verifyInstalledMakerProductIncomeSource>>; interfaceProof: Awaited<ReturnType<typeof verifyMakerProductIncomeInterface>>
    epoch: string; referenceGasPrice: string; addressGasBalance: string | null; inventory: Awaited<ReturnType<typeof readCommerceOwnedCoinInventory>> }
  disabledReason: string | null; notSigningAuthority: true
}
export interface MakerProductIncomeDraft { amount: string; recipient: string; gasBudget: string; gasPrice: string; gasCoinIds: string[]; useAddressGas?: boolean; expirationEpoch: string; attemptHex: string }
type RequestData = Omit<MakerProductIncomeHostRequest, 'client' | 'signal' | 'getActorAddress'>
export interface MakerProductIncomeReview { observation: MakerProductIncomeObservation; request: RequestData }
const data = ({ client, signal, getActorAddress, ...value }: MakerProductIncomeHostRequest) => value
/** Root constructs this controller from its compiled installation catalog.
 * Public form fields select/observe; they cannot install an anchor. There is
 * no URL/env/storage/global activation path, signer or second journal backend.
 */
export function createRootMakerProductIncomeController(options: {
  installations: readonly RootMakerProductIncomeInstallation[]; client: (signal: AbortSignal) => SuiGrpcClient; isCurrent?: () => boolean; executionEnabled?: true; retirementEnabled?: true; retirementSourceManifestSha256s?: readonly string[]; executionModels?: readonly HistoricalExecutionModelInstallationV1[]
}) {
  const installations = structuredClone(options.installations), clientFactory = options.client, isCurrent = options.isCurrent ?? (() => true)
  const executionModels = structuredClone(options.executionModels ?? []), executionEnabled = options.executionEnabled === true, retirementEnabled = options.retirementEnabled === true
  commerceCheck(Array.isArray(executionModels) && executionModels.length <= 32, 'INCOME_EXECUTION_MODEL_CATALOG_BOUND')
  const retirementSourceManifestSha256s = structuredClone(options.retirementSourceManifestSha256s ?? [])
  const executionRegistry = () => executionModels.length ? createIncomeExecutionRegistryV1({ models: executionModels, makerSources: installations,
    retirementSourceManifestSha256s }) : EMPTY_INCOME_EXECUTION_REGISTRY_V1
  const originalRegistry = () => { try { return executionRegistry() } catch { return EMPTY_INCOME_EXECUTION_REGISTRY_V1 } }
  const current = () => { try { return isCurrent() === true } catch { return false } }
  commerceCheck(Array.isArray(installations) && installations.length <= 64, 'MAKER_INCOME_ROOT_CATALOG_BOUND')
  const catalogVersion = makerProductIncomeManifestHash(publicMutationCanonical({ installations, executionModels }))
  // Display copies are never authority to redefine a review. Only an exact
  // issued object with this private independent baseline can be consumed.
  const reviews = new WeakMap<MakerProductIncomeReview, { snapshot: MakerProductIncomeReview; canonical: string }>()
  function catalog() {
    const entries = installations.map(parseRootMakerProductIncomeInstallation)
    commerceCheck(new Set(entries.map(row => row.manifestSha256)).size === entries.length, 'MAKER_INCOME_ROOT_CATALOG_DUPLICATE')
    return entries
  }
  function installedFor(selection: MakerProductIncomeSelection) {
    commerceCheck(selection.installedSourceId, 'MAKER_INCOME_SOURCE_NOT_INSTALLED')
    const installed = catalog().find(row => row.manifestSha256 === selection.installedSourceId)
    commerceCheck(installed && publicMutationCanonical(installed.manifest.deployment) === publicMutationCanonical((({ productId, ...deployment }) => deployment)(selection.target)), 'MAKER_INCOME_SOURCE_NOT_INSTALLED')
    return installed
  }
  async function observeWithClient(input: MakerProductIncomeSelection, source: SuiGrpcClient, parent: AbortSignal, getActorAddress: () => string | null): Promise<MakerProductIncomeObservation> {
    const selection = structuredClone(input)
    const client = captureMakerProductIncomeClient(source), signal = AbortSignal.any([parent, AbortSignal.timeout(90000)])
    const guard = () => { signal.throwIfAborted(); commerceCheck(current() && getActorAddress() === selection.actor, 'MAKER_INCOME_OBSERVATION_LEASE_CHANGED') }
    const reader = browserMakerProductIncomeOriginalReader(), key = makerProductIncomeFundKey(selection.target)
    signal.throwIfAborted()
    // Read-only original exclusion precedes even new source/catalog parsing.
    // It is not a reservation; prepare repeats exclusion under the same Root exclusion.
    const originalHead = (await reader.heads(name => name === key))[0] ?? null
    let previous: MakerProductIncomeObservation['previous'] = null
    if (originalHead) {
      try {
        const original = await queryMakerProductIncomeOriginal({ record: originalHead, client, signal, executionRegistry: originalRegistry() }); signal.throwIfAborted()
        commerceCheck(makerProductIncomeHeadCanClear(originalHead, original), 'MAKER_INCOME_ORIGINAL_RECOVERY_REQUIRED')
        previous = { digest: originalHead.packet.digest, originalText: originalHead.plan.originalText, status: original.status }
      } catch (error) { throw new MakerProductIncomeRecoveryError(error instanceof Error ? error.message : 'MAKER_INCOME_ORIGINAL_QUERY_FAILED', {
        text: originalHead.plan.originalText, digest: originalHead.packet.digest, headPhase: originalHead.packet.phase, durability: 'CONFIRMED' }, { cause: error }) }
    }
    selection.target = parseMakerProductIncomeTarget(selection.target)
    commerceCheck(selection.actor === null || commerceId(selection.actor), 'MAKER_INCOME_OBSERVATION_ACTOR')
    commerceCheck(selection.controlId === '' || commerceId(selection.controlId), 'MAKER_INCOME_OBSERVATION_CONTROL')
    guard()
    const request = { client, target: selection.target, signal,
      ...(selection.actor && selection.controlId ? { control: { actor: selection.actor, objectId: selection.controlId } } : {}) }
    const income = await readMakerProductIncome(request); guard()
    let preparation: MakerProductIncomeObservation['preparation'] = null, disabledReason: string | null = null
    if (!selection.installedSourceId) disabledReason = '此公开目标没有选择 Root 已安装的来源资格，仅可观察收益。'
    else if (!executionModels.length) disabledReason = '执行模型尚未安装，提款准备关闭；原交易查询与下载仍可使用。'
    else if (!selection.actor || !selection.controlId || !income.authority) disabledReason = '请连接Control 持有人钱包并明确选择与 Product 匹配的 Control 对象。'
    else {
      const installed = installedFor(selection)
      assertIncomeExecutionRegistrySupportsTargetV1(executionRegistry(), selection.target)
      const proof = await verifyInstalledMakerProductIncomeSource({ installed, client, income, signal }); guard()
      const interfaceProof = await verifyMakerProductIncomeInterface({ client, manufacturing: selection.target.manufacturing, signal }); guard()
      const epochRead = async () => {
        const row = (await client.ledgerService.getEpoch({ readMask: { paths: ['epoch', 'reference_gas_price'] } }, { abort: signal })).response.epoch
        guard(); commerceCheck(typeof row?.epoch === 'bigint' && row.epoch >= 0n && row.epoch <= 18446744073709551615n && typeof row.referenceGasPrice === 'bigint' && row.referenceGasPrice > 0n && row.referenceGasPrice <= 18446744073709551615n, 'MAKER_INCOME_OBSERVATION_EPOCH')
        return { epoch: String(row.epoch), referenceGasPrice: String(row.referenceGasPrice) }
      }
      const epoch = await epochRead(), inventory = await readCommerceOwnedCoinInventory({ client, owner: selection.actor, coinType: '0x2::sui::SUI', getViewerAddress: getActorAddress, signal }); guard()
      // Coin Gas remains usable if this independent balance projection is unavailable.
      const addressGasBalance = await readMakerProductIncomeAddressGas(client, selection.actor, getActorAddress, signal).catch(() => null)
      guard()
      const finalEpoch = await epochRead(), finalIncome = await readMakerProductIncome(request); guard()
      commerceCheck(publicMutationCanonical(finalEpoch) === publicMutationCanonical(epoch) && publicMutationCanonical(finalIncome) === publicMutationCanonical(income), 'MAKER_INCOME_OBSERVATION_CHANGED')
      preparation = { source: proof, interfaceProof, ...epoch, inventory, addressGasBalance }
    }
    const finalHead = await reader.read(key); guard()
    commerceCheck(publicMutationCanonical(finalHead) === publicMutationCanonical(originalHead), 'MAKER_INCOME_OBSERVATION_HEAD_CHANGED')
    return { selection, catalogVersion, income, previous, preparation, disabledReason, notSigningAuthority: true }
  }
  function makeReview(observation: MakerProductIncomeObservation, draft: MakerProductIncomeDraft): MakerProductIncomeReview {
    const saved = structuredClone(observation), values = structuredClone(draft), prepared = saved.preparation
    commerceCheck(current() && saved.catalogVersion === catalogVersion && prepared && !saved.disabledReason && saved.selection.actor && saved.selection.controlId, 'MAKER_INCOME_REVIEW_NOT_QUALIFIED')
    installedFor(saved.selection)
    const uint = (value: string) => typeof value === 'string' && /^[1-9][0-9]{0,19}$/.test(value) && BigInt(value) <= 18446744073709551615n
    commerceCheck(uint(values.amount) && BigInt(values.amount) <= BigInt(saved.income.ledger.balance) && commerceId(values.recipient)
      && uint(values.gasBudget) && uint(values.gasPrice) && BigInt(values.gasPrice) >= BigInt(prepared.referenceGasPrice), 'MAKER_INCOME_REVIEW_AMOUNT_OR_FEE')
    const useAddressGas = values.useAddressGas === true, nextEpoch = BigInt(prepared.epoch) + 1n
    commerceCheck(/^(0|[1-9][0-9]{0,15})$/.test(values.expirationEpoch) && Number.isSafeInteger(Number(values.expirationEpoch))
      && BigInt(values.expirationEpoch) <= nextEpoch && (useAddressGas ? BigInt(values.expirationEpoch) === nextEpoch : BigInt(values.expirationEpoch) >= BigInt(prepared.epoch)), 'MAKER_INCOME_REVIEW_EXPIRY')
    commerceCheck(typeof values.attemptHex === 'string' && /^[0-9a-f]{64}$/.test(values.attemptHex) && /[1-9a-f]/.test(values.attemptHex), 'MAKER_INCOME_REVIEW_ATTEMPT')
    commerceCheck((useAddressGas ? values.gasCoinIds.length === 0 : values.gasCoinIds.length > 0) && values.gasCoinIds.length <= 256 && new Set(values.gasCoinIds).size === values.gasCoinIds.length, 'MAKER_INCOME_REVIEW_GAS_SELECTION')
    const coins = values.gasCoinIds.map(id => { const coin = prepared.inventory.coins.find(row => row.objectId === id); commerceCheck(coin, 'MAKER_INCOME_REVIEW_GAS_NOT_OBSERVED'); return coin })
    const balance = useAddressGas ? BigInt(prepared.addressGasBalance ?? '0') : coins.reduce((sum, row) => sum + BigInt(row.balance), 0n)
    commerceCheck(balance >= BigInt(values.gasBudget), 'MAKER_INCOME_REVIEW_GAS_BALANCE')
    const review: MakerProductIncomeReview = { observation: saved, request: { kind: 'NEW_MAKER_PRODUCT_INCOME_WITHDRAWAL', target: saved.selection.target, actor: saved.selection.actor,
      controlId: saved.selection.controlId, recipient: values.recipient, amount: values.amount, attempt: fromHex(values.attemptHex), reviewed: saved.income,
      gas: { budget: values.gasBudget, price: values.gasPrice, coins: coins.map(({ objectId, version, digest }) => ({ objectId, version, digest })) }, expirationEpoch: values.expirationEpoch } }
    const snapshot = structuredClone(review)
    reviews.set(review, { snapshot, canonical: publicMutationCanonical(snapshot) })
    return review
  }
  function createPreflight(review: MakerProductIncomeReview): MakerProductIncomeHost {
    const issued = reviews.get(review)
    const host = createMakerProductIncomeHost({ executionRegistry: originalRegistry(), beforePrepare: async request => {
      // Deliberately deferred until the shared Host has queried/excluded old
      // originals. Even a wrong/obsolete new review cannot bypass that query.
      commerceCheck(issued && publicMutationCanonical(review) === issued.canonical, 'MAKER_INCOME_REVIEW_NOT_ISSUED_OR_CHANGED')
      const saved = issued.snapshot
      commerceCheck(current() && publicMutationCanonical(data(request)) === publicMutationCanonical(saved.request), 'MAKER_INCOME_REVIEW_REQUEST_CHANGED')
      const fresh = await observeWithClient(saved.observation.selection, request.client, request.signal, request.getActorAddress)
      function withoutAddressGasBalance(value: MakerProductIncomeObservation) {
        return { ...value, preparation: value.preparation && { ...value.preparation, addressGasBalance: null } }
      }
      commerceCheck(fresh.preparation && publicMutationCanonical(withoutAddressGasBalance(fresh)) === publicMutationCanonical(withoutAddressGasBalance(saved.observation)), 'MAKER_INCOME_REVIEW_REFRESH_REQUIRED')
      if (request.gas.coins.length === 0) {
        commerceCheck(BigInt(fresh.preparation.addressGasBalance ?? '0') >= BigInt(request.gas.budget), 'MAKER_INCOME_ADDRESS_GAS_BALANCE')
      }
    } })
    return input => {
      const address = input.getActorAddress
      return host({ ...input, getActorAddress: () => current() ? address() : null })
    }
  }
  function canResumeTarget(target: MakerProductIncomeTarget) {
    try { const { productId, ...deployment } = target; return current() && executionModels.length > 0 && catalog().filter(row => publicMutationCanonical(row.manifest.deployment) === publicMutationCanonical(deployment)).length === 1 } catch { return false }
  }
  const canExecuteTarget = (target: MakerProductIncomeTarget) => executionEnabled && canResumeTarget(target)
  const canRetireTarget = (target: MakerProductIncomeTarget) => retirementEnabled && current() && canVerifyMakerIncomeRetirementSourceV1(originalRegistry(), target)
  async function readCurrentReview(original: MakerProductIncomeRecoveryRecord, client: SuiGrpcClient, abort: AbortSignal) {
    const { productId, ...deployment } = original.target
    const matching = catalog().filter(row => publicMutationCanonical(row.manifest.deployment) === publicMutationCanonical(deployment))
    commerceCheck(matching.length === 1, 'MAKER_INCOME_RESUME_SOURCE_NOT_INSTALLED')
    const reviewed = await readMakerProductIncome({ client, target: original.target, control: { actor: original.intent.actor, objectId: original.intent.controlId }, signal: abort })
    await verifyInstalledMakerProductIncomeSource({ installed: matching[0], income: reviewed, client, signal: abort })
    commerceCheck(current(), 'MAKER_INCOME_RESUME_SOURCE_CHANGED')
    const gas = Transaction.from(original.packet.bytes).getData().gasData
    commerceCheck(gas.owner === original.intent.actor && typeof gas.budget === 'string' && typeof gas.price === 'string' && gas.payment && gas.payment.every(ref => typeof ref.version === 'string'), 'MAKER_INCOME_RESUME_ORIGINAL_GAS')
    return { reviewed, reviewedGas: { budget: String(gas.budget), price: String(gas.price), coins: gas.payment.map(ref => ({ objectId: ref.objectId, version: String(ref.version), digest: ref.digest })) } }
  }
  return Object.freeze({ queryOriginal: (text: string, signal: AbortSignal) => queryMakerProductIncomeRecoveryRecord({ text, client: clientFactory(signal), signal, executionRegistry: originalRegistry() }), catalogVersion, isCurrent: current, client: clientFactory, makeReview, createPreflight,
    installedSources: () => { try { return { entries: structuredClone(catalog()), error: null } } catch { return { entries: [], error: 'Root 安装目录无效；提款准备关闭，公开观察仍可使用。' } } },
    observe: (selection: MakerProductIncomeSelection, signal: AbortSignal, getActorAddress: () => string | null) => observeWithClient(selection, clientFactory(signal), signal, getActorAddress),
    canResumeTarget, canExecuteTarget, canRetireTarget,
    retireOriginal: (input: { selected: MakerProductIncomeOperation; signal: AbortSignal; isCurrent: () => boolean }) => {
      const activation = input.isCurrent
      return retireMakerProductIncomeOriginal({ selected: input.selected, signal: input.signal, client: clientFactory(input.signal),
        executionRegistry: originalRegistry(), isCurrent: target => activation() && canRetireTarget(target) })
    },
    executeOriginal: (input: MakerProductIncomeExecutionInput) => executeMakerProductIncomeOriginal({
      ...input, isCurrent: () => executionEnabled && current() && input.isCurrent(),
      client: clientFactory(input.signal), executionRegistry: originalRegistry(), readCurrentReview,
    }),
    cancelUnsigned: (selected: MakerProductIncomeOperation, signal: AbortSignal) => cancelMakerProductIncomeOriginal({ selected, signal, client: clientFactory(signal), executionRegistry: originalRegistry() }),
    resume: (input: { selected: MakerProductIncomeOperation; signal: AbortSignal; getActorAddress: () => string | null; isCurrent: () => boolean }) => {
      const selected = structuredClone(input.selected), signal = input.signal, getActorAddress = input.getActorAddress, isCurrent = input.isCurrent
      return recheckMakerProductIncomeOriginal({ selected, signal, getActorAddress, executionRegistry: originalRegistry(), isCurrent: () => current() && isCurrent(), client: clientFactory(signal),
        readCurrentReview })
    },
  })
}
export type RootMakerProductIncomeController = ReturnType<typeof createRootMakerProductIncomeController>
