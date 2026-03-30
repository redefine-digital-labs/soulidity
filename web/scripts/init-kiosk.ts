import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { SuiJsonRpcClient, getJsonRpcFullnodeUrl } from '@mysten/sui/jsonRpc';
import { Transaction } from '@mysten/sui/transactions';

const ADAPTER_PKG = '0xb25dc3b5dfd30e458dce1a7aea2fabca989413e5004fe0012ead7fb21430165d';
const KIOSK_PKG = process.env.NEXT_PUBLIC_KIOSK_PACKAGE_ID ?? '0xc9f6a531d5f4e11ef38dd782c9ab5403fb3c011595384c429285952ff6b31839';
const keypair = Ed25519Keypair.deriveKeypair('razor world ship bulb joke worry expire adapt whisper card glow have');
const client = new SuiJsonRpcClient({ url: getJsonRpcFullnodeUrl('testnet'), network: 'testnet' });

async function resolveExistingPersonalKioskCapId(owner: string) {
  const page = await client.getOwnedObjects({
    owner,
    filter: { StructType: `${KIOSK_PKG}::personal_kiosk::PersonalKioskCap` },
    options: { showType: true },
  });
  const capObjectIds = page.data
    .map((entry) => entry.data?.objectId)
    .filter((objectId): objectId is string => typeof objectId === 'string' && objectId.length > 0);

  if (capObjectIds.length > 1) {
    throw new Error(`Multiple personal kiosk caps detected for ${owner}; refusing to pick one implicitly`);
  }

  return capObjectIds[0] ?? null;
}

async function main() {
  const owner = keypair.toSuiAddress();
  const currentKioskCapOnChainId = await resolveExistingPersonalKioskCapId(owner);
  const tx = new Transaction();
  if (currentKioskCapOnChainId) {
    tx.moveCall({
      target: `${ADAPTER_PKG}::market::reuse_personal_kiosk`,
      arguments: [tx.object(currentKioskCapOnChainId)],
    });
  } else {
    tx.moveCall({ target: `${ADAPTER_PKG}::market::init_personal_kiosk` });
  }
  const result = await client.signAndExecuteTransaction({
    signer: keypair,
    transaction: tx,
    options: { showEffects: true },
  });
  console.log('Action:', currentKioskCapOnChainId ? 'reuse_personal_kiosk' : 'init_personal_kiosk');
  console.log('TX:', result.digest);
  console.log('Status:', result.effects?.status?.status);
}
main();
