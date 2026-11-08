import { captureIncomeReceiptTableMethods, captureOptionalIncomeEpoch } from './income-original-ledger'
import type { HistoricalExecutionModelInstallationV1 } from '../../sui/historical-execution-frame-v1'
import { createIncomeExecutionRegistryV1, EMPTY_INCOME_EXECUTION_REGISTRY_V1, assertIncomeExecutionRegistrySupportsTargetV1, canVerifyFoundationIncomeRetirementSourceV1 } from './income-execution-source-v1'
import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { fromHex } from '@mysten/sui/utils'
import { publicMutationCanonical } from '../../sui/public-mutation-journal'
import { commerceCheck, commerceId, readEconomicsIncome, type EconomicsTarget } from './economics-read'
import { readCommerceOwnedCoinInventory } from './owned-coin-inventory'
import { verifyIncomeWithdrawalInterface } from './income-withdrawal-interface'
import { parseIncomeObservationTarget, parseRootIncomeInstallation, verifyInstalledIncomeSource, incomeSourceManifestHash, type RootIncomeSourceInstallation } from './income-source-qualification'
import { browserIncomeWithdrawalOriginalReaderV1, incomeWithdrawalFundKeyV1, incomeWithdrawalHeadCanClearV1, queryIncomeWithdrawalJournalOriginalV1 } from '../income-withdrawal-journal-v1'
import { retireIncomeWithdrawalOriginalV1 } from '../income-withdrawal-original-recovery'
import type { IncomeWithdrawalResumeCapability } from './income-withdrawal-host-resume'
import { createIncomeWithdrawalHostPreflight, createIncomeWithdrawalHostResume, createIncomeWithdrawalHostExecution } from '../income-withdrawal-host'
import { IncomeWithdrawalHostRecoveryError, type IncomeWithdrawalHostPreflight, type IncomeWithdrawalHostRequest } from './income-withdrawal-host-preflight'

export interface IncomeObservationSelection { target: EconomicsTarget; actor: string | null; adminId: string; installedSourceId: string | null }
export interface IncomeObservation {
  selection: IncomeObservationSelection; catalogVersion: string
  income: Awaited<ReturnType<typeof readEconomicsIncome>>
  previous: { digest: string; originalText: string; status: string } | null
  preparation: null | { source: Awaited<ReturnType<typeof verifyInstalledIncomeSource>>; interfaceProof: Awaited<ReturnType<typeof verifyIncomeWithdrawalInterface>>
    epoch: string; referenceGasPrice: string; inventory: Awaited<ReturnType<typeof readCommerceOwnedCoinInventory>> }
  disabledReason: string | null; notSigningAuthority: true
}
export interface IncomeDraft { amount: string; recipient: string; gasBudget: string; gasPrice: string; gasCoinIds: string[]; expirationEpoch: string; attemptHex: string }
type RequestData = Omit<IncomeWithdrawalHostRequest, 'client' | 'signal' | 'getActorAddress'>
export interface IncomePreparationReview { observation: IncomeObservation; request: RequestData }
const data = ({ client, signal, getActorAddress, ...value }: IncomeWithdrawalHostRequest) => value
function captureClient(source: SuiGrpcClient): SuiGrpcClient {
  const core = source.core, ledger = source.ledgerService, execution = source.transactionExecutionService
  const { batchGetObjects, listDynamicFields } = captureIncomeReceiptTableMethods(source)
  return { core: Object.fromEntries(['getChainIdentifier', 'getMoveFunction', 'listOwnedObjects'].map(name => [name, (core as any)?.[name]?.bind(core)])),
    ledgerService: { ...Object.fromEntries(['getObject', 'getTransaction', 'getCheckpoint', 'getServiceInfo'].map(name => [name, (ledger as any)?.[name]?.bind(ledger)])), getEpoch: captureOptionalIncomeEpoch(ledger), batchGetObjects },
    stateService: { listDynamicFields }, transactionExecutionService: { simulateTransaction: execution?.simulateTransaction?.bind(execution) } } as unknown as SuiGrpcClient
}
/** Root constructs this controller from its compiled installation catalog.
 * Public form fields select/observe; they cannot install an anchor. There is
 * no URL/env/storage/global activation path or second journal backend. A wallet
 * signer is supplied per explicit execution request.
 */
export function createRootIncomeEntryController(options: {
  installations: readonly RootIncomeSourceInstallation[]; client: (signal: AbortSignal) => SuiGrpcClient; isCurrent?: () => boolean; executionModels?: readonly HistoricalExecutionModelInstallationV1[]
  foundationRetirementSourceManifestSha256s?: readonly string[]
}) {
  const installations = structuredClone(options.installations), clientFactory = options.client, isCurrent = options.isCurrent ?? (() => true)
  const executionModels = structuredClone(options.executionModels ?? [])
  commerceCheck(Array.isArray(executionModels) && executionModels.length <= 32, 'INCOME_EXECUTION_MODEL_CATALOG_BOUND')
  const foundationRetirementSourceManifestSha256s = structuredClone(options.foundationRetirementSourceManifestSha256s ?? [])
  const executionRegistry = () => executionModels.length ? createIncomeExecutionRegistryV1({ models: executionModels,
    foundationSources: installations, foundationRetirementSourceManifestSha256s }) : EMPTY_INCOME_EXECUTION_REGISTRY_V1
  const originalRegistry = () => { try { return executionRegistry() } catch { return EMPTY_INCOME_EXECUTION_REGISTRY_V1 } }
  const current = () => { try { return isCurrent() === true } catch { return false } }
  commerceCheck(Array.isArray(installations) && installations.length <= 64, 'INCOME_ROOT_CATALOG_BOUND')
  const catalogVersion = incomeSourceManifestHash(publicMutationCanonical({ installations, executionModels,
    ...(foundationRetirementSourceManifestSha256s.length ? { foundationRetirementSourceManifestSha256s } : {}) }))
  // Display copies are never authority to redefine a review. Only an exact
  // issued object with this private independent baseline can be consumed.
  const reviews = new WeakMap<IncomePreparationReview, { snapshot: IncomePreparationReview; canonical: string }>()
  function catalog() {
    const entries = installations.map(parseRootIncomeInstallation)
    commerceCheck(new Set(entries.map(row => row.manifestSha256)).size === entries.length, 'INCOME_ROOT_CATALOG_DUPLICATE')
    return entries
  }
  function installedFor(selection: IncomeObservationSelection) {
    commerceCheck(selection.installedSourceId, 'INCOME_SOURCE_NOT_INSTALLED')
    const installed = catalog().find(row => row.manifestSha256 === selection.installedSourceId)
    commerceCheck(installed && publicMutationCanonical(installed.manifest.target) === publicMutationCanonical(selection.target), 'INCOME_SOURCE_NOT_INSTALLED')
    return installed
  }
  async function observeWithClient(input: IncomeObservationSelection, source: SuiGrpcClient, parent: AbortSignal, getActorAddress: () => string | null): Promise<IncomeObservation> {
    const selection = structuredClone(input)
    const client = captureClient(source), signal = AbortSignal.any([parent, AbortSignal.timeout(90000)])
    const guard = () => { signal.throwIfAborted(); commerceCheck(current() && getActorAddress() === selection.actor, 'INCOME_OBSERVATION_LEASE_CHANGED') }
    const reader = browserIncomeWithdrawalOriginalReaderV1(), key = incomeWithdrawalFundKeyV1(selection.target)
    signal.throwIfAborted()
    // Read-only original exclusion precedes even new source/catalog parsing.
    // It is not a reservation; prepare repeats exclusion under both locks.
    const originalHead = (await reader.heads(name => name === key))[0] ?? null
    let previous: IncomeObservation['previous'] = null
    if (originalHead) {
      try {
        const original = await queryIncomeWithdrawalJournalOriginalV1({ record: originalHead, client, signal, executionRegistry: originalRegistry() }); signal.throwIfAborted()
        commerceCheck(incomeWithdrawalHeadCanClearV1(originalHead, original), 'INCOME_ORIGINAL_RECOVERY_REQUIRED')
        previous = { digest: originalHead.packet.digest, originalText: originalHead.plan.originalText, status: original.status }
      } catch (error) { throw new IncomeWithdrawalHostRecoveryError(error instanceof Error ? error.message : 'INCOME_ORIGINAL_QUERY_FAILED', {
        text: originalHead.plan.originalText, digest: originalHead.packet.digest, headPhase: originalHead.packet.phase, durability: 'CONFIRMED' }, { cause: error }) }
    }
    selection.target = parseIncomeObservationTarget(selection.target)
    commerceCheck(selection.actor === null || commerceId(selection.actor), 'INCOME_OBSERVATION_ACTOR')
    commerceCheck(selection.adminId === '' || commerceId(selection.adminId), 'INCOME_OBSERVATION_ADMIN')
    guard()
    const request = { client, target: selection.target, signal,
      ...(selection.actor && selection.adminId ? { admin: { actor: selection.actor, objectId: selection.adminId } } : {}) }
    const income = await readEconomicsIncome(request); guard()
    let preparation: IncomeObservation['preparation'] = null, disabledReason: string | null = null
    if (!selection.installedSourceId) disabledReason = '此公开目标没有选择 Root 已安装的来源资格，仅可观察收益。'
    else if (!executionModels.length) disabledReason = '执行模型尚未安装，提款准备关闭；原交易查询与下载仍可使用。'
    else if (!selection.actor || !selection.adminId || !income.authority) disabledReason = '请连接管理钱包并明确选择与 Config 匹配的 Admin 对象。'
    else {
      const installed = installedFor(selection)
      assertIncomeExecutionRegistrySupportsTargetV1(executionRegistry(), selection.target)
      const proof = await verifyInstalledIncomeSource({ installed, client, income, signal }); guard()
      const interfaceProof = await verifyIncomeWithdrawalInterface({ client, foundation: selection.target.foundation, signal }); guard()
      const epochRead = async () => {
        const row = (await client.ledgerService.getEpoch({ readMask: { paths: ['epoch', 'reference_gas_price'] } }, { abort: signal })).response.epoch
        guard(); commerceCheck(typeof row?.epoch === 'bigint' && row.epoch >= 0n && typeof row.referenceGasPrice === 'bigint' && row.referenceGasPrice > 0n, 'INCOME_OBSERVATION_EPOCH')
        return { epoch: String(row.epoch), referenceGasPrice: String(row.referenceGasPrice) }
      }
      const epoch = await epochRead(), inventory = await readCommerceOwnedCoinInventory({ client, owner: selection.actor, coinType: '0x2::sui::SUI', getViewerAddress: getActorAddress, signal }); guard()
      const finalEpoch = await epochRead(), finalIncome = await readEconomicsIncome(request); guard()
      commerceCheck(publicMutationCanonical(finalEpoch) === publicMutationCanonical(epoch) && publicMutationCanonical(finalIncome) === publicMutationCanonical(income), 'INCOME_OBSERVATION_CHANGED')
      preparation = { source: proof, interfaceProof, ...epoch, inventory }
    }
    const finalHead = await reader.read(key); guard()
    commerceCheck(publicMutationCanonical(finalHead) === publicMutationCanonical(originalHead), 'INCOME_OBSERVATION_HEAD_CHANGED')
    return { selection, catalogVersion, income, previous, preparation, disabledReason, notSigningAuthority: true }
  }
  function makeReview(observation: IncomeObservation, draft: IncomeDraft): IncomePreparationReview {
    const saved = structuredClone(observation), values = structuredClone(draft), prepared = saved.preparation
    commerceCheck(current() && saved.catalogVersion === catalogVersion && prepared && !saved.disabledReason && saved.selection.actor && saved.selection.adminId, 'INCOME_REVIEW_NOT_QUALIFIED')
    installedFor(saved.selection)
    const uint = (value: string) => typeof value === 'string' && /^[1-9][0-9]{0,19}$/.test(value) && BigInt(value) <= 18446744073709551615n
    commerceCheck(uint(values.amount) && BigInt(values.amount) <= BigInt(saved.income.ledger.balance) && commerceId(values.recipient)
      && uint(values.gasBudget) && uint(values.gasPrice) && BigInt(values.gasPrice) >= BigInt(prepared.referenceGasPrice), 'INCOME_REVIEW_AMOUNT_OR_FEE')
    commerceCheck(/^(0|[1-9][0-9]{0,15})$/.test(values.expirationEpoch) && Number.isSafeInteger(Number(values.expirationEpoch))
      && BigInt(values.expirationEpoch) >= BigInt(prepared.epoch) && BigInt(values.expirationEpoch) <= BigInt(prepared.epoch) + 1n, 'INCOME_REVIEW_EXPIRY')
    commerceCheck(typeof values.attemptHex === 'string' && /^[0-9a-f]{64}$/.test(values.attemptHex) && /[1-9a-f]/.test(values.attemptHex), 'INCOME_REVIEW_ATTEMPT')
    commerceCheck(values.gasCoinIds.length > 0 && values.gasCoinIds.length <= 256 && new Set(values.gasCoinIds).size === values.gasCoinIds.length, 'INCOME_REVIEW_GAS_SELECTION')
    const coins = values.gasCoinIds.map(id => { const coin = prepared.inventory.coins.find(row => row.objectId === id); commerceCheck(coin, 'INCOME_REVIEW_GAS_NOT_OBSERVED'); return coin })
    commerceCheck(coins.reduce((sum, row) => sum + BigInt(row.balance), 0n) >= BigInt(values.gasBudget), 'INCOME_REVIEW_GAS_BALANCE')
    const review: IncomePreparationReview = { observation: saved, request: { kind: 'NEW_INCOME_WITHDRAWAL', target: saved.selection.target, actor: saved.selection.actor,
      adminId: saved.selection.adminId, recipient: values.recipient, amount: values.amount, attempt: fromHex(values.attemptHex), reviewed: saved.income,
      gas: { budget: values.gasBudget, price: values.gasPrice, coins: coins.map(({ objectId, version, digest }) => ({ objectId, version, digest })) }, expirationEpoch: values.expirationEpoch } }
    const snapshot = structuredClone(review)
    reviews.set(review, { snapshot, canonical: publicMutationCanonical(snapshot) })
    return review
  }
  function createPreflight(review: IncomePreparationReview): IncomeWithdrawalHostPreflight {
    const issued = reviews.get(review)
    const host = createIncomeWithdrawalHostPreflight({ executionRegistry: originalRegistry(), beforePrepare: async request => {
      // Deliberately deferred until the shared Host has queried/excluded old
      // originals. Even a wrong/obsolete new review cannot bypass that query.
      commerceCheck(issued && publicMutationCanonical(review) === issued.canonical, 'INCOME_REVIEW_NOT_ISSUED_OR_CHANGED')
      const saved = issued.snapshot
      commerceCheck(current() && publicMutationCanonical(data(request)) === publicMutationCanonical(saved.request), 'INCOME_REVIEW_REQUEST_CHANGED')
      const fresh = await observeWithClient(saved.observation.selection, request.client, request.signal, request.getActorAddress)
      commerceCheck(fresh.preparation && publicMutationCanonical(fresh) === publicMutationCanonical(saved.observation), 'INCOME_REVIEW_REFRESH_REQUIRED')
    } })
    return input => {
      const address = input.getActorAddress
      return host({ ...input, getActorAddress: () => current() ? address() : null })
    }
  }
  return Object.freeze({ catalogVersion, isCurrent: current, client: clientFactory, makeReview, createPreflight,
    installedSources: () => { try { return { entries: structuredClone(catalog()), error: null } } catch { return { entries: [], error: 'Root 安装目录无效；提款准备关闭，公开观察仍可使用。' } } },
    observe: (selection: IncomeObservationSelection, signal: AbortSignal, getActorAddress: () => string | null) => observeWithClient(selection, clientFactory(signal), signal, getActorAddress),
    resumeCapability: () => {
      if (!installations.length || !executionModels.length) return null
      const sourceId = catalogVersion, activationKey = `root-income-source:${catalogVersion}`
      catalog()
      const options: Parameters<typeof createIncomeWithdrawalHostResume>[0] = {
        sourceId, activationKey, executionRegistry: originalRegistry(), isActive: current, authorizeOriginalSource: async ({ original, client, signal }) => {
          const matching = catalog().filter(row => publicMutationCanonical(row.manifest.target) === publicMutationCanonical(original.target))
          commerceCheck(matching.length === 1, 'INCOME_RESUME_SOURCE_NOT_INSTALLED')
          assertIncomeExecutionRegistrySupportsTargetV1(executionRegistry(), original.target)
          const income = await readEconomicsIncome({ client, target: original.target, admin: { actor: original.intent.actor, objectId: original.intent.adminId }, signal })
          await verifyInstalledIncomeSource({ installed: matching[0], client, income, signal }); commerceCheck(current(), 'INCOME_RESUME_SOURCE_CHANGED')
          return { sourceId, target: original.target }
        } }
      const capability = { sourceId, activationKey, isActive: current, client: clientFactory,
        host: createIncomeWithdrawalHostResume(options), execute: createIncomeWithdrawalHostExecution(options) }
      if (!foundationRetirementSourceManifestSha256s.length) return capability
      const registry = originalRegistry()
      const canRetire = (target: EconomicsTarget) => current() && canVerifyFoundationIncomeRetirementSourceV1(registry, target)
      const retirement: NonNullable<IncomeWithdrawalResumeCapability['retirement']> = {
        canRetire,
        retire: ({ selected, signal, isCurrent }) => retireIncomeWithdrawalOriginalV1({
          selected, signal, client: clientFactory(signal), executionRegistry: registry, isCurrent: target => isCurrent() && canRetire(target),
        }),
      }
      return { ...capability, retirement }
    } })
}
export type RootIncomeEntryController = ReturnType<typeof createRootIncomeEntryController>
