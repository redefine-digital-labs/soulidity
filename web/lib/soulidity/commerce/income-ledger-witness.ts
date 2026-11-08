import type { EconomicsConfigBcs } from './economics-bcs'
import { commerceCheck } from './economics-read'

export interface IncomeLedgerWitness {
  configId: string
  initialSharedVersion: string
  version: string
  digest: string
  revision: string
  balance: string
  collected: string
  withdrawn: string
  requestsTableId: string
  requests: string
}

/** The caller authenticates the full Config object and supplies its chain reference. */
export function incomeLedgerWitness(
  config: ReturnType<typeof EconomicsConfigBcs.parse>,
  reference: { version: string; digest: string },
  initialSharedVersion: string,
): IncomeLedgerWitness {
  const income = config.income
  commerceCheck(income.root === config.id && BigInt(income.collected) - BigInt(income.withdrawn) === BigInt(income.funds)
    && BigInt(income.requests.size) <= BigInt(income.revision), 'INCOME_LEDGER_WITNESS')
  return { ...reference, configId: config.id, initialSharedVersion, revision: income.revision, balance: income.funds,
    collected: income.collected, withdrawn: income.withdrawn, requestsTableId: income.requests.id, requests: income.requests.size }
}

/** Relate two already authenticated snapshots of the same root-bound ledger. */
export function relateIncomeLedgerWitness(earlier: IncomeLedgerWitness, later: IncomeLedgerWitness) {
  commerceCheck(earlier.configId === later.configId && earlier.initialSharedVersion === later.initialSharedVersion
    && earlier.requestsTableId === later.requestsTableId, 'INCOME_LEDGER_LINEAGE')
  const version = BigInt(later.version) - BigInt(earlier.version)
  const revision = BigInt(later.revision) - BigInt(earlier.revision)
  const collected = BigInt(later.collected) - BigInt(earlier.collected)
  const withdrawn = BigInt(later.withdrawn) - BigInt(earlier.withdrawn)
  const requests = BigInt(later.requests) - BigInt(earlier.requests)
  const exact = version === 0n
  commerceCheck(version >= 0n && exact === (earlier.digest === later.digest)
    && (!exact || revision === 0n && collected === 0n && withdrawn === 0n && requests === 0n && earlier.balance === later.balance)
    && revision >= 0n && collected >= 0n && withdrawn >= 0n && requests >= 0n && requests <= revision
    && (withdrawn > 0n) === (requests > 0n)
    && (collected > 0n) === (revision > requests)
    && BigInt(later.balance) - BigInt(earlier.balance) === collected - withdrawn, 'INCOME_LEDGER_CONTINUITY')
  return { kind: exact ? 'SAME_CONFIG_REFERENCE' as const : 'INTERVENING_CONFIG_WRITES' as const,
    revisionDelta: String(revision), collectedDelta: String(collected), withdrawnDelta: String(withdrawn),
    withdrawalRequestsDelta: String(requests) }
}
