import { state } from './soul-detail-browser-state'
export * from '../../../web/lib/soulidity/content-append-operation'
export * from '../../../web/lib/soulidity/content-append-preparation'
export * from '../../../web/lib/soulidity/browser-content-write-state'
export const getBrowserContentWriteConfig = () => state.appendRuntime.config
export const getBrowserContentSealConfig = () => state.appendRuntime.sealConfig
export const readBrowserContentWriteState = (params: any) => state.appendRuntime.read(params)
export const prepareContentAppend = (params: any) => state.appendRuntime.prepare(params)
export const runContentAppend = async (params: any) => {
  try { return await state.appendRuntime.run(params) }
  finally { state.notify() }
}
