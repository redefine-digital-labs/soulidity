import { state } from './soul-detail-browser-state'
export * from '../../../web/lib/soulidity/soul-access-operation'
export const getBrowserContentWriteConfig = () => state.appendRuntime.config
export const readBrowserContentWriteState = (params:any) => state.appendRuntime.read(params)
export const createSoulAccessAdapter = (params:any) => state.appendRuntime.adapter(params)
