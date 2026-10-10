#!/usr/bin/env python3
"""Restore the saved Actions configuration after an explicit owner request."""
import argparse
import base64
import hashlib
import json
from pathlib import Path
import subprocess

DIRECTORY = Path(__file__).resolve().parent
ROOT = DIRECTORY.parent.parent
STATE = json.loads((DIRECTORY / "original-state.json").read_text())
REPOSITORY = STATE["repository"]
RULESET_KEYS = ("name", "target", "enforcement", "bypass_actors", "conditions", "rules")


def api(route, method="GET", payload=None):
    command = ["gh", "api", f"repos/{REPOSITORY}/{route}", "--method", method]
    if payload is not None:
        command += ["--input", "-"]
    result = subprocess.run(command, input=json.dumps(payload) if payload is not None else None,
                            text=True, capture_output=True, check=True)
    return json.loads(result.stdout) if result.stdout.strip() else None


def digest(content):
    return hashlib.sha256(content).hexdigest()


def ruleset_payload(ruleset):
    return {key: ruleset[key] for key in RULESET_KEYS}


def restore_files():
    originals = {}
    for filename, saved in STATE["changedFiles"].items():
        original = (DIRECTORY / saved["snapshot"]).read_bytes()
        assert digest(original) == saved["originalSha256"], f"Corrupt snapshot: {filename}"
        assert digest((ROOT / filename).read_bytes()) in (digest(original), saved["restrictedSha256"]), \
            f"Changed since the restriction; review before restoring: {filename}"
        originals[filename] = original
    for filename, original in originals.items():
        (ROOT / filename).write_bytes(original)
    print("Restored all changed files byte for byte. Commit and merge before restore-github.")


def restore_github():
    # Check everything before enabling any expensive workflow. Files must already
    # be restored on main, and branch rules must not have drifted in the meantime.
    for filename, expected in STATE["workflowSha256"].items():
        file = api(f"contents/{filename}?ref=main")
        assert digest(base64.b64decode(file["content"])) == expected, \
            f"Original workflow not present on main: {filename}"
    for filename, saved in STATE["changedFiles"].items():
        file = api(f"contents/{filename}?ref=main")
        assert digest(base64.b64decode(file["content"])) == saved["originalSha256"], \
            f"Original file not present on main: {filename}"
    original_ruleset = next(rule for rule in STATE["rulesets"] if rule["id"] == 22341821)
    current = ruleset_payload(api("rulesets/22341821"))
    assert current in (STATE["pausedRulesetPayload"], ruleset_payload(original_ruleset)), \
        "Main ruleset changed since the restriction; review it before restoring."
    workflows = {item["id"]: item for item in api("actions/workflows")["workflows"]}
    for workflow in STATE["workflows"]:
        assert workflow["id"] in workflows, f"Missing workflow: {workflow['name']}"
        assert workflow["state"] in ("active", "disabled_manually"), \
            f"Unsupported original state: {workflow['state']}"
    for workflow in STATE["workflows"]:
        if workflows[workflow["id"]]["state"] != workflow["state"]:
            operation = "enable" if workflow["state"] == "active" else "disable"
            api(f"actions/workflows/{workflow['id']}/{operation}", "PUT")
    # Re-enable CLA before making its status obligatory again.
    api("rulesets/22341821", "PUT", ruleset_payload(original_ruleset))
    workflows = {item["id"]: item for item in api("actions/workflows")["workflows"]}
    assert all(workflows[item["id"]]["state"] == item["state"] for item in STATE["workflows"])
    assert ruleset_payload(api("rulesets/22341821")) == ruleset_payload(original_ruleset)
    print("Original workflow states and main ruleset restored and verified.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("operation", choices=("status", "restore-files", "restore-github"), default="status", nargs="?")
    operation = parser.parse_args().operation
    if operation == "restore-files":
        restore_files()
    elif operation == "restore-github":
        restore_github()
    else:
        for workflow in api("actions/workflows")["workflows"]:
            print(f"{workflow['state']}: {workflow['name']}")
