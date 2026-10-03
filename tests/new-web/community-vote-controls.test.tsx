// @vitest-environment jsdom
import React,{act} from 'react'
import {createRoot,type Root} from 'react-dom/client'
import {beforeEach,afterEach,expect,it,vi} from 'vitest'
import {VoteControls} from '../../web/components/community/vote-controls'
const f=vi.hoisted(()=>({auth:{} as any,status:{} as any,operation:{} as any,login:vi.fn()}))
vi.mock('../../web/components/providers/auth-provider',()=>({useAuth:()=>f.auth}))
vi.mock('../../web/lib/hooks/use-wallet-vote',()=>({useWalletVoteStatus:()=>f.status,useWalletVoteOperation:()=>f.operation}))
vi.mock('../../web/lib/hooks/use-login',()=>({useLogin:()=>f.login}))
vi.mock('next/link',()=>({default:({href,children}:any)=><a href={href}>{children}</a>}))
let root:Root,host:HTMLDivElement
beforeEach(()=>{
  vi.stubGlobal('React',React);vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);f.login.mockClear()
  f.auth={walletAddress:'wallet',loading:false,profileError:null,refresh:vi.fn(async()=>{})}
  f.status={data:{state:0,score:'-18446744073709551615',viewer:{id:'profile'}},isPending:false,isFetching:false,error:null,refetch:vi.fn()}
  f.operation={record:null,error:null,busy:false,recoveryExport:null,setVote:vi.fn(async()=>{}),query:vi.fn(async()=>{}),resume:vi.fn(async()=>{}),cancel:vi.fn(async()=>{})}
  host=document.createElement('div');document.body.append(host);root=createRoot(host)
})
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals()})
const button=(name:string)=>[...host.querySelectorAll('button')].find(node=>node.getAttribute('aria-label')===name||node.textContent===name)!
async function render(){await act(async()=>root.render(<VoteControls postId={`0x${'1'.repeat(64)}`}/>))}
it.each([[0,'Upvote',1],[0,'Downvote',2],[1,'Upvote',0],[1,'Downvote',2],[2,'Upvote',1],[2,'Downvote',0]] as const)('state%s %s requests%s without optimistic score mutation',async(state,name,desired)=>{
  f.status.data.state=state;await render();await act(async()=>button(name).click())
  expect(f.operation.setVote).toHaveBeenCalledWith(f.status.data,desired)
  expect(host.querySelector('[aria-label="Vote score"]')!.textContent).toBe('-18446744073709551615')
})
it('preserves sign-in action for anonymous voting',async()=>{
  f.auth.walletAddress=null;f.status.data.viewer=null;await render();await act(async()=>button('Upvote').click())
  expect(f.login).toHaveBeenCalledOnce();expect(f.operation.setVote).not.toHaveBeenCalled()
})
it('requires a registered profile when a wallet is connected',async()=>{
  f.status.data.viewer=null;await render();expect(button('Upvote').disabled).toBe(true)
  expect(host.textContent).toContain('Create your chain profile');expect(host.querySelector('a')?.href).toContain('/profile')
})
it('shows read failure instead of cached score or zero and permits retry',async()=>{
  f.status.error=new Error('offline');await render()
  expect(button('Upvote').disabled).toBe(true);expect(host.querySelector('[aria-label="Vote score"]')!.textContent).toBe('Unavailable')
  await act(async()=>button('Retry vote read').click());expect(f.status.refetch).toHaveBeenCalledOnce()
})
it.each(['PREPARED','SIGNING','SIGNED'])('retains %s recovery and allows unsigned cancel only for PREPARED',async phase=>{
  f.operation.record={phase};f.operation.recoveryExport='saved';await render()
  expect(button('Upvote').disabled).toBe(true);expect(host.textContent).toContain('not yet confirmed')
  expect(!!button('Cancel unsigned transaction')).toBe(phase==='PREPARED')
  await act(async()=>button('Check result').click());await act(async()=>button('Resume same transaction').click())
  expect(f.operation.query).toHaveBeenCalledOnce();expect(f.operation.resume).toHaveBeenCalledOnce()
  expect(button('Export recovery record')).toBeTruthy()
})
it('renders operation errors with reload rather than hiding the failure',async()=>{
  f.operation.error='signed record could not be persisted';await render()
  expect(host.textContent).toContain('signed record could not be persisted')
  await act(async()=>button('Reload vote state').click());expect(f.status.refetch).toHaveBeenCalledOnce()
})
