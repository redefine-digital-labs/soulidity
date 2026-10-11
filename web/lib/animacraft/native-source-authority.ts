import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { parseStructTag } from '@mysten/sui/utils'
import { NativeReceiveError, receiveId, type NativeReceiveTarget } from './native-receive'

/** Shared pinned source types for selection configuration and content-only rendering. */
export async function readNativeSourceAuthority(client: SuiGrpcClient, target: NativeReceiveTarget) {
  const check: (value: unknown, message: string) => asserts value = (value, message) => {
    if (!value) throw new NativeReceiveError('NATIVE_EQUIPMENT_SOURCE_INVALID', message)
  }
  const pin = target.runtime
  check(pin, 'Exact Runtime target required')
  const getPackage = async (id: string) => (await client.ledgerService.getObject({ objectId: id,
    readMask: { paths: ['object_id', 'version', 'digest', 'owner', 'package'] } })).response.object
  const [native, runtime, output] = await Promise.all([getPackage(target.soulidityCallablePackageId),
    getPackage(pin.callablePackageId), getPackage(target.outputCallablePackageId)])
  check(native?.objectId === target.soulidityCallablePackageId && native.digest === target.soulidityCallableDigest
    && runtime?.objectId === pin.callablePackageId && runtime.digest === pin.callableDigest
    && output?.objectId === target.outputCallablePackageId && output.digest === target.outputCallableDigest, 'Source package pin mismatch')
  for (const [object, original] of [[native, target.soulidityOriginalPackageId], [runtime, pin.originalPackageId],
    [output, target.outputOriginalPackageId]] as const) {
    check(object.owner?.kind === 4 && object.package && object.package.storageId === object.objectId
      && object.package.originalId === original && object.package.version === object.version, 'Source package identity mismatch')
  }
  for (const parent of [native, output]) {
    const links = parent.package!.linkage.filter(link => link.originalId === pin.originalPackageId)
    check(links.length === 1 && links[0].upgradedId === pin.callablePackageId
      && links[0].upgradedVersion === runtime.version, 'Source Runtime linkage mismatch')
  }
  const links = [native, runtime].map(p => p.package?.linkage.filter(r => r.originalId === target.coreOriginalPackageId))
  check(links[0]?.length === 1 && links[1]?.length === 1 && links[0][0].upgradedId === links[1][0].upgradedId
    && links[0][0].upgradedVersion === links[1][0].upgradedVersion, 'Source Core linkage mismatch')
  const coreId = receiveId(links[0][0].upgradedId); const core = await getPackage(coreId)
  check(core?.objectId === coreId && core.owner?.kind === 4 && core.version === links[0][0].upgradedVersion
    && core.package?.storageId === coreId && core.package.originalId === target.coreOriginalPackageId
    && core.package.version === core.version, 'Source Core package mismatch')
  const origin = (role: 'core' | 'runtime', module: string, name: string) => {
    const pkg = role === 'core' ? core.package : runtime.package
    const rows = pkg?.typeOrigins.filter(r => r.moduleName === module && r.datatypeName === name)
    check(rows?.length === 1 && pkg?.modules.some(m => m.name === module && m.contents && m.contents.length > 4), 'Source type origin missing')
    return `${receiveId(rows[0].packageId)}::${module}::${name}`
  }
  return { native, runtime, core, origin, rt: (name: string) => origin('runtime', 'runtime_v8', name),
    baseType: (name: string) => origin('core', 'base_registry_v8', name),
    rootType: origin('core', 'maker_v8', 'MakerRootV8'),
    coreMarkerId: parseStructTag(origin('core', 'protocol_config_v8', 'CorePackageMarkerV8')).address }
}
