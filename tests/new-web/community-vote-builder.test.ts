import {expect,it} from 'vitest'
import {bcs} from '@mysten/sui/bcs'
import {fromBase64} from '@mysten/sui/utils'
import {buildSetPublicCommunityVoteTx} from '../../packages/soulidity-sdk/src/community-votes'
const id=(n:number)=>`0x${n.toString(16).padStart(64,'0')}`
const intent=()=>({deployment:{community:{profile:{originalPackageId:id(1),callablePackageId:id(2),registryId:id(3),chainIdentifier:'01010101'},registryId:id(4)},registryId:id(5)},
  owner:id(6),actorId:id(7),postId:id(8),expectedRevision:'18446744073709551615',desired:1 as 0|1|2})
it.each([0,1,2] as const)('builds exactly one desired=%s command in actual Move argument order',desired=>{
  const input={...intent(),desired},tx=buildSetPublicCommunityVoteTx(input).getData()
  expect(tx.sender).toBe(input.owner);expect(tx.commands).toHaveLength(1);expect(tx.inputs).toHaveLength(7)
  const call=tx.commands[0].MoveCall!
  expect(call).toMatchObject({package:id(2),module:'community_votes',function:'set_vote',typeArguments:[]})
  expect(call.arguments.map(value=>value.Input)).toEqual([0,1,2,3,4,5,6])
  expect(tx.inputs.slice(0,4).map(value=>value.UnresolvedObject?.objectId)).toEqual([id(5),id(4),id(3),id(8)])
  expect(bcs.Address.parse(fromBase64(tx.inputs[4].Pure!.bytes))).toBe(id(7))
  expect(bcs.u64().parse(fromBase64(tx.inputs[5].Pure!.bytes))).toBe('18446744073709551615')
  expect(bcs.u8().parse(fromBase64(tx.inputs[6].Pure!.bytes))).toBe(desired)
})
it.each(['-1','01','18446744073709551616','1.5',''])('rejects invalid revision %s',expectedRevision=>{
  expect(()=>buildSetPublicCommunityVoteTx({...intent(),expectedRevision})).toThrow('REVISION_INVALID')
})
it.each([-1,3,true,'1',null])('rejects malformed desired %s',desired=>{
  expect(()=>buildSetPublicCommunityVoteTx({...intent(),desired:desired as any})).toThrow('DESIRED_INVALID')
})
it.each(['owner','actorId','postId'])('rejects invalid %s',field=>{
  expect(()=>buildSetPublicCommunityVoteTx({...intent(),[field]:id(0)})).toThrow('INVALID_ID')
})
it('allows self-voting without imposing the follow-only self-relation prohibition',()=>{
  const input=intent();input.actorId=input.owner
  expect(()=>buildSetPublicCommunityVoteTx(input)).not.toThrow()
})
