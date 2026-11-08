import type { IncomeWithdrawalResumeCapability } from './commerce/income-withdrawal-host-resume'
import { createConfiguredIncomeEntryController } from './configured-income-entry'

/** Root installs a separately qualified source capability here. No deployment
 * environment, current recipient, imported file or test global activates it.
 * Missing qualification leaves the actual recovery route fully read-only.
 */
export function createConfiguredIncomeWithdrawalResumeCapability(): IncomeWithdrawalResumeCapability | null {
  return createConfiguredIncomeEntryController().resumeCapability()
}
