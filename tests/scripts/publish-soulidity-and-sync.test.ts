import { describe, expect, it } from 'vitest'

import { extractDeploymentFromPublishResult } from '../../scripts/publish-soulidity-and-sync'

describe('publish-soulidity-and-sync', () => {
  it('extracts the deployment ids from a publish result', () => {
    const deployment = extractDeploymentFromPublishResult({
      digest: '6XqMK1KoLFXTP4gg4rVraN4vqzTJ28kQp7iPR7wkhdLd',
      objectChanges: [
        { type: 'published', packageId: '0xpackage' },
        { objectType: '0x2::package::UpgradeCap', objectId: '0xupgradecap' },
      ],
      events: [
        {
          type: '0xpackage::market::MarketInitialized',
          parsedJson: {
            config_id: '0xconfig',
            soul_policy_id: '0xsoulpolicy',
            collection_policy_id: '0xcollectionpolicy',
          },
        },
      ],
    }, {
      paymentCoinType: '0x2::coin::COIN',
    })

    expect(deployment).toEqual({
      packageId: '0xpackage',
      marketConfigId: '0xconfig',
      soulTransferPolicyId: '0xsoulpolicy',
      collectionTransferPolicyId: '0xcollectionpolicy',
      paymentCoinType: '0x2::coin::COIN',
      publishTxDigest: '6XqMK1KoLFXTP4gg4rVraN4vqzTJ28kQp7iPR7wkhdLd',
      upgradeCapId: '0xupgradecap',
    })
  })

  it('fails fast when payment coin type cannot be resolved', () => {
    expect(() => extractDeploymentFromPublishResult({
      digest: '0xdigest',
      objectChanges: [
        { type: 'published', packageId: '0xpackage' },
        { objectType: '0x2::package::UpgradeCap', objectId: '0xupgradecap' },
      ],
      events: [
        {
          type: '0xpackage::market::MarketInitialized',
          parsedJson: {
            config_id: '0xconfig',
            soul_policy_id: '0xsoulpolicy',
            collection_policy_id: '0xcollectionpolicy',
          },
        },
      ],
    })).toThrow('Missing paymentCoinType')
  })

  it('falls back to effects.transactionDigest for dry-run publish results', () => {
    const deployment = extractDeploymentFromPublishResult({
      effects: {
        transactionDigest: '0xdryrundigest',
      },
      objectChanges: [
        { type: 'published', packageId: '0xpackage' },
        { objectType: '0x2::package::UpgradeCap', objectId: '0xupgradecap' },
      ],
      events: [
        {
          type: '0xpackage::market::MarketInitialized',
          parsedJson: {
            config_id: '0xconfig',
            soul_policy_id: '0xsoulpolicy',
            collection_policy_id: '0xcollectionpolicy',
          },
        },
      ],
    }, {
      paymentCoinType: '0x2::coin::COIN',
    })

    expect(deployment.publishTxDigest).toBe('0xdryrundigest')
  })
})
