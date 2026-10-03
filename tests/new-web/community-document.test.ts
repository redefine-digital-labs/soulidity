import {expect,it} from 'vitest'
import {createPublicPostDocument,createPublicCommentDocument,encodePublicCommunityDocument,decodePublicCommunityDocument,
  validatePublicCommunityDocument,COMMUNITY_DOCUMENT_MAX_BYTES} from '../../packages/soulidity-sdk/src/community-document'
it('normalizes original trim and case-sensitive comma/array tags without Soul tag restrictions',()=>{
  const post=createPublicPostDocument({title:' Title ',content:' Body ',tags:' Cat,Cat,cat, ,two words '})
  expect(post).toEqual({schema:'soulidity.public-post.v1',title:'Title',content:'Body',tags:['Cat','cat','two words']})
  expect(decodePublicCommunityDocument(encodePublicCommunityDocument(post))).toEqual(post)
  expect(createPublicPostDocument({title:'x',content:'x',tags:['a,b']}).tags).toEqual(['a,b'])
})
it.each([['title',500],['content',50000]] as const)('retains exact %s JS length boundary', (field,max)=>{
  expect(()=>createPublicPostDocument({title:'x',content:'x',[field]:'x'.repeat(max)})).not.toThrow()
  expect(()=>createPublicPostDocument({title:'x',content:'x',[field]:'x'.repeat(max+1)})).toThrow('LENGTH')
  expect(()=>createPublicPostDocument({title:'x',content:'x',[field]:'🦊'.repeat(max/2+1)})).toThrow('LENGTH')
})
it('retains comment10000 boundary and trims composer content',()=>{
  expect(createPublicCommentDocument(' hello ').content).toBe('hello')
  expect(()=>createPublicCommentDocument('x'.repeat(10000))).not.toThrow()
  expect(()=>createPublicCommentDocument('x'.repeat(10001))).toThrow()
})
it.each(['actor','privateKey','report','votes','channel'])('rejects unexpected public field %s',field=>{
  expect(()=>validatePublicCommunityDocument({...createPublicPostDocument({title:'x',content:'x'}),[field]:'secret'})).toThrow('FIELDS')
})
it.each([{title:' x'}, {content:'x '}, {tags:['x','x']}, {tags:[' x']}, {tags:'x'}, {tags:[3]}])('rejects noncanonical incoming content %j',change=>{
  expect(()=>validatePublicCommunityDocument({...createPublicPostDocument({title:'x',content:'x'}),...change})).toThrow()
})
it('bounds UTF8 bytes without inventing a per-tag limit or truncating',()=>{
  expect(()=>createPublicPostDocument({title:'x',content:'x',tags:['a'.repeat(10000)]})).not.toThrow()
  expect(()=>createPublicPostDocument({title:'x',content:'x',tags:['界'.repeat(COMMUNITY_DOCUMENT_MAX_BYTES/2)]})).toThrow('BYTE_LIMIT')
  expect(()=>decodePublicCommunityDocument(new Uint8Array(COMMUNITY_DOCUMENT_MAX_BYTES+1))).toThrow('BYTE_LIMIT')
  expect(()=>decodePublicCommunityDocument(new Uint8Array([255]))).toThrow()
})
