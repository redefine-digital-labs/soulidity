import { Transaction } from '@mysten/sui/transactions'
import { getRequiredSoulidityEnv } from '@/lib/soulidity/env'

const SUI_CLOCK_OBJECT_ID = '0x6'

export function buildAppendSkillVersionTx(params: {
  stateObjectId: string
  skillsObjectId: string
  skillName: string
  blobObjectId: string
  visibility: 'public' | 'private'
  grantObjectId?: string | null
}) {
  const packageId = getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_PACKAGE_ID')
  const tx = new Transaction()
  const target = params.grantObjectId
    ? `${packageId}::skills::append_version_as_granted_agent`
    : `${packageId}::skills::append_version_as_owner`

  tx.moveCall({
    target,
    arguments: params.grantObjectId
      ? [
          tx.object(params.skillsObjectId),
          tx.object(params.stateObjectId),
          tx.object(params.grantObjectId),
          tx.pure.string(params.skillName),
          tx.pure.bool(params.visibility === 'public'),
          tx.object(params.blobObjectId),
          tx.object(SUI_CLOCK_OBJECT_ID),
        ]
      : [
          tx.object(params.skillsObjectId),
          tx.object(params.stateObjectId),
          tx.pure.string(params.skillName),
          tx.pure.bool(params.visibility === 'public'),
          tx.object(params.blobObjectId),
          tx.object(SUI_CLOCK_OBJECT_ID),
        ],
  })

  return tx
}

export function buildDeleteSkillVersionTx(params: {
  stateObjectId: string
  skillsObjectId: string
  skillName: string
  versionIndex: number
  grantObjectId?: string | null
}) {
  const packageId = getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_PACKAGE_ID')
  const tx = new Transaction()
  const target = params.grantObjectId
    ? `${packageId}::skills::delete_version_as_granted_agent`
    : `${packageId}::skills::delete_version_as_owner`

  tx.moveCall({
    target,
    arguments: params.grantObjectId
      ? [
          tx.object(params.skillsObjectId),
          tx.object(params.stateObjectId),
          tx.pure.string(params.skillName),
          tx.pure.u64(params.versionIndex),
          tx.object(params.grantObjectId),
          tx.object(SUI_CLOCK_OBJECT_ID),
        ]
      : [
          tx.object(params.skillsObjectId),
          tx.object(params.stateObjectId),
          tx.pure.string(params.skillName),
          tx.pure.u64(params.versionIndex),
        ],
  })

  return tx
}
