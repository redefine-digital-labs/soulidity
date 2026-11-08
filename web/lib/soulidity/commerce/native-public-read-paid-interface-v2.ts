import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { normalizeStructTag, normalizeSuiAddress } from '@mysten/sui/utils'
import { profileReadStep } from '@soulidity/sdk'
import { readPinnedMovePackage, type PinnedMovePackage } from '../../sui/pinned-move-package'
import { MAINNET_GENESIS_DIGEST } from '../../animacraft/mainnet-chain'
import { verifyNativePaidContentApprovalV2Interface } from '../native-paid-content-approval-v2'
import { commerceCheck } from './economics-read'
import { buildNativePublicReadPaidPurchaseV2, type NativePublicReadPaidPurchaseV2 } from './native-public-read-paid-transaction-v2'

type Signature = Awaited<ReturnType<SuiGrpcClient['core']['getMoveFunction']>>['function']['parameters'][number]
function signature(s: Signature): string {
  const b = s.body
  let inner: string
  if (b.$kind === 'datatype') {
    const base = normalizeStructTag(b.datatype.typeName)
    commerceCheck(!base.includes('<'), 'PUBLIC_PAID_V2_ABI_TYPE_SHAPE')
    // Open generic T0 is not a concrete TypeTag; normalize only the base.
    inner = base + (b.datatype.typeParameters.length ? `<${b.datatype.typeParameters.map(body => signature({ reference: null, body })).join(',')}>` : '')
  } else if (b.$kind === 'vector') inner = `vector<${signature({ reference: null, body: b.vector })}>`
  else if (b.$kind === 'typeParameter') inner = `T${b.index}`
  else inner = b.$kind
  return (s.reference === null ? '' : s.reference === 'mutable' ? '&mut ' : s.reference === 'immutable' ? '&' : '?') + inner
}

/** Exact interfaces of the explicitly pinned isolated V2 format only. This
 * checks neither source closure/adoption nor current Host/Entry/fee/Record
 * authority, simulation, execution or usable delivery. No v1 fallback, wallet
 * prompt, journal, payment or signing token is produced.
 */
export async function verifyNativePublicReadPaidV2Interfaces(input: { client: SuiGrpcClient; native: PinnedMovePackage; foundation: PinnedMovePackage; signal: AbortSignal }) {
  const nativePin = structuredClone(input.native), foundationPin = structuredClone(input.foundation)
  const source = input.client, signal = AbortSignal.any([input.signal, AbortSignal.timeout(45000)])
  const client = { core: { getChainIdentifier: source.core.getChainIdentifier.bind(source.core), getMoveFunction: source.core.getMoveFunction.bind(source.core) },
    ledgerService: { getObject: source.ledgerService.getObject.bind(source.ledgerService) } } as unknown as SuiGrpcClient
  commerceCheck((await profileReadStep(signal, () => client.core.getChainIdentifier())).chainIdentifier === MAINNET_GENESIS_DIGEST, 'PUBLIC_PAID_V2_ABI_CHAIN')
  const native = await readPinnedMovePackage(client, nativePin, signal), foundation = await readPinnedMovePackage(client, foundationPin, signal)
  const link = native.linkage.get(foundation.pin.originalPackageId)
  commerceCheck(link?.upgradedId === foundation.pin.callablePackageId && link.upgradedVersion === String(foundation.version), 'PUBLIC_PAID_V2_ABI_DEPENDENCY')
  const origin = (origins: Map<string, string>, module: string, name: string) => {
    const address = origins.get(`${module}::${name}`); commerceCheck(address, 'PUBLIC_PAID_V2_ABI_ORIGIN')
    return normalizeStructTag(`${address}::${module}::${name}`)
  }
  const host = origin(native.origins, 'birth', 'PublicReadHostV2'), registry = origin(native.origins, 'registry', 'Registry')
  origin(native.origins, 'birth', 'PublicReadLinkV2')
  const config = `${origin(foundation.origins, 'economics', 'Config')}<T0>`, kiosk = normalizeStructTag('0x2::kiosk::Kiosk')
  const clock = normalizeStructTag('0x2::clock::Clock'), ctx = normalizeStructTag('0x2::tx_context::TxContext')
  const expected = [
    { name: 'buy_public_read_paid_v2', parameters: [`&${registry}`, `&mut ${config}`, `&${kiosk}`, `&mut ${host}`, 'u32', 'vector<u8>',
      `${normalizeStructTag('0x1::option::Option')}<vector<u8>>`, 'u64', 'u64', 'vector<u8>', `${normalizeStructTag('0x2::coin::Coin')}<T0>`, `&${clock}`, `&mut ${ctx}`], returns: [] as string[] },
    { name: 'quote_public_read_paid_v2', parameters: [`&${config}`, `&${host}`, 'u32'], returns: ['vector<u8>', 'u64'] },
  ]
  for (const spec of expected) {
    const fn = (await profileReadStep(signal, () => client.core.getMoveFunction({ packageId: native.pin.callablePackageId, moduleName: 'birth', name: spec.name, signal }))).function
    commerceCheck(fn && normalizeSuiAddress(fn.packageId) === native.pin.callablePackageId && fn.moduleName === 'birth' && fn.name === spec.name
      && fn.visibility === 'public' && fn.isEntry === false && fn.typeParameters.length === 1
      && fn.typeParameters[0].constraints.length === 0 && fn.typeParameters[0].isPhantom === false
      && JSON.stringify(fn.parameters.map(signature)) === JSON.stringify(spec.parameters)
      && JSON.stringify(fn.returns.map(signature)) === JSON.stringify(spec.returns), 'PUBLIC_PAID_V2_ABI_SIGNATURE')
  }
  signal.throwIfAborted()
  return { format: 'native-public-read-v2' as const, native: native.pin, foundation: foundation.pin, hostType: host, registryType: registry,
    interfaceVerified: true as const, requiresQualifiedSourceAndFormatAdoption: true as const, requiresCurrentHostRecordEntryAndQuoteProof: true as const,
    notSigningQualification: true as const, notDeliveryProof: true as const }
}

/** Concrete interface-checked unsigned kind, still not payment authorization.
 * Snapshot intent before awaits. Parent must independently qualify the live
 * Record/Host/Entry/quote/source, full packet/gas/simulation and actual delivery.
 */
export async function prepareInterfaceCheckedNativePublicReadPaidV2Kind(input: Parameters<typeof verifyNativePublicReadPaidV2Interfaces>[0] & { intent: NativePublicReadPaidPurchaseV2 }) {
  const intent = structuredClone(input.intent), native = structuredClone(input.native), foundation = structuredClone(input.foundation)
  const { client, signal } = input
  commerceCheck(intent.nativeCallablePackageId === native.callablePackageId, 'PUBLIC_PAID_V2_ABI_INTENT_PACKAGE')
  const transaction = buildNativePublicReadPaidPurchaseV2(intent)
  const interfaces = await verifyNativePublicReadPaidV2Interfaces({ client, native, foundation, signal })
  if (intent.recordGuard) await verifyNativePaidContentApprovalV2Interface({ client, native, signal })
  signal.throwIfAborted()
  const kindBytes = await transaction.build({ onlyTransactionKind: true })
  signal.throwIfAborted()
  return { format: 'native-public-read-v2' as const, kindBytes, interfaces,
    requiresQualifiedSourceAndFormatAdoption: true as const, requiresCurrentHostRecordEntryAndQuoteProof: true as const,
    requiresFullPacketFundingAndSimulation: true as const, notSigningQualification: true as const, notDeliveryProof: true as const }
}
