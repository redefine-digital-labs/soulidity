import { captureMakerProductIncomeClient } from './maker-product-income-client'
import { sha256 } from '@noble/hashes/sha2.js'
import { normalizeStructTag, toHex } from '@mysten/sui/utils'
import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { MAINNET_GENESIS_DIGEST } from '../../animacraft/mainnet-chain'
import { validateCurrentMakerPackage } from '../../animacraft/current-maker-transactions'
import { readPinnedMovePackage } from '../../sui/pinned-move-package'
import { publicMutationCanonical } from '../../sui/public-mutation-journal'
import { commerceCheck, commerceId, readCommerceObject } from './economics-read'
import type { MakerProductIncomeTarget, readMakerProductIncome } from './maker-product-income-read'

type Deployment = Omit<MakerProductIncomeTarget, 'productId'>
type PackageSnapshot = { version: string; moduleHashes: Array<{ name: string; sha256: string; byteLength: string }>; typeOrigins: Array<{ name: string; packageId: string }>; linkage: Array<{ originalPackageId: string; upgradedId: string; upgradedVersion: string }> }
type SourceSnapshot = { commitSha: string; treeSha256: string; buildSha256: string; dependencyLockSha256: string }
export interface MakerProductIncomeManifest {
  schema: 'soulidity.maker-product-income-source.v1'; genesisDigest: string; deployment: Deployment
  packages: { manufacturing: PackageSnapshot; foundation: PackageSnapshot }
  sources: { manufacturing: SourceSnapshot; foundation: SourceSnapshot }; sourceAuditSha256: string
}
export interface RootMakerProductIncomeInstallation { manifestText: string; acceptedManifestSha256: string; acceptedSourceAuditSha256: string }
const MAX = 18446744073709551615n
const roles = ['manufacturing', 'foundation'] as const
function object(input: unknown, keys: string[]) {
  commerceCheck(input && typeof input === 'object' && !Array.isArray(input) && Object.keys(input).sort().join() === keys.slice().sort().join(), 'MAKER_SOURCE_FIELDS')
  return input as Record<string, any>
}
function hash(value: unknown): asserts value is string { commerceCheck(typeof value === 'string' && /^[0-9a-f]{64}$/.test(value), 'MAKER_SOURCE_HASH') }
function uint(value: unknown, positive = false): asserts value is string { commerceCheck(typeof value === 'string' && /^(0|[1-9][0-9]{0,19})$/.test(value) && BigInt(value) <= MAX && (!positive || BigInt(value) > 0n), 'MAKER_SOURCE_U64') }
const ordered = (values: string[]) => values.every((value, i) => i === 0 || values[i - 1] < value)
const identifier = '(?:[A-Za-z][A-Za-z0-9_]*|_[A-Za-z0-9_]+)'
function deployment(input: unknown): Deployment {
  const d = object(input, ['chainIdentifier', 'protocolId', 'coinType', 'manufacturing', 'foundation'])
  commerceCheck(d.chainIdentifier === '35834a8a' && commerceId(d.protocolId) && typeof d.coinType === 'string' && d.coinType.length <= 2048 && normalizeStructTag(d.coinType) === d.coinType, 'MAKER_SOURCE_DEPLOYMENT')
  const pins = Object.fromEntries(roles.map(role => { const value = object(d[role], ['originalPackageId', 'callablePackageId', 'callableDigest']); return [role, validateCurrentMakerPackage(value as any)] })) as Pick<Deployment, 'manufacturing' | 'foundation'>
  commerceCheck(pins.manufacturing.originalPackageId !== pins.foundation.originalPackageId && pins.manufacturing.callablePackageId !== pins.foundation.callablePackageId, 'MAKER_SOURCE_ROLE_ALIAS')
  return { chainIdentifier: d.chainIdentifier, protocolId: d.protocolId, coinType: d.coinType, ...pins }
}
function packageSnapshot(input: unknown, role: typeof roles[number]): PackageSnapshot {
  const p = object(input, ['version', 'moduleHashes', 'typeOrigins', 'linkage']); uint(p.version, true)
  commerceCheck(Array.isArray(p.moduleHashes) && p.moduleHashes.length > 0 && p.moduleHashes.length <= 512 && Array.isArray(p.typeOrigins) && p.typeOrigins.length > 0 && p.typeOrigins.length <= 4096 && Array.isArray(p.linkage) && p.linkage.length <= 1024, 'MAKER_SOURCE_TABLE_BOUNDS')
  const moduleHashes = p.moduleHashes.map((entry: unknown) => {
    const row = object(entry, ['name', 'sha256', 'byteLength']); hash(row.sha256); uint(row.byteLength, true)
    commerceCheck(typeof row.name === 'string' && row.name.length <= 128 && new RegExp(`^${identifier}$`).test(row.name) && BigInt(row.byteLength) <= 4194304n, 'MAKER_SOURCE_MODULE')
    return { name: row.name as string, sha256: row.sha256, byteLength: row.byteLength }
  })
  const typeOrigins = p.typeOrigins.map((entry: unknown) => {
    const row = object(entry, ['name', 'packageId'])
    commerceCheck(typeof row.name === 'string' && row.name.length <= 258 && new RegExp(`^${identifier}::${identifier}$`).test(row.name) && commerceId(row.packageId), 'MAKER_SOURCE_ORIGIN')
    return { name: row.name as string, packageId: row.packageId as string }
  })
  const linkage = p.linkage.map((entry: unknown) => {
    const row = object(entry, ['originalPackageId', 'upgradedId', 'upgradedVersion']); uint(row.upgradedVersion)
    commerceCheck(commerceId(row.originalPackageId) && commerceId(row.upgradedId), 'MAKER_SOURCE_LINK')
    return { originalPackageId: row.originalPackageId as string, upgradedId: row.upgradedId as string, upgradedVersion: row.upgradedVersion }
  })
  const required = role === 'manufacturing' ? ['maker_catalog::Product', 'maker_catalog::Control'] : ['revenue::Request', 'revenue::Receipt', 'revenue::Withdrawn']
  commerceCheck(ordered(moduleHashes.map((r: { name: string }) => r.name)) && ordered(typeOrigins.map((r: { name: string }) => r.name)) && ordered(linkage.map((r: { originalPackageId: string }) => r.originalPackageId))
    && required.every(name => typeOrigins.some((r: { name: string }) => r.name === name)) && moduleHashes.some((r: { name: string }) => r.name === (role === 'manufacturing' ? 'maker_catalog' : 'revenue')), 'MAKER_SOURCE_TABLE_SET')
  return { version: p.version, moduleHashes, typeOrigins, linkage }
}
/** Public manifest parsing never installs qualification. Exact reconstruction
 * rejects duplicate keys, unknown fields, whitespace and alternate encodings.
 */
export function parseMakerProductIncomeManifest(text: string): MakerProductIncomeManifest {
  commerceCheck(typeof text === 'string' && text.length > 0 && new TextEncoder().encode(text).byteLength <= 360000, 'MAKER_SOURCE_MANIFEST_BOUND')
  const r = object(JSON.parse(text), ['schema', 'genesisDigest', 'deployment', 'packages', 'sources', 'sourceAuditSha256'])
  commerceCheck(r.schema === 'soulidity.maker-product-income-source.v1' && r.genesisDigest === MAINNET_GENESIS_DIGEST, 'MAKER_SOURCE_SCHEMA'); hash(r.sourceAuditSha256)
  const target = deployment(r.deployment), p = object(r.packages, [...roles]), s = object(r.sources, [...roles])
  const packages = Object.fromEntries(roles.map(role => [role, packageSnapshot(p[role], role)])) as MakerProductIncomeManifest['packages']
  const sources = Object.fromEntries(roles.map(role => {
    const row = object(s[role], ['commitSha', 'treeSha256', 'buildSha256', 'dependencyLockSha256'])
    commerceCheck(typeof row.commitSha === 'string' && /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(row.commitSha), 'MAKER_SOURCE_COMMIT')
    hash(row.treeSha256); hash(row.buildSha256); hash(row.dependencyLockSha256)
    return [role, { commitSha: row.commitSha, treeSha256: row.treeSha256, buildSha256: row.buildSha256, dependencyLockSha256: row.dependencyLockSha256 }]
  })) as MakerProductIncomeManifest['sources']
  const link = packages.manufacturing.linkage.find(row => row.originalPackageId === target.foundation.originalPackageId)
  commerceCheck(link?.upgradedId === target.foundation.callablePackageId && link.upgradedVersion === packages.foundation.version, 'MAKER_SOURCE_DEPENDENCY')
  const result: MakerProductIncomeManifest = { schema: r.schema, genesisDigest: r.genesisDigest, deployment: target, packages, sources, sourceAuditSha256: r.sourceAuditSha256 }
  commerceCheck(publicMutationCanonical(result) === text, 'MAKER_SOURCE_NONCANONICAL'); return result
}
export const makerProductIncomeManifestHash = (text: string) => toHex(sha256(new TextEncoder().encode(text)))
export function parseRootMakerProductIncomeInstallation(input: RootMakerProductIncomeInstallation) {
  const accepted = structuredClone(input); hash(accepted.acceptedManifestSha256); hash(accepted.acceptedSourceAuditSha256)
  const manifest = parseMakerProductIncomeManifest(accepted.manifestText)
  commerceCheck(makerProductIncomeManifestHash(accepted.manifestText) === accepted.acceptedManifestSha256 && manifest.sourceAuditSha256 === accepted.acceptedSourceAuditSha256, 'MAKER_SOURCE_ROOT_ANCHOR')
  return { manifest, manifestText: accepted.manifestText, manifestSha256: accepted.acceptedManifestSha256, sourceAuditSha256: accepted.acceptedSourceAuditSha256 }
}
export async function verifyInstalledMakerProductIncomeSource(input: { installed: ReturnType<typeof parseRootMakerProductIncomeInstallation>; income: Awaited<ReturnType<typeof readMakerProductIncome>>; client: SuiGrpcClient; signal: AbortSignal }) {
  const source = input.client, signal = input.signal
  const client = captureMakerProductIncomeClient(source)
  const income = structuredClone(input.income), installed = parseRootMakerProductIncomeInstallation({ manifestText: input.installed.manifestText, acceptedManifestSha256: input.installed.manifestSha256, acceptedSourceAuditSha256: input.installed.sourceAuditSha256 })
  const { productId, ...selected } = income.target
  commerceCheck(publicMutationCanonical(installed.manifest) === publicMutationCanonical(input.installed.manifest) && publicMutationCanonical(selected) === publicMutationCanonical(installed.manifest.deployment), 'MAKER_SOURCE_SELECTED_DEPLOYMENT')
  commerceCheck((await client.core.getChainIdentifier()).chainIdentifier === installed.manifest.genesisDigest, 'MAKER_SOURCE_CHAIN')
  for (const role of roles) {
    signal.throwIfAborted(); const pkg = await readPinnedMovePackage(client, selected[role], signal)
    const actual: PackageSnapshot = { version: String(pkg.version), moduleHashes: [...pkg.moduleHashes].map(([name, row]) => ({ name, sha256: row.sha256, byteLength: String(row.byteLength) })).sort((a, b) => a.name < b.name ? -1 : 1),
      typeOrigins: [...pkg.origins].map(([name, packageId]) => ({ name, packageId })).sort((a, b) => a.name < b.name ? -1 : 1),
      linkage: [...pkg.linkage].map(([originalPackageId, row]) => ({ originalPackageId, upgradedId: row.upgradedId, upgradedVersion: row.upgradedVersion })).sort((a, b) => a.originalPackageId < b.originalPackageId ? -1 : 1) }
    commerceCheck(publicMutationCanonical(actual) === publicMutationCanonical(installed.manifest.packages[role]), 'MAKER_SOURCE_LIVE_PACKAGE')
  }
  const current = await readCommerceObject(client, productId, income.productType, signal)
  commerceCheck(current.version === income.object.version && current.digest === income.object.digest && current.owner.Shared?.initialSharedVersion === income.initialSharedVersion && income.product.protocol === selected.protocolId && income.product.income.root === productId, 'MAKER_SOURCE_LIVE_PRODUCT')
  signal.throwIfAborted()
  return { manifestSha256: installed.manifestSha256, sourceAuditSha256: installed.sourceAuditSha256, deploymentMatched: true as const, notControlAuthority: true as const, notSigningQualification: true as const }
}
