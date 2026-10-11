import { bcs } from '@mysten/sui/bcs'
import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { deriveDynamicFieldID, normalizeStructTag, toBase64 } from '@mysten/sui/utils'
import { profileReadStep, readSoulDetailState, readSoulPublicSnapshotBySoulId, SoulDetailStateBcs,
  SoulStatePublicBcs, SoulPublicMarketConfigBcs } from '@soulidity/sdk'
import { createBrowserNativeReadSession } from '../animacraft/browser-native-artwork'
import { SOUL_ACCESS_CLOCK, SOUL_ACCESS_MAX, SoulAccessCoinBcs, parseSoulAccessDeployment,
  soulAccessAddress as id, soulAccessCheck as check, soulAccessDigest as digest, soulAccessUint as uint,
  soulAccessDecode as decode, soulAccessFreeze as freeze, soulAccessSame as same,
  createSoulAccessPlan, makeSoulAccessQuoteDraft,
  type SoulAccessDeployment, type SoulAccessState, type SoulAccessPaymentCoin, type SoulAccessRequest } from './soul-access-plan'

export interface ReadSoulAccessStateParams {
  client: SuiGrpcClient; deployment: SoulAccessDeployment; soulId: string; stateId: string; contentId: string
  paidAccessListId: string; author: string; kind?: number; granteeAddress?: string; signal?: AbortSignal
}
export const soulAccessSignal = (signal?: AbortSignal) => signal
  ? AbortSignal.any([signal, AbortSignal.timeout(45000)]) : AbortSignal.timeout(45000)
type RawObject = NonNullable<Awaited<ReturnType<SuiGrpcClient['ledgerService']['getObject']>>['response']['object']>

function currentObject(row: RawObject | undefined, objectId: string, type: string, ownerKind: number, owner?: string) {
  check(row?.objectId === objectId && row.objectType === normalizeStructTag(type)
    && typeof row.version === 'bigint' && row.version > 0n && row.version <= SOUL_ACCESS_MAX
    && row.owner?.kind === ownerKind && (owner === undefined || row.owner.address === owner), 'CURRENT_OBJECT_MISMATCH')
  digest(row.digest)
  if (ownerKind === 3) check(typeof row.owner!.version === 'bigint' && row.owner!.version > 0n && row.owner!.version <= row.version, 'CURRENT_SHARED_BIRTH')
  check(row.contents?.value instanceof Uint8Array && row.contents.value.length > 0 && row.contents.value.length <= 256 * 1024, 'CURRENT_BCS_BUDGET')
  return row.contents.value
}

/** The requested callable package must actually be this Soulidity family.
 * A matching function name in an unrelated package is not release evidence. */
async function attestPackage(client: SuiGrpcClient, d: SoulAccessDeployment, signal: AbortSignal) {
  const { response } = await profileReadStep(signal, () => client.ledgerService.getObject({ objectId: d.callablePackageId,
    readMask: { paths: ['object_id', 'version', 'digest', 'owner', 'package'] } }, { abort: signal }))
  const row = response.object, pkg = row?.package
  check(row?.objectId === d.callablePackageId && row.owner?.kind === 4 && typeof row.version === 'bigint'
    && row.version > 0n && pkg?.storageId === d.callablePackageId && pkg.originalId === d.originalPackageId
    && pkg.version === row.version, 'CALLABLE_PACKAGE_MISMATCH'); digest(row.digest)
  check(pkg.modules.length > 0 && pkg.modules.length <= 1024 && pkg.typeOrigins.length <= 8192
    && new Set(pkg.modules.map(module => module.name)).size === pkg.modules.length
    && new Set(pkg.typeOrigins.map(type => `${type.moduleName}::${type.datatypeName}`)).size === pkg.typeOrigins.length, 'PACKAGE_SHAPE_INVALID')
  for (const [moduleName, datatypeName] of [['soul', 'Soul'], ['soul', 'SoulState'], ['soul', 'ActiveGrantSlot'],
    ['grant', 'SoulGrant'], ['paid_access', 'SoulPaidAccessList'], ['paid_access', 'KindPaidConfig'],
    ['paid_access', 'KindPaidEntry'], ['kind_registry', 'KindRegistry'], ['market', 'MarketConfigV2']]) {
    const type = pkg.typeOrigins.filter(type => type.moduleName === moduleName && type.datatypeName === datatypeName)
    check(type.length === 1 && type[0].packageId === d.originalPackageId
      && pkg.modules.some(module => module.name === moduleName && module.contents && module.contents.length > 4), 'PACKAGE_TYPE_ORIGIN_MISMATCH')
  }
}

/** Fresh, bounded raw observation. No account API, SQL mirror or private Agent
 * membership is consulted. The existing domain reader proves roots, grants,
 * descriptors and entries; the extra reads preserve exact optional buyer tables. */
export async function readSoulAccessState(params: ReadSoulAccessStateParams): Promise<SoulAccessState> {
  const signal = soulAccessSignal(params.signal)
  const input = structuredClone({ deployment: params.deployment, soulId: params.soulId, stateId: params.stateId,
    contentId: params.contentId, paidAccessListId: params.paidAccessListId, author: params.author,
    kind: params.kind ?? null, buyerAddress: params.granteeAddress ?? params.author })
  const d = parseSoulAccessDeployment(input.deployment)
  ;[input.soulId, input.stateId, input.contentId, input.paidAccessListId, input.author].forEach(value => id(value))
  id(input.buyerAddress, false)
  check(input.kind === null || Number.isInteger(input.kind) && input.kind >= 0 && input.kind <= 0xffff_ffff, 'INVALID_KIND')
  const original = params.client, session = createBrowserNativeReadSession(original, signal)
  // Clock is a fresh time observation. Do not demand stable Clock bytes across
  // an otherwise coherent multi-object read, nor let it enter a session cache.
  const ledger = new Proxy(session.client.ledgerService, { get(target, key) {
    const member = Reflect.get(target, key, target)
    if (key !== 'getObject' && key !== 'batchGetObjects') return typeof member === 'function' ? member.bind(target) : member
    return (request: any, options?: any) => {
      const clock = key === 'getObject' ? request.objectId === SOUL_ACCESS_CLOCK
        : request.requests?.length === 1 && request.requests[0].objectId === SOUL_ACCESS_CLOCK
      const service = clock ? original.ledgerService : target
      return Reflect.apply(Reflect.get(service, key, service), service, [request, { ...options, abort: signal }])
    }
  } })
  const client = new Proxy(session.client, { get(target, key) { return key === 'ledgerService' ? ledger : Reflect.get(target, key, target) } })
  await attestPackage(client, d, signal)
  const deployment = { originalPackageId: d.originalPackageId, chainIdentifier: d.chainIdentifier }
  const asset = await readSoulPublicSnapshotBySoulId({ client, deployment, soulId: input.soulId, signal })
  check(asset.stateId === input.stateId && asset.contentId === input.contentId, 'ROOT_POINTER_MISMATCH')
  const snapshot = await readSoulDetailState({ client, deployment: { ...deployment, kindRegistryId: d.kindRegistryId }, stateId: input.stateId,
    expectedState: { version: asset.stateVersion, digest: asset.stateDigest }, viewerAddresses: [input.author],
    kindIds: input.kind === null ? [] : [input.kind], signal })
  check(snapshot.soulId === input.soulId && snapshot.contentId === input.contentId
    && snapshot.paidAccessListId === input.paidAccessListId, 'ROOT_POINTER_MISMATCH')
  const read = async (objectId: string, type: string) => {
    const { response } = await profileReadStep(signal, () => client.ledgerService.getObject({ objectId,
      readMask: { paths: ['object_id', 'object_type', 'version', 'digest', 'owner', 'contents'] } }, { abort: signal }))
    return currentObject(response.object, objectId, type, 3)
  }
  const stateBytes = await read(input.stateId, `${d.originalPackageId}::soul::SoulState`)
  const paidBytes = await read(input.paidAccessListId, `${d.originalPackageId}::paid_access::SoulPaidAccessList`)
  const marketBytes = await read(d.marketConfigId, `${d.originalPackageId}::market::MarketConfigV2`)
  const state = decode(SoulStatePublicBcs, stateBytes), paid = decode(SoulDetailStateBcs.Paid, paidBytes)
  const market = decode(SoulPublicMarketConfigBcs, marketBytes)
  check(state.ownership_epoch === snapshot.ownershipEpoch && state.current_owner === snapshot.currentOwner
    && state.content_id === input.contentId && state.access_list_id === paid.id && paid.id === input.paidAccessListId
    && market.id === d.marketConfigId && market.version === '2' && market.platform_fee_bps <= 10000, 'RAW_SNAPSHOT_MISMATCH')
  id(market.fee_recipient)
  const buyerFieldId = deriveDynamicFieldID(paid.entries.id, 'address', bcs.Address.serialize(input.buyerAddress).toBytes())
  const { response } = await profileReadStep(signal, () => client.ledgerService.batchGetObjects({ requests: [{ objectId: buyerFieldId }],
    readMask: { paths: ['object_id', 'object_type', 'version', 'digest', 'owner', 'contents'] } }, { abort: signal }))
  check(response.objects.length === 1, 'BUYER_RESPONSE_INCOMPLETE')
  const result = response.objects[0].result
  check(result.oneofKind === 'object' || result.oneofKind === 'error' && result.error.code === 5, 'BUYER_UNAVAILABLE')
  let buyerTableBcs: string | null = null
  if (result.oneofKind === 'object') {
    const valueType = `0x2::table::Table<u32,${d.originalPackageId}::paid_access::KindPaidEntry>`
    const bytes = currentObject(result.object, buyerFieldId, `0x2::dynamic_field::Field<address,${valueType}>`, 2, paid.entries.id)
    const row = decode(bcs.struct('Field', { id: bcs.Address, name: bcs.Address, value: SoulDetailStateBcs.Table }), bytes)
    check(row.id === buyerFieldId && row.name === input.buyerAddress && BigInt(row.value.size) > 0n, 'BUYER_TABLE_MISMATCH')
    id(row.value.id); buyerTableBcs = SoulDetailStateBcs.Table.serialize(row.value).toBase64()
    // The domain reader enumerates all owner rows, or this buyer's own rows.
    // Non-owner callers cannot use this extra field as a grant to another buyer.
    if (snapshot.currentOwner === input.author || input.buyerAddress === input.author) {
      check(BigInt(snapshot.paidAccessEntries.filter(entry => entry.buyerAddress === input.buyerAddress).length) === BigInt(row.value.size), 'BUYER_ENTRY_COUNT_MISMATCH')
    }
  } else check(!snapshot.paidAccessEntries.some(entry => entry.buyerAddress === input.buyerAddress), 'BUYER_ABSENCE_MISMATCH')
  const descriptor = snapshot.kindDescriptors.find(row => row.kind === input.kind)
  const value: SoulAccessState = { deployment: d, soulId: input.soulId, stateId: input.stateId, contentId: input.contentId,
    paidAccessListId: input.paidAccessListId, author: input.author, snapshot, stateBcs: toBase64(stateBytes), paidBcs: toBase64(paidBytes),
    marketConfigBcs: toBase64(marketBytes), buyerAddress: input.buyerAddress, buyerTableBcs,
    kind: input.kind, descriptorBcs: descriptor ? SoulDetailStateBcs.Descriptor.serialize(descriptor).toBase64() : null }
  await session.finish(undefined); signal.throwIfAborted(); return freeze(value)
}

export async function readSoulAccessPaymentCoin(params: { client: SuiGrpcClient; author: string; paymentCoinType: string; objectId: string; signal?: AbortSignal }): Promise<SoulAccessPaymentCoin> {
  const signal = soulAccessSignal(params.signal), { author, paymentCoinType, objectId } = structuredClone({ author: params.author,
    paymentCoinType: params.paymentCoinType, objectId: params.objectId })
  id(author); id(objectId)
  const { response } = await profileReadStep(signal, () => params.client.ledgerService.getObject({ objectId,
    readMask: { paths: ['object_id', 'object_type', 'version', 'digest', 'owner', 'contents'] } }, { abort: signal }))
  const row = response.object, bytes = currentObject(row, objectId, `0x2::coin::Coin<${paymentCoinType}>`, 1, author)
  const value = decode(SoulAccessCoinBcs, bytes); check(value.id === objectId, 'PAYMENT_ID_MISMATCH')
  return freeze({ objectId, version: String(row!.version), digest: row!.digest!, balance: value.balance })
}
export async function selectSoulAccessPaymentCoins(params: {
  client: SuiGrpcClient; author: string; deployment: SoulAccessDeployment; totalAtomic: string; signal?: AbortSignal
}): Promise<SoulAccessPaymentCoin[]> {
  const signal = soulAccessSignal(params.signal), author = params.author, d = parseSoulAccessDeployment(params.deployment), total = params.totalAtomic
  id(author); uint(total, true)
  const selected: SoulAccessPaymentCoin[] = [], seen = new Set<string>(), cursors = new Set<string>()
  let pageToken: Uint8Array | undefined
  for (let page = 0; page < 10; page++) {
    const { response } = await profileReadStep(signal, () => params.client.stateService.listOwnedObjects({ owner: author,
      objectType: `0x2::coin::Coin<${d.paymentCoinType}>`, pageSize: 20, pageToken, readMask: { paths: ['object_id'] } }, { abort: signal }))
    check(Array.isArray(response.objects) && response.objects.length <= 20, 'PAYMENT_DISCOVERY_PAGE')
    for (const hint of response.objects) {
      id(hint.objectId); check(!seen.has(hint.objectId), 'PAYMENT_DISCOVERY_DUPLICATE'); seen.add(hint.objectId)
      const coin = await readSoulAccessPaymentCoin({ client: params.client, author, paymentCoinType: d.paymentCoinType, objectId: hint.objectId, signal })
      if (coin.balance === '0') continue
      selected.push(coin); selected.sort((a, b) => BigInt(a.balance) > BigInt(b.balance) ? -1 : BigInt(a.balance) < BigInt(b.balance) ? 1 : a.objectId.localeCompare(b.objectId))
      if (selected.length > 32) selected.pop()
      let balance = 0n
      for (let count = 0; count < selected.length; count++) {
        balance += BigInt(selected[count].balance)
        check(balance <= SOUL_ACCESS_MAX, 'PAYMENT_MERGE_OVERFLOW')
        if (balance >= BigInt(total)) return freeze(selected.slice(0, count + 1))
      }
    }
    const next = response.nextPageToken
    if (next === undefined || next.length === 0) break
    check(next instanceof Uint8Array && next.length <= 1024 && !cursors.has(toBase64(next)), 'PAYMENT_DISCOVERY_CURSOR')
    cursors.add(toBase64(next)); pageToken = next.slice()
  }
  throw new Error('SOUL_ACCESS_INSUFFICIENT_VERIFIED_USDC')
}

/** Read/quote/coin selection only. The caller displays this immutable result
 * before explicitly handing it to the transaction adapter. No wallet prompt. */
export async function prepareSoulAccessPlan(params: Omit<ReadSoulAccessStateParams, 'kind' | 'granteeAddress'> & { request: SoulAccessRequest }) {
  const request = structuredClone(params.request), signal = soulAccessSignal(params.signal)
  const state = await readSoulAccessState({ ...params, signal, kind: request.kind, granteeAddress: request.granteeAddress })
  const draft = makeSoulAccessQuoteDraft(state, request)
  if (request.action === 'paid-purchase') {
    const paymentCoins = request.paymentCoins?.length ? request.paymentCoins : await selectSoulAccessPaymentCoins({ client: params.client,
      deployment: state.deployment, author: state.author, totalAtomic: draft.quote.totalAtomic, signal })
    for (const coin of paymentCoins) {
      const current = await readSoulAccessPaymentCoin({ client: params.client, author: state.author,
        paymentCoinType: state.deployment.paymentCoinType, objectId: coin.objectId, signal })
      check(same(current, coin), 'PAYMENT_CHANGED')
    }
    signal.throwIfAborted(); return createSoulAccessPlan({ state, request: { ...request, paymentCoins } })
  }
  return createSoulAccessPlan({ state, request })
}
