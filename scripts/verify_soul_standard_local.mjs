// Isolated local genesis only. Persist intents before signing; never replay an
// unknown outcome. No production URL, wallet or package deployment is accepted.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { Transaction } from '/Users/naoer/.codex/worktrees/f722/soulidity/node_modules/@mysten/sui/dist/transactions/index.mjs';
import { SuiJsonRpcClient } from '/Users/naoer/.codex/worktrees/f722/soulidity/node_modules/@mysten/sui/dist/jsonRpc/index.mjs';
import { Ed25519Keypair } from '/Users/naoer/.codex/worktrees/f722/soulidity/node_modules/@mysten/sui/dist/keypairs/ed25519/index.mjs';
import { bcs } from '/Users/naoer/.codex/worktrees/f722/soulidity/node_modules/@mysten/sui/dist/bcs/index.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'output/contract-rebuild/standard-kernel-2026-10-08');
const local = path.join(root, 'output/contract-rebuild/local-ptb-2026-10-08/local-network');
fs.mkdirSync(out, { recursive: true });
const filename = n => path.join(out, n);
const read = n => JSON.parse(fs.readFileSync(filename(n), 'utf8'));
const write = (n, v) => fs.writeFileSync(filename(n), JSON.stringify(v, null, 2) + '\n');
const cfg = fs.readFileSync(path.join(local, 'client.yaml'), 'utf8');
const url = 'http://127.0.0.1:19087';
assert(cfg.includes(url) && !cfg.includes('https://'));
const client = new SuiJsonRpcClient({ url });
assert.equal(await client.getChainIdentifier(), '1544de63');
const protocol = await client.getProtocolConfig();
assert.equal(Number(protocol.protocolVersion), 137);
write('protocol-readback.json', protocol);
const alice = cfg.match(/active_address: "([^"]+)"/)[1];
const aliceKey = JSON.parse(fs.readFileSync(path.join(local, 'sui.keystore'), 'utf8')).map(k => {
  const bytes = Buffer.from(k, 'base64'); assert.equal(bytes[0], 0);
  return Ed25519Keypair.fromSecretKey(bytes.subarray(1));
}).find(k => k.toSuiAddress() === alice);
assert(aliceKey);
const bobFile = filename('bob-local-key.json');
if (!fs.existsSync(bobFile)) fs.writeFileSync(bobFile, JSON.stringify(new Ed25519Keypair().getSecretKey()), { mode: 0o600 });
const bobKey = Ed25519Keypair.fromSecretKey(JSON.parse(fs.readFileSync(bobFile, 'utf8')));
const bob = bobKey.toSuiAddress();
const rows = [];
const object = async id => client.getObject({ id, options: { showContent: true, showOwner: true, showBcs: true } });
const snapshot = async ids => {
  const result = {};
  for (const id of ids) { const o = await object(id); assert(o.data); result[id] = { content: o.data.content, owner: o.data.owner }; }
  return result;
};

async function run(name, build, expected = null, tracked = [], signer = aliceKey) {
  let receipt;
  const observedEarlier = fs.existsSync(filename(name + '-effects.json')) || fs.existsSync(filename(name + '-intent.json'));
  if (fs.existsSync(filename(name + '-effects.json'))) receipt = read(name + '-effects.json');
  else if (fs.existsSync(filename(name + '-intent.json'))) {
    const intent = read(name + '-intent.json');
    receipt = await client.waitForTransaction({ digest: intent.digest, timeout: 30000, options: { showEffects: true, showObjectChanges: true, showRawInput: true } });
    write(name + '-effects.json', receipt);
  } else {
    const tx = new Transaction(); tx.setSender(signer.toSuiAddress()); tx.setGasBudget(5000000000); build(tx);
    const bytes = await tx.build({ client });
    assert(bytes.length <= Number(protocol.attributes.max_tx_size_bytes.u64));
    if (expected) write(name + '-before.json', await snapshot(tracked));
    write(name + '-intent.json', { chain: '1544de63', sender: signer.toSuiAddress(), digest: await tx.getDigest({ client }), bytes: Buffer.from(bytes).toString('base64'), size: bytes.length });
    const signed = await signer.signTransaction(bytes);
    receipt = await client.executeTransactionBlock({ transactionBlock: bytes, signature: signed.signature, options: { showEffects: true, showObjectChanges: true, showRawInput: true } });
    write(name + '-effects.json', receipt);
  }
  const proof = await client.waitForTransaction({ digest: receipt.digest, timeout: 30000, options: { showEffects: true, showObjectChanges: true, showRawInput: true } });
  write(name + '-independent.json', proof);
  const intent = read(name + '-intent.json');
  const signedData = bcs.SenderSignedData.parse(Buffer.from(proof.rawTransaction, 'base64'));
  assert.equal(signedData.length, 1);
  assert.equal(bcs.TransactionData.serialize(signedData[0].intentMessage.value).toBase64(), intent.bytes);
  assert.equal(proof.digest, intent.digest);
  assert.equal(proof.effects.status.status, expected ? 'failure' : 'success');
  if (expected) {
    assert.match(proof.effects.status.error, expected);
    const after = observedEarlier ? read(name + '-after.json') : await snapshot(tracked);
    if (!observedEarlier) write(name + '-after.json', after);
    assert.deepEqual(after, read(name + '-before.json'));
  }
  const row = { name, digest: proof.digest, status: proof.effects.status, bytes: intent.size, gas: proof.effects.gasUsed };
  rows.push(row); write('partial-execution.json', { chain: '1544de63', rows }); console.log(JSON.stringify(row));
  return proof;
}

const pubfile = filename('local-published.toml');
if (!fs.existsSync(pubfile)) fs.writeFileSync(pubfile, 'build-env = "mainnet"\nchain-id = "1544de63"\n');
const cli = path.join(root, 'output/contract-rebuild/local-ptb-2026-10-08/tooling/sui');
function compiled(label, source) {
  const result = execFileSync(cli, ['client', '--client.config', path.join(local, 'client.yaml'), 'test-publish', source,
    '--pubfile-path', pubfile, '--build-env', 'mainnet', '--serialize-unsigned-transaction', '--json', '--gas-budget', '5000000000'], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  fs.writeFileSync(filename(label + '-compiled.json'), result);
  const commands = JSON.parse(result).V1.kind.ProgrammableTransaction.commands;
  assert.equal(commands.filter(c => c.Publish).length, 1);
  const [modules, dependencies] = commands.find(c => c.Publish).Publish;
  return { modules: modules.map(m => Buffer.from(m).toString('base64')), dependencies };
}
function packageSize(p) {
  return 8 + Object.entries(p.moduleMap).reduce((n, [k, v]) => n + Buffer.byteLength(k) + Buffer.from(v, 'base64').length, 0)
    + p.typeOriginTable.reduce((n, t) => n + Buffer.byteLength(t.module_name) + Buffer.byteLength(t.datatype_name) + 32, 0)
    + Object.keys(p.linkageTable).length * 72;
}
const published = {};
for (const [label, rel] of [['standard', 'move/soulidity_standard'], ['maker', 'move/standard_examples/maker'], ['ability', 'move/standard_examples/ability'], ['container', 'move/standard_examples/container']]) {
  const source = path.join(root, rel);
  let code;
  if (!fs.existsSync(filename(label + '-publish-effects.json')) && !fs.existsSync(filename(label + '-publish-intent.json'))) code = compiled(label, source);
  const result = await run(label + '-publish', tx => { const cap = tx.publish(code); tx.transferObjects([cap], alice); });
  const pkg = result.objectChanges.find(c => c.type === 'published').packageId;
  const cap = result.objectChanges.find(c => c.type === 'created' && c.objectType === '0x2::package::UpgradeCap').objectId;
  const p = await object(pkg); write(label + '-package.json', p);
  const size = packageSize(p.data.bcs); assert(size <= Number(protocol.attributes.max_move_package_size.u64));
  const abi = await client.getNormalizedMoveModulesByPackage({ package: pkg }); write(label + '-abi.json', abi);
  published[label] = { package: pkg, cap, size, source, modules: Object.keys(abi) };
  if (!fs.readFileSync(pubfile, 'utf8').includes('published-at = "' + pkg + '"')) fs.appendFileSync(pubfile,
    '\n[[published]]\nsource = { local = ' + JSON.stringify(source) + ' }\npublished-at = "' + pkg + '"\noriginal-id = "' + pkg + '"\nversion = 1\ntoolchain-version = "1.80.1"\nbuild-config = { flavor = "sui", edition = "2024" }\nupgrade-capability = "' + cap + '"\n');
}
write('published.json', published);
const call = (tx, label, fn, args = [], types = []) => tx.moveCall({ target: `${published[label].package}::${label === 'standard' ? 'soul' : label}::${fn}`, arguments: args, typeArguments: types });
const transfer = (tx, value, recipient = alice) => tx.transferObjects([value], recipient);
const text = (tx, s) => tx.pure.vector('u8', Array.from(Buffer.from(s)));
const setup = await run('produce-two-souls', tx => {
  const m = call(tx, 'maker', 'new', [text(tx, 'third-party-definition'), tx.pure.u64(4)]);
  const a = call(tx, 'maker', 'mint', [m, text(tx, 'permanent')]);
  const b = call(tx, 'maker', 'mint', [m, text(tx, 'removable')]);
  call(tx, 'ability', 'install', [a, tx.pure.u64(7), tx.pure.bool(true), tx.pure.u64(0)]);
  call(tx, 'ability', 'install', [b, tx.pure.u64(11), tx.pure.bool(false), tx.pure.u64(0)]);
  transfer(tx, a); transfer(tx, b); transfer(tx, m);
});
const souls = setup.objectChanges.filter(c => c.type === 'created' && c.objectType.endsWith('::soul::Soul')).map(c => c.objectId);
assert.equal(souls.length, 2);
const soulObjects = await Promise.all(souls.map(object));
const permanent = soulObjects.find(o => o.data.content.fields.name === 'permanent').data.objectId;
const removable = souls.find(id => id !== permanent);
const maker = setup.objectChanges.find(c => c.type === 'created' && c.objectType.endsWith('::maker::Maker')).objectId;
const children = setup.objectChanges.filter(c => c.type === 'created' && c.objectType.endsWith('::ability::Ability')).map(c => c.objectId);
assert.equal(children.length, 2);
const childObjects = await Promise.all(children.map(object));
const permanentChild = childObjects.find(o => o.data.content.fields.soul === permanent).data.objectId;
const removableChild = children.find(id => id !== permanentChild);
const tracked = [permanent, removable, permanentChild, removableChild, maker];
if (!fs.existsSync(filename('initial-objects.json'))) write('initial-objects.json', await snapshot(tracked));
for (const [parent, child] of [[permanent, permanentChild], [removable, removableChild]]) {
  const fields = await client.getDynamicFields({ parentId: parent }); write(parent + '-dynamic-fields.json', fields);
  assert(fields.data.some(f => f.objectId === child && f.type === 'DynamicObject'));
}
await run('reject-stale-update', tx => call(tx, 'ability', 'update', [tx.object(permanent), tx.pure.u64(19), tx.pure.u64(0)]), /MoveAbort.*soul.*1\)/, tracked);
await run('reject-permanent-remove', tx => transfer(tx, call(tx, 'ability', 'remove', [tx.object(permanent), tx.pure.u64(1)])), /MoveAbort.*soul.*8\)/, tracked);
await run('reject-transfer-before-edit-restore', tx => {
  const s = tx.object(permanent); const [child, _ticket] = call(tx, 'ability', 'start_update', [s, tx.pure.u64(1)]);
  transfer(tx, child, bob); transfer(tx, s, bob);
}, /UnusedValueWithoutDrop/, tracked);
await run('reject-wrong-soul-for-edit', tx => {
  const [a, ticket] = call(tx, 'ability', 'start_update', [tx.object(permanent), tx.pure.u64(1)]);
  call(tx, 'ability', 'finish_update', [tx.object(removable), ticket, a, tx.pure.u64(8)]);
}, /MoveAbort.*ability.*1\)/, tracked);
await run('update-original-permanent-child', tx => call(tx, 'ability', 'update', [tx.object(permanent), tx.pure.u64(31), tx.pure.u64(1)]));
assert.equal((await object(permanentChild)).data.content.fields.score, '31');
const boxResult = await run('deposit-whole-soul-in-container', tx => {
  const s = tx.object(permanent), box = call(tx, 'container', 'new');
  const hash = call(tx, 'standard', 'manifest_hash', [s]);
  call(tx, 'container', 'deposit', [box, s, tx.pure.u64(2), hash]); transfer(tx, box);
});
const box = boxResult.objectChanges.find(c => c.type === 'created' && c.objectType.endsWith('::container::Container')).objectId;
const boxFields = await client.getDynamicFields({ parentId: box }); write('container-dynamic-fields.json', boxFields);
assert(boxFields.data.some(f => f.objectId === permanent && f.type === 'DynamicObject'));
// Preserve the actual failed reference-return experiment. It is a known terminal
// receipt, never re-executed. Mutable Move borrows compose inside Move, not PTB.
const rejectedRef = read('container-update-with-standard-only-interface-independent.json');
assert.equal(rejectedRef.effects.status.status, 'failure');
assert.match(rejectedRef.effects.status.error, /InvalidPublicFunctionReturnType/);
assert.equal((await object(permanentChild)).data.content.fields.score, '31');
assert.equal((await object(permanent)).data.content.fields.revision, '2');
write('rejected-reference-observed-state.json', await snapshot([box, permanent, permanentChild]));
await run('container-atomic-withdraw-update-redeposit', tx => {
  const c = tx.object(box), s = call(tx, 'container', 'withdraw', [c]);
  call(tx, 'ability', 'update', [s, tx.pure.u64(44), tx.pure.u64(2)]);
  const hash = call(tx, 'standard', 'manifest_hash', [s]);
  call(tx, 'container', 'deposit', [c, s, tx.pure.u64(3), hash]);
});
await run('fund-local-buyer', tx => { const [coin] = tx.splitCoins(tx.gas, [tx.pure.u64(20000000000)]); transfer(tx, coin, bob); });
await run('handover-whole-container', tx => transfer(tx, tx.object(box), bob));
assert.equal((await object(box)).data.owner.AddressOwner, bob);
await run('buyer-withdraw-original-soul', tx => {
  const c = tx.object(box), s = call(tx, 'container', 'withdraw', [c]);
  call(tx, 'container', 'destroy_empty', [c]); transfer(tx, s, bob);
}, null, [], bobKey);
assert.equal((await object(permanent)).data.owner.AddressOwner, bob);
assert.equal((await object(permanentChild)).data.content.fields.score, '44');
await run('remove-original-removable-child', tx => transfer(tx, call(tx, 'ability', 'remove', [tx.object(removable), tx.pure.u64(1)])));
assert.equal((await object(removableChild)).data.owner.AddressOwner, alice);
await run('reattach-original-removable-child', tx => call(tx, 'ability', 'reattach', [tx.object(removable), tx.object(removableChild), tx.pure.u64(2)]));
const final = await snapshot(tracked); write('final-objects.json', final);
assert.equal(final[removable].content.fields.revision, '3');
assert.equal(final[permanent].content.fields.revision, '3');
assert.equal(final[maker].content.fields.issued, '2');
write('execution-evidence.json', { chain: '1544de63', protocol: 137, scope: 'Independent producer/ability/owned-container live local PTBs',
  rows, rejected_reference_return: { digest: rejectedRef.digest, status: rejectedRef.effects.status,
    limitation: 'Terminal experiment preserved; no pre-snapshot for this experiment. Root revision/child score/owner after failure read back.' },
  published, alice, bob, ids: { permanent, removable, permanentChild, removableChild, maker, box },
  source_and_child_ids_preserved: true, negative_snapshots_unchanged: true, actual_dof_discovery: true,
  contracts_complete: false, production_deployed: false,
  remaining: ['Composition/Ref/Bound/Free full product integration', 'funds/rights/visual/market/grant/upgrade/shared-object concurrency/all duties gates', 'local Chain::Unknown is not production/mainnet acceptance'] });
