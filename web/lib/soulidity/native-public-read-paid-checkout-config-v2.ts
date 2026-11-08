import { publicMutationCanonical } from '../sui/public-mutation-journal'
import { parseCanonicalNativeWorkbenchTarget, type CanonicalNativeWorkbenchTarget } from './canonical-native-workbench'
import { parseNativePaidReviewEconomics } from './native-paid-review-config'
import type { EconomicsTarget } from './commerce/economics-read'
import type { executeNativePublicReadPaidOriginalV2 } from './native-public-read-paid-execution-v2'

export interface NativePaidCheckoutInstallationV2 {
  activationKey: string
  target: CanonicalNativeWorkbenchTarget
  economics: EconomicsTarget
  execution: Pick<Parameters<typeof executeNativePublicReadPaidOriginalV2>[0], 'isCurrent' | 'qualifySource'>
}

/** Root adds each audited source and release here. Browser configuration can
 * match an installation but cannot grant source qualification. */
export const ROOT_NATIVE_PAID_CHECKOUT_INSTALLATIONS_V2: readonly NativePaidCheckoutInstallationV2[] = Object.freeze([])

export function resolveNativePaidCheckoutV2(
  releaseJson: string,
  economicsJson: string | undefined,
  installations: readonly NativePaidCheckoutInstallationV2[] = ROOT_NATIVE_PAID_CHECKOUT_INSTALLATIONS_V2,
) {
  if (!economicsJson || installations.length === 0) return null
  try {
    const target = parseCanonicalNativeWorkbenchTarget(JSON.parse(releaseJson))
    if (!target.content) return null
    const economics = parseNativePaidReviewEconomics(JSON.parse(economicsJson), target)
    const release = publicMutationCanonical([target, economics])
    const matches = installations.filter(row => publicMutationCanonical([row.target, row.economics]) === release)
    const installation = matches[0]
    return matches.length === 1 && installation.activationKey && installation.execution.isCurrent() ? installation : null
  } catch {
    return null
  }
}
