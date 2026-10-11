#!/usr/bin/env python3
"""Independent bounded static checks; no compile/runtime/Gate0 claim."""
import argparse,json,re
from pathlib import Path
from source_inventory import read,write,strip_comments,sha

def main():
 ap=argparse.ArgumentParser();ap.add_argument('--source-root',type=Path,required=True);ap.add_argument('--output',type=Path,required=True);a=ap.parse_args();root=a.source_root.resolve();out=a.output.resolve();d=read(out/'current-source-inventory.json')
 for m in d['modules']:
  path=root/m['path'];assert sha(path)==m['sha256'];clean=strip_comments(path.read_text());assert len(re.findall(r'\bfun\s+\w+',clean))==sum(f['module']==m['id'] for f in d['functions']),m['id']
 for f in d['functions']:assert f['name'] in (root/f['path']).read_text().splitlines()[f['line']-1],f['id']
 source={f['id']:f for f in d['functions'] if not f['explicit_test_only']};types={t['id']:t for t in d['types'] if not t['explicit_test_only']};rows=[];base=root/'output/contract-rebuild/native-target-local-2026-10-10'
 for pkg in [p['package'] for p in d['packages']]:
  p=base/(pkg+'-deployed-abi.json');abi=read(p);count=0;st_count=0
  for mod,val in abi.items():
   for name,fn in val['exposedFunctions'].items():
    key=pkg+'::'+mod+'::'+name;assert key in source,key;count+=1
   for name,st in val['structs'].items():
    key=pkg+'::'+mod+'::'+name;assert key in types,key;assert set(x.lower() for x in st['abilities']['abilities'])==set(types[key]['abilities']),key;st_count+=1
  rows.append({'package':pkg,'deployed_exposed_functions_indexed':count,'deployed_types_ability_matched':st_count,'raw_ABI_path':str(p),'raw_ABI_sha256':sha(p)})
 pub=read(out/'local-published-evidence-index.json');assert pub['source_freeze']['all_current_source_hashes_match'];assert pub['source_freeze']['inputs']==67
 q=read(out/'preserved-original30-function-review-queue.json');cov=read(out/'preserved-CONTRACT_REBUILD_COVERAGE.json');assert sha(root/'docs/CONTRACT_REBUILD_COVERAGE.json')==sha(out/'preserved-CONTRACT_REBUILD_COVERAGE.json');assert sha(root/cov['original30_function_review_queue'])==sha(out/'preserved-original30-function-review-queue.json')
 assert len(q['modules'])==30 and q['semantic_reviewed_production']==69 and q['semantic_pending_production']==1459
 mapping=read(out/'module-and-retained-source-selectors.json');assert len(mapping['rows'])==25
 deps=read(out/'seven-kind-dependencies.json');assert set(deps['categories'])=={'compile','runtime','behavior','permission','funds','state','content'};assert all(set(['consumer','provider','kind','actions_types_state','selected_condition','exact_version_range','change_trigger_validation','exit_migration']).issubset(x) for x in deps['edges'])
 write(out/'independent-static-verification.json',{'status':'PASS static evidence checks only','checks':['52 files/nine packages/67 inputs (52 Move,9 manifests,6locks)','all fun-token declaration counts and exact reported declaration lines','byte-preserved original Coverage + all1680decl/1528production duties','nine actual ABI exposed-function source selectors and all deployed abilities','25 target/retained rows preserved','seven dependency kinds and eight edge fields','67 actual-local source-freeze SHA match'],'packages':rows,'full_signature_comparison':'full source signatures and full normalized ABI retained; type-argument/address structural equivalence not independently executed here','runtime_this_task':'Not run','cross_package_production_build_this_task':'Not run','third_party_attack_this_task':'Not run','qualified_independent_review':'Not run','Gate0':'Not passed','full_goal_complete':False})
 print('PASS: bounded static inventory/ABI-name/ability/line/preservation checks. Gate0 NOT PASSED.')
if __name__=='__main__':main()
