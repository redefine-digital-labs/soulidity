import { bcs } from '@mysten/sui/bcs'
import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { normalizeStructTag, toHex } from '@mysten/sui/utils'
import { readPinnedMovePackage } from '../../sui/pinned-move-package'
import { CanonicalSoulBcs, CanonicalOwnedAccountBcs, type CanonicalNativeWorkbenchTarget } from '../canonical-native-workbench'
import { commerceCheck, commerceId, decodeCommerce, readCommerceObject } from './economics-read'
const A = bcs.Address, V = bcs.byteVector(), U = bcs.u64(), T = bcs.struct('TypeName', { name: bcs.string() })
const Origin = bcs.struct('Origin', { producer: T, source_type: T, source: A, source_version: U, source_hash: V, minted_by: A })
export const NativePaidServiceBcs = bcs.struct('SourceService', { id: A,
  authority: bcs.struct('Authority', { cap: bcs.struct('Cap', { id: A, for: A }), kiosk: A, owner: A, closed_digest: V }),
  account: A, return_witness: T, root: A, value: A, name: V, schema: bcs.u16(), origin: Origin,
  revision: U, expires: U, binding: V, busy: bcs.bool() })
export const NativePaidServiceBindingBcs = bcs.struct('PaidServiceBinding', { state: A, ledger: A, protocol: A, registry: A, generation: U })

/** Current service structural subproof, not payment/access authorization.
 * Caller supplies already verified current Soul/custody/ledger/generation and
 * must still qualify current source revision, policy and execution context.
 * Expiry is returned for the caller's FINAL Clock check, never system time.
 */
export async function readNativePaidService(input: { client: SuiGrpcClient; target: CanonicalNativeWorkbenchTarget;
  serviceId: string; soulId: string; stateId: string; ledgerId: string; generation: string;
  owner: string; kioskId: string; revision: string; signal: AbortSignal }) {
  const { client, serviceId, soulId, stateId, ledgerId, generation, owner, kioskId, revision } = input
  const target = structuredClone(input.target), signal = AbortSignal.any([input.signal, AbortSignal.timeout(30000)])
  commerceCheck(target.custody && [serviceId, soulId, stateId, ledgerId, owner, kioskId].every(commerceId), 'PAID_SERVICE_INPUT')
  const native = await readPinnedMovePackage(client, target.native, signal), standard = await readPinnedMovePackage(client, target.standard, signal)
  const custody = await readPinnedMovePackage(client, target.custody, signal)
  for (const pkg of [standard, custody]) { const link = native.linkage.get(pkg.pin.originalPackageId)
    commerceCheck(link?.upgradedId === pkg.pin.callablePackageId && link.upgradedVersion === String(pkg.version), 'PAID_SERVICE_LINK') }
  const type = (origins: Map<string, string>, module: string, name: string) => { const origin = origins.get(`${module}::${name}`)
    commerceCheck(origin, 'PAID_SERVICE_ORIGIN'); return `${origin}::${module}::${name}` }
  const serviceType = `${type(standard.origins, 'soul', 'SourceService')}<${type(native.origins, 'birth', 'NativeModule')},${type(native.origins, 'birth', 'State')}>`
  const object = await readCommerceObject(client, serviceId, serviceType, signal), s = decodeCommerce(NativePaidServiceBcs, object.contents)
  commerceCheck(object.owner.$kind === 'Shared' && s.id === serviceId && s.root === soulId && s.value === stateId
    && toHex(s.name) === '6e6174697665' && s.schema === 1 && s.revision === revision
    && s.authority.owner === owner && s.authority.kiosk === kioskId && s.authority.cap.for === kioskId
    && commerceId(s.authority.cap.id) && [0, 32].includes(s.authority.closed_digest.length)
    && normalizeStructTag(s.return_witness.name) === type(custody.origins, 'account', 'AccountServiceWitness'), 'PAID_SERVICE_BINDING')
  const binding = decodeCommerce(NativePaidServiceBindingBcs, s.binding)
  commerceCheck(binding.state === stateId && binding.ledger === ledgerId && binding.protocol === target.configId
    && binding.registry === target.registryId && binding.generation === generation, 'PAID_SERVICE_LEDGER_GENERATION')
  const rootType = type(standard.origins, 'soul', 'Soul'), rootObject = await readCommerceObject(client, soulId, rootType, signal)
  const root = decodeCommerce(CanonicalSoulBcs, rootObject.contents)
  commerceCheck(root.id === soulId && root.schema === 1 && root.revision === revision && !root.editing
    && toHex(Origin.serialize(root.origin).toBytes()) === toHex(Origin.serialize(s.origin).toBytes()), 'PAID_SERVICE_ROOT_ORIGIN')
  const accountType = type(custody.origins, 'account', 'Account'), accountObject = await readCommerceObject(client, s.account, accountType, signal)
  const account = decodeCommerce(CanonicalOwnedAccountBcs, accountObject.contents)
  commerceCheck(accountObject.owner.AddressOwner === owner && account.id === s.account && account.owner === owner
    && account.kiosk === kioskId && account.authority === null
    && new Set([serviceId, soulId, stateId, ledgerId, s.account, s.authority.cap.id, kioskId]).size === 7, 'PAID_SERVICE_ACCOUNT_AUTHORITY')
  for (const [row, rowType] of [[object, serviceType], [rootObject, rootType], [accountObject, accountType]] as const) {
    const current = await readCommerceObject(client, row.objectId, rowType, signal)
    commerceCheck(current.version === row.version && current.digest === row.digest, 'PAID_SERVICE_CHANGED')
  }
  return { proof: 'native-current-paid-service-binding-only' as const, serviceId, accountId: account.id, owner, kioskId,
    soulId, stateId, ledgerId, generation, revision, busy: s.busy, expiresAtMs: s.expires,
    observed: { objectId: serviceId, version: object.version, digest: object.digest },
    requiresVerifiedSoulCustodyAndLedger: true as const, requiresFinalChainClock: true as const,
    requiresCurrentSourceAndPolicyQualification: true as const, notAuthorization: true as const }
}
