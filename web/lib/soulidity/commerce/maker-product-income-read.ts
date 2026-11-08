import { captureMakerProductIncomeClient } from './maker-product-income-client'
import { bcs } from '@mysten/sui/bcs'
import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { normalizeStructTag } from '@mysten/sui/utils'
import { MAINNET_GENESIS_DIGEST } from '../../animacraft/mainnet-chain'
import { CurrentMakerProductBcs } from '../../animacraft/current-maker-product-bcs'
import { validateCurrentMakerPackage } from '../../animacraft/current-maker-transactions'
import { readPinnedMovePackage, type PinnedMovePackage } from '../../sui/pinned-move-package'
import { commerceCheck, commerceId, decodeCommerce, readCommerceObject } from './economics-read'

export const MakerProductControlBcs = bcs.struct('Control', { id: bcs.Address, product: bcs.Address })
export interface MakerProductIncomeTarget {
  chainIdentifier: string; protocolId: string; productId: string; coinType: string
  manufacturing: PinnedMovePackage; foundation: PinnedMovePackage
}
/** Public observation target only; no source installation or authority. */
export function parseMakerProductIncomeTarget(input: MakerProductIncomeTarget): MakerProductIncomeTarget {
  const target = structuredClone(input)
  commerceCheck(target && Object.keys(target).sort().join() === ['chainIdentifier', 'coinType', 'foundation', 'manufacturing', 'productId', 'protocolId'].sort().join(), 'MAKER_INCOME_TARGET_FIELDS')
  commerceCheck(target.chainIdentifier === '35834a8a' && commerceId(target.protocolId) && commerceId(target.productId) && target.protocolId !== target.productId, 'MAKER_INCOME_TARGET')
  commerceCheck(typeof target.coinType === 'string' && target.coinType.length > 0 && target.coinType.length <= 2048 && normalizeStructTag(target.coinType) === target.coinType, 'MAKER_INCOME_COIN')
  for (const role of ['manufacturing', 'foundation'] as const) {
    commerceCheck(target[role] && Object.keys(target[role]).sort().join() === ['callableDigest', 'callablePackageId', 'originalPackageId'].sort().join(), 'MAKER_INCOME_PIN_FIELDS')
    target[role] = validateCurrentMakerPackage(target[role])
  }
  commerceCheck(target.manufacturing.originalPackageId !== target.foundation.originalPackageId && target.manufacturing.callablePackageId !== target.foundation.callablePackageId, 'MAKER_INCOME_PACKAGE_ROLE_ALIAS')
  return target
}

/** Current Product ledger, independent from Config income and Complete history.
 * Full package/Object BCS and current Control are read-only evidence. Paused or
 * archived products keep their legal withdrawal route; creator is not authority.
 */
export async function readMakerProductIncome(input: { client: SuiGrpcClient; target: MakerProductIncomeTarget; signal: AbortSignal; control?: { objectId: string; actor: string } }) {
  const target = parseMakerProductIncomeTarget(input.target), control = input.control && structuredClone(input.control)
  const signal = AbortSignal.any([input.signal, AbortSignal.timeout(45000)]), source = input.client
  const client = captureMakerProductIncomeClient(source)
  const guard = () => signal.throwIfAborted()
  guard(); commerceCheck((await client.core.getChainIdentifier()).chainIdentifier === MAINNET_GENESIS_DIGEST, 'MAKER_INCOME_CHAIN'); guard()
  const manufacturing = await readPinnedMovePackage(client, target.manufacturing, signal); guard()
  const foundation = await readPinnedMovePackage(client, target.foundation, signal); guard()
  const link = manufacturing.linkage.get(target.foundation.originalPackageId)
  commerceCheck(link?.upgradedId === target.foundation.callablePackageId && link.upgradedVersion === String(foundation.version), 'MAKER_INCOME_REVENUE_DEPENDENCY')
  const productOrigin = manufacturing.origins.get('maker_catalog::Product'), controlOrigin = manufacturing.origins.get('maker_catalog::Control')
  commerceCheck(productOrigin && controlOrigin && foundation.origins.has('revenue::Request') && foundation.origins.has('revenue::Receipt'), 'MAKER_INCOME_ORIGINS')
  const productType = `${productOrigin}::maker_catalog::Product<${target.coinType}>`, controlType = `${controlOrigin}::maker_catalog::Control`
  const object = await readCommerceObject(client, target.productId, productType, signal); guard()
  const product = decodeCommerce(CurrentMakerProductBcs, object.contents), income = product.income
  commerceCheck(object.owner.$kind === 'Shared' && product.id === target.productId && product.protocol === target.protocolId && income.root === product.id
    && product.market.config === target.protocolId && product.primary.config === target.protocolId
    && product.lifecycle <= 3 && BigInt(income.collected) >= BigInt(income.withdrawn) && BigInt(income.collected) - BigInt(income.withdrawn) === BigInt(income.funds), 'MAKER_INCOME_PRODUCT_LEDGER')
  const initialSharedVersion = object.owner.Shared!.initialSharedVersion
  let authority: { objectId: string; actor: string; version: string; digest: string } | null = null
  if (control) {
    commerceCheck(commerceId(control.actor) && commerceId(control.objectId) && ![target.productId, target.protocolId].includes(control.objectId), 'MAKER_INCOME_CONTROL_INPUT')
    const cap = await readCommerceObject(client, control.objectId, controlType, signal); guard()
    const value = decodeCommerce(MakerProductControlBcs, cap.contents)
    commerceCheck(value.id === control.objectId && value.product === product.id && cap.owner.$kind === 'AddressOwner' && cap.owner.AddressOwner === control.actor, 'MAKER_INCOME_CONTROL_AUTHORITY')
    authority = { ...control, version: cap.version, digest: cap.digest }
  }
  // A Control read may await across a Product mutation. No mixed snapshot.
  const final = await readCommerceObject(client, target.productId, productType, signal); guard()
  commerceCheck(final.version === object.version && final.digest === object.digest && final.owner.Shared?.initialSharedVersion === initialSharedVersion, 'MAKER_INCOME_PRODUCT_CHANGED')
  return { target, product, productType, controlType, initialSharedVersion,
    object: { objectId: object.objectId, version: object.version, digest: object.digest }, authority,
    manufacturingVersion: String(manufacturing.version), foundationVersion: String(foundation.version), coinType: target.coinType,
    ledger: { revision: income.revision, balance: income.funds, collected: income.collected, withdrawn: income.withdrawn, requestsTableId: income.requests.id },
    notSourceQualification: true as const, notSigningAuthority: true as const }
}
