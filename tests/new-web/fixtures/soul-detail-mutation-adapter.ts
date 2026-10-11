import { state } from './soul-detail-browser-state'
export * from '../../../web/lib/soulidity/content-mutation-transaction'
export const getBrowserContentWriteConfig = () => state.appendRuntime.config
export const readBrowserContentWriteState = (params: any) => state.appendRuntime.read(params)
export const createContentMutationAdapter = (params: any) => state.appendRuntime.adapter(params)
