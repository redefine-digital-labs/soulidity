import { sha256 } from '@noble/hashes/sha2.js'
import { fromBase58, normalizeStructTag, toBase58, toHex } from '@mysten/sui/utils'
import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { MAINNET_GENESIS_DIGEST } from '../../animacraft/mainnet-chain'
import { publicMutationCanonical } from '../../sui/public-mutation-journal'
import { readPinnedMovePackage } from '../../sui/pinned-move-package'
import { commerceCheck, commerceId, readCommerceObject, readEconomicsIncome, type EconomicsTarget } from './economics-read'

const MAX = 18446744073709551615n
function object(value: unknown, keys: string[]) {
  commerceCheck(value && typeof value === 'object' && !Array.isArray(value), 'INCOME_SOURCE_OBJECT')
  const row = value as Record<string, any>
  commerceCheck(Object.keys(row).length === keys.length && Object.keys(row).every(key => keys.includes(key)), 'INCOME_SOURCE_KEYS')
  return row
}
function uint(value: unknown, positive = false): asserts value is string {
  commerceCheck(typeof value === 'string' && /^(0|[1-9][0-9]{0,19})$/.test(value) && BigInt(value) <= MAX && (!positive || BigInt(value) > 0n), 'INCOME_SOURCE_U64')
}
function hex(value: unknown): asserts value is string { commerceCheck(typeof value === 'string' && /^[0-9a-f]{64}$/.test(value), 'INCOME_SOURCE_HASH') }
function digest(value: unknown) {
  commerceCheck(typeof value === 'string' && value.length <= 44, 'INCOME_SOURCE_DIGEST')
  const bytes = fromBase58(value); commerceCheck(bytes.length === 32 && toBase58(bytes) === value, 'INCOME_SOURCE_DIGEST')
}
export function parseIncomeObservationTarget(value: unknown): EconomicsTarget {
  const t = object(value, ['chainIdentifier', 'foundation', 'configId', 'coinType']), p = object(t.foundation, ['originalPackageId', 'callablePackageId', 'callableDigest'])
  commerceCheck(t.chainIdentifier === '35834a8a' && commerceId(t.configId) && commerceId(p.originalPackageId) && commerceId(p.callablePackageId), 'INCOME_SOURCE_TARGET')
  digest(p.callableDigest)
  commerceCheck(typeof t.coinType === 'string' && t.coinType.length <= 2048 && normalizeStructTag(t.coinType) === t.coinType, 'INCOME_SOURCE_COIN')
  return { chainIdentifier: t.chainIdentifier, configId: t.configId, coinType: t.coinType,
    foundation: { originalPackageId: p.originalPackageId, callablePackageId: p.callablePackageId, callableDigest: p.callableDigest } }
}
export interface IncomeSourceManifest {
  schema: 'soulidity.foundation-income-source.v1'; genesisDigest: string; target: EconomicsTarget; configSchema: 3
  configInitialSharedVersion: string; packageVersion: string
  moduleHashes: Array<{ name: string; sha256: string; byteLength: string }>
  typeOrigins: Array<{ name: string; packageId: string }>
  linkage: Array<{ originalPackageId: string; upgradedId: string; upgradedVersion: string }>
  source: { commitSha: string; treeSha256: string; buildSha256: string; dependencyLockSha256: string; sourceAuditSha256: string }
}
const ordered = (names: string[]) => names.every((name, index) => index === 0 || names[index - 1] < name)
/** Public canonical evidence only. Parsing or importing this document does not
 * install source qualification. Exact text equality also rejects duplicate JSON
 * keys, alternate encodings and hidden unknown fields after reconstruction.
 */
export function parseIncomeSourceManifest(text: string): IncomeSourceManifest {
  commerceCheck(typeof text === 'string' && text.length > 0 && new TextEncoder().encode(text).length <= 180000, 'INCOME_SOURCE_MANIFEST_BOUND')
  const r = object(JSON.parse(text), ['schema', 'genesisDigest', 'target', 'configSchema', 'configInitialSharedVersion', 'packageVersion', 'moduleHashes', 'typeOrigins', 'linkage', 'source'])
  commerceCheck(r.schema === 'soulidity.foundation-income-source.v1' && r.genesisDigest === MAINNET_GENESIS_DIGEST && r.configSchema === 3, 'INCOME_SOURCE_SCHEMA')
  const target = parseIncomeObservationTarget(r.target); uint(r.configInitialSharedVersion, true); uint(r.packageVersion, true)
  commerceCheck(Array.isArray(r.moduleHashes) && r.moduleHashes.length >= 2 && r.moduleHashes.length <= 512, 'INCOME_SOURCE_MODULES')
  const moduleHashes = r.moduleHashes.map((value: unknown) => {
    const row = object(value, ['name', 'sha256', 'byteLength']); hex(row.sha256); uint(row.byteLength, true)
    commerceCheck(typeof row.name === 'string' && /^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(row.name) && BigInt(row.byteLength) <= 4194304n, 'INCOME_SOURCE_MODULE')
    return { name: row.name as string, sha256: row.sha256, byteLength: row.byteLength }
  })
  commerceCheck(ordered(moduleHashes.map((x: { name: string }) => x.name)) && ['economics', 'revenue'].every(name => moduleHashes.some((x: { name: string }) => x.name === name)), 'INCOME_SOURCE_MODULE_SET')
  commerceCheck(Array.isArray(r.typeOrigins) && r.typeOrigins.length >= 4 && r.typeOrigins.length <= 4096, 'INCOME_SOURCE_ORIGINS')
  const typeOrigins = r.typeOrigins.map((value: unknown) => {
    const row = object(value, ['name', 'packageId'])
    commerceCheck(typeof row.name === 'string' && /^[A-Za-z_][A-Za-z0-9_]{0,127}::[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(row.name) && commerceId(row.packageId), 'INCOME_SOURCE_ORIGIN')
    return { name: row.name as string, packageId: row.packageId as string }
  })
  commerceCheck(ordered(typeOrigins.map((x: { name: string }) => x.name)) && ['economics::Config', 'economics::Admin', 'revenue::Request', 'revenue::Receipt'].every(name => typeOrigins.some((x: { name: string }) => x.name === name)), 'INCOME_SOURCE_ORIGIN_SET')
  commerceCheck(Array.isArray(r.linkage) && r.linkage.length <= 1024, 'INCOME_SOURCE_LINKAGE')
  const linkage = r.linkage.map((value: unknown) => {
    const row = object(value, ['originalPackageId', 'upgradedId', 'upgradedVersion']); uint(row.upgradedVersion)
    commerceCheck(commerceId(row.originalPackageId) && commerceId(row.upgradedId), 'INCOME_SOURCE_LINK')
    return { originalPackageId: row.originalPackageId as string, upgradedId: row.upgradedId as string, upgradedVersion: row.upgradedVersion }
  })
  commerceCheck(ordered(linkage.map((x: { originalPackageId: string }) => x.originalPackageId)), 'INCOME_SOURCE_LINK_ORDER')
  const s = object(r.source, ['commitSha', 'treeSha256', 'buildSha256', 'dependencyLockSha256', 'sourceAuditSha256'])
  commerceCheck(typeof s.commitSha === 'string' && /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(s.commitSha), 'INCOME_SOURCE_COMMIT')
  for (const key of ['treeSha256', 'buildSha256', 'dependencyLockSha256', 'sourceAuditSha256']) hex(s[key])
  const source = { commitSha: s.commitSha, treeSha256: s.treeSha256, buildSha256: s.buildSha256, dependencyLockSha256: s.dependencyLockSha256, sourceAuditSha256: s.sourceAuditSha256 }
  const result: IncomeSourceManifest = { schema: r.schema, genesisDigest: r.genesisDigest, target, configSchema: 3,
    configInitialSharedVersion: r.configInitialSharedVersion, packageVersion: r.packageVersion, moduleHashes, typeOrigins, linkage, source }
  commerceCheck(publicMutationCanonical(result) === text, 'INCOME_SOURCE_NONCANONICAL')
  return result
}
export const incomeSourceManifestHash = (text: string) => toHex(sha256(new TextEncoder().encode(text)))
export interface RootIncomeSourceInstallation { manifestText: string; acceptedManifestSha256: string; acceptedSourceAuditSha256: string }
/** Called only with Root's compiled installation catalog. Browser inputs never
 * reach this constructor. The audit anchor records Root's independent source ↔
 * build ↔ deployed-bytecode acceptance; hashes/ABI alone cannot establish it.
 */
export function parseRootIncomeInstallation(input: RootIncomeSourceInstallation) {
  const value = structuredClone(input); hex(value.acceptedManifestSha256); hex(value.acceptedSourceAuditSha256)
  const manifest = parseIncomeSourceManifest(value.manifestText)
  commerceCheck(incomeSourceManifestHash(value.manifestText) === value.acceptedManifestSha256
    && manifest.source.sourceAuditSha256 === value.acceptedSourceAuditSha256, 'INCOME_SOURCE_ROOT_ANCHOR_MISMATCH')
  return { manifest, manifestText: value.manifestText, manifestSha256: value.acceptedManifestSha256, sourceAuditSha256: value.acceptedSourceAuditSha256 }
}
export type InstalledIncomeSource = ReturnType<typeof parseRootIncomeInstallation>
export async function verifyInstalledIncomeSource(input: { installed: InstalledIncomeSource; client: SuiGrpcClient;
  income: Awaited<ReturnType<typeof readEconomicsIncome>>; signal: AbortSignal }) {
  const installed = structuredClone(input.installed), { manifest } = installed, income = structuredClone(input.income)
  commerceCheck(incomeSourceManifestHash(installed.manifestText) === installed.manifestSha256 && publicMutationCanonical(parseIncomeSourceManifest(installed.manifestText)) === publicMutationCanonical(manifest)
    && publicMutationCanonical(income.target) === publicMutationCanonical(manifest.target), 'INCOME_SOURCE_INSTALLED_TARGET')
  commerceCheck((await input.client.core.getChainIdentifier()).chainIdentifier === manifest.genesisDigest, 'INCOME_SOURCE_GENESIS_MISMATCH')
  const pkg = await readPinnedMovePackage(input.client, manifest.target.foundation, input.signal)
  const moduleHashes = [...pkg.moduleHashes].map(([name, row]) => ({ name, sha256: row.sha256, byteLength: String(row.byteLength) })).sort((a, b) => a.name < b.name ? -1 : 1)
  const typeOrigins = [...pkg.origins].map(([name, packageId]) => ({ name, packageId })).sort((a, b) => a.name < b.name ? -1 : 1)
  const linkage = [...pkg.linkage].map(([originalPackageId, row]) => ({ originalPackageId, upgradedId: row.upgradedId, upgradedVersion: row.upgradedVersion })).sort((a, b) => a.originalPackageId < b.originalPackageId ? -1 : 1)
  commerceCheck(String(pkg.version) === manifest.packageVersion && publicMutationCanonical(moduleHashes) === publicMutationCanonical(manifest.moduleHashes)
    && publicMutationCanonical(typeOrigins) === publicMutationCanonical(manifest.typeOrigins) && publicMutationCanonical(linkage) === publicMutationCanonical(manifest.linkage), 'INCOME_SOURCE_DEPLOYED_PACKAGE_MISMATCH')
  const config = await readCommerceObject(input.client, manifest.target.configId, income.configType, input.signal)
  commerceCheck(income.config.schema === manifest.configSchema && income.config.income.root === manifest.target.configId
    && config.version === income.object.version && config.digest === income.object.digest && config.owner.Shared?.initialSharedVersion === manifest.configInitialSharedVersion, 'INCOME_SOURCE_CONFIG_IDENTITY')
  input.signal.throwIfAborted()
  return { manifestSha256: installed.manifestSha256, sourceAuditSha256: installed.sourceAuditSha256,
    packageVersion: manifest.packageVersion, configInitialSharedVersion: manifest.configInitialSharedVersion,
    installedRootSourceAndLiveDeploymentMatched: true as const, notSigningAuthority: true as const }
}
