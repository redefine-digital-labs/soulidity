import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { assertWalrusSingleChain, parseWalrusSingleRecord, queryWalrusSinglePacket, readWalrusSingleRecord,
  walrusSingleKey, withWalrusSingleLock, writeWalrusSingleRecord, type WalrusSinglePacket,
  type WalrusSingleRecord } from '../upload/walrus-single-operation'
import { contentAppendPreparationFingerprint } from './content-append-preparation'
import { browserContentAppendStore, contentAppendStoreKey } from './content-append-store'
import { browserContentAppendRestoreStore } from './content-append-restore-store'
import { verifyContentAppendRecoveryBundle, type ContentAppendRecoveryBundle } from './content-append-recovery'

function check(value: unknown, code: string): asserts value { if (!value) throw new Error(`CONTENT_APPEND_RESTORE_${code}`) }
const json = (value: unknown) => JSON.stringify(value)
function packet(a: WalrusSinglePacket | null, b: WalrusSinglePacket | null): WalrusSinglePacket | null {
  if (!a || !b) return a ?? b
  check(a.bytes === b.bytes && a.digest === b.digest && a.expirationEpoch === b.expirationEpoch, 'PACKET_CONFLICT')
  check(!a.signature || !b.signature || a.signature === b.signature, 'SIGNATURE_CONFLICT')
  check(!(a.phase === 'SUCCEEDED' && b.phase === 'FAILED' || a.phase === 'FAILED' && b.phase === 'SUCCEEDED'), 'RESULT_CONFLICT')
  const rank = { PREPARED: 0, SIGNING: 1, SIGNED: 2, SUCCEEDED: 3, FAILED: 3 }
  const advanced = rank[a.phase] >= rank[b.phase] ? a : b
  return { ...advanced, signature: a.signature ?? b.signature }
}
/** Merge progress of the exact same packets, never replace a known digest or
 * downgrade a locally signed packet to an imported unsigned seed. */
export function mergeContentAppendRestorePayment(a: WalrusSingleRecord, b: WalrusSingleRecord): WalrusSingleRecord {
  a = parseWalrusSingleRecord(a); b = parseWalrusSingleRecord(b)
  check(json(a.intent) === json(b.intent) && (!a.encoding || !b.encoding || json(a.encoding) === json(b.encoding))
    && (!a.approved || !b.approved || json(a.approved) === json(b.approved)), 'PAYMENT_CONFLICT')
  check(!a.uploaded || !b.uploaded || json(a.uploaded) === json(b.uploaded), 'UPLOAD_CONFLICT')
  return parseWalrusSingleRecord({ ...a, register: packet(a.register, b.register), certify: packet(a.certify, b.certify),
    encoding: a.encoding ?? b.encoding, approved: a.approved ?? b.approved,
    uploaded: a.uploaded ?? b.uploaded, acknowledged: a.acknowledged || b.acknowledged })
}
const defaults = { read: readWalrusSingleRecord, write: writeWalrusSingleRecord, lock: withWalrusSingleLock,
  chain: assertWalrusSingleChain, query: queryWalrusSinglePacket,
  store: browserContentAppendStore, restores: browserContentAppendRestoreStore }

/** Explicit local adoption only. No Seal unlock, SDK upload, signature or
 * broadcast is available here. A durable marker bridges IDB and localStorage;
 * retrying that same marker is safe after any partial write or lost response. */
export async function restoreContentAppend(params: {
  bundle: ContentAppendRecoveryBundle; client: SuiGrpcClient; getAddress: () => string | null; signal: AbortSignal
}, injected: Partial<typeof defaults> = {}) {
  const { client, signal, getAddress } = params, deps = { ...defaults, ...injected }
  const bundle = await verifyContentAppendRecoveryBundle(params.bundle, client)
  const guard = () => { signal.throwIfAborted(); check(getAddress() === bundle.record.scope.author, 'RECONNECT_AUTHOR_WALLET') }
  guard(); check(bundle.payment?.register, 'CURRENT_PAID_PACKET_REQUIRED')
  const payments = new Map<string, WalrusSingleRecord>()
  // Reject contradictory evidence before committing a marker that could never
  // finish. Every ancestor and pending-next seed remains durable on this device.
  for (const value of [...bundle.history.flatMap(link => [link.previousPayment, link.nextPayment]), bundle.payment, ...bundle.additionalPayments,
    ...(bundle.pending ? [bundle.pending.previousPayment, bundle.pending.nextPayment] : [])]) {
    const payment = parseWalrusSingleRecord(value), key = walrusSingleKey(payment.intent), previous = payments.get(key)
    check(payment.register, 'PAID_PACKET_REQUIRED')
    payments.set(key, previous ? mergeContentAppendRestorePayment(previous, payment) : payment)
  }
  const store = deps.store(client), restores = deps.restores(client), key = contentAppendStoreKey(bundle.record.scope)
  const execution = { client, getAddress, sign: async () => { throw new Error('CONTENT_APPEND_RESTORE_CANNOT_SIGN') } }
  return store.exclusive(key, async () => {
    guard()
    // Hold all relevant WAL locks until activation. This prevents a different
    // tab changing a checked ancestor between readback and final publication.
    const entries = [...payments.entries()].sort(([a], [b]) => a.localeCompare(b))
    async function locked(index: number): Promise<ContentAppendRecoveryBundle['record']> {
      if (index < entries.length) return deps.lock(entries[index][0], () => locked(index + 1))
      guard()
      const merged = entries.map(([walKey, incoming]) => {
        const local = deps.read(walKey)
        return [walKey, local ? mergeContentAppendRestorePayment(incoming, local) : incoming] as const
      })
      await deps.chain(execution, bundle.payment!.intent.network); guard()
      const verified: Array<readonly [string, WalrusSingleRecord]> = []
      for (const [walKey, payment] of merged) {
        const result = await deps.query(execution, payment.register!); guard()
        check(result.status === 'SUCCEEDED', 'REGISTER_NOT_CONFIRMED_PAID')
        payment.register = { ...payment.register!, phase: 'SUCCEEDED' }
        if (payment.certify) {
          const certified = await deps.query(execution, payment.certify); guard()
          if (certified.status === 'SUCCEEDED' || certified.status === 'FAILED') {
            payment.certify = { ...payment.certify, phase: certified.status }
            if (certified.status === 'FAILED') payment.acknowledged = false
          }
        }
        verified.push([walKey, parseWalrusSingleRecord(payment)])
      }
      // Finish all read-only evidence checks before the first WAL write.
      // Bad/unconfirmed imported payments must not strand a durable slot marker.
      await restores.stage(bundle); guard()
      for (const [walKey, payment] of verified) { guard(); deps.write(walKey, payment) }
      for (const [walKey, payment] of verified) { guard(); check(json(deps.read(walKey)) === json(payment), 'PAYMENT_READBACK_MISMATCH') }
      guard(); await restores.complete(bundle); guard()
      const active = await store.read(key); guard()
      check(active && contentAppendPreparationFingerprint(active) === contentAppendPreparationFingerprint(bundle.record), 'ACTIVE_READBACK_MISMATCH')
      return active
    }
    return locked(0)
  })
}
