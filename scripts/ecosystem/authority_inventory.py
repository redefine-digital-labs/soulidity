#!/usr/bin/env python3
"""Enrich bounded static inventory with seven-kind dependencies and actual local evidence.
All authorities/flows are evidence-backed observations or explicitly pending inferences.
"""
import argparse,json,re
from pathlib import Path
from source_inventory import sha, read, write, PACKAGES, CATEGORIES

def split_top(s):
    parts=[];start=0;stack=[]
    for i,c in enumerate(s):
        if c in '<([{':stack.append(c)
        elif c in '>)]}' and stack:stack.pop()
        elif c==',' and not stack:parts.append(s[start:i].strip());start=i+1
    parts.append(s[start:].strip());return [p for p in parts if p]

def published(root,out):
    rel=Path('output/contract-rebuild/native-target-local-2026-10-10');base=root/rel
    p=base/'published.json';b=base/'bootstrap-evidence.json'
    if not p.exists() or not b.exists():return {'status':'Not run','reason':'explicit latest actual local evidence absent','packages':[]}
    pub=read(p);boot=read(b);rows=[]
    for pkg in pub['packages']:
        name=pkg['package'];rawp=base/(name+'-package.json');abip=base/(name+'-deployed-abi.json');capp=base/(name+'-cap.json')
        raw=read(rawp)['data'];abi=read(abip);cap=read(capp)['data'];bcs=raw['bcs'];cf=cap['content']['fields']
        assert raw['objectId']==pkg['id']==pkg['current'];assert int(raw['version'])==pkg['version'];assert cap['objectId']==pkg['cap'];assert cf['package']==pkg['current']
        write(out/(name+'-actual-abi.json'),abi)
        rows.append({'package':name,'current_callable_package':raw['objectId'],'package_version':raw['version'],'object_digest':raw['digest'],'type_origin_table':bcs['typeOriginTable'],'linkage_table':bcs['linkageTable'],'local_readback_paths':{'package':{'path':str(rawp),'sha256':sha(rawp)},'ABI':{'path':str(abip),'sha256':sha(abip),'copied_to':name+'-actual-abi.json'},'UpgradeCap':{'path':str(capp),'sha256':sha(capp)}},'UpgradeCap':{'id':cap['objectId'],'owner':cap['owner'],'package':cf['package'],'policy':cf['policy'],'version':cf['version'],'public_transfer':cap['content'].get('hasPublicTransfer'),'effective_governance':'raw address-owned Cap observed; no multisig/timelock/wrapper/immutability evidence inferred'},'publish_evidence':pkg,'status':'local retained readback indexed and IDs checked; no fresh RPC query','source_is_same_version':'compare exact local source-freeze separately; body/signature publication cannot be assumed after source changes','production':False})
    assert len(rows)==9
    freeze=base/'source-freeze.json';fr=read(freeze) if freeze.exists() else []
    same=all((root/r['source']).exists() and sha(root/r['source'])==r['sha256'] for r in fr)
    # Package bytes are readback evidence, not a present release gate.
    result={'status':'PASS evidence identity/index checks only','environment':{'chain':pub['chain'],'protocol':pub['protocol'],'production':False},'readback_method':'retained local JSON; this task made no RPC/signature/deployment','published_index':{'path':str(p),'sha256':sha(p)},'bootstrap_index':{'path':str(b),'sha256':sha(b)},'packages':rows,'objects':boot['state'],'actual_receipt_index':boot.get('receipts',{}),'source_freeze':{'path':str(freeze),'sha256':sha(freeze) if freeze.exists() else None,'inputs':len(fr),'all_current_source_hashes_match':same},'runtime_this_task':'Not run','qualified_review':'Not run','full_goal_complete':False,'historical_baselines':'preserved original Coverage references are historical duties/evidence; not mixed with this fresh nine-package lineage'}
    write(out/'local-published-evidence-index.json',result);return result

def authority(data,out):
    fs={f['id']:f for f in data['functions']};ms={m['id']:m for m in data['modules']};types={t['id']:t for t in data['types'] if not t['explicit_test_only']};flows=[]
    for f in fs.values():
        mod=ms[f['module']];imports=dict(mod['imported_types']);imports.update({t['name']:t['id'] for t in types.values() if t['module']==f['module']})
        for param in split_top(f['parameters']):
            if ':' not in param:continue
            name,typ=param.split(':',1)
            for token in re.findall(r'\b\w+(?:::\w+){0,2}\b',typ):
                resolved=imports.get(token,token if token in types else None)
                if resolved in types:
                    flows.append({'type':resolved,'function':f['id'],'position':'parameter','parameter':name.strip(),'full_type_expression':typ.strip(),'access':'mutable-reference' if '&mut' in typ else 'immutable-reference' if '&' in typ else 'by-value (source consumption opportunity; final consumption not inferred)','visibility':f['visibility'],'explicit_test_only':f['explicit_test_only']})
        for token in re.findall(r'\b\w+(?:::\w+){0,2}\b',f['returns']):
            resolved=imports.get(token,token if token in types else None)
            if resolved in types:flows.append({'type':resolved,'function':f['id'],'position':'return','full_type_expression':f['returns'],'access':'reference' if '&' in f['returns'] else 'by-value export','visibility':f['visibility'],'explicit_test_only':f['explicit_test_only']})
    special=[t for t in types.values() if t['key_object'] or not t['abilities'] or t['cap_name_candidate']]
    by_type={t['id']:[r for r in flows if r['type']==t['id']] for t in special}
    for t in special:t['construction_consumption_exports']=by_type[t['id']]
    paths=[]
    for f in fs.values():
        if f['explicit_test_only'] or f['visibility']=='private':continue
        seen=set();pending=[f['id']]
        while pending:
            item=pending.pop()
            if item in seen:continue
            seen.add(item);pending += [x for x in fs[item]['source_function_references'] if x not in seen]
        checks=[{'function':n,'source':fs[n]['path'],'line':fs[n]['line'],'signature':fs[n]['signature'],'source_assert_predicates':fs[n].get('source_assert_predicates',[])} for n in sorted(seen) if re.search(r'assert_|register_role|register_source|authorize_|settle|collect_|handover|withdraw|pause|freeze',fs[n]['name'])]
        if f['authority_inputs'] or checks:paths.append({'entry':f['id'],'path':f['path'],'line':f['line'],'signature':f['signature'],'direct_authority_inputs':f['authority_inputs'],'direct_source_assert_predicates':f.get('source_assert_predicates',[]),'indirect_reachable_source_checks_or_effects':checks,'basis':'resolved lexical local call graph only; private checks included, no alias method/bytecode/dynamic completeness claim','runtime':'Not run'})
    fresh=['soulidity_standard::soul::new','soulidity_application::character::new','soulidity_v1::catalog::mint_soul','soulidity_native::registry::new_root']
    findings=[]
    for key in fresh:
        f=fs[key];findings.append({'id':'D26-'+key,'decision':'D26','severity':'blocker','basis':'observed current source signature','entry':key,'signature':f['signature'],'path':f['path'],'line':f['line'],'visibility':f['visibility'],'finding':'Fresh Soul returned by value before final ownership delivery; Soul has key+store. Public cross-package source paths require owned-only builder/delivery redesign and actual external share/container attack verification.','runtime_attack':'Not run','public_scope':f['visibility']=='public'})
    findings += [{'id':'D26-nesting-exits','decision':'D26','basis':'existing Soul exports','entries':[x for x in ['soulidity_standard::soul::unnest','soulidity_standard::soul::begin_nested_update'] if x in fs],'finding':'Existing-root movement/edit exports are distinct from fresh-root issuance; preserve inventory and restoration hot-potato obligations; exact same-transaction freshness bypass must be tested.','runtime':'Not run'}, {'id':'D27-free-transfer','decision':'D27','basis':'Soul key+store and delegated authorization source','finding':'No universal public_transfer revoke hook. Owner+generation does not prove A→B→A revokes old detached reusable rights; each domain/custody path needs its actual lifecycle proof.','runtime':'Not run'}, {'id':'D28-co-package-coupling','decision':'D28','basis':'actual manifest and source graph','finding':'Catalog,market,release,custody/native adapters coexist in soulidity_v1 and share its UpgradeCap/release. MARKET→Application resale/character snapshot, Vault and Core handover coupling cannot be called independent release units. Native root constructor public(package) cannot simply move to another package.','runtime':'Not run'}, {'id':'D29-governance','decision':'D29','basis':'actual local Cap JSON','finding':'Raw local UpgradeCaps permit package changes; Config/source-role guards are separate authority and need actual old-entry/guard paths. No deployed multisig/timelock/recovery may be inferred from design or role names.','runtime':'Not run'}]
    write(out/'object-cap-construction-consumption-index.json',{'status':'static evidence only','types':special,'all_resolved_type_flow_uses':flows,'limits':'pack_or_unpack_sites are lexical candidates. By-value parameters do not prove mandatory final consumption. Refer to exact source and ABI; third-party attacks and runtime remain Not run.'})
    write(out/'direct-indirect-authority-paths.json',{'paths':paths,'runtime':'Not run','completeness':'lexical resolved local call expressions; not dynamic bytecode call graph'})
    write(out/'boundary-conflicts.json',{'Gate0':'Not passed','conflicts':findings,'full_goal_complete':False})
    return findings

def dependencies(data,out):
    mods={m['id']:m for m in data['modules']};edges=[]
    for m in mods.values():
        for target,lines in m['source_references'].items():
            if target in mods and target!=m['id']:
                edges.append({'consumer':m['id'],'provider':target,'kind':'compile','actions_types_state':'qualified module reference (use/signature/body)','selected_condition':'present source import/reference; not inferred user-selected runtime','exact_version_range':'source SHA '+mods[target]['sha256'],'change_trigger_validation':'cross-package production build and consumer source ABI/behavior checks','exit_migration':'exact owner/module split and unchanged old-target legal exits must be verified','evidence':{'path':m['path'],'lines':lines},'runtime':'Not run'})
    # Seven categories are semantic axes, not guessed duplicates of every import edge.
    selectors={
      'runtime':('soulidity_native::birth','soulidity_content::founding_library','actual Registry/Kiosk/TransferPolicy/System and live certified Blob inputs; selected native birth'),
      'behavior':('soulidity_v1::market','soulidity_application::resale','asset quote/settlement/rounding/handover; selected whole-Soul market'),
      'permission':('soulidity_native::registry','soulidity_foundation::economics','Admin/Config/Publisher/latest UpgradeCap/source revision registration; selected Native issuer'),
      'funds':('soulidity_v1::market','soulidity_foundation::economics','Coin<C>/receipt/fee lanes and seller/platform/creator income; selected market settlement'),
      'state':('soulidity_v1::market','soulidity_application::character','Manifest/Snapshot/root revision/schema/CAS and handover state; selected application-bearing Soul'),
      'content':('soulidity_native::birth','soulidity_content::founding_library','Library/Founding/certified Blob content and expiration; selected initial content')}
    for kind,(a,b,scope) in selectors.items():
        m=mods[a];e={'consumer':a,'provider':b,'kind':kind,'actions_types_state':scope,'selected_condition':scope.split(';')[-1].strip(),'exact_version_range':'current source SHAs '+m['sha256']+'/'+mods[b]['sha256']+'; actual package linkage in local-published-evidence-index.json','change_trigger_validation':'applicable exact CASE, original duty and current consumer composition; no automatic consumer release','exit_migration':'Not run; do not claim unconditional cancellation/refund/content recovery/asset exit','evidence':{'consumer_path':m['path'],'consumer_sha256':m['sha256'],'provider_path':mods[b]['path'],'provider_sha256':mods[b]['sha256']},'basis':'source-domain mapping for review, not completed semantic/runtime proof','runtime':'Not run'};edges.append(e)
    write(out/'seven-kind-dependencies.json',{'categories':CATEGORIES,'definition_source':'docs/SOULIDITY_ECOSYSTEM_MODULARIZATION_SPEC_CN.md §3.2','edges':edges,'manifest_dependencies':data['packages'],'missing_runtime_scope':'all semantic dependencies of every function are not yet independently reviewed; six semantic examples are not exhaustive','runtime':'Not run'})

SELECTORS={
'STANDARD':['move/soulidity_standard/sources/*.move'], 'CONTENT':['move/soulidity_content/sources/*.move'], 'COMMUNITY':['move/soulidity_community/sources/*.move'],
'MAKER':['move/soulidity_v1/sources/catalog.move','move/soulidity_v1/sources/release.move','move/soulidity_v1/sources/issuer.move','move/soulidity_v1/sources/player.move','move/soulidity_v1/sources/physical.move','move/soulidity_v1/sources/collection.move','move/soulidity_application/sources/issuance.move','move/soulidity_application/sources/publication_rules.move'],
'CHANNEL':[], 'MARKET':['move/soulidity_v1/sources/market.move','move/soulidity_application/sources/resale.move'],
'EXTENSIONS':['move/soulidity_application/sources/character.move','move/soulidity_application/sources/forms.move','move/soulidity_application/sources/growth.move','move/soulidity_application/sources/output.move','move/soulidity_application/sources/vault.move','move/soulidity_application/sources/visual_capture.move','move/soulidity_model/sources/*.move','move/soulidity_visual/sources/*.move'],
'SDK':[], 'DEVOPS':['scripts/verify_contract_ability_probes.py','scripts/verify_contract_publication_budget.py'], 'INTEGRATION':['move/soulidity_v1/tests/*.move','scripts/verify_soul_standard_external.py','scripts/verify_soul_standard_local.mjs'],
'NATIVE.PRODUCER':['move/soulidity_native/sources/*.move','move/soulidity_v1/sources/native_creation.move','move/soulidity_v1/sources/native_binding.move'],
'POLICY.ASSET_RULES':['move/soulidity_foundation/sources/economics.move','move/soulidity_foundation/sources/revenue.move','move/soulidity_foundation/sources/source_authority.move','move/soulidity_model/sources/policy.move','move/soulidity_model/sources/material_policy.move'],
'POLICY.PACKAGE_GOVERNANCE':['move/soulidity_foundation/sources/package_roles.move'],
'CLIENTS.SOULDESK':['desktop/package.json','desktop/packages/backend/src/**'],
'CLIENTS.SO_WEB':['web/**'], 'CLIENTS.EXTERNAL_INTERFACE':['move/standard_examples/**','scripts/verify_soul_standard_external.py'],
'CLIENTS.DOCS':['docs/SOUL_STANDARD_KERNEL_CN.md','docs/SOUL_DOF_V1_REBUILD_CN.md'],
'AUTHORING.EDITOR':[], 'AUTHORING.PUBLISHER':[], 'LEGACY.HISTORY':[], 'CLIENTS.ENGINE':[], 'CLIENTS.EXPEDITION':[], 'CLIENTS.THEATER':[], 'CLIENTS.STELLAR':[], 'CLIENTS.HABITAT':[]}

def mappings(root,design,data,out):
    c=read(design/'docs/open-ecosystem/MODULE_INTEROPERABILITY_CONTRACTS.json');plan=read(design/'docs/open-ecosystem/MODULE_DELIVERY_PLAN.json');rows=[]
    for x in c['modules']+c['retained_maintenance_units']:
        id=x['id'];sels=SELECTORS[id];resolved=[]
        for pattern in sels:
            # Only source selector existence; never load keys/build/output content.
            prefix=pattern.split('*')[0].rstrip('/')
            if (root/prefix).exists():resolved.append({'selector':pattern,'root':str(root),'status':'exists (bounded source selector)'} )
            elif (design/prefix).exists():resolved.append({'selector':pattern,'root':str(design),'status':'exists design/product tree; active writable authority not proven'})
            else:resolved.append({'selector':pattern,'root':str(root),'status':'Not located; exact active authority pending'})
        release=sorted({m['package'] for m in data['modules'] if any(Path(m['path']).match(s) for s in sels)})
        row={'id':id,'source_contract':x,'source_selectors':resolved,'functions':[f['id'] for f in data['functions'] if not f['explicit_test_only'] and any(Path(f['path']).match(s) for s in sels)],'write_scope':'Proposed selectors only; no live source-write authorization in this inventory task','actual_writer':'existing owner must be resolved from original records; not assigned by this script','independent_reviewer':'existing acceptance record + qualified independent reviewer; Not run','maintenance_mapping_preserved':x.get('maintenance_mapping',x.get('maintenance_owner_ref')),'review_mapping_preserved':x.get('review_mapping',x.get('review_owner_ref')),'actual_current_release_units':release,'target_release_unit':x.get('repository',x.get('release_unit')),'independent_release_status':'Not run; same-package selectors share real UpgradeCap','engineering_authority_applicability':{'source':{'status':'Observed source selectors' if resolved else 'Pending exact active selector','actual_grant':'Not verified'},'version_release':{'status':'Applicable' if id!='INTEGRATION' else 'N/A own version-release pipeline per plan; integration reports/composition evidence','actual_grant':'Not verified'},'production_deployment':{'status':'Applicable to real publishable runtime/tool consumers; exact target required','authorization':'No new production authorization'},'onchain_control':{'status':'Applicable: exact Cap/object/control inputs in inventories' if release else 'N/A protocol Cap ownership for this noncontract duty; transaction construction/signing authority separately pending','deployment_proof':'local evidence index only; governance/recovery Not run'}},'mapping_status':'Partial exact source selectors' if resolved else 'Unresolved; do not invent active worktree/owner or count as Gate0 pass'}
        if id=='CHANNEL':row['remaining']='No separate Channel production module located among current nine packages. Original source/channel records must be traced; naming services or Config as Channel would create false authority.'
        if id.startswith('CLIENTS.') or id.startswith('AUTHORING.'):row['active_authority_warning']='Located repository directory does not establish current deployed frontend/worktree; original product task CURRENT and owner must be confirmed.'
        rows.append(row)
    assert len(rows)==25
    write(out/'module-and-retained-source-selectors.json',{'modules':10,'retained_units':15,'rows':rows,'full_exact_mapping_complete':False,'all_owners_preserved':True,'not_second_task_board':True,'source_contract_sha256':sha(design/'docs/open-ecosystem/MODULE_INTEROPERABILITY_CONTRACTS.json'),'module_plan_sha256':sha(design/'docs/open-ecosystem/MODULE_DELIVERY_PLAN.json')})

def additional_indexes(root,data,out):
    types={t['id']:t for t in data['types'] if not t['explicit_test_only']};flow=read(out/'object-cap-construction-consumption-index.json')['all_resolved_type_flow_uses']
    groups={
      'production_supply':['soulidity_native::registry::Claim','soulidity_native::birth::Draft','soulidity_application::issuance::Binding','soulidity_application::issuance::Genesis','soulidity_application::issuance::Contribution','soulidity_v1::issuer::Build','soulidity_v1::runtime::Build'],
      'channel_execution':[],
      'order_delivery':['soulidity_application::resale::Receipt','soulidity_foundation::economics::MarketReceipt'],
      'application_result':['soulidity_application::growth::Receipt','soulidity_application::output::Receipt','soulidity_application::output::Creation']}
    rows=[]
    for category,ids in groups.items():
        rows.append({'category':category,'types':[{'declaration':types[i],'constructors_or_unpackers':types[i].get('pack_or_unpack_sites',[]),'consumers_exports':[r for r in flow if r['type']==i]} for i in ids],'status':'No separate production Channel proof found in nine current packages' if not ids else 'Static source type/pack/unpack/signature index; authoritative mandatory final consumption not proven','replay_drop_copy_storage_obligation':'Each type actual abilities retained; copy/drop/store receipts must not be assumed hot-potato obligations','four_legal_paths_and_counterexamples':'Not run'})
    write(out/'cross-module-proof-lifecycle.json',{'D28_categories':rows,'runtime':'Not run','no_standard_reverse_business_dependency_added':True,'not_full_D28_proof':True})
    coin_uses=[{'function':f['id'],'path':f['path'],'line':f['line'],'signature':f['signature']} for f in data['functions'] if not f['explicit_test_only'] and re.search(r'\b(Coin|Balance)<',f['signature'])]
    concrete=[]
    for m in data['modules']:
        for alias,target in m['imported_types'].items():
            if target in ['sui::sui::SUI','wal::wal::WAL']:concrete.append({'module':m['id'],'type':target,'alias':alias,'path':m['path']})
    write(out/'external-coin-control-index.json',{'D29':'Pending exact per-CoinType deployment/control/exit verification','generic_payment_functions':coin_uses,'concrete_imports':concrete,'Soulidity_TreasuryCap_or_DenyCapV2_definition':'none in these nine production source packages; does not imply external currencies have none','controls_to_resolve_per_currency':['actual type origin/decimals','TreasuryCap/Supply mint-burn holder and governance','DenyCapV2 address/global pause applicability with real deployment evidence','frozen payment/change/refund/income/Vault/asset exit cases'],'actual_current_currency_list':'generic C/T API permits parameters; full concrete deployed allowlist and external holders not proven by generic signatures','runtime':'Not run','N_A_policy':'Do not infer N/A from absence in Soulidity source; require exact external currency deployment evidence'})
    base=root/'output/contract-rebuild/native-target-local-2026-10-10';boot=read(base/'bootstrap-evidence.json');pubrows=[]
    for mod,obj in boot.get('pubs',{}).items():
        pkg,module=mod.split('::');path=base/(pkg+'-publisher-'+module+'.json');raw=read(path)['data'] if path.exists() else None
        if raw:assert raw['objectId']==obj
        pubrows.append({'module':mod,'id':obj,'path':str(path),'sha256':sha(path) if path.exists() else None,'owner':raw.get('owner') if raw else None,'fields':raw.get('content',{}).get('fields') if raw else None,'status':'retained actual Publisher readback' if raw else 'bootstrap ID only; raw readback not located','authority_warning':'Publisher type/module qualification and UpgradeCap are distinct; no total-asset control inferred'})
    write(out/'publisher-and-bootstrap-authority-index.json',{'publisher_objects':pubrows,'bootstrap_objects':boot['state'],'bootstrap_path':str(base/'bootstrap-evidence.json'),'shared_object_owner_is_not_admin_authority':True,'all_guard_and_final_consumer_checks':'Not run in this task','production':False})
    mods={m['id']:m for m in data['modules']};ids={n:'m'+str(i) for i,n in enumerate(sorted(mods))};lines=['@startuml','title Actual 52 Move modules: qualified source references','left to right direction']
    for pkg in PACKAGES:
        lines.append('package "'+pkg+'" {')
        for n,m in sorted(mods.items()):
            if m['package']==pkg:lines.append('component "'+n.split('::')[1]+'" as '+ids[n])
        lines.append('}')
    for n,m in sorted(mods.items()):
        for target in m['source_references']:
            if target in mods and target!=n:lines.append(ids[n]+' --> '+ids[target])
    lines+=['note bottom','Source references, not a dynamic/bytecode call graph.','No runtime or publication independence claim.','end note','@enduml'];(out/'actual-source-module-dependencies.puml').write_text('\n'.join(lines)+'\n')

def main():
    ap=argparse.ArgumentParser();ap.add_argument('--source-root',type=Path,required=True);ap.add_argument('--design-root',type=Path,required=True);ap.add_argument('--output',type=Path,required=True);a=ap.parse_args();root=a.source_root.resolve();design=a.design_root.resolve();out=a.output.resolve();d=read(out/'current-source-inventory.json')
    findings=authority(d,out);dependencies(d,out);mappings(root,design,d,out);pub=published(root,out);additional_indexes(root,d,out)
    summary={'static_source_inventory':d['counts'],'original_duty_queue':d['preserved_original_duties'],'actual_local_published_packages':len(pub['packages']),'current_local_readback_source_freeze':pub.get('source_freeze'),'conflicts':len(findings),'Gate0':'Not passed','runtime_this_inventory_task':'Not run','full_goal_complete':False,'handbook':{'version':'1.0 2026-10-06','sections':[1,2,3,4,7,8,9,12],'record_update':'root to attach evidence to existing Delivery/DEV/BUG; no external writes from this subtask'}}
    write(out/'SUMMARY.json',summary);print(json.dumps({'inventory':d['counts'],'local_packages':len(pub['packages']),'Gate0':'Not passed'}))
if __name__=='__main__':main()
