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

export function buildPurgeDeletedSkillVersionTx(params: {
  stateObjectId: string
  skillsObjectId: string
  skillName: string
  versionIndex: number
}) {
  const packageId = getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_PACKAGE_ID')
  const tx = new Transaction()
  tx.moveCall({
    target: `${packageId}::skills::purge_deleted_version_as_owner`,
    arguments: [
      tx.object(params.skillsObjectId),
      tx.object(params.stateObjectId),
      tx.pure.string(params.skillName),
      tx.pure.u64(params.versionIndex),
    ],
  })
  return tx
}

export function buildInitSkillsAndAppendAsOwnerTx(params: {
  stateObjectId: string
  skillName: string
  blobObjectId: string
  visibility: 'public' | 'private'
}) {
  const packageId = getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_PACKAGE_ID')
  const tx = new Transaction()
  const skills = tx.moveCall({
    target: `${packageId}::market::init_skills_and_append_as_owner`,
    arguments: [
      tx.object(params.stateObjectId),
      tx.pure.string(params.skillName),
      tx.pure.bool(params.visibility === 'public'),
      tx.object(params.blobObjectId),
      tx.object(SUI_CLOCK_OBJECT_ID),
    ],
  })
  tx.moveCall({
    target: `${packageId}::market::finalize_soul_skills`,
    arguments: [skills],
  })
  return tx
}

/**
 * Build a single PTB that initializes the SoulSkills root with a first
 * version and appends N more versions to it before finalizing — all in
 * one wallet signature. Used when the user uploads "first skills root +
 * N additional versions" in the same action.
 *
 * The caller MUST own the soul (Move enforces `soul::assert_owner`).
 */
export function buildInitAndBatchAppendSkillsTx(params: {
  stateObjectId: string
  initialVersion: {
    skillName: string
    blobObjectId: string
    visibility: 'public' | 'private'
  }
  additionalVersions?: ReadonlyArray<{
    skillName: string
    blobObjectId: string
    visibility: 'public' | 'private'
  }>
}) {
  const packageId = getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_PACKAGE_ID')
  const tx = new Transaction()
  const skills = tx.moveCall({
    target: `${packageId}::market::init_skills_and_append_as_owner`,
    arguments: [
      tx.object(params.stateObjectId),
      tx.pure.string(params.initialVersion.skillName),
      tx.pure.bool(params.initialVersion.visibility === 'public'),
      tx.object(params.initialVersion.blobObjectId),
      tx.object(SUI_CLOCK_OBJECT_ID),
    ],
  })
  for (const extra of params.additionalVersions ?? []) {
    tx.moveCall({
      target: `${packageId}::skills::append_version_as_owner`,
      arguments: [
        skills,
        tx.object(params.stateObjectId),
        tx.pure.string(extra.skillName),
        tx.pure.bool(extra.visibility === 'public'),
        tx.object(extra.blobObjectId),
        tx.object(SUI_CLOCK_OBJECT_ID),
      ],
    })
  }
  tx.moveCall({
    target: `${packageId}::market::finalize_soul_skills`,
    arguments: [skills],
  })
  return tx
}
