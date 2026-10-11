#!/usr/bin/env python3
"""Validate saved management contracts and actual Slack readback evidence.

Read-only: never contacts services, creates tasks, or changes product files.
"""
import csv
import io
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
BASE = ROOT / "agent-management"


def read_json(path):
    return json.loads(path.read_text())


def require(condition, message):
    if not condition:
        raise ValueError(message)


def main():
    workspace = read_json(BASE / "workspace.json")
    agents = read_json(BASE / "agent-registry.json")["agents"]
    creators = read_json(BASE / "creator-registry.json")["creators"]
    require(len(agents) == 9, "Expected nine internal role contracts")
    require(len(creators) == 3, "Expected three creator profiles")
    identities = [x["id"] for x in agents + creators]
    require(len(set(identities)) == len(identities), "Duplicate Agent IDs")
    for record in agents + creators:
        require((BASE / record["contract"]).is_file(), f"Missing contract: {record['id']}")
        require(record["slack_user_id"] is None and record["soul_id"] is None,
                "Account or Soul assignment requires new verification logic/evidence")
    require(all(not x["product_creation_completed"] for x in creators),
            "Two-round product creation has no acceptance evidence in this bootstrap")

    expected_milestones = {f"ECO-{i}" for i in range(7)} | {f"AC-SO-M{i}" for i in range(1, 5)}
    prefix = BASE / "evidence"
    milestone_data = read_json(prefix / "2026-10-03-milestones-readback.json")
    task_data = read_json(prefix / "2026-10-03-delivery-readback.json")
    require(not milestone_data.get("next_cursor"), "Incomplete milestone readback")
    require(not task_data.get("next_cursor"), "Incomplete task readback")
    milestones = list(csv.DictReader(io.StringIO(milestone_data["result"])))
    tasks = list(csv.DictReader(io.StringIO(task_data["result"])))
    require({x["ID"] for x in milestones} == expected_milestones, "Milestone namespace mismatch")
    require(len(milestones) == len(expected_milestones), "Duplicate milestone rows")
    task_ids = {x["ID"] for x in tasks}
    require(len(task_ids) == len(tasks) == len(workspace["task_records"]), "Duplicate or missing task rows")
    records = {x["id"]: x["record_id"] for x in workspace["task_records"]}
    valid_status = {"Backlog", "Ready", "In progress", "Review", "Blocked", "Done"}
    for row in tasks:
        ident = row["ID"]
        require(row["Record ID"] == records[ident], f"Slack record mapping mismatch: {ident}")
        require(row["Status"] in valid_status, f"Bad status: {ident}")
        require(row["Milestone"] in expected_milestones, f"Bad milestone: {ident}")
        for field in ["Owner Agent", "Accountable", "Reviewer", "Acceptance"]:
            require(bool(row[field].strip()), f"Missing {field}: {ident}")
        if row["Status"] in {"Review", "Done"}:
            require(bool(row["Evidence"].strip()), f"Missing evidence: {ident}")
        if row["Status"] == "Done":
            require("SENTINEL" in row["Evidence"], f"Missing independent acceptance: {ident}")
        for dep in re.findall(r"(?:PLAN|TRACK|PROD|PILOT|OPS|QA)-\d+[AB]?", row["Dependencies"]):
            require(dep in task_ids, f"Unknown dependency {dep}: {ident}")
    require(next(x for x in milestones if x["ID"] == "ECO-0")["Status"] == "Active",
            "This bootstrap must not close the full ECO-0 milestone")
    require(all(x["Status"] != "Verified" for x in milestones if x["ID"].startswith("AC-SO-")),
            "Original product milestones remain incomplete")

    docs = [BASE / x for x in ["README.md", "OPERATING_MODEL.md", "EXECUTION_POLICY.md",
                               "milestones.md", "LIVE_PRODUCT_STATE.md", "labs/README.md",
                               "foundation/README.md", "foundation/head.md", "shared/context-sync.md"]]
    docs += list((BASE / "roles").glob("*.md")) + list((BASE / "creators").glob("*.md"))
    docs += list((BASE / "labs/ai-roles").glob("*.md")) + list((BASE / "foundation/ai-roles").glob("*.md"))
    links = 0
    for path in docs:
        text = path.read_text()
        require(all(line == line.rstrip() for line in text.splitlines()), f"Trailing space: {path}")
        for target in re.findall(r"\]\(([^)]+)\)", text):
            if "://" not in target and not target.startswith("#"):
                require((path.parent / target.split("#")[0]).exists(), f"Broken link: {path}: {target}")
                links += 1
    hub = read_json(prefix / "2026-10-03-hub-readback.json")["markdown_content"]
    require(workspace["milestones"]["url"] in hub and workspace["delivery"]["url"] in hub,
            "Hub is missing board links")
    require("ECO-0" in hub and "AC-SO-M1" in hub, "Hub loses original product roadmap mapping")
    print(f"PASS: {len(milestones)} milestones, {len(tasks)} tasks, 9 roles, 3 creator profiles, {links} local links")


if __name__ == "__main__":
    main()
