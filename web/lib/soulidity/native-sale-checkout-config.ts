import type { PinnedMovePackage } from '../sui/pinned-move-package'
import { publicMutationCanonical } from '../sui/public-mutation-journal'
import { parseCanonicalNativeWorkbenchTarget, type CanonicalNativeWorkbenchTarget } from './canonical-native-workbench'
import type { EconomicsTarget } from './commerce/economics-read'
import { parseIncomeObservationTarget } from './commerce/income-source-qualification'

export interface NativeSaleCheckoutRelease {
  target: CanonicalNativeWorkbenchTarget
  economics: EconomicsTarget
  collection: PinnedMovePackage | null
}

/** Root-reviewed Native market deployments. Public environment config can
 * select one installation, and cannot add an installation or unlock signing. */
export const ROOT_NATIVE_SALE_CHECKOUT_RELEASES: readonly NativeSaleCheckoutRelease[] = Object.freeze([])

export function nativeSaleCheckoutInstalled(release: NativeSaleCheckoutRelease) {
  return ROOT_NATIVE_SALE_CHECKOUT_RELEASES.filter(entry => publicMutationCanonical(entry) === publicMutationCanonical(release)).length === 1
}

export function resolveNativeSaleCheckout(targetJson?: string, economicsJson?: string) {
  if (!targetJson || !economicsJson || !ROOT_NATIVE_SALE_CHECKOUT_RELEASES.length) return null
  try {
    const target = parseCanonicalNativeWorkbenchTarget(JSON.parse(targetJson))
    const economics = parseIncomeObservationTarget(JSON.parse(economicsJson))
    const pair = publicMutationCanonical([target, economics])
    const rows = ROOT_NATIVE_SALE_CHECKOUT_RELEASES.filter(row => publicMutationCanonical([row.target, row.economics]) === pair)
    return rows.length === 1 && target.custody && target.content && target.configId === economics.configId ? structuredClone(rows[0]) : null
  } catch { return null }
}
