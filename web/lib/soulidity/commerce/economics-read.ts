import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { MAINNET_GENESIS_DIGEST } from '../../animacraft/mainnet-chain'
import { normalizeStructTag, toBase64 } from '@mysten/sui/utils'
import { profileReadStep } from '@soulidity/sdk'
import { collectionCommandRaw } from '../../collections/collection-command-plan'
import { historicalMoveObjectType } from '../../sui/historical-object'
import { readPinnedMovePackage, type PinnedMovePackage } from '../../sui/pinned-move-package'
import { EconomicsConfigBcs, EconomicsAdminBcs } from './economics-bcs'

export interface EconomicsTarget { chainIdentifier: string; foundation: PinnedMovePackage; configId: string; coinType: string }
export function commerceCheck(v: unknown, code: string): asserts v { if (!v) throw Error(`COMMERCE_${code}`) }
export const commerceId = (v: string) => typeof v === 'string' && /^0x[0-9a-f]{64}$/.test(v) && !/^0x0+$/.test(v)

/** Canonical full-object bytes/digest, not unverified JSON field projections. */
export async function readCommerceObject(client: SuiGrpcClient, objectId: string, type: string, signal: AbortSignal) {
  commerceCheck(commerceId(objectId), 'OBJECT_ID')
  const { response } = await profileReadStep(signal, () => client.ledgerService.getObject({ objectId,
    readMask: { paths: ['object_id', 'version', 'digest', 'bcs'] } }, { abort: signal }))
  const row = structuredClone(response.object)
  commerceCheck(row?.objectId === objectId && row.version && row.digest && row.bcs?.value instanceof Uint8Array
    && row.bcs.value.length <= 256 * 1024, 'OBJECT_UNAVAILABLE')
  const raw = collectionCommandRaw({ objectId, version: String(row.version), digest: row.digest, bcs: toBase64(row.bcs.value) })
  const move = raw.data.Move
  commerceCheck(move && historicalMoveObjectType(move.type) === normalizeStructTag(type), 'OBJECT_TYPE')
  return { objectId, version: String(row.version), digest: row.digest, owner: raw.owner, contents: move.contents, previousTransaction: raw.previousTransaction }
}

export function decodeCommerce<C extends { parse(bytes: Uint8Array): any; serialize(value: any): { toBytes(): Uint8Array } }>(codec: C, bytes: Uint8Array): ReturnType<C['parse']> {
  const row = codec.parse(bytes)
  commerceCheck(toBase64(codec.serialize(row).toBytes()) === toBase64(bytes), 'NONCANONICAL_CONTENTS')
  return row
}

/** Read-only revenue and fee snapshot. Author/seller royalties are paid directly
 * by native_sale_settle, so this ledger is protocol income, not their wallet.
 * Pause/enabled flags remain visible and never hide legitimate exit balances.
 */
export async function readEconomicsIncome(input: { client: SuiGrpcClient; target: EconomicsTarget; signal: AbortSignal;
  admin?: { objectId: string; actor: string } }) {
  const target = structuredClone(input.target), admin = input.admin && structuredClone(input.admin)
  const signal = AbortSignal.any([input.signal, AbortSignal.timeout(30000)]), source = input.client
  const client = { core: { getChainIdentifier: source.core.getChainIdentifier.bind(source.core) },
    ledgerService: { getObject: source.ledgerService.getObject.bind(source.ledgerService) } } as unknown as SuiGrpcClient
  commerceCheck(target.chainIdentifier === '35834a8a' && commerceId(target.configId), 'TARGET')
  const chain = await profileReadStep(signal, () => client.core.getChainIdentifier())
  commerceCheck(chain.chainIdentifier === MAINNET_GENESIS_DIGEST, 'CHAIN')
  const pkg = await readPinnedMovePackage(client, target.foundation, signal), origins = pkg.origins
  const origin = origins.get('economics::Config')
  commerceCheck(origin, 'CONFIG_ORIGIN')
  const coinType = normalizeStructTag(target.coinType)
  const configType = `${origin}::economics::Config<${coinType}>`
  const object = await readCommerceObject(client, target.configId, configType, signal)
  commerceCheck(object.owner.$kind === 'Shared', 'CONFIG_OWNER')
  const config = decodeCommerce(EconomicsConfigBcs, object.contents)
  commerceCheck(config.id === target.configId && config.income.root === config.id && config.schema === 3
    && config.original_package === target.foundation.originalPackageId && config.callable_package === target.foundation.callablePackageId
    && normalizeStructTag(config.payment_coin.name) === coinType && config.roles.roles.length === 6
    && config.primary_bps <= 10000 && config.secondary_bps <= 10000 && config.commitment.length === 32
    && BigInt(config.income.collected) - BigInt(config.income.withdrawn) === BigInt(config.income.funds), 'CONFIG_BINDING')
  let authority: { objectId: string; actor: string; version: string; digest: string } | null = null
  if (admin) {
    commerceCheck(commerceId(admin.actor), 'ADMIN_ACTOR')
    const adminOrigin = origins.get('economics::Admin'); commerceCheck(adminOrigin, 'ADMIN_ORIGIN')
    const cap = await readCommerceObject(client, admin.objectId, `${adminOrigin}::economics::Admin`, signal)
    const value = decodeCommerce(EconomicsAdminBcs, cap.contents)
    commerceCheck(value.id === cap.objectId && value.config === config.id && cap.owner.AddressOwner === admin.actor, 'ADMIN_AUTHORITY')
    authority = { ...admin, version: cap.version, digest: cap.digest }
  }
  // Detect a Config mutation while optional Admin evidence was fetched.
  const current = await readCommerceObject(client, object.objectId, `${origin}::economics::Config<${coinType}>`, signal)
  commerceCheck(current.version === object.version && current.digest === object.digest, 'CONFIG_CHANGED')
  return { target, config, configType, initialSharedVersion: object.owner.Shared!.initialSharedVersion, foundationVersion: String(pkg.version), object: { objectId: object.objectId, version: object.version, digest: object.digest },
    authority, coinType, ledger: { revision: config.income.revision, balance: config.income.funds,
      collected: config.income.collected, withdrawn: config.income.withdrawn, requestsTableId: config.income.requests.id },
    notAuthorization: true as const }
}
