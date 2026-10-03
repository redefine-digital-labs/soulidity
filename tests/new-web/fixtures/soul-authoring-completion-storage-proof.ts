// Storage-only browser harness substitute. Never bundled by the app.
// Production historical verification is separately exercised by completion.test.
import { walrusBatchPreparationHash } from '../../../web/lib/upload/walrus-batch-preparation'
export let pending = false
export function setPending(value: boolean) { pending = value }
export function createSoulAuthoringVerifier({ preparation }: any) {
  return { query: async (record: any) => pending ? { status: 'MISSING' } : {
    status: 'SUCCEEDED', checkpoint: '1', receipt: {
      registration: { preparationHash: walrusBatchPreparationHash(preparation.preparation),
        packet: { bytes: record.packet.bytes, digest: record.packet.digest }, blobs: [] },
      consumption: null, business: { mints: [] },
    },
  } }
}
