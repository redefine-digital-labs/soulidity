import copy
import json
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch

import delivery_gate as gate
import delivery_execute as executor


def item():
    data = json.loads((Path(__file__).resolve().parents[2] /
                       'agent-management/runs/dev-002-delivery.json').read_text())
    data['pair'] = {'ac': {'commit': 'a' * 40, 'run_id': 10, 'pr': 82},
                    'so': {'commit': 'b' * 40, 'run_id': 20, 'pr': 34}}
    data['acceptance']['interaction_budget'] = {'signature_count': 7, 'plan_evidence': 'synthetic-test-only'}
    return data


def ci(site='ac'):
    data = item()
    run = {'id': data['pair'][site]['run_id'], 'head_sha': data['pair'][site]['commit'],
           'event': 'workflow_dispatch', 'status': 'completed', 'conclusion': 'success', 'run_attempt': 2,
           'jobs': [{'name': name, 'status': 'completed', 'conclusion': 'success'} for name in gate.JOBS[site]]}
    receipt = {'schema': 1, 'pair': {s: data['pair'][s]['commit'] for s in gate.REPOS},
               'site': site, 'run_id': str(run['id']), 'attempt': '2', 'event': 'workflow_dispatch'}
    return data, run, receipt


def journey():
    return {'scope_revision': item()['scope']['revision'], 'mode': 'fresh',
            'environment': 'production', 'kind': 'observed-browser-and-chain',
            'pair': {s: item()['pair'][s]['commit'] for s in gate.REPOS},
            'browser': 'chrome', 'initial_cache': 'empty',
            'steps': [{'step': step, 'status': 'pass', 'evidence': 'synthetic-test-only',
                       'observed_at': f'2026-10-06T00:00:0{i}Z', 'new_content_hashes': ['c' * 64],
                       'soul_id': '0x' + '1' * 64, 'owner': 'test-owner', 'content_hash': 'c' * 64}
                      for i, step in enumerate(gate.JOURNEY)],
            'deployments': {s: {'source_commit': item()['pair'][s]['commit'], 'id': 'fixture-deploy',
                               'readback': 'synthetic-test-only'} for s in gate.REPOS},
            'recovery': {'same_operation': True, 'duplicate_charges': 0, 'duplicate_mints': 0,
                         'evidence': 'synthetic-test-only'},
            'interaction': {'redundant_continue_clicks': 0, 'signature_count': 7,
                            'reviewed_signature_budget': 7, 'plan_evidence': 'synthetic-test-only'}}


class DeliveryGateTests(unittest.TestCase):
    def test_current_work_item_is_reviewed(self):
        gate.check_item(item())

    def test_stale_review_and_unreviewed_bug_are_blocked(self):
        for change in [lambda d: d['review'].update(scope_revision='old'),
                       lambda d: d['bugs'][0].update(review='pending'),
                       lambda d: d['bugs'].append(copy.deepcopy(d['bugs'][0]))]:
            data = item(); change(data)
            with self.assertRaises(ValueError): gate.check_item(data)

    def test_fresh_cannot_require_r41(self):
        for field in ['required_draft_id', 'required_revision']:
            data = item(); data['scope'][field] = 'r41'
            with self.assertRaisesRegex(ValueError, 'historical'): gate.check_item(data)

    def test_unreviewed_write_and_path_escape_blocked(self):
        gate.check_changed(item(), ['scripts/codex/delivery_gate.py'])
        for path in ['ac/move/new-contract.move', '../outside', '/absolute']:
            with self.assertRaises(ValueError): gate.check_changed(item(), [path])

    def test_existing_authorization_is_reused_but_not_extended(self):
        data = item()
        self.assertEqual(gate.check_authorization(data, 'merge', gate.REPOS['ac'])['decision'],
                         'reuse-existing-authorization')
        for action, target in [('sign', gate.REPOS['ac']), ('merge', 'another/repo')]:
            with self.assertRaises(ValueError): gate.check_authorization(data, action, target)
        data['execution']['grants'][0]['expires_at'] = '2020-01-01T00:00:00Z'
        with self.assertRaises(ValueError): gate.check_authorization(data, 'merge', gate.REPOS['ac'])

    def test_wrong_browser_or_unverified_account_is_blocked(self):
        data = item()
        observed = {'browser': 'chrome', 'origin': 'https://animacraft.soulidity.ai',
                    'account': 'verified-author', 'observed_at': datetime.now(timezone.utc).isoformat()}
        with self.assertRaises(ValueError): gate.check_browser(data, observed)
        data['execution']['browser']['account'] = 'verified-author'
        gate.check_browser(data, observed)
        for field, value in [('browser', 'iab'), ('origin', 'http://127.0.0.1'),
                             ('account', 'wrong-author'), ('observed_at', '2020-01-01T00:00:00Z')]:
            bad = {**observed, field: value}
            with self.assertRaises(ValueError): gate.check_browser(data, bad)

    def test_both_exact_ci_receipts_accepted(self):
        for site in gate.REPOS:
            data, run, receipt = ci(site); gate.check_ci(data, site, run, receipt)

    def test_old_green_pair_pr_run_rerun_and_missing_job_blocked(self):
        changes = [lambda r, p: p['pair'].update(so='c' * 40),
                   lambda r, p: r.update(head_sha='c' * 40),
                   lambda r, p: r.update(event='pull_request'),
                   lambda r, p: r.update(status='in_progress'),
                   lambda r, p: r['jobs'].pop(),
                   lambda r, p: r['jobs'][0].update(conclusion='skipped'),
                   lambda r, p: p.update(attempt='1'),
                   lambda r, p: p.update(run_id='999')]
        for change in changes:
            data, run, receipt = ci(); change(run, receipt)
            with self.assertRaises(ValueError): gate.check_ci(data, 'ac', run, receipt)

    def test_pending_ci_does_not_fetch_artifacts(self):
        with patch.object(gate, 'github', return_value={'status': 'queued', 'conclusion': None}) as api:
            with self.assertRaises(ValueError): gate.live_ci(item(), 'ac')
            self.assertEqual(api.call_count, 1)

    def test_release_executor_does_not_merge_when_either_pair_gate_fails(self):
        with patch.object(executor, 'live_ci', side_effect=[None, ValueError('SO stale')]), \
                patch.object(executor.subprocess, 'run') as mutate:
            with self.assertRaisesRegex(ValueError, 'SO stale'):
                executor.execute(item(), 'merge', 'ac')
            mutate.assert_not_called()

    def test_merge_command_is_bound_to_the_checked_head(self):
        with patch.object(executor, 'live_ci'), patch.object(executor.subprocess, 'run') as mutate:
            executor.execute(item(), 'merge', 'ac')
            args = mutate.call_args.args[0]
            self.assertEqual(args[-2:], ['--match-head-commit', 'a' * 40])

    def test_unreviewed_staging_entry_never_runs(self):
        with patch.object(executor, 'live_ci'), patch.object(executor.subprocess, 'run') as mutate:
            with self.assertRaisesRegex(ValueError, 'staging directory'):
                executor.execute(item(), 'stage', 'ac', '/tmp/unreviewed-stage')
            mutate.assert_not_called()

    def test_complete_synthetic_journey_schema(self):
        # Tests validator behavior only; never a real product acceptance receipt.
        gate.check_journey(item(), journey())

    def test_local_green_wrong_soul_old_draft_and_redundant_clicks_cannot_close(self):
        changes = [lambda e: e.update(environment='local'), lambda e: e.update(kind='simulation'),
                   lambda e: e['steps'].pop(), lambda e: e['steps'][0].update(reused_draft=True),
                   lambda e: e['steps'][4].update(soul_id='0x' + '2' * 64),
                   lambda e: e['steps'][5].update(content_hash='d' * 64),
                   lambda e: e['interaction'].update(redundant_continue_clicks=1),
                   lambda e: e['interaction'].update(signature_count=8),
                   lambda e: e['interaction'].update(signature_count=99, reviewed_signature_budget=99),
                   lambda e: e['recovery'].update(duplicate_charges=1),
                   lambda e: e['pair'].update(ac='f' * 40),
                   lambda e: e['steps'][2].update(status='unknown')]
        for change in changes:
            e = journey(); change(e)
            with self.assertRaises(ValueError): gate.check_journey(item(), e)


if __name__ == '__main__':
    unittest.main()
