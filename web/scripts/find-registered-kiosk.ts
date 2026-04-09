import { SuiJsonRpcClient, getJsonRpcFullnodeUrl } from '@mysten/sui/jsonRpc';
import { Transaction } from '@mysten/sui/transactions';

async function main() {
  const suiClient = new SuiJsonRpcClient({ url: getJsonRpcFullnodeUrl('testnet'), network: 'testnet' });
  const SELLER = '0x858dacfa57af771ed53e216acf3409d7485afebb6f68e592fac39ca8e777eb82';
  const PKG = '0xc9f6a531d5f4e11ef38dd782c9ab5403fb3c011595384c429285952ff6b31839';
  const SOUL_PKG = process.env.NEXT_PUBLIC_SOUL_OBJECT_PACKAGE_ID!;
  const MARKET_CONFIG = process.env.NEXT_PUBLIC_SOUL_MARKET_CONFIG_ID!;

  const capType = `${PKG}::personal_kiosk::PersonalKioskCap`;
  const caps = await suiClient.getOwnedObjects({
    owner: SELLER,
    filter: { StructType: capType },
    options: { showContent: true },
  });

  for (const e of caps.data) {
    const capId = e.data?.objectId!;
    const f = e.data?.content && 'fields' in e.data.content ? e.data.content.fields as any : null;
    const kioskId = f?.cap?.fields?.for;
    
    try {
      const tx = new Transaction();
      tx.setSender(SELLER);
      tx.setGasBudget(10_000_000);
      
      tx.moveCall({
        target: `${SOUL_PKG}::market::ensure_personal_kiosk_registered`,
        arguments: [tx.object(MARKET_CONFIG), tx.object(capId)],
      });
      // reuse_personal_kiosk calls assert_registered_personal_kiosk
      tx.moveCall({
        target: `${SOUL_PKG}::market::reuse_personal_kiosk`,
        arguments: [tx.object(MARKET_CONFIG), tx.object(capId)],
      });
      
      const txBytes = await tx.build({ client: suiClient });
      const result = await suiClient.dryRunTransactionBlock({ transactionBlock: Buffer.from(txBytes).toString('base64') });
      
      if (result.effects.status.status === 'success') {
        console.log(`✅ MATCH capId=${capId} kioskId=${kioskId}`);
      } else {
        const err = result.effects.status.error || '';
        if (err.includes('18')) {
          console.log(`❌ Mismatch capId=${capId.slice(0,16)}...`);
        } else {
          console.log(`❌ Other error capId=${capId.slice(0,16)}...: ${err.slice(0,80)}`);
        }
      }
    } catch (err: any) {
      console.log(`❌ Error capId=${capId.slice(0,16)}...: ${err.message?.slice(0,80)}`);
    }
  }
}

main().catch(console.error);
