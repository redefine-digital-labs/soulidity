import { ROOT_HISTORICAL_EXECUTION_MODEL_INSTALLATIONS_V1 } from '../sui/configured-historical-execution-models-v1'
import { createRootMakerProductIncomeController } from './commerce/maker-product-income-controller'
import type { RootMakerProductIncomeInstallation } from './commerce/maker-product-income-source'
import { createIncomeWithdrawalOriginalClient } from './income-withdrawal-original-client'

/** Separate Root compiled Maker deployment/audit acceptance. Public fields,
 * URL/env/storage/files and controlled fixtures cannot install qualification.
 * The public transport supplies no wallet. Root must explicitly activate execution.
 */
const ROOT_ACCEPTED_MAKER_PRODUCT_INCOME_DEPLOYMENTS: readonly RootMakerProductIncomeInstallation[] = Object.freeze([])
const ROOT_MAKER_PRODUCT_INCOME_EXECUTION_ENABLED = false
// Admit each exact deployment after its permanent receipt-table audit.
const ROOT_ACCEPTED_MAKER_PRODUCT_RETIREMENT_SOURCES: readonly string[] = Object.freeze([])
const ROOT_MAKER_PRODUCT_INCOME_RETIREMENT_ENABLED = false
export function createConfiguredMakerProductIncomeController() {
  return createRootMakerProductIncomeController({ installations: ROOT_ACCEPTED_MAKER_PRODUCT_INCOME_DEPLOYMENTS, client: createIncomeWithdrawalOriginalClient,
    executionEnabled: ROOT_MAKER_PRODUCT_INCOME_EXECUTION_ENABLED ? true : undefined,
    retirementEnabled: ROOT_MAKER_PRODUCT_INCOME_RETIREMENT_ENABLED ? true : undefined,
    retirementSourceManifestSha256s: ROOT_ACCEPTED_MAKER_PRODUCT_RETIREMENT_SOURCES, executionModels: ROOT_HISTORICAL_EXECUTION_MODEL_INSTALLATIONS_V1 })
}
