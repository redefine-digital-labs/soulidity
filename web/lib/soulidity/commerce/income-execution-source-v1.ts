import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { MAINNET_GENESIS_DIGEST } from '../../animacraft/mainnet-chain'
import { publicMutationCanonical } from '../../sui/public-mutation-journal'
import { readPinnedMovePackage } from '../../sui/pinned-move-package'
import { createHistoricalExecutionModelRegistryV1, observeHistoricalExecutionFrameV1, isQualifiedHistoricalEventFrameV1,
  type HistoricalExecutionModelInstallationV1, type HistoricalExecutionContextV1,
  type HistoricalTopMoveCallV1, type QualifiedHistoricalEventFrameV1 } from '../../sui/historical-execution-frame-v1'
import { createSimulatedExecutionModelRegistryV1, observeSimulatedExecutionFrameV1, isQualifiedSimulatedEventFrameV1,
  type QualifiedSimulatedEventFrameV1 } from '../../sui/simulated-execution-frame-v1'
import { commerceCheck, type EconomicsTarget } from './economics-read'
import type { MakerProductIncomeTarget } from './maker-product-income-read'
import { parseRootMakerProductIncomeInstallation, type RootMakerProductIncomeInstallation } from './maker-product-income-source'
import { parseRootIncomeInstallation, type RootIncomeSourceInstallation } from './income-source-qualification'
import { captureIncomeOriginalLedger } from './income-original-ledger'

type Target = MakerProductIncomeTarget | EconomicsTarget
type Entries = {
  models: ReturnType<typeof createHistoricalExecutionModelRegistryV1>
  simulatedModels: ReturnType<typeof createSimulatedExecutionModelRegistryV1>
  makerSources: ReturnType<typeof parseRootMakerProductIncomeInstallation>[]
  foundationSources: ReturnType<typeof parseRootIncomeInstallation>[]
  retirementSources: ReadonlySet<string>
  foundationRetirementSources: ReadonlySet<string>
}
const registries = new WeakMap<object, Entries>()
/** Explicit caller-owned trust inputs, reusable by release. Constructing this
 * registry cannot install any entry in the first-party compiled catalogs. */
export function createIncomeExecutionRegistryV1(input: {
  models: readonly HistoricalExecutionModelInstallationV1[]
  makerSources?: readonly RootMakerProductIncomeInstallation[]
  foundationSources?: readonly RootIncomeSourceInstallation[]
  retirementSourceManifestSha256s?: readonly string[]
  foundationRetirementSourceManifestSha256s?: readonly string[]
}) {
  const models = createHistoricalExecutionModelRegistryV1(input.models), simulatedModels = createSimulatedExecutionModelRegistryV1(input.models)
  commerceCheck((input.makerSources?.length ?? 0) <= 64 && (input.foundationSources?.length ?? 0) <= 64, 'INCOME_EXECUTION_SOURCE_BOUND')
  const makerSources = (input.makerSources ?? []).map(parseRootMakerProductIncomeInstallation)
  const foundationSources = (input.foundationSources ?? []).map(parseRootIncomeInstallation)
  const acceptedRetirements = input.retirementSourceManifestSha256s ?? []
  const retirementSources = new Set(acceptedRetirements)
  commerceCheck(acceptedRetirements.length <= 64 && retirementSources.size === acceptedRetirements.length
    && acceptedRetirements.every(sha => makerSources.some(source => source.manifestSha256 === sha)), 'MAKER_INCOME_RETIREMENT_CATALOG')
  const acceptedFoundationRetirements = input.foundationRetirementSourceManifestSha256s ?? []
  const foundationRetirementSources = new Set(acceptedFoundationRetirements)
  commerceCheck(acceptedFoundationRetirements.length <= 64 && foundationRetirementSources.size === acceptedFoundationRetirements.length
    && acceptedFoundationRetirements.every(sha => foundationSources.some(source => source.manifestSha256 === sha)), 'WITHDRAW_RETIREMENT_CATALOG')
  const registry = Object.freeze({ modelCount: models.length })
  registries.set(registry, { models, simulatedModels, makerSources, foundationSources, retirementSources, foundationRetirementSources }); return registry
}
export type IncomeExecutionRegistryV1 = ReturnType<typeof createIncomeExecutionRegistryV1>
export const EMPTY_INCOME_EXECUTION_REGISTRY_V1 = createIncomeExecutionRegistryV1({ models: [] })
const emptySimulationModels = createSimulatedExecutionModelRegistryV1([])
export type IncomeExecutionFrameV1 = QualifiedHistoricalEventFrameV1 | QualifiedSimulatedEventFrameV1
const sourceQualifiedFrames = new WeakSet<object>()
/** A protocol frame alone does not attest its producer's original source. */
export function assertIncomeExecutionSourceFrameV1(frame: IncomeExecutionFrameV1) {
  commerceCheck(sourceQualifiedFrames.has(frame), 'INCOME_EXECUTION_SOURCE_FRAME_REQUIRED')
}
function entriesFor(registry: IncomeExecutionRegistryV1) {
  const entries = registries.get(registry)
  commerceCheck(entries, 'INCOME_EXECUTION_REGISTRY_CAPABILITY'); return entries
}
function matchingSources(entries: Entries, target: Target) {
  if ('productId' in target) {
    const { productId, ...deployment } = target
    return entries.makerSources.filter(row => publicMutationCanonical(row.manifest.deployment) === publicMutationCanonical(deployment))
  }
  return entries.foundationSources.filter(row => publicMutationCanonical(row.manifest.target) === publicMutationCanonical(target))
}
/** Necessary catalog capability, not a claim about the current protocol or
 * signing. Full simulation must still qualify its current before/after anchors. */
export function assertIncomeExecutionRegistrySupportsTargetV1(registry: IncomeExecutionRegistryV1, target: Target) {
  const entries = entriesFor(registry)
  commerceCheck(entries.models.length > 0, 'INCOME_EXECUTION_MODEL_NOT_INSTALLED')
  commerceCheck(matchingSources(entries, target).length === 1, 'INCOME_EXECUTION_SOURCE_NOT_INSTALLED_OR_AMBIGUOUS')
}
function topCallFor(target: Target): HistoricalTopMoveCallV1 {
  return { commandIndex: 0, packagePin: structuredClone('productId' in target ? target.manufacturing : target.foundation),
    module: 'productId' in target ? 'maker_catalog' : 'economics', function: 'withdraw_income' }
}
function snapshot(pkg: Awaited<ReturnType<typeof readPinnedMovePackage>>) {
  const order = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0
  return { version: String(pkg.version),
    moduleHashes: [...pkg.moduleHashes].map(([name, row]) => ({ name, sha256: row.sha256, byteLength: String(row.byteLength) })).sort((a, b) => order(a.name, b.name)),
    typeOrigins: [...pkg.origins].map(([name, packageId]) => ({ name, packageId })).sort((a, b) => order(a.name, b.name)),
    linkage: [...pkg.linkage].map(([originalPackageId, row]) => ({ originalPackageId, ...row })).sort((a, b) => order(a.originalPackageId, b.originalPackageId)) }
}
/** Immutable original release only. Current balances/Control/Admin are not
 * prerequisites for verifying a historical producer. */
async function readQualifiedTopCall(input: { entries: Entries; client: SuiGrpcClient; target: Target; signal: AbortSignal }) {
  const { entries, client, target, signal } = input, topCall = topCallFor(target)
  if (!matchingSources(entries, target).length) return null
  commerceCheck(matchingSources(entries, target).length === 1, 'INCOME_EXECUTION_SOURCE_AMBIGUOUS')
  if ('productId' in target) {
    const { productId, ...deployment } = target
    const installed = entries.makerSources.find(row => publicMutationCanonical(row.manifest.deployment) === publicMutationCanonical(deployment))!
    for (const role of ['manufacturing', 'foundation'] as const) {
      const pkg = await readPinnedMovePackage(client, deployment[role], signal)
      commerceCheck(publicMutationCanonical(snapshot(pkg)) === publicMutationCanonical(installed.manifest.packages[role]), 'INCOME_EXECUTION_ORIGINAL_PACKAGE')
      if (role === 'manufacturing') {
        topCall.moduleBytes = pkg.moduleBytes.get(topCall.module)
        topCall.moduleSha256 = installed.manifest.packages.manufacturing.moduleHashes.find(row => row.name === topCall.module)?.sha256
      }
    }
  } else {
    const installed = entries.foundationSources.find(row => publicMutationCanonical(row.manifest.target) === publicMutationCanonical(target))!, manifest = installed.manifest
    const pkg = await readPinnedMovePackage(client, target.foundation, signal), { version, ...tables } = snapshot(pkg)
    commerceCheck(version === manifest.packageVersion && publicMutationCanonical(tables) === publicMutationCanonical({ moduleHashes: manifest.moduleHashes, typeOrigins: manifest.typeOrigins, linkage: manifest.linkage }), 'INCOME_EXECUTION_ORIGINAL_PACKAGE')
    topCall.moduleBytes = pkg.moduleBytes.get(topCall.module)
    topCall.moduleSha256 = manifest.moduleHashes.find(row => row.name === topCall.module)?.sha256
  }
  return topCall
}
function retirementSource(entries: Entries, target: MakerProductIncomeTarget) {
  const { productId, ...deployment } = target
  const key = publicMutationCanonical(deployment)
  const matches = entries.makerSources.filter(row => publicMutationCanonical(row.manifest.deployment) === key)
  return matches.length === 1 && entries.retirementSources.has(matches[0].manifestSha256) ? matches[0] : null
}

export function canVerifyMakerIncomeRetirementSourceV1(registry: IncomeExecutionRegistryV1, target: MakerProductIncomeTarget) {
  return Boolean(retirementSource(entriesFor(registry), target))
}

/** Exact Root-admitted immutable release and its receipt type origins. */
export async function verifyMakerIncomeRetirementSourceV1(input: {
  registry: IncomeExecutionRegistryV1; client: SuiGrpcClient; target: MakerProductIncomeTarget; signal: AbortSignal
}) {
  const target = structuredClone(input.target), client = captureIncomeOriginalLedger(input.client), entries = entriesFor(input.registry)
  const installed = retirementSource(entries, target)
  commerceCheck(installed, 'MAKER_INCOME_RETIREMENT_SOURCE_NOT_INSTALLED')
  await readQualifiedTopCall({ ...input, client, target, entries })
  const origins = installed.manifest.packages.foundation.typeOrigins
  const request = origins.find(row => row.name === 'revenue::Request'), receipt = origins.find(row => row.name === 'revenue::Receipt')
  commerceCheck(request && receipt, 'MAKER_INCOME_RETIREMENT_RECEIPT_TYPES')
  return { requestType: `${request.packageId}::revenue::Request`, receiptType: `${receipt.packageId}::revenue::Receipt` }
}
function foundationRetirementSource(entries: Entries, target: EconomicsTarget) {
  const key = publicMutationCanonical(target)
  const matches = entries.foundationSources.filter(row => publicMutationCanonical(row.manifest.target) === key)
  return matches.length === 1 && entries.foundationRetirementSources.has(matches[0].manifestSha256) ? matches[0] : null
}

export function canVerifyFoundationIncomeRetirementSourceV1(registry: IncomeExecutionRegistryV1, target: EconomicsTarget) {
  return Boolean(foundationRetirementSource(entriesFor(registry), target))
}

/** Retirement admission additionally attests the persistent receipt invariant
 * for this Config and its effective deployment lineage. */
export async function verifyFoundationIncomeRetirementSourceV1(input: {
  registry: IncomeExecutionRegistryV1; client: SuiGrpcClient; target: EconomicsTarget; signal: AbortSignal
}) {
  const target = structuredClone(input.target), client = captureIncomeOriginalLedger(input.client), entries = entriesFor(input.registry)
  const installed = foundationRetirementSource(entries, target)
  commerceCheck(installed, 'WITHDRAW_RETIREMENT_SOURCE_NOT_INSTALLED')
  await readQualifiedTopCall({ ...input, client, target, entries })
  const request = installed.manifest.typeOrigins.find(row => row.name === 'revenue::Request')
  const receipt = installed.manifest.typeOrigins.find(row => row.name === 'revenue::Receipt')
  commerceCheck(request && receipt, 'WITHDRAW_RETIREMENT_RECEIPT_TYPES')
  return { requestType: `${request.packageId}::revenue::Request`, receiptType: `${receipt.packageId}::revenue::Receipt`,
    initialSharedVersion: installed.manifest.configInitialSharedVersion, sourceManifestSha256: installed.manifestSha256 }
}
type ObservationInput = Omit<Parameters<typeof observeHistoricalExecutionFrameV1>[0], 'registry' | 'topCall'> & {
  registry: IncomeExecutionRegistryV1; client: SuiGrpcClient; signal: AbortSignal; target: Target
}
async function observeIncomeHistoricalExecution(input: ObservationInput) {
  input = { ...input, target: structuredClone(input.target), context: structuredClone(input.context), client: captureIncomeOriginalLedger(input.client) }
  const entries = entriesFor(input.registry)
  commerceCheck(input.context.genesisDigest === MAINNET_GENESIS_DIGEST, 'INCOME_EXECUTION_GENESIS')
  const topCall = entries.models.length ? await readQualifiedTopCall({ ...input, entries }) : topCallFor(input.target)
  if (!topCall) return { status: 'EXECUTION_MODEL_UNQUALIFIED' as const, reason: 'ORIGINAL_SOURCE_NOT_INSTALLED' as const,
    transactionDigest: input.context.transactionDigest, checkpoint: input.context.checkpoint, epoch: input.context.effects.V2!.executedEpoch, completeBusinessOutputVerified: false as const }
  const frame = await observeHistoricalExecutionFrameV1({ ...input, registry: entries.models, topCall, scopedSignal: input.signal })
  if (isQualifiedHistoricalEventFrameV1(frame)) sourceQualifiedFrames.add(frame)
  return frame
}
export function observeMakerIncomeExecutionV1(input: ObservationInput & { target: MakerProductIncomeTarget }) { return observeIncomeHistoricalExecution(input) }
export function observeFoundationIncomeExecutionV1(input: ObservationInput & { target: EconomicsTarget }) { return observeIncomeHistoricalExecution(input) }

type SimulateInput<T> = Omit<Parameters<typeof observeSimulatedExecutionFrameV1<T>>[0], 'registry' | 'topCall'> & {
  registry: IncomeExecutionRegistryV1; client: SuiGrpcClient; signal: AbortSignal; target: Target
}
/** The callback and original ledger readers are captured by the caller at its
 * operation boundary. No fake checkpoint or historical frame is used. */
export async function observeIncomeSimulatedExecutionV1<T>(input: SimulateInput<T>) {
  input = { ...input, target: structuredClone(input.target), context: structuredClone(input.context), client: captureIncomeOriginalLedger(input.client) }
  const entries = entriesFor(input.registry)
  commerceCheck(input.context.genesisDigest === MAINNET_GENESIS_DIGEST, 'INCOME_EXECUTION_GENESIS')
  const topCall = entries.models.length ? await readQualifiedTopCall({ ...input, entries }) : topCallFor(input.target)
  const result = await observeSimulatedExecutionFrameV1({ ...input, registry: topCall ? entries.simulatedModels : emptySimulationModels,
    topCall: topCall ?? topCallFor(input.target), scopedSignal: input.signal })
  if (!topCall) return { value: result.value, observation: { status: 'SIMULATION_MODEL_UNAVAILABLE' as const, reason: 'ORIGINAL_SOURCE_NOT_INSTALLED' as const,
    transactionDigest: input.context.transactionDigest, completeBusinessOutputVerified: false as const, notFinalizedEvidence: true as const, notSigningAuthority: true as const } }
  if (isQualifiedSimulatedEventFrameV1(result.observation)) sourceQualifiedFrames.add(result.observation)
  return result
}
