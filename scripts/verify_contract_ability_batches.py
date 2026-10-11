#!/usr/bin/env python3
"""Compile foreign modules in diagnostic-stage batches; retain per-file evidence.

Every case remains its own foreign module. A failed batch never proves a case
without that case's intended primary diagnostic. This is compiler evidence,
not runtime authority or publication acceptance. Original per-package probes
remain available for independent verification and disagreements.
"""
import argparse,hashlib,importlib.util,json,re,subprocess,time
from pathlib import Path
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('original',ROOT/'scripts/verify_contract_ability_probes.py')
original=importlib.util.module_from_spec(spec);spec.loader.exec_module(original)

def main():
 p=argparse.ArgumentParser();p.add_argument('--out',type=Path,required=True);p.add_argument('--sui-binary',required=True);p.add_argument('--case',action='append',choices=tuple(original.CASES));p.add_argument('--jobs',type=int,choices=range(1,9),default=4);p.add_argument('--batch-size',type=int,choices=range(1,33),default=16);p.add_argument('--discard-build-artifacts',action='store_true',help='After retaining compiler log/bytecode JSON and per-case evidence, remove only reproducible .mv/.mvd/debug_info files under this generated batch build');a=p.parse_args();out=a.out.resolve();out.mkdir(parents=True,exist_ok=True)
 groups=defaultdict(list)
 for name,value in original.CASES.items():
  if not a.case or name in a.case:groups['positive' if value[1] else value[2]].append((name,value))
 batches=[]
 for group,cases in groups.items():
  size=1 if group.startswith('ESC') else a.batch_size
  for offset in range(0,len(cases),size):batches.append((group,offset//size,cases[offset:offset+size]))
 def run(batch):
  group,n,cases=batch;d=out/f'{group}-{n:02d}';(d/'sources').mkdir(parents=True,exist_ok=True)
  (d/'Move.toml').write_text('[package]\nname = "ability_batch"\nedition = "2024"\n[dependencies]\nsoulidity_v1 = { local = "'+str(ROOT/'move/soulidity_v1')+'" }\n'+original.SUI_DEPENDENCY+'\n[addresses]\nability_probe = "0xa"\n')
  files={}
  for name,(body,_,_) in cases:
   assert 'ability_probe::' not in body and not re.search(r'\bmodule\s+',body)
   source='module ability_probe::'+name+';\nuse soulidity_v1::physical::{Self,Asset};\n'+body+'\n';(d/'sources'/f'{name}.move').write_text(source);files[name]=hashlib.sha256(source.encode()).hexdigest()
  command=[a.sui_binary,'move','build','--path',str(d),'--dump-bytecode-as-base64','--no-tree-shaking','--with-unpublished-dependencies'];start=time.monotonic();r=subprocess.run(command,capture_output=True,text=True);log=r.stdout+r.stderr;(d/'build.log').write_text(log);clean=re.sub(r'\x1b\[[0-9;]*m','',log)
  all_codes=sorted(set(re.findall(r'error\[([^]]+)\]',clean)));structural=[c for c in all_codes if c.startswith(('EC01','EC02','EC03'))]
  primary=defaultdict(list)
  for block in re.split(r'(?=error\[)',clean):
   m=re.match(r'error\[([^]]+)\]',block)
   if not m:continue
   # First diagnostic source span is the complained-about source, not a later
   # dependency declaration used to explain the error.
   source=re.search(r'(?:┌─|-->)[^\n]*[/\\]sources[/\\]([^/\\:\s]+)\.move:\d+',block)
   if source:primary[source[1]].append(m[1])
  rows=[]
  for name,(_,positive,expected) in cases:
   codes=sorted(set(primary[name]));verified=(r.returncode==0) if positive else r.returncode!=0 and not structural and (expected in codes or len(cases)==1 and expected in all_codes)
   row={'case':name,'module':'ability_probe::'+name,'batch':d.name,'source_sha256':files[name],'expected_success':positive,'expected_diagnostic':expected,'primary_error_codes':codes,'batch_error_codes':all_codes,'unrelated_structural_errors':structural,'batch_exit':r.returncode,'verified':verified};rows.append(row)
  result={'group':group,'batch':d.name,'command':command,'elapsed_seconds':time.monotonic()-start,'exit':r.returncode,'cases':rows};cleanup={'enabled':a.discard_build_artifacts,'files':0,'bytes':0}
  if a.discard_build_artifacts:
   # Generated batch-local compiler output only; preserve source, locks, logs,
   # complete compiler bytecode JSON and all structured diagnostic evidence.
   build=d/'build'
   if build.is_dir() and not build.is_symlink():
    for f in build.rglob('*'):
     if f.is_file() and not f.is_symlink() and (f.suffix in ('.mv','.mvd') or 'debug_info' in f.relative_to(build).parts):
      cleanup['files']+=1;cleanup['bytes']+=f.stat().st_size;f.unlink()
  result['reproducible_build_cleanup']=cleanup
  (d/'evidence.json').write_text(json.dumps(result,indent=2)+'\n');print(d.name+': '+str(sum(x['verified'] for x in rows))+'/'+str(len(rows)),flush=True);return result
 with ThreadPoolExecutor(max_workers=a.jobs) as pool:results=list(pool.map(run,batches))
 rows=[c for r in results for c in r['cases']];e={'tool':'Sui Move compiler, foreign modules grouped by diagnostic stage','sui_dependency':original.SUI_DEPENDENCY,'total_available':len(original.CASES),'selected_cases':a.case,'selected_count':len(rows),'batch_size':a.batch_size,'batches':results,'all_verified':all(r['verified'] for r in rows),'cases':rows,'limit':'Each negative requires its own intended primary diagnostic; no failed-batch substitution. Batch module names differ from original per-package probes. Runtime/custody/payment/publication require separate evidence.'};(out/'evidence.json').write_text(json.dumps(e,indent=2)+'\n');raise SystemExit(0 if e['all_verified'] else 1)
if __name__=='__main__':main()
