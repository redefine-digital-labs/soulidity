/** Shared order/persistence for public transaction recovery; domain parsers,
 * current authority and historical chain evidence remain separate. */
export interface PublicMutationPlan {
  deployment: { chainIdentifier: string; originalPackageId: string; callablePackageId: string; marketConfigId: string; kindRegistryId: string }
  soulId: string; author: string
}
export interface PublicMutationPacket {
  bytes: string; digest: string; expirationEpoch: string
  phase: 'PREPARED' | 'SIGNING' | 'SIGNED' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED' | 'RETIRED'
  signature: string | null
}
export interface PublicMutationRecord<P> { schema: string; plan: P; packet: PublicMutationPacket }
export interface PublicMutationQuery { status: 'MISSING' | 'PENDING' | 'SUCCEEDED' | 'FAILED'; checkpoint?: string }
/** Await every durable boundary, for both Storage and IndexedDB journals. */
export interface PublicMutationJournal<R> {
  exclusive<T>(key: string, work: () => Promise<T>): Promise<T>
  read(key: string): R | null | Promise<R | null>
  write(key: string, record: R): void | Promise<void>
}
export interface PublicMutationListScope<P extends PublicMutationPlan> { deployment: P['deployment']; soulId: string; author: string | null }
export interface PublicMutationStore<P extends PublicMutationPlan, R extends PublicMutationRecord<P>> {
  exclusive<T>(key: string, work: () => Promise<T>): Promise<T>
  read(key: string): R | null; write(key: string, record: R): void
  list(scope: PublicMutationListScope<P>): R[]
  discover(scope: { soulId: string; originalPackageId: string }): R[]
  history(key: string): R[]
}
export interface PublicMutationAdapter<P, R extends PublicMutationRecord<P>, Q extends PublicMutationQuery> {
  prepare(plan: P): Promise<R>; query(record: R): Promise<Q>
  preflight(record: R, signing: boolean): Promise<void>
  sign(record: R): Promise<{ bytes: string; signature: string }>
  verifySignature(record: R): Promise<void>; broadcast(record: R): Promise<void>
  /** Domain-specific durable evidence; the domain parser must validate it. */
  retire?(record: R): Promise<R>
}
export interface PublicMutationRunParams<P, R extends PublicMutationRecord<P>, Q extends PublicMutationQuery> {
  plan: P; store: PublicMutationJournal<R>; adapter: PublicMutationAdapter<P, R, Q>
  queryOnly?: boolean; cancelUnsigned?: boolean; startNew?: boolean; retireExpired?: boolean
  expectedPacket?: { bytes: string; digest: string }
}
interface Domain<P, R extends PublicMutationRecord<P>> {
  parse: (input: unknown) => R; key: (plan: P) => string; errorPrefix: string
}
export const publicMutationCanonical = (value: unknown): string => JSON.stringify(value, (_key, entry) =>
  entry && typeof entry === 'object' && !Array.isArray(entry)
    ? Object.fromEntries(Object.keys(entry).sort().map(key => [key, entry[key]])) : entry)
const terminal = (r: { packet: PublicMutationPacket }) => ['SUCCEEDED', 'FAILED', 'CANCELLED', 'RETIRED'].includes(r.packet.phase)
export const publicMutationFrozen = <P>(r: PublicMutationRecord<P>) => publicMutationCanonical({ schema: r.schema, plan: r.plan,
  bytes: r.packet.bytes, digest: r.packet.digest, expirationEpoch: r.packet.expirationEpoch })
const frozen = publicMutationFrozen
export function assertPublicMutationTransition<P>(before: PublicMutationRecord<P>, after: PublicMutationRecord<P>, errorPrefix: string) {
  function check(v: unknown, code: string): asserts v { if (!v) throw new Error(`${errorPrefix}_${code}`) }
  check(frozen(before) === frozen(after), 'FROZEN_RECORD_CHANGED')
  const old = before.packet, next = after.packet
  check(old.signature === null || next.signature === old.signature, 'SIGNATURE_CHANGED')
  const allowed: Record<PublicMutationPacket['phase'], PublicMutationPacket['phase'][]> = {
    PREPARED: ['PREPARED', 'SIGNING', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'RETIRED'], SIGNING: ['SIGNING', 'SIGNED', 'SUCCEEDED', 'FAILED', 'RETIRED'],
    SIGNED: ['SIGNED', 'SUCCEEDED', 'FAILED', 'RETIRED'], SUCCEEDED: ['SUCCEEDED'], FAILED: ['FAILED'], CANCELLED: ['CANCELLED', 'SUCCEEDED', 'FAILED'],
    RETIRED: ['RETIRED'],
  }
  check(allowed[old.phase].includes(next.phase), 'INVALID_TRANSITION')
  check(old.signature !== null || next.signature === null || old.phase === 'SIGNING' && next.phase === 'SIGNED', 'UNEXPECTED_SIGNATURE')
}

/** Public bytes only. Cancellation assumes an intact journal, not adversarial
 * storage or external signing. Every write is locked/read back; no deletion. */
export function createPublicMutationStore<P extends PublicMutationPlan, R extends PublicMutationRecord<P>>(
  domain: Domain<P, R> & { prefix: string; changedEvent: string },
): PublicMutationStore<P, R> {
  const { parse, key: keyOf, prefix } = domain
  function check(v: unknown, code: string): asserts v { if (!v) throw new Error(`${domain.errorPrefix}_${code}`) }
  check(typeof window !== 'undefined' && typeof navigator !== 'undefined' && navigator.locks?.request, 'REQUIRES_STORAGE_AND_LOCKS')
  const storage = window.localStorage, held = new Set<string>(), maxRecordSize = 300000, maxRecords = 256
  function readAt(name: string, key: string) {
    const raw = storage.getItem(name)
    if (raw === null) return null
    check(raw.length > 0 && raw.length <= maxRecordSize, 'RECORD_SIZE')
    const record = parse(JSON.parse(raw)); check(keyOf(record.plan) === key, 'SCOPE_MISMATCH'); return record
  }
  function persist(name: string, record: R) {
    const encoded = publicMutationCanonical(record); check(encoded.length <= maxRecordSize, 'RECORD_SIZE')
    storage.setItem(name, encoded); check(storage.getItem(name) === encoded, 'PERSISTENCE_FAILED')
  }
  function archive(key: string, record: R) {
    check(terminal(record), 'ARCHIVE_NOT_TERMINAL')
    const name = `${key}:history:${record.packet.digest}:${record.packet.phase}`, previous = readAt(name, key)
    check(!previous || publicMutationCanonical(previous) === publicMutationCanonical(record), 'ARCHIVE_CONFLICT')
    if (!previous) persist(name, record)
    else check(storage.getItem(name) === publicMutationCanonical(record), 'PERSISTENCE_FAILED')
  }
  function transition(before: R, after: R) {
    assertPublicMutationTransition(before, after, domain.errorPrefix)
  }
  function discover(matchesKey: (parts: string[]) => boolean, matches: (plan: P) => boolean) {
    const records: R[] = []
    for (let index = 0; index < storage.length; index++) {
      const name = storage.key(index)
      if (!name?.startsWith(prefix) || name.includes(':history:')) continue
      const parts = name.slice(prefix.length).split(':')
      if (parts.length !== 7 || !matchesKey(parts)) continue
      const raw = storage.getItem(name); check(raw !== null && raw.length > 0 && raw.length <= maxRecordSize, 'RECORD_SIZE')
      const record = readAt(name, name); check(record, 'RECORD_DISAPPEARED'); check(matches(record.plan), 'SCOPE_MISMATCH')
      records.push(record); check(records.length <= maxRecords, 'LIST_LIMIT')
    }
    return records.sort((a, b) => keyOf(a.plan).localeCompare(keyOf(b.plan)))
  }
  return {
    exclusive: (key, work) => navigator.locks.request(key, { mode: 'exclusive', ifAvailable: true }, async lock => {
      check(lock && !held.has(key), 'BUSY'); held.add(key)
      try { return await work() } finally { held.delete(key) }
    }),
    read: key => readAt(key, key),
    write: (key, input) => {
      check(held.has(key), 'LOCK_REQUIRED')
      const record = parse(input); check(keyOf(record.plan) === key && key.startsWith(prefix), 'SCOPE_MISMATCH')
      const previous = readAt(key, key)
      if (!previous) check(record.packet.phase === 'PREPARED' && record.packet.signature === null, 'FIRST_RECORD_NOT_PREPARED')
      else if (frozen(previous) === frozen(record) && !(previous.packet.phase === 'CANCELLED' && record.packet.phase === 'PREPARED')) transition(previous, record)
      else {
        check(terminal(previous) && record.packet.phase === 'PREPARED' && record.packet.signature === null, 'RECOVERY_REQUIRED')
        archive(key, previous) // Archive/readback precedes replacement of the active head.
      }
      persist(key, record); window.dispatchEvent(new window.Event(domain.changedEvent))
    },
    list: input => {
      const scope = structuredClone(input), d = scope.deployment
      return discover(parts => parts.slice(0, 6).join(':') === [d.chainIdentifier, d.originalPackageId, d.callablePackageId,
        d.marketConfigId, d.kindRegistryId, scope.soulId].join(':') && (scope.author === null || parts[6] === scope.author),
      plan => plan.soulId === scope.soulId && publicMutationCanonical(plan.deployment) === publicMutationCanonical(scope.deployment)
        && (scope.author === null || plan.author === scope.author))
    },
    discover: input => {
      const scope = structuredClone(input)
      return discover(parts => parts[5] === scope.soulId && parts[1] === scope.originalPackageId,
        plan => plan.soulId === scope.soulId && plan.deployment.originalPackageId === scope.originalPackageId)
    },
    history: key => {
      const start = `${key}:history:`, records: R[] = []
      for (let index = 0; index < storage.length; index++) {
        const name = storage.key(index); if (!name?.startsWith(start)) continue
        const record = readAt(name, key)
        check(record && terminal(record) && name === `${start}${record.packet.digest}:${record.packet.phase}`, 'ARCHIVE_INVALID')
        records.push(record); check(records.length <= maxRecords, 'LIST_LIMIT')
      }
      return records.sort((a, b) => a.packet.digest.localeCompare(b.packet.digest))
    },
  }
}

/** Query-first FSM. Domain adapters verify bytes, signatures, preconditions and
 * historical evidence. The same SIGNING packet can retry but cannot cancel. */
export async function runPublicMutation<P, R extends PublicMutationRecord<P>, Q extends PublicMutationQuery>(
  params: PublicMutationRunParams<P, R, Q>, domain: Domain<P, R>,
): Promise<Q & { record: R }> {
  const { parse, key: keyOf } = domain
  function check(v: unknown, code: string): asserts v { if (!v) throw new Error(`${domain.errorPrefix}_${code}`) }
  const plan = structuredClone(params.plan), expectedPacket = params.expectedPacket ? structuredClone(params.expectedPacket) : null
  const { store, adapter, queryOnly, cancelUnsigned, startNew, retireExpired } = params
  check([queryOnly, cancelUnsigned, startNew, retireExpired].filter(Boolean).length <= 1, 'MODE_CONFLICT')
  const key = keyOf(plan)
  return store.exclusive(key, async () => {
    let record = await store.read(key), newAttempt = false
    if (record) record = parse(record)
    check(!expectedPacket || record && record.packet.bytes === expectedPacket.bytes && record.packet.digest === expectedPacket.digest, 'SELECTED_PACKET_CHANGED')
    check(!record || keyOf(record.plan) === key, 'SCOPE_MISMATCH')
    const save = async (next: unknown) => {
      const checked = parse(next); await store.write(key, checked)
      const persisted = await store.read(key)
      check(persisted && publicMutationCanonical(parse(persisted)) === publicMutationCanonical(checked), 'PERSISTENCE_FAILED')
      record = checked
    }
    async function query(): Promise<Q> {
      check(record, 'NOT_FOUND')
      const result = await adapter.query(structuredClone(record))
      check(result && ['MISSING', 'PENDING', 'SUCCEEDED', 'FAILED'].includes(result.status), 'QUERY_INVALID'); return result
    }
    async function reconcile(result: Q) {
      check(record, 'NOT_FOUND')
      if (result.status === 'SUCCEEDED' || result.status === 'FAILED') {
        check(!['SUCCEEDED', 'FAILED'].includes(record.packet.phase) || record.packet.phase === result.status, 'TERMINAL_CONTRADICTION')
        if (record.packet.phase !== result.status) await save({ ...record, packet: { ...record.packet, phase: result.status } })
      } else check(!['SUCCEEDED', 'FAILED'].includes(record.packet.phase), 'RESULT_UNCONFIRMED')
    }
    if (queryOnly) { check(record, 'NOT_FOUND'); return { ...await query(), record } }
    if (record) {
      const observed = await query(); await reconcile(observed)
      if (retireExpired) {
        check(observed.status === 'MISSING' && adapter.retire
          && ['PREPARED', 'SIGNING', 'SIGNED', 'RETIRED'].includes(record.packet.phase), 'RETIREMENT_NOT_ALLOWED')
        const retired = parse(await adapter.retire(structuredClone(record)))
        check(retired.packet.phase === 'RETIRED' && frozen(retired) === frozen(record)
          && retired.packet.signature === record.packet.signature, 'RETIREMENT_PACKET_CHANGED')
        await save(retired); return { ...observed, record: record! }
      }
      if (startNew) {
        check(terminal(record) && observed.status !== 'PENDING', 'RECOVERY_REQUIRED')
        check(['CANCELLED', 'RETIRED'].includes(record.packet.phase) ? observed.status === 'MISSING' : observed.status === record.packet.phase, 'PREVIOUS_RESULT_UNCONFIRMED')
        newAttempt = true
      } else {
        check(publicMutationCanonical(record.plan) === publicMutationCanonical(plan), 'RECOVERY_REQUIRED')
        if (terminal(record) || observed.status === 'PENDING') return { ...observed, record }
        if (cancelUnsigned) {
          check(record.packet.phase === 'PREPARED' && record.packet.signature === null, 'CANNOT_CANCEL_SIGNING')
          await save({ ...record, packet: { ...record.packet, phase: 'CANCELLED' } }); return { ...observed, record: record! }
        }
      }
    } else check(!cancelUnsigned && !retireExpired, 'NOT_FOUND')
    if (!record || newAttempt) {
      const prepared = parse(await adapter.prepare(structuredClone(plan)))
      check(publicMutationCanonical(prepared.plan) === publicMutationCanonical(plan)
        && prepared.packet.phase === 'PREPARED' && prepared.packet.signature === null, 'PREPARATION_MISMATCH')
      await save(prepared)
      const observed = await query(); await reconcile(observed)
      if (observed.status !== 'MISSING') return { ...observed, record: record! }
    }
    check(record, 'NOT_FOUND')
    await adapter.preflight(structuredClone(record), record.packet.phase !== 'SIGNED')
    if (record.packet.phase === 'PREPARED' || record.packet.phase === 'SIGNING') {
      await save({ ...record, packet: { ...record.packet, phase: 'SIGNING' } })
      const signed = await adapter.sign(structuredClone(record!)); check(signed.bytes === record!.packet.bytes, 'WALLET_CHANGED_BYTES')
      const next = parse({ ...record, packet: { ...record!.packet, phase: 'SIGNED', signature: signed.signature } })
      await adapter.verifySignature(structuredClone(next)); await save(next)
    }
    check(record!.packet.phase === 'SIGNED', 'NOT_SIGNED')
    await adapter.preflight(structuredClone(record!), false); await adapter.verifySignature(structuredClone(record!))
    await adapter.broadcast(structuredClone(record!))
    const observed = await query(); await reconcile(observed); return { ...observed, record: record! }
  })
}
