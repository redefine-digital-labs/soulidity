import { expect, it } from 'vitest'
import { bcs } from '@mysten/sui/bcs'
import { fromHex, toBase64 } from '@mysten/sui/utils'
import { generateContentDocumentIdHex } from '@soulidity/sdk'
import { buildContentApprovalTransaction, parseContentAccessResponse, type SealedContentAccess } from '../../desktop/apps/desktop/src/renderer/lib/soulidity/content-access'
const id = (n: number) => `0x${n.toString(16).padStart(64, '0')}`
function access(kind: SealedContentAccess['accessKind']): SealedContentAccess {
  return { visibility: 'sealed', artifact: { walrusBlobUrl: 'https://walrus.example.com/content', walrusBlobId: 'blob', blobObjectId: id(9) },
    accessPolicy: { packageId: id(1), protocolGateId: id(70), stateObjectId: id(2), contentObjectId: id(3), kind: 2,
      name: 'skill', versionIndex: 4, moduleName: kind === 'paid' ? 'paid_access' : 'content',
      functionName: ({ owner: 'seal_approve_content_owner', 'granted-agent': 'seal_approve_content_granted_agent', public: 'seal_approve_content_public', paid: 'seal_approve_content_paid_access' } as const)[kind],
      soulGrantObjectId: kind === 'granted-agent' ? id(5) : null, paidAccessListOnChainId: kind === 'paid' ? id(6) : null,
      documentIdHex: generateContentDocumentIdHex({ contentObjectId: id(3), kind: 2, name: 'skill', versionIndex: 4n, nonce: new Uint8Array(16).fill(1) }) },
    seal: { network: 'mainnet', threshold: 1, verifyKeyServers: true, serverConfigs: [] },
    sealSidecar: { encryptedDek: '', iv: '', cipher: 'AES-GCM-256', fileName: 'skill.zip', mimeType: 'application/zip', contentHash: 'a'.repeat(64) },
    viewerAddress: id(4), accessKind: kind, sessionTtlMin: 10 }
}
it.each(['owner', 'granted-agent', 'public', 'paid'] as const)('desktop %s approval preserves document first and gate second', kind => {
  const a = access(kind), data = buildContentApprovalTransaction(parseContentAccessResponse(a)).getData(), call = data.commands[0].MoveCall!
  expect(call.function).toBe(a.accessPolicy.functionName)
  expect(data.inputs[call.arguments[0].Input!].Pure?.bytes).toBe(toBase64(bcs.vector(bcs.u8()).serialize(fromHex(a.accessPolicy.documentIdHex)).toBytes()))
  expect(data.inputs[call.arguments[1].Input!].UnresolvedObject?.objectId).toBe(id(70))
  expect(data.inputs[call.arguments[2].Input!].UnresolvedObject?.objectId).toBe(id(2))
  expect(call.arguments).toHaveLength(kind === 'owner' || kind === 'public' ? 7 : 9)
})
it('desktop parser and builder reject missing gate before requesting a session', () => {
  const a = access('owner'); a.accessPolicy.protocolGateId = ''
  expect(() => parseContentAccessResponse(a)).toThrow('protocolGateId')
  expect(() => buildContentApprovalTransaction(a)).toThrow('protocolGateId')
})
