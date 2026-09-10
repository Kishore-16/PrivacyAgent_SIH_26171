"""
PrivacyAgent Eval Harness — Automated Scenario Testing
=======================================================
Tests the agent planner's decision-making against pre-captured DOM snapshots.
Validates that the LLM/fallback planner produces correct action sequences
for 5 diverse browsing scenarios.

Usage:
    python tests/eval_harness.py            # standalone
    python -m pytest tests/eval_harness.py  # via pytest
"""
import json
import sys
import time
import os
from pathlib import Path
from typing import List, Dict, Any, Optional

# Add project root to path
PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT / "local-server"))

from app.agent.schema import AgentStepRequest, AgentStepResponse
from app.agent.planner import plan_next_agent_step


# ---------------------------------------------------------------------------
# Load fixtures
# ---------------------------------------------------------------------------
FIXTURES_DIR = Path(__file__).resolve().parent / "eval_fixtures"
DOM_SNAPSHOTS = json.loads((FIXTURES_DIR / "dom_snapshots.json").read_text(encoding="utf-8"))


# ---------------------------------------------------------------------------
# Scenario definitions
# ---------------------------------------------------------------------------
class Scenario:
    def __init__(self, name: str, goal: str, fixture_key: str, max_steps: int,
                 checkpoints: List[Dict[str, Any]], description: str = ""):
        self.name = name
        self.goal = goal
        self.fixture_key = fixture_key
        self.max_steps = max_steps
        self.checkpoints = checkpoints
        self.description = description


SCENARIOS = [
    Scenario(
        name="Google Search",
        goal="Search for 'privacy agent SIH 2026'",
        fixture_key="google_search",
        max_steps=5,
        description="Agent should type a search query into Google and submit",
        checkpoints=[
            {"type": "action_type_in", "values": ["NAVIGATE", "TYPE", "TYPE_AND_ENTER"],
             "description": "Must navigate to Google or type in search box"}
        ]
    ),
    Scenario(
        name="Wikipedia Navigation",
        goal="Go to wikipedia and search for 'Alan Turing'",
        fixture_key="wikipedia_main",
        max_steps=8,
        description="Agent should navigate to Wikipedia and search for Alan Turing",
        checkpoints=[
            {"type": "action_type_in", "values": ["NAVIGATE", "TYPE", "TYPE_AND_ENTER"],
             "description": "Must navigate or type search query"}
        ]
    ),
    Scenario(
        name="PVR City Selection",
        goal="Go to pvr.com, set location to Pondicherry",
        fixture_key="pvr_home",
        max_steps=12,
        description="Agent should recognize the city dropdown and select Pondicherry",
        checkpoints=[
            {"type": "action_type_in", "values": ["SELECT", "CLICK", "TYPE"],
             "description": "Must interact with the city selector to choose Pondicherry"},
            {"type": "action_not_type", "value": "COMPLETE",
             "description": "Should NOT immediately complete — there's work to do"}
        ]
    ),
    Scenario(
        name="Contact Form Fill",
        goal="Fill the contact form with name John and email john@test.com, then submit",
        fixture_key="local_form",
        max_steps=10,
        description="Agent should type into name and email fields",
        checkpoints=[
            {"type": "action_type_in", "values": ["TYPE", "TYPE_AND_ENTER"],
             "description": "Must type into form fields"}
        ]
    ),
    Scenario(
        name="Modal Dismiss + Click",
        goal="Dismiss the cookie popup and click the Sign Up button",
        fixture_key="modal_test",
        max_steps=8,
        description="Agent should dismiss the cookie modal first, then click Sign Up",
        checkpoints=[
            {"type": "action_type_in", "values": ["DISMISS_MODAL", "CLICK"],
             "description": "Must dismiss modal or click an element"}
        ]
    ),
]


# ---------------------------------------------------------------------------
# Checkpoint evaluation
# ---------------------------------------------------------------------------
def evaluate_checkpoint(checkpoint: Dict, response: AgentStepResponse) -> bool:
    """Check if a step response satisfies a checkpoint condition."""
    cp_type = checkpoint["type"]
    action = response.action

    if cp_type == "action_type_in":
        return action.type in checkpoint["values"]

    if cp_type == "action_not_type":
        return action.type != checkpoint["value"]

    if cp_type == "action_has_value":
        return checkpoint["substring"].lower() in (action.value or "").lower()

    if cp_type == "action_has_url":
        return checkpoint["substring"].lower() in (action.url or "").lower()

    return False


# ---------------------------------------------------------------------------
# Run a single scenario
# ---------------------------------------------------------------------------
def run_scenario(scenario: Scenario) -> Dict[str, Any]:
    """Execute a scenario against the planner and return results."""
    fixture = DOM_SNAPSHOTS.get(scenario.fixture_key, {})
    nodes = fixture.get("nodes", [])
    url = fixture.get("url", "")
    title = fixture.get("title", "")
    page_alerts = fixture.get("page_alerts", [])

    start_time = time.time()
    actions_taken = []
    checkpoints_met = [False] * len(scenario.checkpoints)

    # Simulate up to max_steps
    for step in range(1, scenario.max_steps + 1):
        req = AgentStepRequest(
            task_id=f"eval-{scenario.name.lower().replace(' ', '-')}",
            goal=scenario.goal,
            step_number=step,
            dom_nodes=nodes,
            sanitized_findings=[],
            url=url,
            title=title,
            client_attested=True,
            page_alerts=page_alerts,
            visible_text="",
            last_action_result=None if step == 1 else "success",
            action_history=[]
        )

        try:
            response = plan_next_agent_step(req)
        except Exception as e:
            actions_taken.append(f"ERROR: {e}")
            break

        action_desc = f"{response.action.type}"
        if response.action.label:
            action_desc += f" ({response.action.label[:40]})"
        actions_taken.append(action_desc)

        # Evaluate checkpoints
        for i, cp in enumerate(scenario.checkpoints):
            if not checkpoints_met[i]:
                if evaluate_checkpoint(cp, response):
                    checkpoints_met[i] = True

        # Stop if agent says complete
        if response.completed or response.action.type == "COMPLETE":
            break

    elapsed = round(time.time() - start_time, 2)
    all_passed = all(checkpoints_met)

    return {
        "name": scenario.name,
        "passed": all_passed,
        "steps_used": len(actions_taken),
        "steps_budget": scenario.max_steps,
        "actions": actions_taken,
        "checkpoints_met": sum(checkpoints_met),
        "checkpoints_total": len(scenario.checkpoints),
        "time_seconds": elapsed,
        "checkpoint_details": [
            {"description": cp["description"], "met": checkpoints_met[i]}
            for i, cp in enumerate(scenario.checkpoints)
        ]
    }


# ---------------------------------------------------------------------------
# Main runner
# ---------------------------------------------------------------------------
def run_all_scenarios():
    """Run all evaluation scenarios and print results."""
    print("=" * 70)
    print("  PrivacyAgent Eval Harness — Automated Scenario Testing")
    print("=" * 70)
    print()

    results = []
    for scenario in SCENARIOS:
        print(f"  Running: {scenario.name} ...")
        result = run_scenario(scenario)
        results.append(result)
        status = "✅ PASS" if result["passed"] else "❌ FAIL"
        print(f"    {status} | Steps: {result['steps_used']}/{result['steps_budget']} | "
              f"Checkpoints: {result['checkpoints_met']}/{result['checkpoints_total']} | "
              f"Time: {result['time_seconds']}s")
        for cp in result["checkpoint_details"]:
            cp_icon = "  ✓" if cp["met"] else "  ✗"
            print(f"      {cp_icon} {cp['description']}")
        print(f"    Actions: {' → '.join(result['actions'][:8])}")
        print()

    # Summary table
    passed = sum(1 for r in results if r["passed"])
    total = len(results)
    print("-" * 70)
    print(f"  SUMMARY: {passed}/{total} scenarios passed")
    print("-" * 70)
    print()

    # Markdown output
    print("### Eval Results (Markdown)")
    print()
    print("| Scenario | Result | Steps | Checkpoints | Time |")
    print("|---|---|---|---|---|")
    for r in results:
        status = "✅ Pass" if r["passed"] else "❌ Fail"
        print(f"| {r['name']} | {status} | {r['steps_used']}/{r['steps_budget']} | "
              f"{r['checkpoints_met']}/{r['checkpoints_total']} | {r['time_seconds']}s |")
    print()

    return results


# ---------------------------------------------------------------------------
# Pytest integration
# ---------------------------------------------------------------------------
def test_google_search():
    result = run_scenario(SCENARIOS[0])
    assert result["passed"], f"Google Search failed: {result['actions']}"

def test_wikipedia_navigation():
    result = run_scenario(SCENARIOS[1])
    assert result["passed"], f"Wikipedia Navigation failed: {result['actions']}"

def test_pvr_city_selection():
    result = run_scenario(SCENARIOS[2])
    assert result["passed"], f"PVR City Selection failed: {result['actions']}"

def test_contact_form_fill():
    result = run_scenario(SCENARIOS[3])
    assert result["passed"], f"Contact Form Fill failed: {result['actions']}"

def test_modal_dismiss():
    result = run_scenario(SCENARIOS[4])
    assert result["passed"], f"Modal Dismiss failed: {result['actions']}"


if __name__ == "__main__":
    results = run_all_scenarios()
    # Exit with code 1 if any scenario failed
    sys.exit(0 if all(r["passed"] for r in results) else 1)
