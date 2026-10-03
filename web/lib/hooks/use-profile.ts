'use client'

import { useEffect } from 'react'
import {useCommittedSession,useSessionState,type SessionLease} from './use-committed-session'
import { createPublicProfileSaveIntent, PublicProfileReceiptPersistenceError, type PublicProfileSaveIntent } from '@soulidity/sdk'
import { useAuth } from '@/components/providers/auth-provider'
import { useUploadCostReview } from '@/components/upload/upload-cost-review'
import { useWalletSign } from './use-wallet-sign'
import { getBrowserProfileConfig } from '@/lib/profile/profile-config'
import { browserPublicProfileOperationStore } from '@/lib/profile/profile-operation-client'
import { browserProfileCoverCache } from '@/lib/profile/profile-cover-cache'
import { browserProfileDraftStore, createProfileSaveController, ProfileDraftPersistenceError } from '@/lib/profile/profile-save-controller'
import { acknowledgeWalrusSingleBlobUpload, recoverWalrusSingleBlobUpload, uploadSoulPayload } from '@/lib/upload/client-upload'

export type ProfileUpdateStatus = 'idle' | 'saving' | 'success' | 'pending' | 'error'
export interface ProfileUpdatePayload {
  displayName?: string | null; avatar?: string | null; bio?: string | null; coverImageUrl?: string | null
  handle?: string | null; twitterUrl?: string | null; websiteUrl?: string | null
}
type Controller = ReturnType<typeof createProfileSaveController>
type Pending = ReturnType<Controller['inspect']>

export function useUpdateProfile() {
  const { user, walletAddress, profile, profileError, loading, refresh } = useAuth()
  const { suiGrpcClient, getWalletAddress, signTransaction, walletAccount, currentWallet } = useWalletSign()
  const { requestUploadCostApproval } = useUploadCostReview()
  let config:ReturnType<typeof getBrowserProfileConfig>|null=null,configError:unknown
  try{config=structuredClone(getBrowserProfileConfig())}catch(cause){configError=cause}
  const scope=JSON.stringify([walletAddress,config?.deployment??null])
  const session=useCommittedSession(scope,walletAccount,suiGrpcClient,currentWallet)
  const [status, setStatus] = useSessionState<ProfileUpdateStatus>(session,'idle')
  const [error, setError] = useSessionState<string | null>(session,null)
  const [pending, setPending] = useSessionState<Pending | null>(session,null)
  const [recoveryExport, setRecoveryExport] = useSessionState<string | null>(session,null)

  function context(payload: ProfileUpdatePayload = {},lease:SessionLease|null=session.capture()) {
    function assertCurrent(){
      if(!lease?.matches()||getWalletAddress()!==walletAddress)throw new Error('Profile context changed')
      if(JSON.stringify(getBrowserProfileConfig().deployment)!==JSON.stringify(config?.deployment))throw new Error('Profile release changed')
    }
    assertCurrent()
    if (!walletAddress || !user) throw new Error('Connect the profile owner wallet')
    if(!config)throw configError??new Error('Profile configuration unavailable')
    const getAddress=()=>lease?.matches()?getWalletAddress():null
    const sign:typeof signTransaction=transaction=>{
      assertCurrent()
      return Promise.resolve(signTransaction(transaction)).then(result=>{assertCurrent();return result})
    }
    const execution = { client: suiGrpcClient, getAddress, sign }
    const intent = createPublicProfileSaveIntent({ deployment: config.deployment, owner: walletAddress,
      expected: profile ? { profileId: profile.id, revision: profile.revision } : null,
      handle: payload.handle === undefined ? user.handle : payload.handle,
      metadata: { schema: 'soulidity.public-profile.v1',
        displayName: payload.displayName === undefined ? user.displayName : payload.displayName,
        avatar: payload.avatar === undefined ? user.avatar : payload.avatar,
        bio: payload.bio === undefined ? user.bio : payload.bio,
        coverImageUrl: payload.coverImageUrl === undefined ? user.coverImageUrl : payload.coverImageUrl,
        twitterUrl: payload.twitterUrl === undefined ? user.twitterUrl : payload.twitterUrl,
        websiteUrl: payload.websiteUrl === undefined ? user.websiteUrl : payload.websiteUrl } })
    const controller = createProfileSaveController({ config, client: suiGrpcClient, getAddress,
      sign, operations: browserPublicProfileOperationStore(), drafts: browserProfileDraftStore(), covers: browserProfileCoverCache(),
      uploads: {
        recover: async(operationScope, walletAddress) => {
          assertCurrent()
          const result=await recoverWalrusSingleBlobUpload({ operationScope, walletAddress, execution, attachment: null })
          assertCurrent();return result
        },
        upload: async (file, operationScope, walletAddress) => {
          assertCurrent()
          const result = await uploadSoulPayload({ file, operationScope, walletAddress, execution, attachment: null,
            uploadType: 'public', kind: 'soul-content', confirmQuote: async review=>{
              assertCurrent()
              const approved=await requestUploadCostApproval(review)
              assertCurrent();return approved
            } })
          assertCurrent()
          if (!result.recoveryKey) throw new Error('PROFILE_UPLOAD_RECOVERY_KEY_REQUIRED')
          return { ...result, recoveryKey: result.recoveryKey }
        },
        acknowledge: receipt => {assertCurrent();return acknowledgeWalrusSingleBlobUpload({ recoveryKey: receipt.recoveryKey, certifyDigest: receipt.certifyTxDigest })},
      },
    })
    return { controller, intent }
  }
  function inspect(controller: Controller, intent: PublicProfileSaveIntent) {
    const snapshot = controller.inspect(intent)
    const unfinished = snapshot.operation && !['SUCCEEDED', 'FAILED', 'CANCELLED'].includes(snapshot.operation.phase)
    setPending(snapshot.draft || unfinished ? snapshot : null)
    setRecoveryExport(JSON.stringify(snapshot, null, 2))
  }
  useEffect(() => {
    if (!walletAddress || !user) return
    try { const { controller, intent } = context(); inspect(controller, intent) }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Profile recovery could not be read'); setStatus('error') }
    // Scope inspection must not overwrite the frozen save on a profile refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session])

  async function run(mode: 'save' | 'resume' | 'query' | 'discard', payload: ProfileUpdatePayload = {}, coverFile?: File | null) {
    const lease=session.capture()
    if(!lease?.matches())throw new Error('Profile context changed')
    if(lease.isRunning())throw new Error('Profile save is already running')
    lease.setRunning(true)
    const current=lease.matches
    let ctx: ReturnType<typeof context> | undefined
    if (current()) { setStatus('saving'); setError(null) }
    try {
      if (mode === 'save' && (loading || profileError)) throw new Error('Reload your chain profile before saving')
      ctx = context(payload,lease)
      const result = await ctx.controller.run({ mode, intent: ctx.intent, coverFile })
      if (current()) {
        inspect(ctx.controller, ctx.intent)
        setStatus(result.status === 'saved' ? 'success' : result.status === 'pending' ? 'pending' : 'idle')
        if (result.status === 'saved' || result.status === 'archived') await refresh()
      }
      return result
    } catch (failure) {
      if (current()) {
        if (ctx) { try { inspect(ctx.controller, ctx.intent) } catch { /* retain prior export */ } }
        if (failure instanceof ProfileDraftPersistenceError) setRecoveryExport(JSON.stringify(failure.recovery, null, 2))
        if (failure instanceof PublicProfileReceiptPersistenceError) setRecoveryExport(JSON.stringify(failure.receipt, null, 2))
        setError(failure instanceof Error ? failure.message : 'Profile save failed'); setStatus('error')
      }
      throw failure
    } finally { lease.setRunning(false) }
  }
  return { status, error, pending, recoveryExport,
    updateProfile: (payload: ProfileUpdatePayload, coverFile?: File | null) => run('save', payload, coverFile),
    resumeProfile: (coverFile?: File | null) => run('resume', {}, coverFile),
    queryProfile: () => run('query'), discardProfile: () => run('discard') }
}
