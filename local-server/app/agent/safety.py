import logging
from typing import Tuple, Dict, Any

logger = logging.getLogger("AgentSafetyGate")

HIGH_RISK_KEYWORDS = {
    "submit", "pay", "deposit", "transfer", "confirm", "buy", "checkout",
    "password", "delete", "remove", "withdraw", "send money", "place order"
}

HIGH_RISK_URL_PATTERNS = {
    "bank", "banking", "checkout", "payment", "cart/checkout", "pay", "transfer"
}

def evaluate_action_risk(action_type: str, label: str, value: str, url: str, dom_node: Dict[str, Any] = None) -> Tuple[str, bool, str]:
    """
    Evaluates action risk level and returns:
    (risk_level, requires_hitl, reasoning)
    """
    label_lower = (label or "").lower()
    value_lower = (value or "").lower()
    url_lower = (url or "").lower()
    node_text = ((dom_node or {}).get("text") or "").lower()
    node_type = ((dom_node or {}).get("type") or "").lower()

    combined_text = f"{label_lower} {value_lower} {node_text}"

    is_high_risk_keyword = any(kw in combined_text for kw in HIGH_RISK_KEYWORDS)
    is_password_field = node_type == "password" or "password" in combined_text
    is_sensitive_url = any(pattern in url_lower for pattern in HIGH_RISK_URL_PATTERNS)

    # --- New action types: always low risk ---
    if action_type in ("SELECT", "WAIT", "DISMISS_MODAL", "TYPE_AND_SELECT"):
        return (
            "low",
            False,
            f"Safe {action_type} action — no sensitive data interaction."
        )

    # CLICK_COORDINATE: medium by default, high on sensitive URLs
    if action_type == "CLICK_COORDINATE":
        if is_sensitive_url:
            return (
                "high",
                True,
                "Coordinate-based click on a banking/payment page requires explicit user confirmation."
            )
        return (
            "medium",
            False,
            "Coordinate-based click on a non-sensitive page. Monitoring for safety."
        )

    # --- Existing risk evaluations ---
    if action_type == "CLICK" and (is_high_risk_keyword or is_password_field):
        return (
            "high",
            True,
            f"Action '{label or 'Click'}' triggers sensitive operation (Payment / Account / Financial Transfer). Explicit user confirmation required."
        )

    if action_type == "LOCAL_AUTOFILL" and (is_sensitive_url or "card" in combined_text or "cvv" in combined_text):
        return (
            "high",
            True,
            "Autofilling credentials/card info on sensitive page requires user approval."
        )

    if action_type == "TYPE" and (is_password_field or "pin" in combined_text):
        return (
            "high",
            True,
            "Entering security PIN/password requires user verification."
        )

    if action_type in ("CLICK", "TYPE") and is_sensitive_url:
        return (
            "medium",
            False,
            "Executing action on banking/checkout page under observation."
        )

    return (
        "low",
        False,
        "Safe navigation & element interaction."
    )
