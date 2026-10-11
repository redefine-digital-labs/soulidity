#!/usr/bin/env python3
"""Build independent production D26 probes; compile expectations are not safety.

Every run requires a new output directory. Source/live Standard are read-only.
Generated candidates never switch consumers or submit transactions.
"""
from pathlib import Path
import argparse, hashlib, json, re, shutil, subprocess, sys

ROOT = Path(__file__).resolve().parents[2]

def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def manifest(path):
    files = [path/'Move.toml', *sorted((path/'sources').rglob('*.move'))]
    if (path/'Move.lock').exists():
        files.append(path/'Move.lock')
    files += sorted((path/'tests').rglob('*.move'))
    return {str(p.relative_to(path)):sha(p) for p in files}

def package(path,name,address,dependencies,source):
    (path/'sources').mkdir(parents=True,exist_ok=False)
    (path/'Move.toml').write_text(
        f'[package]\nname = "{name}"\nedition = "2024"\n\n'
        f'[dependencies]\n{dependencies}\n[addresses]\n{address} = "0x0"\n')
    (path/'sources/probe.move').write_text(source)

def re_diagnostic(output):
    clean = re.sub(r'\x1b\[[0-9;]*m','',output)
    match = re.search(r'error\[([^\]]+)\][^\n]*',clean)
    if not match:
        return None
    rest = clean[match.end():]
    stop = re.search(r'\n(?:error|warning)\[',rest)
    end = match.end()+(stop.start() if stop else len(rest))
    return {'code':match.group(1),'header':match.group(),'block':clean[match.start():end]}

def candidate_source(source,wallet_only):
    declaration = 'public struct Soul has key, store {'
    assert source.count(declaration)==1, 'Standard declaration changed'
    source = source.replace(declaration,
        '/// Linear fresh root: no key/store/copy/drop or mutable root export.\n'
        'public struct Creation { root: Soul }\n\n'+declaration,1)
    start = source.index('public fun new<W: drop, P: key>')
    end = source.index('\nfun find<W>',start)
    constructor = source[start:end]
    assert constructor.count('): Soul {')==1 and constructor.count('\n    s\n}')==1
    constructor = constructor.replace('): Soul {','): Creation {',1)
    constructor = constructor.replace('\n    s\n}','\n    Creation { root: s }\n}',1)
    source = source[:start]+constructor+source[end:]
    source += '''
/// Read-only access lets independent content authorities bind initial modules.
public fun initial_root(c: &Creation): &Soul { &c.root }
public fun creation_id(c: &Creation): ID { object::id(&c.root) }
public fun install_initial<W: drop, T: key + store>(
    c: &mut Creation, w: W, name: vector<u8>, value: T,
    schema: u16, removable: bool, semantic: vector<u8>, expected: u64,
) { install(&mut c.root, w, name, value, schema, removable, semantic, expected) }
/// The wallet profile consumes Creation into the transaction sender's ownership.
public fun finish_owned(c: Creation, ctx: &TxContext): ID {
    let Creation { root } = c; ready(&root);
    assert!(root.origin.minted_by == ctx.sender(), EAuthority);
    let id = object::id(&root); transfer::public_transfer(root, ctx.sender()); id
}
'''
    if not wallet_only:
        source += '''
/// UNSAFE EXPERIMENT: standard Kiosk custody can expose the fresh Soul again.
/// Retained as a counterexample, never as an owned-only solution.
public fun finish_locked(c: Creation, k: &mut sui::kiosk::Kiosk,
    cap: &sui::kiosk::KioskOwnerCap,
    policy: &sui::transfer_policy::TransferPolicy<Soul>, ctx: &TxContext): ID {
    let Creation { root } = c; ready(&root);
    assert!(root.origin.minted_by == ctx.sender(), EAuthority);
    let id = object::id(&root); sui::kiosk::lock(k, cap, policy, root); id
}
'''
    return source

BASELINE_PRODUCER = '''module independent_producer::producer;
use soulidity_standard::soul::{Self,Soul};
public struct SoulProducer has drop {}
public struct Source has key,store { id:UID }
public fun source(ctx:&mut TxContext):Source { Source{id:object::new(ctx)} }
public fun mint(p:&Source,ctx:&mut TxContext):Soul {
    soul::new(SoulProducer{},p,1,std::hash::sha3_256(b"fixture"),std::string::utf8(b"OC"),ctx)
}
'''
WALLET_PRODUCER = '''module independent_producer::producer;
use soulidity_standard::soul::{Self,Soul,Creation};
public struct SoulProducer has drop {}
public struct Source has key,store { id:UID }
public struct Witness has drop {}
public struct Widget has key,store { id:UID,bound_root:ID,bound_source:ID }
public fun source(ctx:&mut TxContext):Source { Source{id:object::new(ctx)} }
public fun build(p:&Source,ctx:&mut TxContext):Creation {
    soul::new(SoulProducer{},p,1,std::hash::sha3_256(b"fixture"),std::string::utf8(b"OC"),ctx)
}
/// Independent constructor genuinely uses the restricted root reference.
public fun widget(p:&Source,root:&Soul,ctx:&mut TxContext):Widget {
    let origin=soul::origin(root);
    assert!(soul::source(&origin)==object::id(p),0);
    Widget{id:object::new(ctx),bound_root:object::id(root),bound_source:object::id(p)}
}
public fun mint(p:&Source,ctx:&mut TxContext):ID {
    let mut c=build(p,ctx);
    let value=widget(p,soul::initial_root(&c),ctx);
    soul::install_initial(&mut c,Witness{},b"widget",value,1,true,std::hash::sha3_256(b"fixture"),0);
    soul::finish_owned(c,ctx)
}
public fun widget_id(root:&Soul):ID {
    object::id(soul::borrow_module<Witness,Widget>(root,b"widget"))
}
public fun root_binding(root:&Soul):ID {
    soul::borrow_module<Witness,Widget>(root,b"widget").bound_root
}
public fun source_binding(root:&Soul):ID {
    soul::borrow_module<Witness,Widget>(root,b"widget").bound_source
}
'''
LOCKED_PRODUCER = '''
public fun locked(p:&Source,k:&mut sui::kiosk::Kiosk,cap:&sui::kiosk::KioskOwnerCap,
    policy:&sui::transfer_policy::TransferPolicy<Soul>,ctx:&mut TxContext):ID {
    soul::finish_locked(build(p,ctx),k,cap,policy,ctx)
}
'''

def cases(wallet_only):
    # Match each primary diagnostic in its own probe. Parse/name errors never
    # count as rejection of an ownership escape.
    result = [
        ('baseline','fresh_root_can_share',True,None,'counterexample',
         'public fun attack(p:&producer::Source,ctx:&mut TxContext){transfer::public_share_object(producer::mint(p,ctx))}'),
        ('baseline','fresh_root_can_party_transfer',True,None,'unsupported_existing_root_control',
         'public fun attack(p:&producer::Source,ctx:&mut TxContext){transfer::public_party_transfer(producer::mint(p,ctx),sui::party::single_owner(ctx.sender()))}'),
        ('candidate','legitimate_wallet_and_initial_module',True,None,'legitimate',
         'public fun accept(p:&producer::Source,ctx:&mut TxContext):ID{producer::mint(p,ctx)}'),
        ('candidate','legitimate_owned_root_transfer',True,None,'legitimate',
         'public fun accept(root:soul::Soul,recipient:address){transfer::public_transfer(root,recipient)}'),
        ('candidate','legitimate_restricted_root_read',True,None,'legitimate',
         'public fun accept(p:&producer::Source,ctx:&mut TxContext):ID{let c=producer::build(p,ctx);let r=soul::initial_root(&c);let id=object::id(r);let _origin=soul::origin(r);let _revision=soul::revision(r);assert!(id==soul::creation_id(&c),0);soul::finish_owned(c,ctx)}'),
        ('candidate','share_linear_creation',False,'EC05001','boundary_rejection',
         'public fun attack(p:&producer::Source,ctx:&mut TxContext){transfer::public_share_object(producer::build(p,ctx))}'),
        ('candidate','party_transfer_linear_creation',False,'EC05001','boundary_rejection',
         'public fun attack(p:&producer::Source,ctx:&mut TxContext){transfer::public_party_transfer(producer::build(p,ctx),sui::party::single_owner(ctx.sender()))}'),
        ('candidate','pack_creation_in_shareable_wrapper',False,'EC05001','boundary_rejection',
         'public struct Wrapper has key,store{id:UID,c:soul::Creation}\npublic fun attack(p:&producer::Source,ctx:&mut TxContext){transfer::public_share_object(Wrapper{id:object::new(ctx),c:producer::build(p,ctx)})}'),
        ('candidate','unpack_fresh_root',False,'EC04001','boundary_rejection',
         'public fun attack(p:&producer::Source,ctx:&mut TxContext){let soul::Creation{root}=producer::build(p,ctx);transfer::public_share_object(root)}'),
        ('candidate','ignore_final_delivery',False,'EC06001','boundary_rejection',
         'public fun attack(p:&producer::Source,ctx:&mut TxContext){let _c=producer::build(p,ctx);}'),
        ('candidate','mutate_fresh_root_from_read_only_ref',False,'EC04006','boundary_rejection',
         'public fun attack(p:&producer::Source,ctx:&mut TxContext){let c=producer::build(p,ctx);let r:&mut soul::Soul=soul::initial_root(&c);let _r=r;soul::finish_owned(c,ctx);}'),
        ('candidate','share_creation_defining_only_api',False,'ESC02009','boundary_rejection',
         'public fun attack(p:&producer::Source,ctx:&mut TxContext){transfer::share_object(producer::build(p,ctx))}'),
        ('candidate','party_creation_defining_only_api',False,'ESC02009','boundary_rejection',
         'public fun attack(p:&producer::Source,ctx:&mut TxContext){transfer::party_transfer(producer::build(p,ctx),sui::party::single_owner(ctx.sender()))}'),
        ('candidate','copy_readonly_fresh_root',False,'EC05001','boundary_rejection',
         'public fun attack(p:&producer::Source,ctx:&mut TxContext){let c=producer::build(p,ctx);let r=soul::initial_root(&c);let r_copy=copy r;let s=*r_copy;transfer::public_share_object(s);soul::finish_owned(c,ctx);}'),
        ('candidate','share_readonly_fresh_root_ref',False,'EC05001','boundary_rejection',
         'public fun attack(p:&producer::Source,ctx:&mut TxContext){let c=producer::build(p,ctx);transfer::public_share_object(soul::initial_root(&c));soul::finish_owned(c,ctx);}'),
        ('candidate','borrow_mut_uid_from_restricted_root',False,'EC04006','boundary_rejection',
         'public fun attack(p:&producer::Source,ctx:&mut TxContext){let c=producer::build(p,ctx);let uid:&mut UID=object::borrow_uid(soul::initial_root(&c));let _uid=uid;soul::finish_owned(c,ctx);}'),
        ('candidate','share_final_delivery_id',False,'EC05001','boundary_rejection',
         'public fun attack(p:&producer::Source,ctx:&mut TxContext){transfer::public_share_object(producer::mint(p,ctx))}'),
        ('candidate','store_creation_in_option',False,'EC05001','boundary_rejection',
         'public struct Wrapper has store {c:std::option::Option<soul::Creation>}\npublic fun attack(p:&producer::Source,ctx:&mut TxContext):Wrapper{Wrapper{c:std::option::some(producer::build(p,ctx))}}'),
    ]
    if not wallet_only:
        result.append(('candidate','legitimate_native_locked_kiosk',True,None,'legitimate',
            'public fun accept(p:&producer::Source,k:&mut sui::kiosk::Kiosk,cap:&sui::kiosk::KioskOwnerCap,policy:&sui::transfer_policy::TransferPolicy<soul::Soul>,ctx:&mut TxContext):ID{producer::locked(p,k,cap,policy,ctx)}'))
        prefix = '''public fun attack(p:&producer::Source,k:&mut sui::kiosk::Kiosk,cap:&sui::kiosk::KioskOwnerCap,policy:&sui::transfer_policy::TransferPolicy<soul::Soul>,ctx:&mut TxContext){
    let id=producer::locked(p,k,cap,policy,ctx);
    sui::kiosk::list<soul::Soul>(k,cap,id,0);
    let(root,request)=sui::kiosk::purchase<soul::Soul>(k,id,sui::coin::zero<sui::sui::SUI>(ctx));
    let(_,_,_)=sui::transfer_policy::confirm_request(policy,request);
'''
        result += [
            ('candidate','locked_purchase_can_share_fresh_root',True,None,'counterexample',
             prefix+'    sui::transfer::public_share_object(root);\n}\n'),
            ('candidate','locked_purchase_can_party_transfer_fresh_root',True,None,'counterexample',
             prefix+'    sui::transfer::public_party_transfer(root,sui::party::single_owner(ctx.sender()));\n}\n'),
        ]
    return result

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--out',type=Path,required=True)
    parser.add_argument('--sui',type=Path,required=True)
    parser.add_argument('--profile',choices=['wallet','unsafe-custody'],default='unsafe-custody')
    parser.add_argument('--wallet-only',action='store_true',help='Alias for --profile wallet')
    parser.add_argument('--live-standard',type=Path,help='Authoritative read-only Standard verifying the input copy')
    args = parser.parse_args()
    profile = 'wallet' if args.wallet_only else args.profile
    wallet_only = profile=='wallet'
    sui = args.sui.resolve(strict=True)
    input_standard = ROOT/'move/soulidity_standard'
    live_standard = args.live_standard.resolve(strict=True) if args.live_standard else input_standard
    input_before,live_before = manifest(input_standard),manifest(live_standard)
    if input_before!=live_before:
        parser.error('Input Standard differs from supplied live Standard; copy latest input first')
    out = args.out.resolve()
    if out==input_standard or input_standard in out.parents or out==live_standard or live_standard in out.parents:
        parser.error('Output must not be inside either read-only Standard input')
    try:
        out.mkdir(parents=True,exist_ok=False)
    except FileExistsError:
        parser.error('Output already exists: choose a fresh path; never overwrite evidence')
    script_sha = sha(Path(__file__))
    version = subprocess.run([str(sui),'--version'],capture_output=True,text=True)
    (out/'tool-version.log').write_text(version.stdout+version.stderr)
    if version.returncode:
        raise RuntimeError('Cannot identify pinned Sui binary; output preserved')
    for variant in ['baseline','candidate']:
        standard = out/variant/'standard'
        standard.mkdir(parents=True)
        for name in ['Move.toml','Move.lock']:
            if (input_standard/name).exists():
                shutil.copy2(input_standard/name,standard/name)
        shutil.copytree(input_standard/'sources',standard/'sources')
    candidate_soul = out/'candidate/standard/sources/soul.move'
    candidate_soul.write_text(candidate_source(candidate_soul.read_text(),wallet_only))
    candidate_sha = sha(candidate_soul)
    baseline_soul = out/'baseline/standard/sources/soul.move'
    baseline_sha = sha(baseline_soul)
    for variant,producer in [('baseline',BASELINE_PRODUCER),('candidate',WALLET_PRODUCER+('' if wallet_only else LOCKED_PRODUCER))]:
        package(out/variant/'producer','IndependentProducer','independent_producer',
            'SoulidityStandard = { local = "../standard" }',producer)
    definitions = cases(wallet_only)
    assert len({case[1] for case in definitions})==len(definitions), 'Duplicate case name'
    evidence = {
        'profile':profile,'wallet_only_candidate':wallet_only,
        'script_source':str(Path(__file__).resolve()),'script_sha256':script_sha,
        'sui_binary':str(sui),'sui_binary_sha256':sha(sui),'sui_version':(version.stdout+version.stderr).strip(),
        'input_standard':str(input_standard),'input_standard_manifest_sha256':input_before,
        'live_standard':str(live_standard),'live_standard_manifest_sha256':live_before,
        'live_source':str(live_standard/'sources/soul.move'),'live_source_sha256':live_before['sources/soul.move'],
        'baseline_source':str(baseline_soul),'baseline_source_sha256':baseline_sha,
        'candidate_source':str(candidate_soul),'candidate_source_sha256':candidate_sha,
        'candidate_producer':str(out/'candidate/producer/sources/probe.move'),
        'candidate_producer_sha256':sha(out/'candidate/producer/sources/probe.move'),
        'expected_compile_matrix':[{'case':name,'variant':variant,'expected_compile_success':expected,
            'expected_primary_code':diagnostic,'purpose':purpose} for variant,name,expected,diagnostic,purpose,_ in definitions],
        'cases':[],'all_expected_results':False,'run_complete':False,
        'runtime':{'status':'Not run','transactions_submitted':0},
        'owned_only_safety_verdict':'Not established: compile probes are not runtime ownership proof',
        'all_fresh_roots_owned':None,'consumer_switch':False,'chain_release':False,'Gate0_complete':False,
        'unsupported':['Existing key+store Soul retains public_transfer/public_party_transfer; global prohibition is not implemented.',
            'Wallet-only candidate does not support a fresh-root custody exit.'],
        'limitations':['Independent production compile only; actual owner readback/share rejection, receiving and custody PTBs remain.',
            'Candidate changes new return type; Native/Application/Maker production migration not performed.',
            'Generated candidate omits existing test-only files; no VM/test result claimed.',
            'Empty TransferPolicy and authorized Kiosk owner are runtime preconditions of unsafe purchase counterexamples.'],
    }
    def save():
        (out/'evidence.json').write_text(json.dumps(evidence,indent=2)+'\n')
    save()
    for variant,name,expected,diagnostic,purpose,body in definitions:
        path = out/variant/name
        source = path/'sources/probe.move'
        package(path,'ExternalProbe','external_probe',
            'IndependentProducer = { local = "../producer" }\nSoulidityStandard = { local = "../standard" }',
            'module external_probe::probe;\nuse independent_producer::producer;\nuse soulidity_standard::soul;\n'+body+'\n')
        command = [str(sui),'move','build','--path',str(path),'--dump-bytecode-as-base64',
            '--no-tree-shaking','--with-unpublished-dependencies']
        run = subprocess.run(command,capture_output=True,text=True)
        log = out/(name+'.log')
        log.write_text(run.stdout+run.stderr)
        primary = re_diagnostic(run.stdout+run.stderr)
        met = (run.returncode==0)==expected
        if not expected:
            met = met and primary is not None and primary['code']==diagnostic
            met = met and './sources/probe.move' in primary['block']
        result = {'case':name,'variant':variant,'purpose':purpose,'expected_compile_success':expected,
            'exit_code':run.returncode,'production_compile':True,'compile_success':run.returncode==0,
            'probe_source':str(source),'source_sha256':sha(source),
            'standard_source_sha256':baseline_sha if variant=='baseline' else candidate_sha,
            'diagnostic':primary,'expected_primary_code':diagnostic,'compile_expectation_met':bool(met),'pass':bool(met),
            'command':command,'log':str(log),'log_sha256':sha(log)}
        evidence['cases'].append(result)
        save()
        print(json.dumps({k:v for k,v in result.items() if k not in ['diagnostic','command']}),flush=True)
    evidence['input_standard_unchanged'] = input_before==manifest(input_standard)
    evidence['live_standard_unchanged'] = live_before==manifest(live_standard)
    evidence['candidate_source_unchanged'] = candidate_sha==sha(candidate_soul)
    evidence['baseline_source_unchanged'] = baseline_sha==sha(baseline_soul)
    evidence['all_expected_results'] = all(case['compile_expectation_met'] for case in evidence['cases'])
    evidence['run_complete'] = True
    custody_exits = [case for case in evidence['cases'] if case['variant']=='candidate'
        and case['purpose']=='counterexample' and case['compile_success']]
    if custody_exits:
        evidence['owned_only_safety_verdict'] = 'FAIL: unsafe custody has compile-valid fresh-root exits; runtime Not run'
        evidence['all_fresh_roots_owned'] = False
    evidence['compile_valid_custody_counterexamples'] = [case['case'] for case in custody_exits]
    save()
    guards = all(evidence[name] for name in ['input_standard_unchanged','live_standard_unchanged',
        'candidate_source_unchanged','baseline_source_unchanged'])
    if not guards or not evidence['all_expected_results']:
        print('Unexpected production probe or source mutation; evidence preserved',file=sys.stderr)
        return 1
    return 0

if __name__=='__main__':
    sys.exit(main())
