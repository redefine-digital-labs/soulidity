import {proveNativePublicReadPaidRegistryIdentityV2} from './native-public-read-paid-registry-identity-v2'
import {proveNativePublicReadPaidEventsV2} from './native-public-read-paid-events-v2'
import { readFinalizedMutation } from '../../sui/finalized-mutation'
import type { PublicMutationPacket } from '../../sui/public-mutation-journal'
import { MAINNET_GENESIS_DIGEST } from '../../animacraft/mainnet-chain'
import { proveNativePublicReadPaidLinkHistoryV2 } from './native-public-read-paid-link-history-v2'
import { reconcileNativePublicReadPaidEffectsV2 } from './native-public-read-paid-effects-v2'
import { assertNativePublicReadPaidPacketV2 } from './native-public-read-paid-packet-v2'
import { proveNativePublicReadPaidModulePointerHistoryV2 } from './native-public-read-paid-module-pointer-history-v2'
import { proveNativePublicReadPaidSoulHistoryV2 } from './native-public-read-paid-soul-history-v2'
import { proveNativePublicReadPaidAuthorizationHistoryV2 } from './native-public-read-paid-authorization-history-v2'
import { proveNativePublicReadPaidCustodyHistoryV2 } from './native-public-read-paid-custody-history-v2'
import { proveNativePublicReadPaidOfferHistoryV2 } from './native-public-read-paid-offer-history-v2'
import { proveNativePublicReadPaidPointerHistoryV2 } from './native-public-read-paid-pointer-history-v2'
import { proveNativePublicReadPaidMoneyV2 } from './native-public-read-paid-money-v2'
import { proveNativePublicReadPaidReceiptV2 } from './native-public-read-paid-receipt-v2'

/** Original known-V2 recovery only. Shared finality plus typed original Host,
 * Entry/Receipt and exact Updated/Paid events are necessary partial evidence.
 * Content event codecs are shared; no v1 reader or ownership interpretation.
 * Never a new payment, current access grant or whole operation SUCCEEDED.
 */
export async function readNativePublicReadPaidHistoryV2(input: Omit<Parameters<typeof proveNativePublicReadPaidReceiptV2>[0], 'effects' | 'packet'> & { packet: PublicMutationPacket; proveMoney?: boolean; proveRegistryIdentity?: boolean; provePaidPointer?: boolean; proveOffer?: boolean; proveCustody?: boolean; proveAuthorization?: { authorizationId: string }; proveSoul?: Pick<Parameters<typeof proveNativePublicReadPaidSoulHistoryV2>[0], 'standard' | 'linkBytes'>; proveModulePointer?: Pick<Parameters<typeof proveNativePublicReadPaidModulePointerHistoryV2>[0], 'standard' | 'linkBytes'>; proveLink?: Pick<Parameters<typeof proveNativePublicReadPaidLinkHistoryV2>[0], 'standard' | 'linkBytes'> }) {
  const saved = structuredClone({ intent: input.intent, packet: input.packet, gas: input.gas, offer: input.offer, soulId: input.soulId,
    ledgerId: input.ledgerId, native: input.native, content: input.content, foundation: input.foundation })
  const proveRegistryIdentity=input.proveRegistryIdentity===true
  const proveMoney = input.proveMoney === true, provePaidPointer = input.provePaidPointer === true, proveOffer = input.proveOffer === true, proveCustody = input.proveCustody === true
  const authorizationRequest = input.proveAuthorization ? structuredClone(input.proveAuthorization) : null
  const soulRequest = input.proveSoul ? structuredClone(input.proveSoul) : null
  const modulePointerRequest = input.proveModulePointer ? structuredClone(input.proveModulePointer) : null
  const linkRequest = input.proveLink ? structuredClone(input.proveLink) : null
  const source = input.client
  const client = { ledgerService: { getServiceInfo: source.ledgerService.getServiceInfo.bind(source.ledgerService), getTransaction: source.ledgerService.getTransaction.bind(source.ledgerService),
    getCheckpoint: source.ledgerService.getCheckpoint.bind(source.ledgerService), getObject: source.ledgerService.getObject.bind(source.ledgerService) } } as unknown as typeof source
  const signal = AbortSignal.any([input.signal, AbortSignal.timeout(30000)])
  await assertNativePublicReadPaidPacketV2(saved.intent, saved.packet, saved.gas)
  const result = await readFinalizedMutation({ client, packet: saved.packet, signal, chainIdentifier: '35834a8a', genesisDigest: MAINNET_GENESIS_DIGEST,
    errorPrefix: 'COMMERCE_PUBLIC_PAID_V2_HISTORY', proveSuccess: async context => {
      const receipt = await proveNativePublicReadPaidReceiptV2({ ...saved, client, signal, effects: context.effects })
      const {change,payment} = await proveNativePublicReadPaidEventsV2({client,content:saved.content,foundation:saved.foundation,soulId:saved.soulId,buyer:saved.intent.buyer,kind:saved.intent.kind,attempt:saved.intent.attempt,receipt,events:context.events,signal})
      const money = proveMoney ? await proveNativePublicReadPaidMoneyV2({ ...saved, client, signal, effects: context.effects }) : null
      const paidPointer = provePaidPointer ? await proveNativePublicReadPaidPointerHistoryV2({ ...saved, client, signal, effects: context.effects, checkpoint: context.checkpoint }) : null
      const offerHistory = proveOffer ? await proveNativePublicReadPaidOfferHistoryV2({ ...saved, client, signal, effects: context.effects, checkpoint: context.checkpoint }) : null
      const kioskCustody = proveCustody ? await proveNativePublicReadPaidCustodyHistoryV2({ ...saved, client, signal, effects: context.effects, checkpoint: context.checkpoint }) : null
      const authorizationHistory = authorizationRequest ? await proveNativePublicReadPaidAuthorizationHistoryV2({ ...saved, client, signal, effects: context.effects, checkpoint: context.checkpoint, authorizationId: authorizationRequest.authorizationId }) : null
      const soulHistory = soulRequest ? await proveNativePublicReadPaidSoulHistoryV2({ ...saved, ...soulRequest, client, signal, effects: context.effects, checkpoint: context.checkpoint }) : null
      const modulePointerHistory = modulePointerRequest ? await proveNativePublicReadPaidModulePointerHistoryV2({ ...saved, ...modulePointerRequest, client, signal, effects: context.effects, checkpoint: context.checkpoint }) : null
      const linkHistory = linkRequest ? await proveNativePublicReadPaidLinkHistoryV2({ ...saved, ...linkRequest, client, signal, effects: context.effects, checkpoint: context.checkpoint }) : null
      const registryIdentity=proveRegistryIdentity?await proveNativePublicReadPaidRegistryIdentityV2({...saved,client,signal,effects:context.effects}):null
      const effectsInventory = reconcileNativePublicReadPaidEffectsV2({ transactionDigest: saved.packet.digest, effects: context.effects, receipt, money, registryIdentity, paidPointer, offerHistory, kioskCustody, authorizationHistory, soulHistory, modulePointerHistory, linkHistory })
      return { ...receipt, registryIdentity, requiresOriginalRegistryIdentityProof:registryIdentity===null, linkHistory, requiresOriginalLinkObjectHistoryProof: linkHistory === null, effectsInventory, modulePointerHistory, requiresOriginalModulePointerHistoryProof: modulePointerHistory === null, soulHistory, requiresOriginalSoulHistoryProof: soulHistory === null, authorizationHistory, requiresOriginalAuthorizationHistoryProof: authorizationHistory === null, kioskCustody, requiresOriginalKioskItemLockProof: kioskCustody === null, offerHistory, requiresOriginalOfferProof: offerHistory === null, paidPointer, requiresOriginalPaidPointerProof: paidPointer === null, proof: 'native-public-read-v2-finalized-host-entry-receipt-events-only' as const,
        checkpoint: context.checkpoint, checkpointProof: context.checkpointProof, requiresOriginalFinalityAndEvents: false as const, notMoneySettlementProof: money === null, money, change, payment }
    } })
  return result.status === 'SUCCEEDED' ? { ...result, status: 'SUBSCRIPTION_RECORDED' as const } : result
}
