import re
from typing import Any
import logging

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("PrivacyFirewall")

EMAIL_RE = re.compile(r'\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b', re.I)
PHONE_RE = re.compile(r'\b(?:\+?91[-\s]?)?[6-9]\d{9}\b')
PAN_RE = re.compile(r'\b[A-Z]{5}\d{4}[A-Z]\b', re.I)
AADHAAR_RE = re.compile(r'\b\d{4}[\s-]?\d{4}[\s-]?\d{4}\b')
CARD_RE = re.compile(r'\b(?:\d[ -]*?){13,19}\b')

def sanitize_text(text: str) -> str:
    if not text or not isinstance(text, str):
        return text
    sanitized = text
    sanitized = EMAIL_RE.sub('[EMAIL]', sanitized)
    sanitized = PHONE_RE.sub('[PHONE]', sanitized)
    sanitized = PAN_RE.sub('[PAN]', sanitized)
    sanitized = AADHAAR_RE.sub('[AADHAAR]', sanitized)
    sanitized = CARD_RE.sub('[CARD]', sanitized)
    return sanitized

def contains_raw_pii(text: str) -> bool:
    if not text or not isinstance(text, str):
        return False
    return any([
        EMAIL_RE.search(text),
        PHONE_RE.search(text),
        PAN_RE.search(text),
        AADHAAR_RE.search(text),
        CARD_RE.search(text)
    ])

SENSITIVE_KEY_RE = re.compile(r'password|passcode|otp|secret|token', re.I)

def contains_unsafe_payload(value: Any, key: str = '') -> bool:
    """Reject raw PII anywhere in a nested planner payload.

    Sanitized placeholders (for example ``[PASSWORD]``) are permitted for
    audit/counting; real values under sensitive keys are not.
    """
    if isinstance(value, dict):
        return any(contains_unsafe_payload(item, str(name)) for name, item in value.items())
    if isinstance(value, list):
        return any(contains_unsafe_payload(item, key) for item in value)
    if isinstance(value, str):
        if contains_raw_pii(value):
            return True
        if SENSITIVE_KEY_RE.search(key) and not re.fullmatch(r'\[[A-Z_]+\]', value):
            return True
    return False

def log_safe_audit(event_type: str, details: dict):
    # Log audit events WITHOUT recording any actual PII values
    safe_details = {k: v for k, v in details.items() if 'raw' not in k.lower() and 'value' not in k.lower()}
    logger.info(f"AUDIT_EVENT: {event_type} | {safe_details}")
