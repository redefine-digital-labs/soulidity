import { bcs } from '@mysten/sui/bcs'
import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { fromBase58, toBase58, toHex } from '@mysten/sui/utils'
import { sha256 } from '@noble/hashes/sha2.js'
import { MAINNET_GENESIS_DIGEST } from '../../animacraft/mainnet-chain'
import { readPinnedMovePackage, type PinnedMovePackage } from '../../sui/pinned-move-package'
import { publicMutationCanonical } from '../../sui/public-mutation-journal'
import { parseEquipmentManagementRecord, type EquipmentManagementRecord } from './equipment-record'
import { captureAccountOriginalReadClientV155 } from './account-original-readers-v155'
function check(value: unknown, code: string): asserts value { if (!value) throw Error(`MANAGEMENT_ORIGINAL_SOURCE_V154_${code}`) }
const MAX = (1n << 64n) - 1n
const hash = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value) && !/^0+$/.test(value)
function object(value: unknown, fields: string[]): Record<string, any> {
  check(value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).sort().join() === [...fields].sort().join(), 'FIELDS')
  return value as Record<string, any>
}
function id(value: unknown): asserts value is string { check(typeof value === 'string' && /^0x[0-9a-f]{64}$/.test(value) && BigInt(value) > 0n, 'ID') }
function uint(value: unknown, positive = false): asserts value is string { check(typeof value === 'string' && /^(0|[1-9][0-9]{0,19})$/.test(value) && BigInt(value) <= MAX && (!positive || BigInt(value) > 0n), 'U64') }
function pin(value: unknown): PinnedMovePackage {
  const p = object(value, ['originalPackageId', 'callablePackageId', 'callableDigest']); id(p.originalPackageId); id(p.callablePackageId)
  check(typeof p.callableDigest === 'string' && p.callableDigest.length <= 44 && fromBase58(p.callableDigest).length === 32 && toBase58(fromBase58(p.callableDigest)) === p.callableDigest, 'PACKAGE_DIGEST')
  return { originalPackageId: p.originalPackageId, callablePackageId: p.callablePackageId, callableDigest: p.callableDigest }
}
const sorted = (keys: string[]) => keys.every((key, index) => index === 0 || keys[index - 1] < key)
const same = (a: unknown, b: unknown) => publicMutationCanonical(a) === publicMutationCanonical(b)
const REQUIRED_INVARIANTS = ['account-original-pair', 'complete-application-commitment', 'equipment-exit-semantics', 'historical-version-parent-commit-coverage', 'native-kiosk-listing', 'owned-child-parent-commit', 'permanent-source-inventory', 'standard-module-parent-commit', 'standard-module-version', 'sui-effects-v2', 'three-source-rights'] as const
export interface ManagementOriginalSourceManifestV154 {
  schema: 'soulidity.management-original-source.v1'; genesisDigest: string; recordSchema: 'soulidity.equipment-account-mutation.v1'
  actions: Array<'ATTACH' | 'REMOVE' | 'REPLACE'>; checkpoints: { first: string; last: string }
  target: { application: PinnedMovePackage; model: PinnedMovePackage }
  packages: Array<{ role: string; pin: PinnedMovePackage; version: string; moduleHashes: Array<{ name: string; sha256: string; byteLength: string }>;
    typeOrigins: Array<{ name: string; packageId: string }>; linkage: Array<{ originalPackageId: string; upgradedId: string; upgradedVersion: string }> }>
  invariants: string[]; zeroLinkageVersion: 'ROOT_AUDITED_WITHIN_CHECKPOINT_RANGE'; rendererQualification: 'NOT_INCLUDED'
  source: { commitSha: string; treeSha256: string; buildSha256: string; dependencyLockSha256: string; toolchainSha256: string; sourceAuditSha256: string; independentAcceptanceSha256: string }
}
/** Public exact canonical evidence parser. A parsed manifest is neither a Root
 * installation nor an authorization. Hash-shaped external data is insufficient
 * until the actual compiled registry accepts the independent audit identity. */
export function parseManagementOriginalSourceManifestV154(text: string): ManagementOriginalSourceManifestV154 {
  check(typeof text === 'string' && text.length > 0 && new TextEncoder().encode(text).length <= 512 * 1024, 'MANIFEST_BOUND')
  const x = object(JSON.parse(text), ['schema', 'genesisDigest', 'recordSchema', 'actions', 'checkpoints', 'target', 'packages', 'invariants', 'zeroLinkageVersion', 'rendererQualification', 'source'])
  check(x.schema === 'soulidity.management-original-source.v1' && x.genesisDigest === MAINNET_GENESIS_DIGEST && x.recordSchema === 'soulidity.equipment-account-mutation.v1', 'SCHEMA')
  check(Array.isArray(x.actions) && x.actions.length > 0 && x.actions.every((v: unknown) => ['ATTACH', 'REMOVE', 'REPLACE'].includes(v as string)) && sorted(x.actions), 'ACTIONS')
  const checkpoints = object(x.checkpoints, ['first', 'last']); uint(checkpoints.first); uint(checkpoints.last); check(BigInt(checkpoints.first) <= BigInt(checkpoints.last), 'CHECKPOINT_RANGE')
  const target = object(x.target, ['application', 'model']), application = pin(target.application), model = pin(target.model)
  check(Array.isArray(x.packages) && x.packages.length >= 7 && x.packages.length <= 128, 'PACKAGES')
  const packages: ManagementOriginalSourceManifestV154['packages'] = x.packages.map((value: unknown) => {
    const p = object(value, ['role', 'pin', 'version', 'moduleHashes', 'typeOrigins', 'linkage']), reference = pin(p.pin); uint(p.version, true)
    check(typeof p.role === 'string' && /^[a-z][a-z0-9-]{0,63}$/.test(p.role), 'ROLE')
    check(Array.isArray(p.moduleHashes) && p.moduleHashes.length > 0 && p.moduleHashes.length <= 512, 'MODULES')
    const moduleHashes = p.moduleHashes.map((v: unknown) => {
      const m = object(v, ['name', 'sha256', 'byteLength']); check(typeof m.name === 'string' && /^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(m.name) && hash(m.sha256), 'MODULE')
      uint(m.byteLength, true); check(BigInt(m.byteLength) <= 4194304n, 'MODULE_BYTES'); return { name: m.name as string, sha256: m.sha256 as string, byteLength: m.byteLength }
    })
    check(sorted(moduleHashes.map((v: { name: string }) => v.name)), 'MODULE_ORDER')
    check(Array.isArray(p.typeOrigins) && p.typeOrigins.length <= 4096, 'ORIGINS')
    const typeOrigins = p.typeOrigins.map((v: unknown) => {
      const t = object(v, ['name', 'packageId']); check(typeof t.name === 'string' && /^[A-Za-z_][A-Za-z0-9_]{0,127}::[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(t.name), 'TYPE_NAME'); id(t.packageId)
      check(moduleHashes.some((m: { name: string }) => t.name.startsWith(m.name + '::')), 'TYPE_MODULE'); return { name: t.name as string, packageId: t.packageId }
    })
    check(sorted(typeOrigins.map((v: { name: string }) => v.name)), 'ORIGIN_ORDER')
    check(Array.isArray(p.linkage) && p.linkage.length <= 1024, 'LINKAGE')
    const linkage = p.linkage.map((v: unknown) => {
      const l = object(v, ['originalPackageId', 'upgradedId', 'upgradedVersion']); id(l.originalPackageId); id(l.upgradedId); uint(l.upgradedVersion)
      return { originalPackageId: l.originalPackageId, upgradedId: l.upgradedId, upgradedVersion: l.upgradedVersion }
    })
    check(sorted(linkage.map((v: { originalPackageId: string }) => v.originalPackageId)), 'LINKAGE_ORDER')
    return { role: p.role, pin: reference, version: p.version, moduleHashes, typeOrigins, linkage }
  })
  check(sorted(packages.map(p => p.role)), 'PACKAGE_ORDER_OR_ALIAS')
  // Historical versions of one owning package are explicit separate rows.
  // Multiple roles may share a package only with identical complete evidence.
  for (const p of packages) for (const q of packages) if (p !== q && p.pin.callablePackageId === q.pin.callablePackageId) check(same({ ...p, role: '' }, { ...q, role: '' }), 'PACKAGE_ALIAS_MISMATCH')
  for (const role of ['application', 'content', 'custody', 'foundation', 'model', 'standard', 'visual']) check(packages.some(p => p.role === role), 'REQUIRED_DEPENDENCY')
  check(same(packages.find(p => p.role === 'application')!.pin, application) && same(packages.find(p => p.role === 'model')!.pin, model), 'TARGET_PACKAGES')
  for (const p of packages) for (const link of p.linkage) {
    const dependency = packages.find(q => q.pin.originalPackageId === link.originalPackageId && q.pin.callablePackageId === link.upgradedId && (link.upgradedVersion === '0' || q.version === link.upgradedVersion))
    check(dependency && dependency.pin.callablePackageId === link.upgradedId && (link.upgradedVersion === '0' || dependency.version === link.upgradedVersion), 'DEPENDENCY_CLOSURE')
  }
  check(same(x.invariants, REQUIRED_INVARIANTS) && x.zeroLinkageVersion === 'ROOT_AUDITED_WITHIN_CHECKPOINT_RANGE' && x.rendererQualification === 'NOT_INCLUDED', 'AUDIT_SCOPE')
  const s = object(x.source, ['commitSha', 'treeSha256', 'buildSha256', 'dependencyLockSha256', 'toolchainSha256', 'sourceAuditSha256', 'independentAcceptanceSha256'])
  check(typeof s.commitSha === 'string' && /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(s.commitSha) && Object.entries(s).every(([key, value]) => key === 'commitSha' || hash(value)), 'SOURCE_IDENTITIES')
  const result: ManagementOriginalSourceManifestV154 = { schema: x.schema, genesisDigest: x.genesisDigest, recordSchema: x.recordSchema, actions: [...x.actions],
    checkpoints: { first: checkpoints.first, last: checkpoints.last }, target: { application, model }, packages, invariants: [...REQUIRED_INVARIANTS],
    zeroLinkageVersion: x.zeroLinkageVersion, rendererQualification: x.rendererQualification, source: { commitSha: s.commitSha, treeSha256: s.treeSha256, buildSha256: s.buildSha256,
      dependencyLockSha256: s.dependencyLockSha256, toolchainSha256: s.toolchainSha256, sourceAuditSha256: s.sourceAuditSha256, independentAcceptanceSha256: s.independentAcceptanceSha256 } }
  check(publicMutationCanonical(result) === text, 'NONCANONICAL'); return result
}
export const managementOriginalSourceManifestHashV154 = (text: string) => toHex(sha256(new TextEncoder().encode(text)))
export interface ManagementOriginalSourceInstallationV154 { manifestText: string; acceptedManifestSha256: string; acceptedSourceAuditSha256: string }
/** An explicitly trusted client registry. First-party acceptance is supplied
 * exclusively by its separate compiled consumer; no browser install API exists.
 * Entries/anchors are parsed and privately captured synchronously, before I/O. */
export function createManagementOriginalSourceRegistryV154(inputs: readonly ManagementOriginalSourceInstallationV154[]) {
  check(inputs.length <= 128, 'REGISTRY_BOUND')
  const installed = structuredClone(inputs).map(entry => {
    object(entry, ['manifestText', 'acceptedManifestSha256', 'acceptedSourceAuditSha256'])
    check(hash(entry.acceptedManifestSha256) && hash(entry.acceptedSourceAuditSha256), 'ACCEPTED_ANCHORS')
    const manifest = parseManagementOriginalSourceManifestV154(entry.manifestText)
    check(managementOriginalSourceManifestHashV154(entry.manifestText) === entry.acceptedManifestSha256 && manifest.source.sourceAuditSha256 === entry.acceptedSourceAuditSha256, 'ACCEPTANCE_MISMATCH')
    return { manifest, manifestSha256: entry.acceptedManifestSha256, sourceAuditSha256: entry.acceptedSourceAuditSha256 }
  })
  check(new Set(installed.map(row => row.manifestSha256)).size === installed.length, 'REGISTRY_DUPLICATE')
  return Object.freeze({ async match(input: { client: SuiGrpcClient; record: EquipmentManagementRecord; checkpoint: string; signal: AbortSignal }) {
    const record = parseEquipmentManagementRecord(input.record), checkpoint = input.checkpoint, signal = input.signal
    const client = captureAccountOriginalReadClientV155(input.client, signal); uint(checkpoint)
    const selected = installed.filter(({ manifest: m }) => m.recordSchema === record.schema && m.actions.includes(record.plan.action.kind)
      && same(m.target, { application: record.plan.target.application, model: record.plan.target.model })
      && BigInt(checkpoint) >= BigInt(m.checkpoints.first) && BigInt(checkpoint) <= BigInt(m.checkpoints.last))
    if (!selected.length) return null
    check(selected.length === 1, 'AMBIGUOUS_SOURCE')
    const entry = selected[0], m = entry.manifest
    check((await client.ledgerService.getServiceInfo({}, { abort: signal })).response.chainId === m.genesisDigest, 'GENESIS')
    const actual = new Map<string, Awaited<ReturnType<typeof readPinnedMovePackage>>>()
    for (const p of m.packages) {
      // Versioned raw package read also covers historical system package bytes.
      // Root's accepted checkpoint range attests actual VM dependency selection;
      // its audit MUST cover every owning historical version and parent-commit
      // invariant used in that range, not only today's/current target code. An
      // arbitrary package snapshot alone cannot establish that selection.
      const facade = Object.freeze({ ledgerService: Object.freeze({ getObject: async (request: any, options: any) => {
        const version = BigInt(p.version)
        check(request.objectId === p.pin.callablePackageId && (request.version === undefined || request.version === version), 'PACKAGE_ORIGINAL_VERSION')
        // package.* would trigger withPackageObjectIdentity's unversioned
        // package-service enrichment. Read only the accepted original raw Object;
        // preserve and authenticate any redundant projection actually supplied.
        const result = await client.ledgerService.getObject({ ...request, version,
          readMask: { paths: ['object_id', 'version', 'digest', 'owner', 'bcs'] } }, options)
        const row = result.response.object, projection = row?.package
        if (projection) {
          const bytes = row.bcs?.value
          check(bytes instanceof Uint8Array && bytes.length > 0 && bytes.length <= 4194304, 'PACKAGE_PROJECTION_BCS')
          const raw = bcs.Object.parse(bytes).data.Package
          check(raw, 'PACKAGE_PROJECTION_BCS')
          check((projection.storageId === undefined || projection.storageId === raw.id)
            && (projection.originalId === undefined || projection.originalId === p.pin.originalPackageId)
            && (projection.version === undefined || projection.version === BigInt(raw.version)), 'PACKAGE_PROJECTION_IDENTITY')
          const modules = projection.modules ?? [], origins = projection.typeOrigins ?? [], links = projection.linkage ?? []
          check(Array.isArray(modules) && modules.length <= 512 && Array.isArray(origins) && origins.length <= 4096
            && Array.isArray(links) && links.length <= 1024, 'PACKAGE_PROJECTION_BOUND')
          check(new Set(modules.map(m => m.name)).size === modules.length && modules.every(m => {
            if (!m.name) return false
            const contents = raw.moduleMap.get(m.name)
            return contents && (m.contents === undefined || m.contents instanceof Uint8Array && m.contents.length === contents.length
              && m.contents.every((byte, index) => byte === contents[index]))
          }), 'PACKAGE_PROJECTION_MODULE')
          const rawOrigins = new Map(raw.typeOriginTable.map(o => [o.moduleName + '::' + o.datatypeName, o.package]))
          check(new Set(origins.map(o => o.moduleName + '::' + o.datatypeName)).size === origins.length
            && origins.every(o => typeof o.moduleName === 'string' && typeof o.datatypeName === 'string'
              && rawOrigins.has(o.moduleName + '::' + o.datatypeName)
              && rawOrigins.get(o.moduleName + '::' + o.datatypeName) === o.packageId), 'PACKAGE_PROJECTION_ORIGIN')
          check(new Set(links.map(l => l.originalId)).size === links.length && links.every(l => {
            const rawLink = l.originalId && raw.linkageTable.get(l.originalId)
            return rawLink && rawLink.upgradedId === l.upgradedId && BigInt(rawLink.upgradedVersion) === l.upgradedVersion
          }), 'PACKAGE_PROJECTION_LINKAGE')
        }
        return result
      } }) }) as unknown as SuiGrpcClient
      const pkg = await readPinnedMovePackage(facade, p.pin, signal)
      const modules = [...pkg.moduleHashes].map(([name, value]) => ({ name, sha256: value.sha256, byteLength: String(value.byteLength) })).sort((a, b) => a.name < b.name ? -1 : 1)
      const origins = [...pkg.origins].map(([name, packageId]) => ({ name, packageId })).sort((a, b) => a.name < b.name ? -1 : 1)
      const linkage = [...pkg.linkage].map(([originalPackageId, value]) => ({ originalPackageId, ...value })).sort((a, b) => a.originalPackageId < b.originalPackageId ? -1 : 1)
      check(String(pkg.version) === p.version && same(modules, p.moduleHashes) && same(origins, p.typeOrigins) && same(linkage, p.linkage), 'ORIGINAL_PACKAGE_MISMATCH')
      actual.set(p.role, pkg)
    }
    function origin(role: string, names: string[]) {
      const origins = names.map(name => actual.get(role)!.origins.get(name)); check(origins.every(Boolean) && new Set(origins).size === 1, 'SUPPORTED_TYPE_FAMILY'); return origins[0]!
    }
    const appOrigin = origin('application', ['character::ApplicationState', 'character::ApplicationWitness', 'character::Composition', 'character::CompositionKey', 'character::BoundParts', 'character::BoundPartsKey', 'character::RootVisual', 'character::RootVisualKey', 'character::ActiveVariants', 'character::ActiveVariantsKey', 'character::Core', 'character::CoreKey', 'character::AuthorizationKey', 'character::Content', 'character::ContentKey', 'character::PaidAccessKey', 'character::LoadoutKey', 'character::OutputKey', 'character::StateConfigurationKey', 'character::ItemKey', 'character::ContentOperator', 'character::Changed', 'output::Artifact'])
    check(appOrigin === record.plan.target.application.originalPackageId && origin('model', ['assembly::Scope', 'assembly::PartKey', 'assembly::Profile', 'assembly::Variant', 'policy::Source', 'components::Item']) === record.plan.target.model.originalPackageId, 'PLAN_TYPE_FAMILY')
    const context = { standardTypeOrigin: origin('standard', ['soul::Soul', 'soul::Changed', 'soul::ModuleVersionKey', 'soul::ModuleVersion']),
      custodyTypeOrigin: origin('custody', ['account::Account']), contentTypeOrigin: origin('content', ['authorization::Authorization', 'paid_access::Ledger', 'loadout::Library', 'state_configuration::Configuration']),
      visualTypeOrigin: origin('visual', ['visual::ColorChoice']), standardPackage: structuredClone(m.packages.find(p => p.role === 'standard')!.pin) }
    signal.throwIfAborted()
    return { manifestSha256: entry.manifestSha256, sourceAuditSha256: entry.sourceAuditSha256, independentAcceptanceSha256: m.source.independentAcceptanceSha256,
      qualifiedCheckpointRange: structuredClone(m.checkpoints), packages: structuredClone(m.packages.map(p => ({ role: p.role, pin: p.pin, version: p.version }))), context,
      rendererQualification: 'NOT_INCLUDED' as const, formsQualification: 'NOT_INCLUDED' as const, notMutationAuthority: true as const }
  } })
}
