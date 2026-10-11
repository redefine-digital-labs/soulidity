// Isolated D26 runtime proof. This does not replace the nine-package target.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Transaction } from '/Users/naoer/.codex/worktrees/f722/soulidity/node_modules/@mysten/sui/dist/transactions/index.mjs';
import { SuiJsonRpcClient } from '/Users/naoer/.codex/worktrees/f722/soulidity/node_modules/@mysten/sui/dist/jsonRpc/index.mjs';
import { Ed25519Keypair } from '/Users/naoer/.codex/worktrees/f722/soulidity/node_modules/@mysten/sui/dist/keypairs/ed25519/index.mjs';
import { bcs } from '/Users/naoer/.codex/worktrees/f722/soulidity/node_modules/@mysten/sui/dist/bcs/index.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);
const arg = name => { const i=args.indexOf(name); assert(i>=0 && args[i+1], name); return path.resolve(args[i+1]); };
const proof = arg('--proof'), out = arg('--out');
const cli = path.join(root,'output/contract-rebuild/local-ptb-2026-10-08/tooling/sui');
const network = path.join(root,'output/contract-rebuild/certified-capacity-ptb-2026-10-09/local-network');
const hash = p => createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const norm = id => '0x'+id.replace(/^0x/,'').padStart(64,'0');
const read = name => JSON.parse(fs.readFileSync(path.join(out,name),'utf8'));
const write = (name,data) => fs.writeFileSync(path.join(out,name),JSON.stringify(data,null,2)+'\n');
fs.mkdirSync(out,{recursive:true});
const e=JSON.parse(fs.readFileSync(path.join(proof,'evidence.json'),'utf8'));
assert.equal(e.all_expected_results,true,'production probes must pass');
assert.equal(e.run_complete,true,'all expected production probes must finish');
assert.equal(e.wallet_only_candidate,true,'custody candidate is unsafe');
assert.equal(hash(cli),e.sui_binary_sha256,'same production compiler tool');
for(const guard of ['input_standard_unchanged','live_standard_unchanged','candidate_source_unchanged','baseline_source_unchanged'])assert.equal(e[guard],true,guard);
const standard=path.join(proof,'candidate/standard'), producer=path.join(proof,'candidate/producer');
assert.equal(hash(path.join(standard,'sources/soul.move')),e.candidate_source_sha256,'same compiler-verified Standard');
assert.equal(hash(path.join(producer,'sources/probe.move')),e.candidate_producer_sha256,'same compiler-verified producer');
const inputs=[standard,producer].flatMap(dir=>[path.join(dir,'Move.toml'),...(fs.existsSync(path.join(dir,'Move.lock'))?[path.join(dir,'Move.lock')]:[]),...fs.readdirSync(path.join(dir,'sources')).filter(n=>n.endsWith('.move')).map(n=>path.join(dir,'sources',n))]);
const currentInputs=inputs.map(p=>({path:p,sha256:hash(p)}));
let freeze=currentInputs;
if(fs.existsSync(path.join(out,'source-freeze.json'))) {
  freeze=read('source-freeze.json');
  for(const f of freeze)assert.equal(hash(f.path),f.sha256,'do not reuse intents for changed source');
  const extra=currentInputs.filter(f=>!freeze.some(old=>old.path===f.path));
  for(const f of extra){
    assert.equal(path.basename(f.path),'Move.lock','only compiler-generated additional locks');
    const recorded=read('generated-locks.json').files.find(old=>old.path===f.path);assert(recorded);
    assert.equal(recorded.sha256,f.sha256);assert(recorded.same_compiled_modules_and_dependencies);
    assert.equal(recorded.compiled_cache_sha256,hash(path.join(out,path.basename(path.dirname(f.path))+'-compiled.json')),'generated lock bound to original artifact');
  }
} else write('source-freeze.json',freeze);
const config=fs.readFileSync(path.join(network,'client.yaml'),'utf8');
assert(!config.includes('https://') && config.includes('http://127.0.0.1:19089'));
const client=new SuiJsonRpcClient({url:'http://127.0.0.1:19089'});
assert.equal(await client.getChainIdentifier(),'ae60751d');
const protocol=await client.getProtocolConfig();assert.equal(Number(protocol.protocolVersion),137);
write('protocol.json',protocol);
const alice=config.match(/active_address: "([^"]+)"/)[1];
const actors=JSON.parse(fs.readFileSync(path.join(network,'sui.keystore'),'utf8')).map(encoded=>{
  const b=Buffer.from(encoded,'base64');assert.equal(b[0],0);return Ed25519Keypair.fromSecretKey(b.subarray(1));
});
assert(actors.some(k=>k.toSuiAddress()===alice));
const bob=actors.find(k=>k.toSuiAddress()!==alice).toSuiAddress();
const object=id=>client.getObject({id,options:{showContent:true,showOwner:true,showBcs:true}});
const bootstrap=JSON.parse(fs.readFileSync(path.join(root,'output/contract-rebuild/native-target-local-2026-10-10/bootstrap-evidence.json'),'utf8'));
const retained=Object.values(bootstrap.state);
async function retainedSnapshot(name) {
  const data={};for(const id of retained){const o=await object(id);assert(o.data);data[id]={owner:o.data.owner,content:o.data.content};}
  write(name,data);return data;
}
if(!fs.existsSync(path.join(out,'retained-target-before.json')))await retainedSnapshot('retained-target-before.json');
const rows=[];
let submitted=0;
async function atReceipt(id,receipt) {
  const changed=['created','mutated','unwrapped'].flatMap(k=>receipt.effects[k]??[]).find(x=>x.reference.objectId===id);
  assert(changed,'receipt contains object version '+id);
  const old=await client.tryGetPastObject({id,version:Number(changed.reference.version),options:{showContent:true,showOwner:true,showBcs:true}});
  assert.equal(old.status,'VersionFound');return {data:old.details};
}
async function snapshot(name,id,receipt) {
  if(fs.existsSync(path.join(out,name)))return read(name);
  const value=await atReceipt(id,receipt);write(name,value);return value;
}
async function run(name,build,sender=alice,expected=null,tracked=[]) {
  let receipt;
  const effects=name+'-effects.json', intentFile=name+'-intent.json';
  if(fs.existsSync(path.join(out,effects))) receipt=read(effects);
  else if(fs.existsSync(path.join(out,intentFile))) {
    // Unknown outcomes are recovered by the original digest; never blindly replay.
    const saved=read(intentFile);
    receipt=await client.waitForTransaction({digest:saved.digest,timeout:30000,options:{showEffects:true,showObjectChanges:true}});
    write(effects,receipt);
  } else {
    const tx=new Transaction();tx.setSender(sender);tx.setGasBudget(5000000000);build(tx);
    let cursor=null,coins=[];
    do { const page=await client.getCoins({owner:sender,coinType:'0x2::sui::SUI',cursor,limit:50});coins.push(...page.data);cursor=page.hasNextPage?page.nextCursor:null; } while(cursor);
    const gas=coins.filter(c=>BigInt(c.balance)>=5000000000n).sort((a,b)=>BigInt(a.balance)>BigInt(b.balance)?-1:1)[0];assert(gas,'single sufficient isolated gas coin');
    tx.setGasPayment([{objectId:gas.coinObjectId,version:gas.version,digest:gas.digest}]);
    const bytes=await tx.build({client}), decoded=bcs.TransactionData.parse(bytes).V1;
    const ownership=[];
    for(const input of decoded.kind.ProgrammableTransaction.inputs) {
      const ref=input.Object?.ImmOrOwnedObject;if(!ref)continue;
      const actual=await object(ref.objectId);assert(actual.data);
      if(actual.data.owner.AddressOwner)assert.equal(actual.data.owner.AddressOwner,sender);
      ownership.push({id:ref.objectId,owner:actual.data.owner});
    }
    const abi=[];
    for(const command of decoded.kind.ProgrammableTransaction.commands)if(command.MoveCall){const c=command.MoveCall;const f=await client.getNormalizedMoveFunction({package:c.package,module:c.module,function:c.function});assert.equal(c.typeArguments.length,f.typeParameters.length);abi.push({package:c.package,module:c.module,function:c.function});}
    write(name+'-pre-sign.json',{chain:'ae60751d',sender,ownership,abi,gas:gas.coinObjectId,production:false});
    if(expected){const before={};for(const id of tracked){const o=await object(id);before[id]={owner:o.data.owner,content:o.data.content};}write(name+'-before.json',before);}
    write(intentFile,{chain:'ae60751d',sender,digest:await tx.getDigest({client}),unsigned_bytes:Buffer.from(bytes).toString('base64')});
    const key=actors.find(k=>k.toSuiAddress()===sender);assert(key,'only retained isolated Genesis actor');
    const signature=await key.signTransaction(bytes);
    submitted++;
    receipt=await client.executeTransactionBlock({transactionBlock:bytes,signature:signature.signature,options:{showEffects:true,showObjectChanges:true}});write(effects,receipt);
  }
  const result=await client.waitForTransaction({digest:receipt.digest,timeout:30000,options:{showEffects:true,showObjectChanges:true,showRawInput:true,showBalanceChanges:true,showEvents:true}});write(name+'-independent.json',result);
  const saved=read(intentFile);assert.equal(result.digest,saved.digest);assert.equal(saved.chain,'ae60751d');assert.equal(saved.sender,sender);
  const signed=bcs.SenderSignedData.parse(Buffer.from(result.rawTransaction,'base64'));assert.equal(signed.length,1);
  assert.equal(bcs.TransactionData.serialize(signed[0].intentMessage.value).toBase64(),saved.unsigned_bytes);
  assert.equal(result.effects.status.status,expected?'failure':'success');
  if(expected){
    assert.match(result.effects.status.error,expected);
    for(const k of ['deleted','wrapped','unwrapped'])for(const x of result.effects[k]??[])assert(!tracked.includes(x.reference?.objectId??x.objectId),'failed operation changed tracked identity');
    let after;
    if(fs.existsSync(path.join(out,name+'-after.json')))after=read(name+'-after.json');
    else {
      after={};const unsigned=bcs.TransactionData.parse(Buffer.from(saved.unsigned_bytes,'base64')).V1;
      for(const id of tracked){
        const changed=(result.effects.mutated??[]).find(x=>x.reference.objectId===id);
        const input=unsigned.kind.ProgrammableTransaction.inputs.find(x=>x.Object?.ImmOrOwnedObject?.objectId===id);
        const version=changed?.reference.version??input?.Object.ImmOrOwnedObject.version;assert(version);
        const old=await client.tryGetPastObject({id,version:Number(version),options:{showContent:true,showOwner:true,showBcs:true}});assert.equal(old.status,'VersionFound');
        after[id]={owner:old.details.owner,content:old.details.content};
      }
      write(name+'-after.json',after);
    }
    assert.deepEqual(after,read(name+'-before.json'));
  }
  rows.push({name,digest:result.digest,status:result.effects.status});console.log(JSON.stringify(rows.at(-1)));return result;
}
const pubfile=path.join(out,'published.toml');
if(!fs.existsSync(pubfile))fs.writeFileSync(pubfile,'build-env = "mainnet"\nchain-id = "ae60751d"\n');
const published={};
function relocate(raw,id) {
  const bytes=Buffer.from(raw);let pos=8;
  function uleb(){let n=0,shift=0,v;do{v=bytes[pos++];n|=(v&127)<<shift;shift+=7;}while(v&128);return n;}
  const tables=[];for(let count=uleb();count>0;count--)tables.push({kind:bytes[pos++],offset:uleb(),size:uleb()});
  const addresses=tables.find(t=>t.kind===8);assert(addresses&&addresses.size%32===0);let replaced=0;
  for(let i=pos+addresses.offset;i<pos+addresses.offset+addresses.size;i+=32)if(bytes.subarray(i,i+32).equals(Buffer.alloc(32))){Buffer.from(norm(id).slice(2),'hex').copy(bytes,i);replaced++;}
  assert.equal(replaced,1);return bytes;
}
async function publish(name,source) {
  const compiledFile=name+'-compiled.json';let compiled;
  const binding={chain:'ae60751d',protocol:137,source,tool_sha256:hash(cli),source_freeze:freeze.filter(f=>f.path.startsWith(source+path.sep)),standard_dependency:name==='producer'?published.standard.id:null};
  if(fs.existsSync(path.join(out,compiledFile))){compiled=read(compiledFile);assert.deepEqual(compiled.input_binding,binding,'compiled cache matches exact source/tool/dependency');}
  else {
    const r=spawnSync(cli,['client','--client.config',path.join(network,'client.yaml'),'test-publish',source,'--pubfile-path',pubfile,'--build-env','mainnet','--serialize-unsigned-transaction','--json','--gas-budget','5000000000'],{encoding:'utf8',maxBuffer:100*1024*1024});
    fs.writeFileSync(path.join(out,name+'-production-build.log'),r.stdout+r.stderr);assert.equal(r.status,0,'production publication build '+name);
    const [modules,dependencies]=JSON.parse(r.stdout.slice(r.stdout.indexOf('{'))).V1.kind.ProgrammableTransaction.commands.find(c=>c.Publish).Publish;
    compiled={modules:modules.map(m=>Buffer.from(m).toString('base64')),dependencies,input_binding:binding};write(compiledFile,compiled);
  }
  const allowed=['0x1','0x2',...(name==='producer'?[published.standard.id]:[])].map(norm);
  assert(compiled.dependencies.every(id=>allowed.includes(norm(id))),'exact dependency allowlist before signing '+name);
  if(name==='producer')assert(compiled.dependencies.map(norm).includes(norm(published.standard.id)),'producer uses this Standard');
  const generatedLock=path.join(source,'Move.lock');
  if(fs.existsSync(generatedLock)&&!freeze.some(f=>f.path===generatedLock)){
    const metadata=fs.existsSync(path.join(out,'generated-locks.json'))?read('generated-locks.json'):{files:[]};
    const old=metadata.files.find(f=>f.path===generatedLock);
    if(old)assert.equal(old.sha256,hash(generatedLock));
    else metadata.files.push({path:generatedLock,sha256:hash(generatedLock),same_compiled_modules_and_dependencies:true,compiled_cache_sha256:hash(path.join(out,compiledFile)),generated_by:'first production compiler output, bound to captured compiled artifact'});
    write('generated-locks.json',metadata);
  }
  const result=await run(name+'-publish',tx=>{const cap=tx.publish(compiled);tx.transferObjects([cap],tx.pure.address(alice));});
  const id=result.objectChanges.find(c=>c.type==='published').packageId;
  const cap=result.objectChanges.find(c=>c.type==='created'&&c.objectType==='0x2::package::UpgradeCap').objectId;
  const abi=await client.getNormalizedMoveModulesByPackage({package:id});write(name+'-abi.json',abi);
  const pkg=await object(id);write(name+'-package.json',pkg);
  assert.equal(Number(pkg.data.bcs.version),1);
  assert.deepEqual(Object.values(pkg.data.bcs.moduleMap).map(m=>sha(Buffer.from(m,'base64'))).sort(),compiled.modules.map(m=>sha(relocate(Buffer.from(m,'base64'),id))).sort(),'actual published bytecode is compiled candidate');
  assert.deepEqual(Object.values(pkg.data.bcs.linkageTable).map(v=>norm(v.upgraded_id)).sort(),compiled.dependencies.map(norm).sort());
  for(const t of pkg.data.bcs.typeOriginTable)assert.equal(norm(t.package),norm(id),'fresh defining type lineage');
  const capObject=await object(cap);write(name+'-cap.json',capObject);assert.equal(capObject.data.owner.AddressOwner,alice);assert.equal(norm(capObject.data.content.fields.package),norm(id));assert.equal(capObject.data.content.fields.version,'1');
  published[name]={id,cap,digest:result.digest,source};write('published.json',published);
  const line='published-at = "'+id+'"';if(!fs.readFileSync(pubfile,'utf8').includes(line)) fs.appendFileSync(pubfile,'\n[[published]]\nsource = { local = '+JSON.stringify(source)+' }\npublished-at = '+JSON.stringify(id)+'\noriginal-id = '+JSON.stringify(id)+'\nversion = 1\ntoolchain-version = "1.80.1"\nbuild-config = { flavor = "sui", edition = "2024" }\nupgrade-capability = '+JSON.stringify(cap)+'\n');
  return id;
}
const standardId=await publish('standard',standard);
const abi=read('standard-abi.json').soul;
assert.deepEqual(abi.structs.Creation.abilities.abilities,[]);
assert.deepEqual(abi.structs.Soul.abilities.abilities,['Store','Key']);
assert(!abi.exposedFunctions.finish_locked,'unsafe custody API excluded');
const producerId=await publish('producer',producer);
const producerDependencies=read('producer-compiled.json').dependencies;
assert(producerDependencies.map(norm).includes(norm(standardId)),'producer uses this exact verified Standard');
assert(producerDependencies.every(id=>['0x1','0x2',standardId].map(norm).includes(norm(id))),'no legacy or business dependencies');
const sourceReceipt=await run('source-create',tx=>{const s=tx.moveCall({target:producerId+'::producer::source'});tx.transferObjects([s],tx.pure.address(alice));});
const source=sourceReceipt.objectChanges.find(c=>c.type==='created'&&c.objectType===producerId+'::producer::Source').objectId;
const minted=await run('wallet-create-and-initialize',tx=>{tx.moveCall({target:producerId+'::producer::mint',arguments:[tx.object(source)]});});
const soul=minted.objectChanges.find(c=>c.type==='created'&&c.objectType===standardId+'::soul::Soul').objectId;
const first=await snapshot('wallet-born-soul.json',soul,minted);assert.equal(first.data.owner.AddressOwner,alice);assert.equal(first.data.content.fields.revision,'1');
assert.equal(first.data.content.fields.origin.fields.source,source);
assert.equal(first.data.content.fields.modules.length,1);
const module=first.data.content.fields.modules[0].fields;
assert.equal(module.value_type.fields.name,producerId.slice(2)+'::producer::Widget');
const child=await snapshot('wallet-born-widget.json',module.object,minted);assert(child.data,'installed actual DOF object');
assert(child.data.owner.ObjectOwner,'widget has a real object parent');
assert.equal(child.data.content.fields.bound_root,soul,'initial_root bound the actual issued root');
assert.equal(child.data.content.fields.bound_source,source,'widget bound the actual producer source');
assert.deepEqual(module.body_hash,Array.from(createHash('sha3-256').update(Buffer.from(child.data.bcs.bcsBytes,'base64')).digest()),'descriptor commits actual stored DOF bytes');
const parent=await client.getObject({id:child.data.owner.ObjectOwner,options:{showContent:true,showOwner:true}});
assert(parent.data,'actual DOF field wrapper');assert.equal(parent.data.owner.ObjectOwner,soul);
assert.equal(parent.data.content.fields.value,module.object);write('widget-parent-wrapper.json',parent);
const transferReceipt=await run('legal-transfer-to-bob',tx=>tx.transferObjects([tx.object(soul)],tx.pure.address(bob)));
const transferred=await snapshot('transferred-soul.json',soul,transferReceipt);assert.equal(transferred.data.owner.AddressOwner,bob);assert.deepEqual(transferred.data.content,first.data.content);
await run('reject-sharing-existing-root',tx=>{tx.moveCall({target:'0x2::transfer::public_share_object',typeArguments:[standardId+'::soul::Soul'],arguments:[tx.object(soul)]});},bob,/MoveAbort\(MoveLocation \{ module: ModuleId \{ address: 0*2, name: Identifier\("transfer"\) \}.*\}, 0\) in command 0/,[soul]);
const returnReceipt=await run('legal-transfer-back-to-alice',tx=>tx.transferObjects([tx.object(soul)],tx.pure.address(alice)),bob);
const returned=await snapshot('returned-soul.json',soul,returnReceipt);assert.equal(returned.data.owner.AddressOwner,alice);assert.deepEqual(returned.data.content,first.data.content);
for(const f of freeze)assert.equal(hash(f.path),f.sha256);
assert.deepEqual(await retainedSnapshot('retained-target-after.json'),read('retained-target-before.json'),'existing target objects preserved');
write('evidence.json',{chain:'ae60751d',protocol:137,production:false,scope:'isolated wallet Creation proof, no target consumer switch',published,source,soul,rows,transactions_submitted_this_run:submitted,wallet_creation_and_actual_initial_DOF:'PASS',legal_free_transfers:'PASS',existing_root_share_rejected_and_rollback:'PASS',fresh_creation_compile_cases:proof,custody:'Not run / excluded unsafe API',receiving:'Not run',other_target_constructors:'Not migrated',Gate0_complete:false,full_goal_complete:false});
