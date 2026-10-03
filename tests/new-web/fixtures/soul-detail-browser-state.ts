import type { ChainSoulDetail } from '../../../web/lib/soulidity/soul-detail-model'

// Test-only state. No user wallet, live deployment or business backend.
export const state: {
  soul: ChainSoulDetail | null; crypto: any; account: { address: string } | null;
  wallet: object; notify: () => void; visitor: boolean; appendRuntime: any
} = { soul: null, crypto: null, account: null, wallet: {}, notify: () => {}, visitor: false, appendRuntime: null }
export const formAppend = { pending: false, submitted: '', complete: null as (() => void) | null,
  fail: null as (() => void) | null, cancel: null as (() => void) | null }
export async function controlledFormAppend(input: { file: File }) {
  if (!new URLSearchParams(location.search).has('append-form')) return unavailable()
  formAppend.submitted = await input.file.text()
  formAppend.pending = true; state.notify()
  return new Promise<{ versionIndex: string } | undefined>((resolve, reject) => {
    const settle = (error?: Error, cancelled = false) => {
      formAppend.pending = false; formAppend.complete = null; formAppend.fail = null; formAppend.cancel = null
      state.notify(); error ? reject(error) : resolve(cancelled ? undefined : { versionIndex: '1' })
    }
    formAppend.complete = () => settle()
    formAppend.fail = () => settle(new Error('Controlled append rejected; draft retained'))
    formAppend.cancel = () => settle(undefined, true)
    state.notify()
  })
}
export const unavailable = async () => { throw new Error('Write operations are not enabled in this read-only fixture') }
export const formGrant = { pending:false, submitted:'', complete:null as (()=>void)|null }
export function controlledFormGrant(address:string, expiry:unknown, scope:number) {
  if(!new URLSearchParams(location.search).has('grant-form')) return unavailable()
  formGrant.pending=true; formGrant.submitted=JSON.stringify({address,expiry,scope})
  return new Promise<void>(resolve=>{
    formGrant.complete=()=>{formGrant.pending=false;formGrant.complete=null;state.notify();resolve()}
    state.notify()
  })
}
