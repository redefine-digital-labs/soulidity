#!/usr/bin/env python3
"""Read a Sui function-only JSONL.zst trace without decoding enormous values.

Reports inclusive VM-meter deltas, not network gas prices or per-PTB acceptance.
An unfinished frame is retained as incomplete, never counted as a successful call.
"""
import argparse
import collections
import json
import re
import subprocess
from pathlib import Path

OPEN = re.compile(rb'^\{"OpenFrame":\{"frame":\{"frame_id":(\d+),"function_name":"([^"]+)","module":\{"address":"([^"]+)","name":"([^"]+)"')
CLOSE = re.compile(rb'^\{"CloseFrame":\{"frame_id":(\d+),')
GAS = re.compile(rb'"gas_left":(\d+)\}\}\s*$')


def profile(path):
    process = subprocess.Popen(['zstd', '-dc', str(path)], stdout=subprocess.PIPE)
    stack = []
    calls = collections.Counter()
    finished = collections.Counter()
    inclusive = collections.Counter()
    root_start = last_gas = None
    lines = 0
    try:
        for line in process.stdout:
            lines += 1
            gas_match = GAS.search(line[-128:])
            if not gas_match:
                continue
            gas = int(gas_match[1])
            last_gas = gas
            opened = OPEN.match(line[:512])
            if opened:
                frame, function, address, module = opened.groups()
                name = module.decode() + '::' + function.decode()
                if root_start is None:
                    root_start = gas
                stack.append((int(frame), name, gas))
                calls[name] += 1
            else:
                closed = CLOSE.match(line[:128])
                if closed:
                    if not stack or stack[-1][0] != int(closed[1]):
                        raise ValueError('Non-nested frame close at line %s' % lines)
                    _, name, before = stack.pop()
                    finished[name] += 1
                    inclusive[name] += before - gas
    except BaseException:
        process.terminate()
        raise
    finally:
        process.stdout.close()
        code = process.wait()
    if code:
        raise ValueError('zstd exited %s' % code)
    if root_start is None or last_gas is None:
        raise ValueError('No function frames with VM gas in this trace')
    return {
        'trace': str(path), 'lines': lines,
        'root_start_vm_meter': root_start, 'last_observed_vm_meter': last_gas,
        'observed_vm_meter_delta': root_start - last_gas,
        'unfinished': [{'frame': f, 'function': n, 'start_vm_meter': g,
                        'observed_inclusive_delta': g - last_gas} for f, n, g in stack],
        'functions': [{'function': n, 'started': calls[n], 'finished': finished[n],
                       'completed_inclusive_vm_delta': inclusive[n]}
                      for n in sorted(calls, key=lambda n: inclusive[n], reverse=True)],
        'limit': 'Inclusive deltas overlap between ancestors/descendants; never sum them. '
                 'test_scenario boundaries do not reset this meter. Trace timing differs '
                 'from untraced execution. This is not actual network gas acceptance.',
    }


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('trace', type=Path)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    result = profile(args.trace)
    args.output.write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps({'observed_vm_meter_delta': result['observed_vm_meter_delta'],
                      'unfinished': result['unfinished'],
                      'top_functions': result['functions'][:12]}, indent=2))
