'use client'

import { useEffect } from 'react'
import {useCommittedSession,useSessionState} from './use-committed-session'
import { useCurrentAccount, useCurrentWallet, useSignTransaction, useSuiClient } from '@mysten/dapp-kit'
import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { browserEquipmentOperationStore, equipmentOperationKey, runEquipmentOperation, terminalEquipmentOperation,
  type EquipmentOperation, type EquipmentOperationRecord, type EquipmentSnapshot } from '@/lib/animacraft/equipment-operation'
import { createEquipmentOperationAdapter } from '@/lib/animacraft/equipment-operation-adapter'

export function useNativeEquipmentActions(params: {
  soulId: string; snapshot?: EquipmentSnapshot; read: (operation?: EquipmentOperation) => Promise<EquipmentSnapshot>; onChanged: () => void
}) {
  const account = useCurrentAccount(); const client = useSuiClient()
  const {currentWallet}=useCurrentWallet()
  const { mutateAsync: signTransaction } = useSignTransaction()
  const address = account?.address ?? null
  const scope = JSON.stringify([params.soulId,address,params.snapshot?.release])
  const session=useCommittedSession(scope,account,client,currentWallet)
  const [record, setRecord] = useSessionState<EquipmentOperationRecord | null>(session,null)
  const [error, setError] = useSessionState<string | null>(session,null)
  const [notice, setNotice] = useSessionState<string | null>(session,null)
  const [busy, setBusy] = useSessionState(session,false)
  useEffect(() => {
    if (address) {
      try { setRecord(browserEquipmentOperationStore().read(equipmentOperationKey(params.soulId, address))) }
      catch (cause) { setError(cause instanceof Error ? cause.message : 'Equipment recovery storage unavailable') }
    }
  }, [session, address, params.soulId])
  const visibleRecord = record?.soulId === params.soulId && record.owner === address ? record : null
  const pending = visibleRecord !== null && !terminalEquipmentOperation(visibleRecord)
  const canStart = Boolean(account && params.snapshot?.owner === address && !params.snapshot.listed
    && params.snapshot.release?.writesEnabled && !busy && !pending)
  async function run(operation?: EquipmentOperation, queryOnly = false, cancelUnsigned = false) {
    const lease=session.capture()
    if (!address || !account || !lease?.matches() || lease.isRunning()) return
    const matches=lease.matches
    lease.setRunning(true)
    setBusy(true); setError(null); setNotice(null)
    try {
      const grpc = (client as unknown as { grpc?: SuiGrpcClient }).grpc
      if (!grpc) throw new Error('The verified gRPC wallet client is required')
      const adapter = createEquipmentOperationAdapter({ client: grpc, observed: params.snapshot,
        getAddress: () => matches() ? address : null,
        read: async operation=>{
          if(!matches())throw new Error('Equipment session changed')
          const result=await params.read(operation)
          if(!matches())throw new Error('Equipment session changed')
          return result
        },
        sign: transaction => {
          if(!matches())throw new Error('Wallet changed before equipment signature')
          return Promise.resolve(signTransaction({ transaction, account, chain: 'sui:mainnet' })).then(result=>{
            if(!matches())throw new Error('Wallet changed during equipment signature')
            return result
          })
        },
        onSnapshot: () => { if (matches()) params.onChanged() },
      })
      const value = await runEquipmentOperation({ soulId: params.soulId, owner: address, operation, queryOnly,
        store: browserEquipmentOperationStore(), adapter, cancelUnsigned,
        onRecord: value => { if (matches()) setRecord(value) },
      })
      if (matches()) { setRecord(value); params.onChanged() }
    } catch (cause) {
      if (matches()) {
        if (cause instanceof Error && 'code' in cause && cause.code === 'NO_CHANGE') {
          setNotice(cause.message); params.onChanged(); return
        }
        setError(cause instanceof Error ? cause.message : 'Equipment result is unknown. Check the saved transaction before retrying.')
        try { setRecord(browserEquipmentOperationStore().read(equipmentOperationKey(params.soulId, address))) } catch { /* Preserve the original storage error. */ }
      }
    } finally { lease.setRunning(false);if (matches()) setBusy(false) }
  }
  return { record: visibleRecord, error, notice, busy, pending, canStart, start: (operation: EquipmentOperation) => run(operation),
    resume: () => run(), check: () => run(undefined, true), cancelUnsigned: () => run(undefined, false, true) }
}
