#!/usr/bin/env python3
"""Fail-closed checks for the existing DEV/BUG delivery record.

Read-only. Exit 1 means the requested transition must not be executed.
CI evidence is fetched from GitHub, not inferred from a local PASS string.
This checks evidence consistency; it cannot attest that hand-entered browser
observations are true or intercept tools called outside the guarded entry point.
"""
import argparse
import hashlib
import io
import json
import re
import subprocess
import sys
import zipfile
from datetime import datetime, timezone
from pathlib import Path

REPOS = {"ac": "redefine-digital-labs/animacraft", "so": "redefine-digital-labs/soulidity"}
JOBS = {"ac": {"Web production build", "Paired eight-package Move gates", "Repository hygiene"},
        "so": {"PR gates (typecheck + unit + Move build/test)"}}
JOURNEY = ["fresh-upload", "certified", "published-active", "complete", "received", "refreshed"]


def require(ok, message):
    if not ok:
        raise ValueError(message)


def sha(value):
    return isinstance(value, str) and re.fullmatch(r"[0-9a-f]{40}", value) is not None


def check_item(item):
    require(item.get("record_id") and item.get("dev_id"), "Existing DEV record required")
    for key in ("owner", "reviewer", "user_outcome", "original_operation"):
        require(isinstance(item.get(key), str) and item[key].strip(), f"Missing {key}")
    scope = item["scope"]
    require(item["review"]["scope_revision"] == scope["revision"] and
            item["review"]["decision"] == "approved" and item["review"]["source"],
            "Current scope has not been reviewed")
    require(scope["mode"] in {"fresh", "resume"}, "Unknown journey mode")
    if scope["mode"] == "fresh":
        require(not scope.get("required_draft_id") and not scope.get("required_revision"),
                "Fresh acceptance cannot require a historical draft/revision")
    else:
        require(scope.get("required_draft_id"), "Resume requires an exact draft")
    require(item["bugs"] and len({b["id"] for b in item["bugs"]}) == len(item["bugs"]),
            "Missing or duplicate Bug links")
    require(all(re.fullmatch(r"BUG-\d{3}", b["id"]) and b["record_id"] and
                b["review"] == "approved" for b in item["bugs"]), "Unreviewed Bug")
    for site in REPOS:
        require(sha(item["pair"][site]["commit"]), f"Exact {site} commit required")


def check_changed(item, paths):
    require(paths, "No changed paths supplied")
    for path in paths:
        require(not path.startswith("/") and ".." not in Path(path).parts, "Unsafe changed path")
        require(any(path == p or (p.endswith("/") and path.startswith(p))
                    for p in item["scope"]["write_paths"]), f"Unreviewed write path: {path}")


def check_authorization(item, action, target, now=None):
    now = now or datetime.now(timezone.utc)
    for grant in item["execution"]["grants"]:
        if action not in grant["actions"] or target not in grant["targets"]:
            continue
        require(grant.get("source"), "Authorization has no human source")
        expiry = grant.get("expires_at")
        if expiry and datetime.fromisoformat(expiry.replace("Z", "+00:00")) <= now:
            continue
        return {"decision": "reuse-existing-authorization", "source": grant["source"]}
    raise ValueError(f"No applicable authorization: {action}/{target}")


def check_browser(item, observed):
    for key in ("browser", "origin", "account"):
        require(item["execution"]["browser"][key] and
                observed.get(key) == item["execution"]["browser"][key], f"Wrong/unverified browser context: {key}")
    require(observed.get("observed_at"), "Browser observation time required")
    age = (datetime.now(timezone.utc) - datetime.fromisoformat(observed["observed_at"].replace("Z", "+00:00"))).total_seconds()
    require(0 <= age <= 300, "Browser observation is stale")


def check_ci(item, site, run, receipt):
    pair = {s: item["pair"][s]["commit"] for s in REPOS}
    require(run["id"] == item["pair"][site]["run_id"], "Wrong CI run")
    require(run["head_sha"] == pair[site], "CI checked another source revision")
    require(run["event"] == "workflow_dispatch", "Baseline PR CI is not paired release evidence")
    require(run["status"] == "completed" and run["conclusion"] == "success", "CI is not successfully complete")
    names = [job["name"] for job in run["jobs"]]
    require(len(names) == len(set(names)) and JOBS[site].issubset(names), "Missing/ambiguous required jobs")
    require(all(j["status"] == "completed" and j["conclusion"] == "success" for j in run["jobs"]),
            "Failed, skipped or unfinished job")
    require(receipt["schema"] == 1 and receipt["pair"] == pair, "CI paired source mismatch")
    require(receipt["site"] == site and receipt["run_id"] == str(run["id"]) and
            receipt["attempt"] == str(run["run_attempt"]) and receipt["event"] == run["event"],
            "Receipt belongs to another CI execution")


def github(path, binary=False):
    raw = subprocess.check_output(["gh", "api", path])
    return raw if binary else json.loads(raw)


def live_ci(item, site):
    run_id = item["pair"][site]["run_id"]
    require(isinstance(run_id, int) and run_id > 0, "CI run has not been recorded")
    prefix = f"repos/{REPOS[site]}/actions/runs/{run_id}"
    run = github(prefix)
    # Do not download artifacts or call a queued execution a failure.
    require(run["status"] == "completed" and run["conclusion"] == "success", "CI pending or failed")
    jobs = github(f"{prefix}/attempts/{run['run_attempt']}/jobs?per_page=100")
    require(jobs["total_count"] == len(jobs["jobs"]), "Incomplete CI job listing")
    run["jobs"] = jobs["jobs"]
    artifacts = github(prefix + "/artifacts?per_page=100")
    require(artifacts["total_count"] == len(artifacts["artifacts"]), "Incomplete artifact listing")
    name = f"paired-source-{site}-{run_id}-{run['run_attempt']}"
    matches = [a for a in artifacts["artifacts"] if a["name"] == name and not a["expired"]]
    require(len(matches) == 1, "Missing/ambiguous paired source receipt")
    archive = github(f"repos/{REPOS[site]}/actions/artifacts/{matches[0]['id']}/zip", binary=True)
    with zipfile.ZipFile(io.BytesIO(archive)) as z:
        require(z.namelist() == ["paired-source.json"], "Unexpected receipt artifact contents")
        require(z.getinfo("paired-source.json").file_size <= 16384, "Oversized receipt")
        receipt = json.loads(z.read("paired-source.json"))
    check_ci(item, site, run, receipt)


def check_journey(item, evidence):
    require(evidence["scope_revision"] == item["scope"]["revision"], "Stale acceptance scope")
    require(evidence["mode"] == item["scope"]["mode"], "Wrong acceptance journey")
    require(evidence["environment"] == "production" and evidence["kind"] == "observed-browser-and-chain",
            "Local tests/simulations cannot close a product journey")
    require(evidence["pair"] == {s: item["pair"][s]["commit"] for s in REPOS}, "Acceptance checked another pair")
    require(evidence["browser"] == "chrome" and evidence["initial_cache"] == "empty", "Clean Chrome acceptance missing")
    rows = evidence["steps"]
    require([r["step"] for r in rows] == JOURNEY, "Incomplete or out-of-order journey")
    require(all(r["status"] == "pass" and r["evidence"] and r["observed_at"] for r in rows), "Unverified journey step")
    times = [datetime.fromisoformat(r["observed_at"].replace("Z", "+00:00")) for r in rows]
    require(times == sorted(times), "Journey timestamps are out of order")
    hashes = rows[0]["new_content_hashes"]
    require(isinstance(hashes, list) and hashes and len(set(hashes)) == len(hashes) and
            all(re.fullmatch(r"[0-9a-f]{64}", h) for h in hashes) and not rows[0].get("reused_draft"),
            "Fresh input hashes missing/duplicated or historical draft reused")
    soul = rows[3]["soul_id"]
    require(re.fullmatch(r"0x[0-9a-f]{64}", soul) is not None, "Exact Soul ID missing")
    require(all(r["soul_id"] == soul for r in rows[3:]), "Different Souls across Complete/receive/refresh")
    require(all(r["owner"] == rows[3]["owner"] and r["content_hash"] == rows[3]["content_hash"]
                for r in rows[3:]), "Owner/content drift")
    require(rows[3]["owner"] and re.fullmatch(r"[0-9a-f]{64}", rows[3]["content_hash"]), "Missing owner/content identity")
    for site in REPOS:
        require(evidence["deployments"][site]["source_commit"] == item["pair"][site]["commit"] and
                evidence["deployments"][site]["id"] and evidence["deployments"][site]["readback"],
                "Deployment acceptance identity missing")
    require(evidence["recovery"]["same_operation"] and evidence["recovery"]["duplicate_charges"] == 0 and
            evidence["recovery"]["duplicate_mints"] == 0 and evidence["recovery"]["evidence"], "Recovery acceptance missing")
    interaction = evidence["interaction"]
    budget = item["acceptance"].get("interaction_budget", {})
    require(type(budget.get("signature_count")) is int and budget["signature_count"] >= 0 and
            budget.get("plan_evidence"), "A reviewed feasible transaction plan is required before acceptance")
    require(all(type(interaction[k]) is int and interaction[k] >= 0
                for k in ("signature_count", "reviewed_signature_budget", "redundant_continue_clicks")),
            "Invalid interaction counters")
    require(interaction["redundant_continue_clicks"] == 0 and
            interaction["reviewed_signature_budget"] == budget["signature_count"] and
            interaction["signature_count"] <= budget["signature_count"] and
            interaction["plan_evidence"] == budget["plan_evidence"], "Interaction budget violated")


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("action", choices=["code", "release", "close", "browser", "authorize"])
    p.add_argument("--item", type=Path, required=True)
    p.add_argument("--changed", nargs="*")
    p.add_argument("--evidence", type=Path)
    p.add_argument("--operation")
    p.add_argument("--target")
    args = p.parse_args()
    item = json.loads(args.item.read_text())
    check_item(item)
    if args.action == "code":
        check_changed(item, args.changed)
    elif args.action == "authorize":
        print(json.dumps(check_authorization(item, args.operation, args.target)))
    elif args.action == "release":
        for site in REPOS:
            live_ci(item, site)
    else:
        require(args.evidence, "Observed evidence file required")
        evidence = json.loads(args.evidence.read_text())
        if args.action == "browser":
            check_browser(item, evidence)
        else:
            check_journey(item, evidence)
    print(json.dumps({"gate": args.action, "status": "pass", "dev_id": item["dev_id"],
                      "item_sha256": hashlib.sha256(args.item.read_bytes()).hexdigest()}))


if __name__ == "__main__":
    try:
        main()
    except (ValueError, KeyError, TypeError, OSError, subprocess.CalledProcessError) as error:
        print(f"BLOCKED: {error}", file=sys.stderr)
        sys.exit(1)
