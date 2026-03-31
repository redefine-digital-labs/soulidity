import { SuiJsonRpcClient, getJsonRpcFullnodeUrl } from '@mysten/sui/jsonRpc';

async function main() {
  const suiClient = new SuiJsonRpcClient({ url: getJsonRpcFullnodeUrl('testnet'), network: 'testnet' });
  const SELLER = '0x858dacfa57af771ed53e216acf3409d7485afebb6f68e592fac39ca8e777eb82';
  const PKG = '0xc9f6a531d5f4e11ef38dd782c9ab5403fb3c011595384c429285952ff6b31839';
  const capType = `${PKG}::personal_kiosk::PersonalKioskCap`;

  console.log('Checking balance...');
  const bal = await suiClient.getBalance({ owner: SELLER });
  console.log('SUI balance:', bal.totalBalance);

  console.log('Querying kiosk caps...');
  const caps = await suiClient.getOwnedObjects({
    owner: SELLER,
    filter: { StructType: capType },
    options: { showContent: true },
  });
  console.log('Found', caps.data.length, 'caps');
  for (const e of caps.data) {
    const f = e.data?.content && 'fields' in e.data.content ? e.data.content.fields as any : null;
    const kioskId = f?.cap?.fields?.for || f?.for;
    console.log('capId:', e.data?.objectId, 'kioskId:', kioskId);
    if (f) console.log('  fields:', JSON.stringify(f).slice(0, 300));
  }

  // Also search for any kiosk-related objects
  const all = await suiClient.getOwnedObjects({
    owner: SELLER,
    options: { showType: true },
    limit: 50,
  });
  const kioskObjs = all.data.filter(e => (e.data?.type || '').toLowerCase().includes('kiosk'));
  console.log('\nAll kiosk-related objects:', kioskObjs.length);
  for (const e of kioskObjs) {
    console.log(' -', e.data?.objectId, e.data?.type);
  }
}

main().catch(console.error);
