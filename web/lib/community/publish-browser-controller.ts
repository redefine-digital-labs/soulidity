import { createCommunityPublishController } from './publish-controller'
import { browserCommunityPublishJournalStore } from './publish-journal'
import { browserPublicCommunityPublishOperationStore } from './publish-operation-client'
import { acknowledgeWalrusSingleBlobUpload, recoverWalrusSingleBlobUpload, uploadSoulPayload } from '../upload/client-upload'

/** Original paid browser uploader, not a new server/transport. The controller
 * owns the parent journal; this adapter keeps the register/certify child scope. */
export function createBrowserCommunityPublishController(params: Omit<Parameters<typeof createCommunityPublishController>[0],
  'journals' | 'operations' | 'uploads'> & {
    confirmQuote: NonNullable<Parameters<typeof uploadSoulPayload>[0]['confirmQuote']>
  }) {
  const { client, getAddress, sign, writesEnabled, confirmQuote } = params
  const chainIdentifier = params.config.deployment.profile.chainIdentifier
  function uploadNetwork() {
    const network = process.env.NEXT_PUBLIC_SUI_NETWORK === 'mainnet' ? '35834a8a' : '4c78adac'
    if (network !== chainIdentifier) throw new Error('COMMUNITY_PUBLISH_UPLOAD_NETWORK_MISMATCH')
  }
  const execution = { client, getAddress, sign, beforeWrite: async () => {
    uploadNetwork()
    if (!writesEnabled()) throw new Error('COMMUNITY_PUBLISH_WRITES_DISABLED')
  } }
  return createCommunityPublishController({ ...params, journals: browserCommunityPublishJournalStore(),
    operations: browserPublicCommunityPublishOperationStore(), uploads: {
      recover: (operationScope, walletAddress) => {
        uploadNetwork()
        return recoverWalrusSingleBlobUpload({ operationScope, walletAddress, execution, attachment: null })
      },
      upload: async (file, operationScope, walletAddress) => {
        uploadNetwork()
        const result = await uploadSoulPayload({ file, operationScope, walletAddress, execution, attachment: null,
          uploadType: 'public', kind: 'soul-content', confirmQuote })
        if (!result.recoveryKey) throw new Error('COMMUNITY_PUBLISH_UPLOAD_RECOVERY_KEY_REQUIRED')
        return { ...result, recoveryKey: result.recoveryKey }
      },
      acknowledge: result => acknowledgeWalrusSingleBlobUpload({ recoveryKey: result.recoveryKey, certifyDigest: result.certifyTxDigest }),
    },
  })
}
