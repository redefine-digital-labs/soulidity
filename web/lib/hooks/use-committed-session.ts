'use client'

import {useLayoutEffect,useState,type SetStateAction} from 'react'

/** One committed activation. Revocation is permanent, including StrictMode's
 * cleanup/setup replay: an old asynchronous operation never acquires a new lease. */
export class SessionLease {
  readonly requests=new Set<AbortController>()
  private active=true
  private running=false
  matches=()=>this.active
  isRunning=()=>this.running
  setRunning(value:boolean){this.running=value}
  revoke(){this.active=false;for(const request of this.requests)request.abort()}
}

export class CommittedSession {
  private lease:SessionLease|null=null
  constructor(readonly key:string,readonly account:unknown,readonly client:unknown,readonly wallet:unknown,readonly generation=1){}
  activate(){
    const lease=new SessionLease()
    this.lease=lease
    return ()=>{lease.revoke();if(this.lease===lease)this.lease=null}
  }
  capture=()=>this.lease
  matches=()=>this.lease?.matches()===true
}

export function useCommittedSession(key:string,account:unknown,client:unknown,wallet:unknown){
  const [session,setSession]=useState(()=>new CommittedSession(key,account,client,wallet))
  if(session.key!==key||session.account!==account||session.client!==client||session.wallet!==wallet){
    setSession(new CommittedSession(key,account,client,wallet,session.generation+1))
  }
  // A discarded render never touches the committed session. Layout cleanup
  // revokes its capabilities before the replacement's layout subscribers run.
  useLayoutEffect(()=>session.activate(),[session])
  return session
}

/** UI values carry their render identity; no render reads a mutable lease/ref.
 * The conditional adjustment is confined to this component's state. */
export function useSessionState<T>(session:CommittedSession,initial:T){
  const [state,setState]=useState({session,value:initial})
  if(state.session!==session)setState({session,value:initial})
  function update(value:SetStateAction<T>){
    setState(previous=>previous.session!==session?previous:({session,value:typeof value==='function'
      ?(value as (previous:T)=>T)(previous.value):value}))
  }
  return [state.session===session?state.value:initial,update] as const
}
