import { Transaction } from '@mysten/sui/transactions'
import { normalizeStructTag } from '@mysten/sui/utils'

/** Exact read target, supplied by separately verified release/provenance reads.
 * These IDs are not an ownership proof. The single entry derives live authority.
 * SessionKey uses Release's ORIGINAL package ID, not this callable package ID. */
export interface AnimacraftNativeCompleteApprovalV8 {
  releaseCallablePackageId: string
  signer: string
  soulStateId: string
  provenanceBindingId: string
  completeOutputId: string
  receiptId: string
  makerRootId: string
  protocolConfigId: string
  catalogId: string
  releaseConfigId: string
  sealRegistryId: string
  sealPolicyId: string
  paymentCoinType: string
  sealId: number[]
}

/** Read-only Seal TransactionKind builder, never a transaction to sign/broadcast.
 * Seal permits only same-package seal_approve calls with Input arguments; proofs
 * are constructed and consumed internally, not passed from preceding commands. */
export function buildAnimacraftNativeCompleteApprovalV8(input: AnimacraftNativeCompleteApprovalV8): Transaction {
  const p = structuredClone(input)
  const objectKeys = ['soulStateId', 'provenanceBindingId', 'completeOutputId', 'receiptId',
    'makerRootId', 'protocolConfigId', 'catalogId', 'releaseConfigId', 'sealRegistryId', 'sealPolicyId'] as const
  for (const key of ['releaseCallablePackageId', 'signer', ...objectKeys] as const) {
    if (typeof p[key] !== 'string' || !/^0x[0-9a-f]{64}$/.test(p[key]) || /^0x0+$/.test(p[key])) {
      throw new Error(`${key} must be a canonical nonzero ID`)
    }
  }
  if (typeof p.paymentCoinType !== 'string' || !p.paymentCoinType.includes('::')) {
    throw new Error('paymentCoinType must be an explicit Move struct type')
  }
  normalizeStructTag(p.paymentCoinType)
  if (!Array.isArray(p.sealId) || p.sealId.length !== 32
    || p.sealId.some(byte => !Number.isInteger(byte) || byte < 0 || byte > 255)) {
    throw new Error('sealId must contain exactly 32 bytes')
  }
  const tx = new Transaction()
  tx.setSender(p.signer)
  tx.moveCall({ target: `${p.releaseCallablePackageId}::release_v8::seal_approve_complete_v8`,
    typeArguments: [p.paymentCoinType],
    arguments: [tx.pure.vector('u8', p.sealId), ...objectKeys.map(key => tx.object(p[key]))],
  })
  return tx
}
