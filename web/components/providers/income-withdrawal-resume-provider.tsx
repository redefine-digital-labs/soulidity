'use client'
import React, { createContext, useContext, useState, type ReactNode } from 'react'
import type { IncomeWithdrawalResumeCapability } from '../../lib/soulidity/commerce/income-withdrawal-host-resume'
import { createConfiguredIncomeWithdrawalResumeCapability } from '../../lib/soulidity/configured-income-withdrawal-resume'

const missing = '当前来源与提款主机尚未取得恢复核对资格。仍可查询原结果和下载原件。'
const Context = createContext<{ capability: IncomeWithdrawalResumeCapability | null; disabledReason: string | null }>({ capability: null, disabledReason: missing })
export function IncomeWithdrawalResumeProvider({ children, capability }: { children: ReactNode; capability?: IncomeWithdrawalResumeCapability | null }) {
  const [configured] = useState(() => {
    try { return { capability: createConfiguredIncomeWithdrawalResumeCapability(), error: null as string | null } }
    catch { return { capability: null, error: missing } }
  })
  const selected = capability === undefined ? configured.capability : capability
  return <Context.Provider value={{ capability: selected, disabledReason: selected ? null : configured.error ?? missing }}>{children}</Context.Provider>
}
export function useIncomeWithdrawalResumeCapability() { return useContext(Context) }
