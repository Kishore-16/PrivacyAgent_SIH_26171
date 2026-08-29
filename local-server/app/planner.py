import logging

logger = logging.getLogger("LocalPlanner")

ALLOWED_ACTIONS = {"CLICK", "SCROLL", "HIGHLIGHT", "TYPE"}
DISALLOWED_ACTIONS = {"EXECUTE_JAVASCRIPT", "RUN_COMMAND", "NAVIGATE_ANYWHERE", "DOWNLOAD_FILE"}

HIGH_RISK_KEYWORDS = {"submit", "confirm", "pay", "delete", "remove", "checkout", "transfer", "password", "send"}

def plan_action(context: dict) -> dict:
    controls = context.get('controls', [])
    scan_info = context.get('scan', {})
    findings = scan_info.get('findings', [])

    # Server never receives raw PII. Verify context contains no raw values.
    raw_pii_count = 0
    for f in findings:
        val = f.get('value', '')
        if val and not (val.startswith('[') and val.endswith(']')):
            raw_pii_count += 1

    # Find candidate completion control
    submit_control = None
    for ctrl in controls:
        text_lower = (ctrl.get('text') or '').lower()
        if any(kw in text_lower for kw in HIGH_RISK_KEYWORDS):
            submit_control = ctrl
            break

    if submit_control:
        planned = {
            "type": "CLICK",
            "selector": submit_control.get('selector'),
            "label": submit_control.get('text', 'Submit'),
            "risk": "high",
            "reason": "Control involves sensitive/completion operation. Explicit user confirmation is required before proceeding."
        }
    elif controls:
        target = controls[0]
        planned = {
            "type": "HIGHLIGHT",
            "selector": target.get('selector'),
            "label": target.get('text', 'Element'),
            "risk": "low",
            "reason": "Inspecting next safe control on sanitized page."
        }
    else:
        planned = {
            "type": "SCROLL",
            "direction": "down",
            "label": "Scroll Page",
            "risk": "low",
            "reason": "No interactive form controls remaining."
        }

    # Validate against allow-list
    if planned["type"] not in ALLOWED_ACTIONS or planned["type"] in DISALLOWED_ACTIONS:
        return {
            "ok": False,
            "error": "Planned action is not allow-listed",
            "action": None
        }

    return {
        "ok": True,
        "action": planned,
        "privacy_summary": {
            "pii_findings_detected": len(findings),
            "raw_pii_transmitted": raw_pii_count
        }
    }
