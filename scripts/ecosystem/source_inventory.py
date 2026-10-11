#!/usr/bin/env python3
"""Read-only bounded Move declaration inventory; outputs never constitute Gate 0 PASS.
Scans only move/soulidity_*/sources, manifests, locks and explicitly named evidence.
No git/network/chain commands, wallets, keys, build trees or recursive output scans.
"""
import argparse, hashlib, json, re, shutil
from pathlib import Path

PACKAGES = ['soulidity_standard','soulidity_foundation','soulidity_model','soulidity_visual','soulidity_content','soulidity_application','soulidity_community','soulidity_native','soulidity_v1']
CATEGORIES = ['compile','runtime','behavior','permission','funds','state','content']

def sha(p): return hashlib.sha256(p.read_bytes()).hexdigest()
def read(p): return json.loads(p.read_text())
def write(p,d): p.write_text(json.dumps(d,ensure_ascii=False,indent=2)+'\n')
def strip_comments(s):
    """Replace comment bytes with spaces, preserving exact offsets and newlines.
    Nested block comments and quoted strings (including b\"...\") are recognized.
    """
    out=list(s); i=0; n=len(s)
    while i<n:
        if s[i]=='"':
            i+=1
            while i<n:
                if s[i]=='\\': i+=2
                elif s[i]=='"': i+=1;break
                else:i+=1
        elif s.startswith('//',i):
            j=s.find('\n',i); j=n if j<0 else j
            for k in range(i,j):out[k]=' '
            i=j
        elif s.startswith('/*',i):
            depth=1;j=i+2
            while j<n and depth:
                if s.startswith('/*',j):depth+=1;j+=2
                elif s.startswith('*/',j):depth-=1;j+=2
                else:j+=1
            if depth:raise ValueError('unterminated comment')
            for k in range(i,j):
                if s[k]!='\n':out[k]=' '
            i=j
        else:i+=1
    return ''.join(out)
def line(s,i):return s.count('\n',0,i)+1
def paired(s,i,left,right):
    depth=0; quote=False; k=i
    while k<len(s):
        c=s[k]
        if quote:
            if c=='\\':k+=2;continue
            if c=='"':quote=False
        elif c=='"':quote=True
        elif c==left:depth+=1
        elif c==right:
            depth-=1
            if depth==0:return k
        k+=1
    raise ValueError('unbalanced '+left+' at '+str(i))
def attrs(s,start):
    result=[];tail=s[:start].rstrip()
    while tail.endswith(']'):
        m=re.search(r'#\[([^\]]+)\]\s*$',tail)
        if not m:break
        result.insert(0,m[1].strip());tail=tail[:m.start()].rstrip()
    return result
def imports(s,module):
    aliases={module.split('::')[-1]:module}; types={}
    for m in re.finditer(r'\buse\s+([^;]+);',s):
        u=' '.join(m[1].split()); g=re.match(r'(\w+::\w+)::\{(.+)\}$',u)
        if g:
            prefix,items=g.groups()
            for item in items.split(','):
                item=item.strip(); a=re.split(r'\s+as\s+',item); name=a[0]; alias=a[-1]
                if name=='Self':aliases[alias if len(a)>1 else prefix.split('::')[-1]]=prefix
                else:types[alias]=prefix+'::'+name
        else:
            a=re.split(r'\s+as\s+',u); path=a[0];alias=a[-1] if len(a)>1 else path.split('::')[-1]
            if path.count('::')==1:aliases[alias]=path
            elif path.count('::')==2:types[alias]=path
    return aliases,types

def inventory(root):
    modules=[]; functions=[]; structs=[]; manifests=[]; all_inputs=[]
    for pkg in PACKAGES:
        folder=root/'move'/pkg
        for name in ['Move.toml','Move.lock']:
            p=folder/name
            if p.exists():all_inputs.append({'path':str(p.relative_to(root)),'sha256':sha(p),'kind':'manifest' if name=='Move.toml' else 'lock'})
        p=folder/'Move.toml';s=p.read_text(); section='';deps=[];addresses={}
        for l in s.splitlines():
            if l.startswith('['):section=l.strip('[]')
            elif section=='dependencies' and '=' in l:
                name,value=l.split('=',1);deps.append({'name':name.strip(),'declaration':value.strip(),'local_path':(re.search(r'local\s*=\s*"([^"]+)"',value) or [None,None])[1]})
            elif section=='addresses' and '=' in l:
                k,v=l.split('=',1);addresses[k.strip()]=v.strip().strip('"')
        manifests.append({'package':pkg,'path':str(p.relative_to(root)),'sha256':sha(p),'dependencies':deps,'addresses':addresses,'release_unit':str(p.parent.relative_to(root)),'deployed_authority_status':'Not run; manifests are source configuration, not a deployed identity'})
        for p in sorted((folder/'sources').glob('*.move')):
            raw=p.read_text();s=strip_comments(raw);match=re.search(r'\bmodule\s+(\w+::\w+)\s*[;{]',s)
            if not match:raise ValueError('module missing '+str(p))
            module=match[1];module_attrs=attrs(s,match.start());module_test='test_only' in module_attrs
            aliases,types=imports(s,module);ref={}
            for m in re.finditer(r'\b(\w+::\w+)(?:::([A-Za-z_][\w]*))?',s):
                target=m[1]
                if target!=module:ref.setdefault(target,[]).append(line(s,m.start()))
            module_row={'id':module,'package':pkg,'path':str(p.relative_to(root)),'sha256':sha(p),'declaration_line':line(s,match.start()),'source_attributes':module_attrs,'explicit_test_only':module_test,'source_references':{k:sorted(set(v)) for k,v in ref.items()},'module_aliases':aliases,'imported_types':types}
            modules.append(module_row);all_inputs.append({'path':module_row['path'],'sha256':sha(p),'kind':'move_source'})
            # Bodies are balanced, then skipped: fun-like text in bodies cannot become a declaration.
            decl=re.compile(r'(?<![\w:])(?:(?:public(?:\s*\(\s*(?:package|friend)\s*\))?\s+)?(?:entry\s+)?(?:native\s+)?(?:macro\s+)?)\b(fun|struct|enum)\s+(\w+)')
            pos=match.end()
            while True:
                m=decl.search(s,pos)
                if not m:break
                kind,name=m.groups();a=attrs(s,m.start());test=module_test or 'test_only' in a
                gen='';i=m.end()
                while i<len(s) and s[i].isspace():i+=1
                if s[i:i+1]=='<':j=paired(s,i,'<','>');gen=s[i:j+1];i=j+1
                if kind=='fun':
                    i=s.index('(',i);j=paired(s,i,'(',')'); k=j+1
                    while k<len(s) and s[k] not in '{;':k+=1
                    end=paired(s,k,'{','}') if s[k]=='{' else k
                    signature=s[m.start():k].strip();body=s[k:end+1] if s[k]=='{' else ''
                    row={'id':module+'::'+name,'module':module,'package':pkg,'path':module_row['path'],'line':line(s,m.start()),'end_line':line(s,end),'name':name,'signature':signature,'type_parameters':gen,'parameters':s[i+1:j],'returns':s[j+1:k].strip().lstrip(':').strip(),'visibility':'public(package)' if re.match(r'public\s*\(\s*package',signature) else 'public(friend)' if re.match(r'public\s*\(\s*friend',signature) else 'public' if signature.startswith('public') else 'private','entry':bool(re.search(r'\bentry\b',signature.split('fun')[0])),'source_attributes':a,'explicit_test_only':test,'classification_basis':'explicit function/module test_only attribute only; names are not used','body_sha256':hashlib.sha256(body.encode()).hexdigest(),'body_start_line':line(s,k),'body':body,'source_test_status':'Not run'}
                    functions.append(row)
                else:
                    k=i
                    while k<len(s) and s[k] not in '{;':k+=1
                    end=paired(s,k,'{','}') if s[k]=='{' else k
                    ability=re.search(r'\bhas\s+(.+)',s[i:k]);abilities=re.findall(r'\b(copy|drop|store|key)\b',ability[1]) if ability else []
                    fields=s[k+1:end].strip() if s[k]=='{' else ''
                    structs.append({'id':module+'::'+name,'module':module,'package':pkg,'path':module_row['path'],'line':line(s,m.start()),'end_line':line(s,end),'name':name,'type_parameters':gen,'signature':s[m.start():k].strip(),'abilities':abilities,'fields':fields,'kind':kind,'source_attributes':a,'explicit_test_only':test,'key_object':'key' in abilities,'cap_name_candidate':bool(re.search(r'Cap$|^(Admin|Control|Account)$',name)),'cap_semantic_status':'name is a candidate only; effective authority requires entry/control-path review'})
                pos=end+1
    # Resolve lexical function references and types conservatively; no dynamic call inference.
    module_by={m['id']:m for m in modules}; function_by={f['id']:f for f in functions}; calls=[]
    for f in functions:
        mod=module_by[f['module']];body=f.pop('body');refs=[]
        for m in re.finditer(r'\b(\w+(?:::\w+){0,2})\s*(?:<[^;{}()]*>)?\s*\(',body):
            token=m[1];bits=token.split('::');target=None
            if len(bits)==3:target=token
            elif len(bits)==2:target=mod['module_aliases'].get(bits[0],bits[0])+'::'+bits[1]
            else:target=f['module']+'::'+token
            if target in function_by:
                refs.append(target);calls.append({'consumer':f['id'],'provider':target,'kind':'source_call_expression','not_bytecode_or_runtime_proof':True})
        f['source_function_references']=sorted(set(refs))
        guards=[]
        for g in re.finditer(r'\bassert!\s*\(',body):
            opening=body.index('(',g.start());ending=paired(body,opening,'(',')')
            guards.append({'line':f['body_start_line']+body[:g.start()].count('\n'),'source_expression':body[g.start():ending+1],'semantics':'source predicate only; passing inputs/authority path not executed'})
        f['source_assert_predicates']=guards
        f['authority_inputs']=[x.strip() for x in f['parameters'].split(',') if re.search(r'\b(Admin|Control|Account|\w*Cap|Publisher|Config|Soul|Kiosk|Claim|Draft|Installation|Receipt|Permit|UpgradeTicket)\b',x)]
        f['source_effect_expressions']=[{'expression':m[0],'line':f['body_start_line']+body[:m.start()].count('\n')} for m in re.finditer(r'\b(?:\w+::)+(?:public_share_object|share_object|public_transfer|transfer|public_receive|receive|new|claim|make_immutable|authorize_upgrade|commit_upgrade)\b',body)]
        for st in structs:
            if st['explicit_test_only']:continue
            visible=st['module']==f['module'] or st['id'] in mod['imported_types'].values()
            if not visible:continue
            name=next((a for a,b in mod['imported_types'].items() if b==st['id']),st['name'])
            if re.search(r'\b'+re.escape(name)+r'\b',f['signature']):
                st.setdefault('signature_users',[]).append({'function':f['id'],'signature':f['signature'],'visibility':f['visibility'],'explicit_test_only':f['explicit_test_only'],'parameter_or_return_reference':'lexical type reference; generic/type-path semantics not executed'})
            if st['module']==f['module']:
                for site in re.finditer(r'\b'+re.escape(st['name'])+r'\s*(?:<[^{};]*>)?\s*\{',body):
                    st.setdefault('pack_or_unpack_sites',[]).append({'function':f['id'],'line':f['body_start_line']+body[:site.start()].count('\n'),'explicit_test_only':f['explicit_test_only'],'basis':'lexical pack/unpack site; inspect source to distinguish construction/destruction'})
    return {'packages':manifests,'modules':modules,'functions':functions,'types':structs,'source_function_edges':calls,'frozen_inputs':all_inputs}

def graph(data):
    lines=['@startuml','title Actual source package dependencies (consumer -> provider)','left to right direction','skinparam componentStyle rectangle']
    for p in PACKAGES:lines.append('component "'+p+'" as '+p)
    manifest=set();source=set();mods={m['id']:m for m in data['modules']}
    for p in data['packages']:
        for d in p['dependencies']:
            if d['local_path']:
                target=Path(d['local_path']).name;manifest.add((p['package'],target))
    for m in data['modules']:
        for ref in m['source_references']:
            if ref in mods and mods[ref]['package']!=m['package']:source.add((m['package'],mods[ref]['package']))
    for a,b in sorted(manifest|source):lines.append(a+' --> '+b+' : '+('manifest + source refs' if (a,b) in manifest and (a,b) in source else 'manifest' if (a,b) in manifest else 'source refs'))
    lines+=['note bottom','Textual references and manifest imports, not dynamic bytecode calls.','Co-package duties share actual release/upgrade authority.','Runtime/production/independent-review Gate 0 checks remain Not run.','end note','@enduml']
    return '\n'.join(lines)+'\n'

def selftest():
    s='// fun fake() {}\n/* outer /* nested */\n fun fake() {} */\n#[test_only]\npublic fun x<T: drop>(s: vector<T>): (u64, bool) { let _ = b"// not comment"; }'
    c=strip_comments(s);assert len(c)==len(s) and c.count('\n')==s.count('\n') and 'fake' not in c and '// not comment' in c
    assert attrs(c,c.index('public'))==['test_only']; assert c.index('public')==s.index('public')
    assert paired('(<T>,(u64,bool))',0,'(',')')==15

def main():
    ap=argparse.ArgumentParser();ap.add_argument('--source-root',type=Path,required=True);ap.add_argument('--design-root',type=Path,required=True);ap.add_argument('--output',type=Path,required=True);args=ap.parse_args()
    root=args.source_root.resolve();design=args.design_root.resolve();out=args.output.resolve();out.mkdir(parents=True,exist_ok=True);selftest()
    d=inventory(root);coverage=root/'docs/CONTRACT_REBUILD_COVERAGE.json';cov=read(coverage);queue=root/cov['original30_function_review_queue'];q=read(queue)
    shutil.copyfile(coverage,out/'preserved-CONTRACT_REBUILD_COVERAGE.json');shutil.copyfile(queue,out/'preserved-original30-function-review-queue.json')
    production=[f for f in d['functions'] if not f['explicit_test_only']]
    d['metadata']={'source_root':str(root),'scope':'exact current source declarations separate from preserved original-duty queue','declaration_inventory_status':'PASS static extraction/self-check only','Gate0':'Not run / blocked by outstanding executable boundary checks','runtime_status':'Not run','full_goal_complete':False,'public_ABI_status':'candidate source signatures; deployed ABI and frozen public minimal ABI are separate','comment_offsets_and_lines_preserved':True}
    d['counts']={'packages':len(d['packages']),'move_source_files':len(d['modules']),'production_inputs':len(d['frozen_inputs']),'manifest_files':sum(x['kind']=='manifest' for x in d['frozen_inputs']),'lock_files':sum(x['kind']=='lock' for x in d['frozen_inputs']),'all_source_function_declarations':len(d['functions']),'current_production_function_declarations':len(production),'explicit_test_only_functions':len(d['functions'])-len(production),'source_types':len(d['types']),'production_key_types':sum(t['key_object'] and not t['explicit_test_only'] for t in d['types'])}
    d['preserved_original_duties']={'coverage_source':str(coverage),'coverage_sha256':sha(coverage),'queue_source':str(queue),'queue_sha256':sha(queue),'modules':len(cov['modules']),'syntactic_functions':q['syntactic_functions'],'classification_counts':q['classification_counts'],'semantic_reviewed_production':q['semantic_reviewed_production'],'semantic_pending_production':q['semantic_pending_production'],'counts_not_replaced_by_current_inventory':True}
    assert len(cov['modules'])==30 and len(q['modules'])==30
    assert sum(len(m['functions']) for m in q['modules'])==q['syntactic_functions']
    assert sha(out/'preserved-CONTRACT_REBUILD_COVERAGE.json')==sha(coverage) and sha(out/'preserved-original30-function-review-queue.json')==sha(queue)
    assert len(d['modules'])==52 and len(d['packages'])==9 and len(d['frozen_inputs'])==67
    assert any(m['id']=='soulidity_native::birth' for m in d['modules'])
    frozen=read(root/'output/contract-rebuild/native-revision-guard-2026-10-10/source-freeze.json')
    delta=[r['source'] for r in frozen if sha(root/r['source'])!=r['sha256']]
    d['prior_source_freeze_comparison']={'path':'output/contract-rebuild/native-revision-guard-2026-10-10/source-freeze.json','inputs':len(frozen),'changed_since_freeze':delta,'not_prior_verification_reexecution':True}
    write(out/'current-source-inventory.json',d);(out/'actual-source-package-dependencies.puml').write_text(graph(d))
    write(out/'inventory-selfcheck.json',{'status':'PASS','meaning':'static parser/inventory/byte-preserved old queue only; not Gate0','counts':d['counts'],'preserved_original_duties':d['preserved_original_duties'],'old_freeze_changes':delta,'runtime':'Not run'})
    print(json.dumps(d['counts']))
if __name__=='__main__': main()
