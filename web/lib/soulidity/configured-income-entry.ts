import { createIncomeExecutionRegistryV1, EMPTY_INCOME_EXECUTION_REGISTRY_V1 } from './commerce/income-execution-source-v1'
import { ROOT_HISTORICAL_EXECUTION_MODEL_INSTALLATIONS_V1 } from '../sui/configured-historical-execution-models-v1'
import { createRootIncomeEntryController } from './commerce/income-entry-controller'
import type { RootIncomeSourceInstallation } from './commerce/income-source-qualification'
import { createIncomeWithdrawalOriginalClient } from './income-withdrawal-original-client'

/** Root-owned compiled installations only. Each exact public manifest/audit
 * anchor must be independently accepted against source/build/deployed bytes.
 * Browser forms, documents, URLs, environment and local storage cannot install
 * entries. Empty by design until genuine deployment qualification is supplied.
 */
const ROOT_ACCEPTED_INCOME_DEPLOYMENTS: readonly RootIncomeSourceInstallation[] = Object.freeze([])
// Separate admission for the permanent receipt table invariant across the effective deployment lineage.
const ROOT_ACCEPTED_FOUNDATION_RETIREMENT_SOURCES: readonly string[] = Object.freeze([])
export function createConfiguredIncomeEntryController() {
  return createRootIncomeEntryController({ installations: ROOT_ACCEPTED_INCOME_DEPLOYMENTS, client: createIncomeWithdrawalOriginalClient, executionModels: ROOT_HISTORICAL_EXECUTION_MODEL_INSTALLATIONS_V1,
    foundationRetirementSourceManifestSha256s: ROOT_ACCEPTED_FOUNDATION_RETIREMENT_SOURCES })
}

/** Original query uses only compiled reusable acceptance. Invalid current
 * configuration must not remove original raw query/export access. */
export function createConfiguredIncomeOriginalExecutionRegistry() {
  try { return { registry: createIncomeExecutionRegistryV1({ models: ROOT_HISTORICAL_EXECUTION_MODEL_INSTALLATIONS_V1, foundationSources: ROOT_ACCEPTED_INCOME_DEPLOYMENTS, foundationRetirementSourceManifestSha256s: ROOT_ACCEPTED_FOUNDATION_RETIREMENT_SOURCES }), error: null } }
  catch { return { registry: EMPTY_INCOME_EXECUTION_REGISTRY_V1, error: '来源或执行模型安装目录不可核验；仅查询原执行事实，提款证据暂不能确认。' } }
}
