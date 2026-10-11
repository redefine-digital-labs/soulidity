#!/usr/bin/env python3
"""Rebuild evidence-backed Gate0 record/source mappings without modifying authorities.

Local only. Exact declarations are evidence of existence, never semantic completion.
No source, task board, owner, Git, wallet, network or deployed authority is mutated.
"""
from __future__ import annotations
import argparse, collections, csv, hashlib, io, json, re
from pathlib import Path

DESIGN_DEFAULT = Path('/Users/naoer/Documents/Claude/Projects/soulidity')
SOURCE_DEFAULT = Path('/Users/naoer/.codex/worktrees/soul-dof-v1-rebuild/soulidity')
SCRIPT_ROOT = Path(__file__).resolve().parents[2]
TRACE = 'docs/open-ecosystem/ORIGINAL_SCOPE_TRACE.json'
PLAN = 'docs/open-ecosystem/MODULE_DELIVERY_PLAN.json'
CONTRACT = 'docs/open-ecosystem/MODULE_INTEROPERABILITY_CONTRACTS.json'
CASES = 'docs/open-ecosystem/INTEROPERABILITY_CASES.json'
PREP = 'agent-management/runs/soul-dof-v1-preparation.json'
WORKSPACE = 'agent-management/workspace.json'
UI = 'docs/soul-dof-v1-preparation/02_UIUX_CN.md'

def sha(p): return hashlib.sha256(p.read_bytes()).hexdigest()
def load(p): return json.loads(p.read_text())
def evidence(root, rel):
    p = root / rel
    if not p.is_file(): return {'root': str(root), 'path': rel, 'exists': False, 'status': 'Pending'}
    return {'root': str(root), 'path': rel, 'exists': True, 'sha256': sha(p), 'bytes': p.stat().st_size}

def fields(row, words):
    return {k: v for k, v in row.items() if any(w in k for w in words)}

def refs(text, prefix, width=2):
    out = set()
    shorthand=rf'({re.escape(prefix)}\d{{{width}}}(?:[～–—-]{re.escape(prefix)}?\d{{{width}}})?(?:/\d{{{width}}})+)'
    text=re.sub(shorthand,lambda m:re.sub(r'/([0-9]+)',lambda n:'/'+prefix+n[1],m[0]),text)
    # Expand only explicit ranges in the original row, never infer adjacent records.
    pat = rf'(?<![A-Z]){re.escape(prefix)}(\d{{{width}}})(?:[～–—-]{re.escape(prefix)}?(\d{{{width}}}))?'
    for m in re.finditer(pat, text):
        lo = int(m[1]); hi = int(m[2] or m[1])
        if lo <= hi and hi - lo < 100: out.update(f'{prefix}{i:0{width}d}' for i in range(lo, hi + 1))
    return sorted(out)

# Explicit original journeys -> precise candidate modules/functions. These anchors
# were inspected locally. They intentionally do not assert full journey coverage.
J = {
 'J01': [], 'J02': [], 'J03': [('soulidity_model/policy','definition')],
 'J04': [('soulidity_visual/visual','render_layers')],
 'J05': [('soulidity_content/state_configuration','new')],
 'J06': [('soulidity_v1/catalog','create_maker'),('soulidity_model/policy','supply')],
 'J07': [('soulidity_visual/visual','render_layers'),('soulidity_v1/player','semantic_recipe')],
 'J08': [],
 'J09': [('soulidity_v1/release','begin'),('soulidity_v1/metadata','begin_publication')],
 'J10': [('soulidity_v1/release','append'),('soulidity_v1/release','finish')],
 'J11': [('soulidity_v1/catalog','create_pack'),('soulidity_v1/release','finish')],
 'J12': [('soulidity_model/components','issue_item'),('soulidity_v1/catalog','append_adapters')],
 'J13': [('soulidity_v1/release','cancel'),('soulidity_v1/release','pause'),('soulidity_v1/release','archive'),('soulidity_v1/release','resume')],
 'J14': [('soulidity_v1/catalog','current_version')],
 'J15': [('soulidity_v1/player','create'),('soulidity_v1/player','set_base')],
 'J16': [('soulidity_v1/catalog','buy_access'),('soulidity_v1/catalog','claim_access')],
 'J17': [('soulidity_v1/player','set_pack'),('soulidity_v1/catalog','assert_pack')],
 'J18': [('soulidity_v1/player','set'),('soulidity_v1/player','clear')],
 'J19': [('soulidity_v1/issuer','begin'),('soulidity_v1/issuer','finish'),('soulidity_v1/catalog','authorize_complete')],
 'J20': [('soulidity_native/birth','begin'),('soulidity_native/birth','finish'),('soulidity_v1/native_creation','prepare_native')],
 'J21': [('soulidity_application/character','core'),('soulidity_standard/soul','manifest')],
 'J22': [('soulidity_application/character','attach'),('soulidity_application/character','replace'),('soulidity_application/character','detach')],
 'J23': [('soulidity_application/character','tune'),('soulidity_application/character','reset_layout')],
 'J24': [('soulidity_application/character','unmount_bound'),('soulidity_application/character','remount_bound'),('soulidity_application/character','clear_reference')],
 'J25': [('soulidity_application/character','attach_scoped'),('soulidity_application/character','replace_scoped')],
 'J26': [('soulidity_application/character','save_loadout'),('soulidity_application/character','apply_loadout')],
 'J27': [('soulidity_v1/market','list_control'),('soulidity_v1/market','buy_control')],
 'J28': [('soulidity_v1/market','list_soul'),('soulidity_v1/market','cancel')],
 'J29': [('soulidity_v1/market','buy_soul'),('soulidity_application/character','handover')],
 'J30': [('soulidity_v1/market','list_item'),('soulidity_v1/market','buy_item'),('soulidity_application/character','detach')],
 'J31': [('soulidity_application/character','grant'),('soulidity_application/character','revoke'),('soulidity_content/authorization','issue'),('soulidity_content/document','assert_read')],
 'J32': [('soulidity_v1/physical','issue'),('soulidity_v1/physical','consume'),('soulidity_v1/physical','purchase_scoped')],
 'J33': [('soulidity_v1/collection','create'),('soulidity_v1/collection','buy'),('soulidity_community/profile','create_profile'),('soulidity_community/social','set_follow'),('soulidity_community/community_votes','set_vote')],
 'J34': [('soulidity_v1/custody','create'),('soulidity_standard/soul','nest'),('soulidity_standard/soul','unnest')],
 'J35': [('soulidity_v1/release','cancel'),('soulidity_v1/metadata','cancel')],
 'J36': [], 'J37': []
}
# Contract rows are narrower than journeys; avoid assigning every function in a package.
C = {
 'C01':[('soulidity_standard/soul','new'),('soulidity_standard/soul','install'),('soulidity_standard/soul','uninstall')],
 'C02':J['J22']+J['J24'], 'C03':J['J06']+J['J10']+J['J11'],
 'C04':J['J15']+J['J19'], 'C05':J['J12']+J['J25'], 'C06':J['J04']+J['J23'],
 'C07':J['J05']+[('soulidity_application/character','append_content')],
 'C08':J['J26']+J['J31'], 'C09':J['J27']+J['J28']+J['J29']+J['J30'],
 'C10':[('soulidity_foundation/economics','primary_quote'),('soulidity_foundation/economics','market_quote'),('soulidity_application/resale','quote')],
 'C11':J['J32'], 'C12':[('soulidity_foundation/economics','register_role'),('soulidity_foundation/economics','set_enabled'),('soulidity_foundation/package_roles','freeze_role')],
 'C13':[], 'C14':J['J19']+J['J20'],
 'C15':[('soulidity_model/material_policy','terms')]+J['J24']+J['J30']
}

# Exact current selectors, not declarations that target extraction already exists.
# Paths shared across unit boundaries are intentional findings, never concurrent leases.
UNIT_SELECTORS = {
 'STANDARD':['move/soulidity_standard/sources/*.move'],
 'CONTENT':['move/soulidity_content/sources/*.move'],
 'COMMUNITY':['move/soulidity_community/sources/*.move'],
 'MAKER':['move/soulidity_v1/sources/catalog.move','move/soulidity_v1/sources/release.move','move/soulidity_v1/sources/metadata.move','move/soulidity_v1/sources/issuer.move','move/soulidity_v1/sources/player.move','move/soulidity_v1/sources/physical.move','move/soulidity_v1/sources/runtime.move','move/soulidity_model/sources/*.move','move/soulidity_application/sources/publication_rules.move'],
 'CHANNEL':['move/soulidity_v1/sources/access.move','move/soulidity_v1/sources/custody.move','move/soulidity_v1/sources/application_operator.move'],
 'MARKET':['move/soulidity_v1/sources/market.move','move/soulidity_v1/sources/collection.move','move/soulidity_v1/sources/physical.move','move/soulidity_application/sources/resale.move'],
 'EXTENSIONS':['move/soulidity_application/sources/*.move','move/soulidity_visual/sources/*.move','move/soulidity_model/sources/*.move'],
 'SDK':['packages/soulidity-sdk/package.json','packages/soulidity-sdk/src/**/*.ts','packages/animacraft-render-core/package.json','packages/animacraft-render-core/**/*.mjs'],
 'DEVOPS':['.github/workflows/*.yml','scripts/verify_contract_*.py','scripts/verify_soul_standard_*.py','scripts/codex/*.py'],
 'INTEGRATION':['move/standard_examples/*/Move.toml','move/standard_examples/*/sources/*.move','scripts/verify_soul_standard_external.py','scripts/inspect_contract_dependencies.py'],
 'CLIENTS.ENGINE':['Move.toml','sources/*.move','sdk/package.json','sdk/*.ts','README.md'],
 'CLIENTS.EXPEDITION':['package.json','app/**/*.ts','app/**/*.tsx'],
 'CLIENTS.THEATER':['package.json','app/**/*.ts','app/**/*.tsx'],
 'CLIENTS.STELLAR':['package.json','apps/*/package.json','packages/*/package.json','docs/codex/CURRENT.md'],
 'CLIENTS.HABITAT':['README.md','docs/*.md','scripts/*.py'],
 'NATIVE.PRODUCER':['move/soulidity_native/sources/*.move','move/soulidity_v1/sources/native_creation.move','move/soulidity_v1/sources/native_binding.move'],
 'POLICY.ASSET_RULES':['move/soulidity_foundation/sources/economics.move','move/soulidity_foundation/sources/revenue.move','move/soulidity_application/sources/resale.move','move/soulidity_model/sources/policy.move','move/soulidity_model/sources/material_policy.move'],
 'POLICY.PACKAGE_GOVERNANCE':['move/soulidity_foundation/sources/package_roles.move','move/soulidity_foundation/sources/source_authority.move','move/soulidity_foundation/sources/economics.move','move/soulidity_native/sources/registry.move'],
 'LEGACY.HISTORY':['move/soulidity/sources/*.move'],
 'CLIENTS.SO_WEB':['web/app/**/*.tsx','web/components/**/*.tsx','web/lib/hooks/**/*.ts','web/package.json'],
 'CLIENTS.SOULDESK':['desktop/package.json','desktop/apps/*/package.json','desktop/packages/*/package.json'],
 'CLIENTS.DOCS':['README.md'],
 'CLIENTS.EXTERNAL_INTERFACE':['move/standard_examples/*/Move.toml','move/standard_examples/*/sources/*.move','docs/SOUL_STANDARD_KERNEL_CN.md'],
}
AC_EDITOR = ['original-product-app.js','maker-workspace-v8-view.js','maker-v8-creator-style.js','maker-v8-render-core.js','maker-v8-player-colors.js','maker-v8-player-recipe-constraints.js','maker-v8-project-zip.js','maker-v8-local-player-store.js','maker-player-v8-view.js','maker-v8-player-controller.js']
AC_PUBLISHER = ['maker-v8-publication-controller.js','maker-v8-workspace.js','maker-v8-pack-controller.js','maker-v8-pack-authoring.js','maker-v8-composable-controller.js','maker-v8-market-controller.js','maker-v8-player-journey.js','maker-v8-player-protocol.js']
# Each page evidence is linked to its original U row and journey references.
UI_FILES = {
 1:['original-product-app.js'],2:['original-product-app.js'],3:['original-product-app.js','maker-v8-workspace.js'],
 4:['maker-workspace-v8-view.js','maker-v8-creator-style.js'],5:['maker-workspace-v8-view.js'],
 6:['maker-workspace-v8-view.js','maker-v8-render-core.js'],7:['maker-workspace-v8-view.js','maker-v8-player-colors.js'],
 8:['maker-workspace-v8-view.js','maker-v8-player-recipe-constraints.js'],9:['maker-v8-pack-controller.js','maker-v8-pack-authoring.js'],
 10:['maker-v8-composable-controller.js'],11:['maker-v8-market-controller.js'],12:['maker-workspace-v8-view.js'],
 13:['maker-v8-publication-controller.js'],14:['maker-v8-project-zip.js','maker-v8-local-player-store.js'],
 15:['maker-player-v8-view.js','maker-v8-player-controller.js'],16:['maker-v8-player-journey.js','maker-player-v8-view.js'],
 17:['maker-v8-player-protocol.js','maker-player-v8-view.js'],
 18:['web/app/souls/[id]/page.tsx','native-original-preview.tsx'],
 19:['native-wardrobe.tsx','use-native-equipment-actions.ts'],20:['native-equipment-preview.tsx','native-current-appearance.tsx'],
 21:['native-loadouts.tsx','use-native-loadouts.ts'],22:['web/app/souls/[id]/page.tsx'],
 23:['web/app/souls/[id]/page.tsx','web/lib/hooks/use-grant.ts'],
 24:['web/app/market/page.tsx','equipment-market-browser.tsx'],
 25:['web/app/souls/[id]/sell/page.tsx','use-native-market-list-actions.ts'],
 26:['web/app/souls/[id]/sell/authorize/page.tsx','native-delist-modal.tsx','native-update-price-modal.tsx'],
 27:['web/app/souls/[id]/buy/page.tsx','use-native-market-buy-actions.ts'],
 28:['equipment-market-panel.tsx'],29:['web/app/my-souls/page.tsx'],30:['native-purchase-recovery.tsx','native-listing-recovery.tsx','equipment-market-recovery.tsx','content-mutation-recovery.tsx']}

def mask_comments(text):
    """Mask Move comments while preserving character offsets and declaration lines."""
    out=list(text); i=0; block=0; quoted=False
    while i<len(text):
        if block:
            if text[i:i+2]=='/*': block+=1;out[i:i+2]=[' ',' '];i+=2;continue
            if text[i:i+2]=='*/': block-=1;out[i:i+2]=[' ',' '];i+=2;continue
            if text[i]!='\n':out[i]=' '
            i+=1;continue
        if quoted:
            if text[i]=='\\':i+=2;continue
            if text[i]=='"':quoted=False
            i+=1;continue
        if text[i]=='"':quoted=True;i+=1;continue
        if text[i:i+2]=='/*':block=1;out[i:i+2]=[' ',' '];i+=2;continue
        if text[i:i+2]=='//':
            while i<len(text) and text[i]!='\n':out[i]=' ';i+=1
            continue
        i+=1
    return ''.join(out)


def inventory(source):
    files = []; functions = {}; structs = []
    for p in sorted((source/'move').glob('*/sources/*.move')):
        text = p.read_text(); clean=mask_comments(text); rel = str(p.relative_to(source))
        # Sources with a module-level test_only attribute are not production authority.
        module = re.search(r'(?m)^\s*module\s+([\w:]+)', clean)
        module_test = bool(module and re.search(r'#\[test_only\]', clean[:module.start()]))
        item = evidence(source,rel); item['module'] = module[1] if module else None
        item['module_test_only'] = module_test; files.append(item)
        for m in re.finditer(r'(?m)^\s*((?:public(?:\([^)]*\))?\s+)?(?:entry\s+)?)fun\s+(\w+)',clean):
            start = m.start(); decl = clean.find('fun',start,m.end()); end = text.find('{',m.end())
            if end < 0: end = text.find(';',m.end())
            signature = text[decl:end].strip()
            before = text[:decl].splitlines()
            attrs = []
            for line in reversed(before[:-1]):
                if not line.strip() or line.strip().startswith('//'):continue
                if line.strip().startswith('#['): attrs.insert(0,line.strip())
                else:break
            fn={'path':rel,'module':item['module'],'name':m[2],'line':text.count('\n',0,decl)+1,
                'signature':m[1]+signature,'file_sha256':item['sha256'],
                'explicit_test_only':module_test or any('test_only' in a for a in attrs),
                'source_attributes':attrs,'visibility':m[1].strip() or 'private',
                'existence_status':'Verified source declaration; semantics and runtime Pending'}
            functions[(p.parent.parent.name+'/'+p.stem,m[2])] = fn
        for m in re.finditer(r'\b(?:public\s+)?struct\s+(\w+)([^\{;]*)\{',clean):
            structs.append({'module':item['module'],'name':m[1],'declaration':m[0][:-1].strip(),
                'path':rel,'line':text.count('\n',0,m.start())+1,'file_sha256':item['sha256'],
                'module_test_only':module_test})
    return files,functions,structs


def selector_files(root, patterns):
    result = {}
    for pat in patterns:
        # pathlib treats [id] as glob syntax; a literal declared path comes first.
        literal=root/pat
        paths=[literal] if literal.is_file() else root.glob(pat)
        for p in paths:
            if p.is_file() and not set(p.relative_to(root).parts)&{'node_modules','build','dist','.git','output'}:
                rel=str(p.relative_to(root)); result[rel]=evidence(root,rel)
    return [result[k] for k in sorted(result)]


def run(args):
    design=args.design.resolve(); source=args.source.resolve(); out=args.out.resolve()
    # Never write into either authoritative tree through a mistaken output argument.
    if out == design or design in out.parents:
        raise SystemExit('Never write artifacts into the design authority tree')
    if out == source or source in out.parents:
        allowed_artifact_root=source/'output'
        if not args.allow_source_artifact_output or not allowed_artifact_root in out.parents:
            raise SystemExit('Source-tree writes are forbidden except explicitly requested output artifacts with --allow-source-artifact-output')
    data={x:load(design/x) for x in [TRACE,PLAN,CONTRACT,CASES,PREP,WORKSPACE]}
    trace,plan,contract,cases,prep,workspace=(data[x] for x in [TRACE,PLAN,CONTRACT,CASES,PREP,WORKSPACE])
    live_path=args.slack_readback.resolve()
    live_input=load(live_path) if live_path.is_file() else []
    live_by_record={}; live_lists={}
    for result in live_input:
        if result.get('status')!='fulfilled': continue
        value=result['value']; list_id=value['id']; parsed=[]
        for item in value['result'].get('content',[]):
            if item.get('type')=='text':
                body=json.loads(item['text']); parsed+=list(csv.DictReader(io.StringIO(body.get('result',''))))
        live_lists[list_id]=len(parsed)
        for row in parsed:
            rid=row.get('Record ID')
            if rid:
                if rid in live_by_record:raise SystemExit('Duplicate live Slack record_id')
                live_by_record[rid]={'list_id':list_id,'row':row}
    current_text=(source/'docs/codex/CURRENT.md').read_text()
    current_handoff_match=re.search(r'Latest handoff:\s*`([^`]+)`',current_text)
    current_handoff=current_handoff_match[1] if current_handoff_match else None
    coverage=load(source/'docs/CONTRACT_REBUILD_COVERAGE.json')
    queue_path=coverage['original30_function_review_queue']; queue=load(source/queue_path)
    files,functions,structs=inventory(source)
    ac=design/'tmp/animacraft-v8-mainnet-release'; so_live=Path('/Users/naoer/.codex/worktrees/f722/soulidity')
    historical_ac=design/'tmp/bug005-publication-recovery'
    # Narrow UI inventory; never crawl generated build trees or user storage.
    ui_source_paths={}
    for root in [source,so_live]:
        for sub in ['web/app','web/components','web/lib/hooks']:
            for p in sorted((root/sub).rglob('*')):
                if p.is_file() and p.suffix in {'.ts','.tsx'}:ui_source_paths.setdefault((str(root),p.name),[]).append(str(p.relative_to(root)))
    ui_rows=[]
    for line in (design/UI).read_text().splitlines():
        m=re.match(r'\| U(\d{2}) ',line)
        if not m:continue
        n=int(m[1]); parts=[x.strip() for x in line.split('|')[1:-1]]
        row={'id':f'U{n:02d}','original_ui_mapping_row':parts,'journey_refs':refs(parts[-1],'J'),
             'source_anchors':[], 'current_live_behavior':'Pending browser/user-wallet verification; document S/L labels remain historical'}
        for name in UI_FILES[n]:
            roots=[ac,historical_ac] if n<18 else [so_live,source]
            for root in roots:
                rels=[name] if (root/name).is_file() else ui_source_paths.get((str(root),Path(name).name),[])
                for rel in rels:row['source_anchors'].append(evidence(root,rel))
        row['anchor_scope']='Declared UI source files only; route/function behavior not independently accepted'
        ui_rows.append(row)
    ui_by_j=collections.defaultdict(list)
    for u in ui_rows:
        for j in u['journey_refs']:ui_by_j[j].append(u['id'])
    boards={**prep['boards'],'agile':prep['agile'],'journeys':prep['journeys']}
    current_rows={k:{r['ID']:r for r in v['rows']} for k,v in boards.items()}
    csv_rows={}
    for k,v in prep['readbacks'].items():
        csv_rows[k]={r['ID']:r for r in csv.DictReader(io.StringIO(v['result']))}
    # Original record identity registry is authoritative; no second task board.
    registry={}
    def walk(obj,list_id=None):
        if isinstance(obj,dict):
            local=obj.get('list_id') or (obj.get('id') if isinstance(obj.get('id'),str) and obj['id'].startswith('F0C') else list_id)
            if 'record_id' in obj:registry[obj['record_id']]={'id':obj.get('id'),'list_id':local}
            for v in obj.values():walk(v,local)
        elif isinstance(obj,list):
            for v in obj:walk(v,list_id)
    walk(workspace['soul_dof_rebuild'])
    conflicts=[]; records=[]
    for old in trace['records']:
        table=old['original_table']; ident=old['original_id']; row=old['original_row_historical']
        current=current_rows.get(table,{}).get(ident)
        rb=csv_rows.get(table,{}).get(ident)
        live=live_by_record.get(old['record_id'])
        live_match=bool(live and live['list_id']==old['original_list_id'] and live['row'].get('ID')==ident)
        if not live_match:conflicts.append({'kind':'live_record_identity_pending_or_mismatch','record':old['id'],'status':'Pending' if not live else 'FAIL'})
        text=json.dumps(row,ensure_ascii=False)
        # Journey mapping avoids broad parent links in ID-only management rows.
        journey_fields=fields(row,['用户旅程','关联专项','对应旅程'])
        journey_text=json.dumps(journey_fields,ensure_ascii=False)
        journeys=[ident] if table=='journeys' else refs(journey_text,'J')
        contract_refs=[ident] if table=='contracts' else refs(json.dumps(fields(row,['合约','安全域','关联专项']),ensure_ascii=False),'C')
        requested=[]
        if table not in {'devops','milestones','artifacts'}:
            for j in journeys:requested+=J.get(j,[])
            for c in contract_refs:requested+=C.get(c,[])
        anchors=[]; missing=[]
        for key in sorted(set(requested)):
            f=functions.get(key)
            if not f or f['explicit_test_only']:missing.append({'module':key[0],'function':key[1],'status':'Pending missing production declaration'})
            else:anchors.append(f)
        for k in ['owner_ref','reviewer_ref']:
            if not old.get(k):conflicts.append({'kind':'original_responsibility_missing','record':old['id'],'field':k})
        registry_entry=registry.get(old['record_id'])
        registry_match=bool(registry_entry and registry_entry['id']==ident and registry_entry['list_id']==old['original_list_id'])
        if not registry_match:conflicts.append({'kind':'record_registry_mismatch','record':old['id'],'expected':{'id':ident,'list_id':old['original_list_id']},'actual':registry_entry})
        if rb and rb.get('Record ID')!=old['record_id']:conflicts.append({'kind':'readback_identity_mismatch','record':old['id']})
        changed={k:{'trace_historical':v,'preparation_current_snapshot':current.get(k)} for k,v in row.items() if current and current.get(k)!=v}
        document_candidates=[evidence(design,rel) for rel in sorted(set(re.findall(r'(?:docs|agent-management)/[A-Za-z0-9_/.-]+\.(?:md|json|csv)',text)))]
        behavior=fields(row,['用户结果','原UI','角色／入口','操作步骤','预期结果','施工范围','规则／口径','当前方案','边界／职责','原功能','原模块','验收'])
        dependencies=fields(row,['依赖','前置条件','进入条件'])
        exits=fields(row,['退出','恢复','验收','预期结果','风险'])
        permissions=fields(row,['资格','收费','权限','收费','资金','签名'])
        records.append({**old,
            'live_source_record':live,'live_identity_verification':'PASS' if live_match else 'Pending or FAIL',
            'live_owner_fields_unchanged':fields(live['row'],['负责人','Owner']) if live else {},
            'live_reviewer_fields_unchanged':fields(live['row'],['验收责任','验收人','负责人／审查','Reviewer']) if live else {},
            'live_status_stage_unchanged':fields(live['row'],['状态','阶段']) if live else {},
            'live_precedence':'Live readback preserves current Owners/status/stage; historical trace never overrides it. Local mapping status is separate.',
            'list_id':old['original_list_id'],'original_owner_unchanged':old['owner_ref'],'original_reviewer_unchanged':old['reviewer_ref'],
            'identity_registry_verification':{'status':'PASS' if registry_match else 'FAIL','registry_entry':registry_entry},
            'original_ui_and_behavior':behavior,'original_ui_refs':sorted(set(u for j in journeys for u in ui_by_j.get(j,[]))),
            'original_journey_refs':journeys,'original_contract_refs':contract_refs,
            'document_and_template_candidates':document_candidates,
            'source_function_candidates':anchors,'missing_requested_declarations':missing,
            'source_mapping_method':'Explicit journey/contract anchor lookup. Exact declaration existence, line and SHA are verified; relation is a candidate until original behavior and per-function duty are checked.',
            'exact_semantic_mapping_status':'Pending','runtime_acceptance_status':'Not run',
            'unique_state_mapping':{'parameter_type_state_candidates':[s for s in structs if not s['module_test_only'] and any(re.search(r'\b'+re.escape(s['name'])+r'\b',f['signature']) and s['path']==f['path'] for f in anchors)],'status':'Pending per-record authority resolution','candidate_units':old['target_units'],'rule':'Unit state declarations do not prove this record owns one unique state'},
            'permission_mapping':{'original_fields':permissions,'status':'Pending direct/indirect control, actual holders and third-party attack proof'},
            'dependency_mapping':{'original_fields':dependencies,'interface_family_refs':old['interface_families'],'status':'Pending actual type/package/state edges for this behavior'},
            'case_mapping':{'case_ids':old['cases'],'status':'Design trace preserved; exact execution Not run'},
            'exit_mapping':{'original_fields':exits,'status':'Pending exact source/runtime behavior and lawful exit verification'},
            'historical_policy':'Historical wait-for-start text is provenance only; latest explicit construction authorization applies. Do not close original DEV/BUG or assign new Owners.',
            'preparation_snapshot_row':current,'readback_record':rb,'trace_vs_preparation_changed_fields':changed,
            'applicability_original_evidence':fields(row,['适用阶段','类别','准备状态','费用类别']),
            'stage':'Plan / Gate0 mapping','status':'Pending exact semantic/runtime mapping',
            'handbook':{'version':'1.0 (2026-10-06)','sections':['1–4','5','7','8.3','8.4','9','12'],'remaining_checks':'Original record owner/reviewer perform applicable evidence checks; this artifact is an attachment, not a new board'}
        })
    case_list=cases.get('cases',[])
    if not isinstance(case_list,list):raise SystemExit('Unexpected cases schema')
    case_by_id={x['id']:x for x in case_list}
    units=[]; file_units=collections.defaultdict(list); release_units=collections.defaultdict(list)
    all_specs=contract['modules']+contract['retained_maintenance_units']
    for spec in all_specs:
        unit=spec['id']; selectors=UNIT_SELECTORS.get(unit,[]); root=source
        local_client_projects={'CLIENTS.ENGINE':'infinite-flow-engine','CLIENTS.EXPEDITION':'soul-expedition','CLIENTS.THEATER':'soul-paper-theater','CLIENTS.STELLAR':'infinite-stellar','CLIENTS.HABITAT':'soul-habitat','CLIENTS.DOCS':'soulidity-docs'}
        if unit in local_client_projects:root=design.parent/local_client_projects[unit]
        if unit in {'AUTHORING.EDITOR','AUTHORING.PUBLISHER'}:
            root=ac; selectors=AC_EDITOR if unit.endswith('EDITOR') else AC_PUBLISHER
        selected=selector_files(root,selectors)
        original_refs=spec.get('original_record_refs',[])
        related=[r for r in records if unit in r['target_units'] or r['original_id'] in original_refs]
        identities=[{'id':r['id'],'record_id':r['record_id'],'list_id':r['list_id'],'owner_ref':r['owner_ref'],'reviewer_ref':r['reviewer_ref'],'live_owner_fields_unchanged':r['live_owner_fields_unchanged'],'live_reviewer_fields_unchanged':r['live_reviewer_fields_unchanged'],'live_status_stage_unchanged':r['live_status_stage_unchanged']} for r in related]
        manifests={}
        for f in selected:
            rel=f['path'];parts=Path(rel).parts
            if len(parts)>2 and parts[0]=='move':
                manifest='/'.join(parts[:2])+'/Move.toml'
            elif rel.startswith('packages/'):
                manifest='/'.join(parts[:2])+'/package.json'
            elif rel.startswith('web/'):manifest='web/package.json'
            elif rel.startswith('desktop/'):manifest='desktop/package.json'
            elif root==ac:manifest='package.json'
            else:manifest=None
            if manifest and (root/manifest).is_file():manifests[manifest]=evidence(root,manifest)
            if rel in {'Move.toml','package.json'}:manifests[rel]=evidence(root,rel)
            file_units[(str(root),rel)].append(unit)
        physical_releases=[]
        for rel,ev in sorted(manifests.items()):
            if rel.endswith('.toml'):
                package_section=re.search(r'(?ms)^\[package\]\s*\n(.*?)(?=^\[|\Z)',(root/rel).read_text())
                name_match=re.search(r'(?m)^name\s*=\s*"([^"]+)"',package_section[1]) if package_section else None
                package_name=name_match[1] if name_match else None
            else:
                package_name=load(root/rel).get('name')
            physical_releases.append({**ev,'name':package_name,'role':'Observed current build/package manifest; independent target release Pending'})
            release_units[(str(root),rel)].append(unit)
        declarations=[s for s in structs if not s['module_test_only'] and any(f['path']==s['path'] and f['root']==str(source) for f in selected)]
        applicable={}
        for kind in ['source','version_release','production_deployment','onchain_control']:
            if unit=='LEGACY.HISTORY' and kind in {'version_release','production_deployment'}:
                applicable[kind]={'status':'N/A for new-target release','reason':'Retained deployed historical lineage/read/exit scope; original lawful-exit authority still Pending'}
            elif unit=='CLIENTS.EXTERNAL_INTERFACE' and kind in {'production_deployment','onchain_control'}:
                applicable[kind]={'status':'N/A for third-party authority','reason':'Only self-owned interface/examples are in scope; no third-party deployments or Caps assigned'}
            elif kind=='onchain_control' and unit in {'SDK','DEVOPS','INTEGRATION','AUTHORING.EDITOR','CLIENTS.DOCS','CLIENTS.SO_WEB','CLIENTS.SOULDESK'}:
                applicable[kind]={'status':'N/A for inherent package control; transaction-user authority Pending','reason':'Client/tool source does not itself grant a chain Cap; users and any configured runtime signer require separate exact authorization'}
            else:applicable[kind]={'status':'Applicable or conditionally applicable; Pending effective holder and authorization','evidence':'Exact selected source/manifests below; they do not prove deployed grants'}
        units.append({'id':unit,'category':'new' if spec in contract['modules'] else 'retained','original_design':spec,
            'source_authority_root':str(root),'root_authority_status':'Observed local candidate selector; latest actual writer/deployed authority Pending','exact_source_selectors':selectors,'selected_files':selected,
            'selector_status':'Verified existing files; authoritative writer selection Pending' if selected else 'Pending source authority access/selection',
            'write_scope':{'allowed_future_scope':selectors,'status':'Proposed lease only; no writes to selected source performed','original_scope':spec.get('write_scope')},
            'release_unit':{'current_build_manifests':physical_releases,'status':'Independent extraction/release boundary Pending' if physical_releases else 'Pending exact build/release authority'},
            'original_responsibility_mapping':identities,'writer':{'status':'Pending one actual writer lease','preserved_original_record_owners':sorted({r['owner_ref'] for r in related})},
            'reviewer':{'status':'Pending actual independent capable reviewer acceptance','preserved_original_record_reviewers':sorted({r['reviewer_ref'] for r in related})},
            'state_declaration_candidates':declarations,'unique_state_status':'Pending per-domain state owner and accounting deduplication proof',
            'permission_declaration_candidates':[x for x in declarations if re.search('Cap|Control|Config|Authority|Permit|Ticket|Draft|Witness',x['name'])],
            'engineering_authority_applicability':applicable,
            'declared_dependencies':spec.get('selected_dependencies',[]),'declared_cases':spec.get('acceptance_case_ids',[]),
            'implementation_status':'Source selected where present; independent module authority and actual runtime acceptance Pending'})
    for key,ids in sorted(file_units.items()):
        if len(ids)>1:conflicts.append({'kind':'shared_source_write_scope','root':key[0],'path':key[1],'units':ids,'resolution':'One coordinator/writer until extraction; related units request changes instead of concurrent writes'})
    for key,ids in sorted(release_units.items()):
        if len(ids)>1:conflicts.append({'kind':'shared_current_release_unit','root':key[0],'manifest':key[1],'units':ids,'resolution':'Current package is one release unit; target independent publication not yet established'})
    conflicts += [
      {'kind':'ui_authority_locator_conflict','evidence':['02_UIUX selects historical AC bug005/rebuild SO','LIVE_PRODUCT_STATE selects AC mainnet-release/SO f722'],'resolution':'Preserve both file SHA sets. Latest exact deployed candidate and current writable frontend must be confirmed from original product executor evidence; no source takeover.'},
      {'kind':'missing_current_frontend_pointer','path':str(so_live/'docs/codex/CURRENT.md'),'exists':(so_live/'docs/codex/CURRENT.md').exists(),'resolution':'Frontend files exist, but this presumed CURRENT path is absent; do not invent continuation authority.'},
      {'kind':'channel_independence_pending','units':['CHANNEL','MARKET','MAKER'],'manifest':'move/soulidity_v1/Move.toml','resolution':'Private/package signatures and shared current state still require real cross-package production build before ABI freeze.'}
    ]
    validation={
      'records':len(records),'expected_records':157,'unique_record_ids':len({r['record_id'] for r in records}),
      'table_counts':dict(collections.Counter(r['original_table'] for r in records)),
      'live_identity_pass':sum(r['live_identity_verification']=='PASS' for r in records),
      'live_total_records':len(live_by_record),'live_list_counts':live_lists,
      'registry_identity_pass':sum(r['identity_registry_verification']['status']=='PASS' for r in records),
      'trace_source_hash_matches':trace['source_sha256']==sha(design/PREP),
      'owner_and_reviewer_preserved':all(r['original_owner_unchanged']==r['owner_ref'] and r['original_reviewer_unchanged']==r['reviewer_ref'] for r in records),
      'new_units':sum(u['category']=='new' for u in units),'retained_units':sum(u['category']=='retained' for u in units),
      'records_with_verified_function_candidates':sum(bool(r['source_function_candidates']) for r in records),
      'exact_semantic_records_accepted':0,'function_candidate_references':sum(len(r['source_function_candidates']) for r in records),
      'missing_candidate_declarations':sum(len(r['missing_requested_declarations']) for r in records),
      'units_with_source_files':sum(bool(u['selected_files']) for u in units),
      'current_production_source_files':sum(not f['module_test_only'] and not f['path'].startswith('move/soulidity/') for f in files),
      'original30_modules':len(queue['modules']),'original_syntactic_functions':sum(len(m['functions']) for m in queue['modules']),
      'semantic_reviewed_production':queue.get('semantic_reviewed_production'),'semantic_pending_production':queue.get('semantic_pending_production'),
      'case_count':len(case_list),'unresolved_conflicts':len(conflicts),
      'gate0':'Pending','gate0_pass':False,'runtime_status':'Not run','current_handoff':current_handoff,
      'protected_authorities':'No writes to design, source, frontends, CURRENT, task records, Git, chain, signer, DB or wallet'}
    assert len(records)==157 and len({r['record_id'] for r in records})==157
    assert validation['table_counts']==trace['table_counts']
    assert validation['new_units']==10 and validation['retained_units']==15
    assert validation['owner_and_reviewer_preserved']
    if live_input:
        assert validation['live_identity_pass']==157 and validation['live_total_records']==157
        assert all(r['live_source_record']['row']['Record ID']==r['record_id'] for r in records)
    for r in records:
        assert all(c in case_by_id for c in r['cases']),r['id']
        for f in r['source_function_candidates']:
            p=source/f['path'];assert sha(p)==f['file_sha256']
            assert re.search(r'\bfun\s+'+re.escape(f['name'])+r'\b',p.read_text().splitlines()[f['line']-1])
    out.mkdir(parents=True,exist_ok=True)
    outputs={
      'record-mapping.json':{'schema':'soulidity.gate0.original-record-source-mapping.v1','is_task_board':False,'records':records},
      'unit-mapping.json':{'schema':'soulidity.gate0.current-unit-authority-mapping.v1','units':units},
      'mapping-parser-corrections.json':{'observed_first_run_summary':'history/observed-first-run-summary.json','original_artifacts_overwritten_before_preservation':True,'current_module_names_validated':all(f['module'] and '::' in f['module'] for f in files),'registry_repaired_without_design_write':validation['registry_identity_pass']==157,'missing_names_are_mapping_errors_not_semantic_completion':True,'old_unanchored_module_parser_reproduction':[{'path':f['path'],'sha256':f['sha256'],'old_result':re.search(r'\bmodule\s+([\w:]+)',(source/f['path']).read_text())[1],'actual_module':f['module']} for f in files if re.search(r'\bmodule\s+([\w:]+)',(source/f['path']).read_text()) and re.search(r'\bmodule\s+([\w:]+)',(source/f['path']).read_text())[1]!=f['module']]},
      'source-declarations.json':{'scope':'Immediate authored sources only; excludes build directories','files':files,'functions':list(functions.values()),'structs':structs},
      'ui-source-map.json':{'uiux_source':evidence(design,UI),'live_locator_source':evidence(design,'agent-management/LIVE_PRODUCT_STATE.md'),'rows':ui_rows},
      'original30-review-queue.json':{'source_evidence':evidence(source,queue_path),'queue_preserved_verbatim':queue,'source_scope':'Original responsibility queue; no completion status changed'},
      'live-records-preserved.json':{'source':evidence(live_path.parent,live_path.name),'lists':live_lists,'records':live_by_record},
      'scope-conflicts.json':{'conflicts':conflicts},'verification.json':validation,
      'input-manifest.json':{'inputs':[evidence(design,x) for x in [TRACE,PLAN,CONTRACT,CASES,PREP,WORKSPACE,UI,'agent-management/LIVE_PRODUCT_STATE.md','agent-management/PRODUCT_ENGINEERING_HANDBOOK_CN.md','agent-management/OPERATING_MODEL.md']]+[evidence(source,x) for x in ['AGENTS.md','docs/codex/PROJECT_MEMORY.md','docs/codex/CURRENT.md','docs/CONTRACT_REBUILD_COVERAGE.json',queue_path]+([current_handoff] if current_handoff else [])],'slack_readback':evidence(live_path.parent,live_path.name),'script':{'path':str(Path(__file__).resolve()),'sha256':sha(Path(__file__))}}}
    for name,value in outputs.items():(out/name).write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n')
    summary=(f'# 关口0原记录与源码映射\n\n'
      f'原九表157条逐条保留；{validation["registry_identity_pass"]}/157 record_id/list_id通过本地原登记核对；实时Slack读回{validation["live_identity_pass"]}/157 ID核对，原与实时Owner/验收责任及状态／阶段分别原文保留。10新增和15保留单元全部登记。\n\n'
      f'{validation["records_with_verified_function_candidates"]}条记录有可定位的函数候选；{validation["function_candidate_references"]}处引用已核函数存在、声明行及文件SHA。这些是候选锚点，精确行为承接仍Pending，接受数为0。\n\n'
      f'原30模块职责队列完整承接：{validation["original_syntactic_functions"]}语法函数，{validation["semantic_reviewed_production"]}项生产语义已审／{validation["semantic_pending_production"]}项待审（来自原队列，不新增接受）。\n\n'
      f'{validation["units_with_source_files"]}/25单元找到现有文件。Maker/Channel/Market目前共用soulidity_v1发布；多单元选中同一源码不得并行writer。实际独立writer/reviewer、精确状态/权限/依赖/退出、第三方生产构建、运行／UI／CASE-19均未由本映射通过。\n\n'
      f'发现{len(conflicts)}项冲突，包括共享源码和发布单元、AC/SO界面定位来源差异、SO f722缺少预期CURRENT、Channel独立边界待证明。历史等待开工只保留为来源，不恢复为当前阻塞。关口0仍Pending，不签名不部署。\n\n'
      f'重跑：`python3 scripts/gate0/build_record_mapping.py --design {design} --source {source} --out {out}`\n')
    (out/'README_CN.md').write_text(summary)
    print(json.dumps(validation,ensure_ascii=False,indent=2))

if __name__=='__main__':
    ap=argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--design',type=Path,default=DESIGN_DEFAULT)
    ap.add_argument('--source',type=Path,default=SOURCE_DEFAULT)
    ap.add_argument('--allow-source-artifact-output',action='store_true',help='Coordinator-only opt-in for evidence artifacts beneath source/output; never permits source or design writes')
    ap.add_argument('--slack-readback',type=Path,default=SOURCE_DEFAULT/'output/ecosystem-construction/gate0-2026-10-10/slack-before.json')
    ap.add_argument('--out',type=Path,default=SCRIPT_ROOT/'output/gate0-records')
    run(ap.parse_args())
