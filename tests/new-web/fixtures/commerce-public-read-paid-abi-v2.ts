import {vi} from 'vitest'
import {activityEvidenceFixture,activityGenesis,aid} from './activity-transaction-evidence'
import {verifyNativePublicReadPaidV2Interfaces} from '../../../web/lib/soulidity/commerce/native-public-read-paid-interface-v2'
export async function publicReadPaidAbiV2Fixture() {
  const n = await activityEvidenceFixture(), f = await activityEvidenceFixture()
  const np = n.packageData.data.Package!, fp = f.packageData.data.Package!
  np.moduleMap = new Map([['birth', new Uint8Array([1])], ['registry', new Uint8Array([1])]])
  np.typeOriginTable = ['birth::PublicReadHostV2', 'birth::PublicReadLinkV2', 'registry::Registry'].map(value => ({ moduleName: value.split('::')[0], datatypeName: value.split('::')[1], package: aid(42) }))
  f.deployment.originalPackageId = aid(44); f.deployment.callablePackageId = aid(45)
  fp.id = aid(45); fp.moduleMap = new Map([['economics', new Uint8Array([1])]])
  fp.typeOriginTable = [{ moduleName: 'economics', datatypeName: 'Config', package: aid(44) }]; f.rehashPackage()
  np.linkageTable = new Map([[aid(44), { upgradedId: aid(45), upgradedVersion: '2' }]]); n.rehashPackage()
  const primitive = (kind: string) => ({ reference: null, body: { $kind: kind } })
  const vector = { $kind: 'vector', vector: { $kind: 'u8' } }, t0 = { $kind: 'typeParameter', index: 0 }
  const data = (typeName: string, reference: string | null = null, typeParameters: any[] = []) => ({ reference, body: { $kind: 'datatype', datatype: { typeName, typeParameters } } })
  const generic = () => [{ constraints: [], isPhantom: false }]
  const base = { packageId: aid(43), moduleName: 'birth', visibility: 'public', isEntry: false }
  const buy: any = { ...base, name: 'buy_public_read_paid_v2', typeParameters: generic(), returns: [], parameters: [
    data(`${aid(42)}::registry::Registry`, 'immutable'), data(`${aid(44)}::economics::Config`, 'mutable', [t0]), data('0x2::kiosk::Kiosk', 'immutable'),
    data(`${aid(42)}::birth::PublicReadHostV2`, 'mutable'), primitive('u32'), { reference: null, body: vector }, data('0x1::option::Option', null, [vector]),
    primitive('u64'), primitive('u64'), { reference: null, body: vector }, data('0x2::coin::Coin', null, [t0]), data('0x2::clock::Clock', 'immutable'), data('0x2::tx_context::TxContext', 'mutable'),
  ] }
  const quote: any = { ...base, name: 'quote_public_read_paid_v2', typeParameters: generic(), parameters: [data(`${aid(44)}::economics::Config`, 'immutable', [t0]), data(`${aid(42)}::birth::PublicReadHostV2`, 'immutable'), primitive('u32')], returns: [{ reference: null, body: vector }, primitive('u64')] }
  const approval = { ...base, name: 'seal_approve_content_paid_v2', typeParameters: [], returns: [], parameters: [
    { reference: null, body: vector }, data('0x2::kiosk::Kiosk','immutable'), data(`${aid(42)}::birth::PublicReadHostV2`,'immutable'),
    primitive('u64'), data('0x2::clock::Clock','immutable'), data('0x2::tx_context::TxContext','immutable'),
  ] }
  const client: any = { ledgerService: { getObject: vi.fn(async (r: any) => ({ response: { object: r.objectId === aid(45) ? f.pkg : n.pkg } })) },
    core: { getChainIdentifier: vi.fn(async () => ({ chainIdentifier: activityGenesis })), getMoveFunction: vi.fn(async (r: any) => ({ function: [quote,buy,approval].find(fn=>fn.name===r.name) })) } }
  const run = () => verifyNativePublicReadPaidV2Interfaces({ client, native: n.deployment, foundation: f.deployment, signal: new AbortController().signal })
  return { n, f, np, buy, quote, approval, client, run }
}
