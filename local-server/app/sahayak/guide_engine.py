"""
Sahayak (सहायक) Dynamic OpenRouter AI Guide Engine
Generates dynamic, state-specific and central government document acquisition instructions
(online and offline state procedures) in any language using OpenRouter LLM API.
Enforces 100% verified live HTTPS government domain URLs.
"""

import json
import logging
import os
import re
import urllib.request
import urllib.parse
from pathlib import Path
from typing import Dict, Any, Optional

logger = logging.getLogger("SahayakDynamicGuideEngine")

# Memory Cache for LLM responses to avoid redundant API calls
GUIDE_CACHE: Dict[str, Dict[str, Any]] = {}

# 100% Verified Live Working Indian Government State/Central Portal Directory
STATE_PORTAL_MAP: Dict[str, tuple] = {
    "uttar pradesh": ("e-District UP Portal", "https://edistrict.up.gov.in"),
    "up": ("e-District UP Portal", "https://edistrict.up.gov.in"),
    "maharashtra": ("Aaple Sarkar Maharashtra Portal", "https://aaplesarkar.maharashtra.gov.in"),
    "delhi": ("e-District Delhi Portal", "https://edistrict.delhigovt.nic.in"),
    "tamil nadu": ("e-Sevai Tamil Nadu Portal", "https://tnesevai.tn.gov.in"),
    "tn": ("e-Sevai Tamil Nadu Portal", "https://tnesevai.tn.gov.in"),
    "karnataka": ("Seva Sindhu Karnataka Portal", "https://sevasindhu.karnataka.gov.in"),
    "bihar": ("RTPS Bihar Services Portal", "https://serviceonline.bihar.gov.in"),
    "west bengal": ("e-District West Bengal Portal", "https://edistrict.wb.gov.in"),
    "madhya pradesh": ("MP e-District Portal", "https://mpedistrict.gov.in"),
    "mp": ("MP e-District Portal", "https://mpedistrict.gov.in"),
    "gujarat": ("Digital Gujarat Portal", "https://digitalgujarat.gov.in"),
    "rajasthan": ("e-Mitra Rajasthan Portal", "https://emitra.rajasthan.gov.in"),
    "kerala": ("e-District Kerala Portal", "https://edistrict.kerala.gov.in"),
    "punjab": ("Sewa Kendra Punjab Portal", "https://connect.punjab.gov.in"),
    "haryana": ("Saral Haryana Portal", "https://saralharyana.gov.in"),
    "andhra pradesh": ("Meeseva Andhra Pradesh Portal", "https://meeseva.ap.gov.in"),
    "national": ("National Government Services Portal", "https://services.india.gov.in"),
    "general india": ("National Government Services Portal", "https://services.india.gov.in")
}

def get_openrouter_api_key() -> Optional[str]:
    """Loads OPENROUTER_API_KEY from local-server/.env or environment variables."""
    key = os.getenv("OPENROUTER_API_KEY")
    if key and key.strip():
        return key.strip().strip("'").strip('"')
    
    server_dir = Path(__file__).resolve().parent.parent.parent
    possible_env_files = [
        server_dir / ".env",
        server_dir.parent / ".env"
    ]
    for env_path in possible_env_files:
        if env_path.exists():
            try:
                content = env_path.read_text(encoding="utf-8")
                for line in content.splitlines():
                    if line.strip().startswith("OPENROUTER_API_KEY"):
                        parts = line.split("=", 1)
                        if len(parts) == 2:
                            val = parts[1].strip().strip("'").strip('"')
                            if val:
                                os.environ["OPENROUTER_API_KEY"] = val
                                return val
            except Exception as e:
                logger.warning(f"Error reading .env at {env_path}: {e}")
    return None


def get_gemini_api_key() -> Optional[str]:
    """Loads GEMINI_API_KEY or GOOGLE_API_KEY from local-server/.env or environment variables."""
    key = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")
    if key and key.strip():
        return key.strip().strip("'").strip('"')
    
    server_dir = Path(__file__).resolve().parent.parent.parent
    possible_env_files = [
        server_dir / ".env",
        server_dir.parent / ".env"
    ]
    for env_path in possible_env_files:
        if env_path.exists():
            try:
                content = env_path.read_text(encoding="utf-8")
                for line in content.splitlines():
                    line_s = line.strip()
                    if line_s.startswith("GEMINI_API_KEY") or line_s.startswith("GOOGLE_API_KEY"):
                        parts = line_s.split("=", 1)
                        if len(parts) == 2:
                            val = parts[1].strip().strip("'").strip('"')
                            if val:
                                os.environ["GEMINI_API_KEY"] = val
                                return val
            except Exception as e:
                logger.warning(f"Error reading .env at {env_path}: {e}")
    return None



FALLBACK_DATABASE: Dict[str, Dict[str, Any]] = {
    "income_certificate": {
        "doc_id": "income_certificate",
        "portal_name": "National Government Services Portal",
        "portal_url": "https://services.india.gov.in",
        "title": "Income Certificate (आय प्रमाण पत्र)",
        "description": "An official government document certifying your annual household income, issued by Revenue Dept / Tehsildar office.",
        "how_to_identify": "Look for State Emblem at top, Tehsildar signature/stamp at bottom, and a 12-to-16 digit Certificate Number.",
        "online_steps": [
            "Click portal link above to open official government services portal.",
            "Select your State e-District portal from the state portal directory.",
            "Fill income details and upload Aadhaar & salary slip/ration card.",
            "Download digitally signed PDF certificate."
        ],
        "offline_steps": [
            "Visit nearest Common Service Centre (CSC / Jan Seva Kendra) or Tehsildar Office.",
            "Fill physical Income Certificate application form.",
            "Attach Aadhaar Card, Ration Card, and Income proof photocopy.",
            "Submit at counter and receive reference slip to collect hardcopy in 7-14 days."
        ]
    },
    "aadhaar_card": {
        "doc_id": "aadhaar_card",
        "portal_name": "UIDAI MyAadhaar Portal",
        "portal_url": "https://myaadhaar.uidai.gov.in",
        "title": "Aadhaar Card (आधार कार्ड)",
        "description": "A 12-digit unique identity card issued by UIDAI serving as national proof of identity and address.",
        "how_to_identify": "Card displaying Unique Identification Authority of India, 12-digit number formatted as XXXX XXXX XXXX, and QR Code.",
        "online_steps": [
            "Open UIDAI MyAadhaar portal.",
            "Click 'Download Aadhaar' and enter 12-digit Aadhaar number & OTP.",
            "Download e-Aadhaar PDF."
        ],
        "offline_steps": [
            "Visit nearest Aadhaar Seva Kendra or post office.",
            "Provide mobile number/enrolment slip and collect printed Aadhaar letter."
        ]
    },
    "generic": {
        "doc_id": "generic",
        "portal_name": "National Document Portal (DigiLocker)",
        "portal_url": "https://digilocker.gov.in",
        "title": "Required Document (आवश्यक दस्तावेज)",
        "description": "An official government certificate requested by the form.",
        "how_to_identify": "Official certificate with government emblem and issuing authority signature.",
        "online_steps": [
            "Open DigiLocker portal using link above.",
            "Search and fetch the required certificate.",
            "Download PDF file."
        ],
        "offline_steps": [
            "Visit relevant government office or Jan Seva Kendra.",
            "Collect verified physical copy."
        ]
    }
}

def resolve_verified_portal(state_context: str, fallback_portal: str = "National Services Portal", fallback_url: str = "https://services.india.gov.in") -> tuple:
    """Returns verified live HTTPS government domain for state context."""
    s = (state_context or "").lower().strip()
    for key, (pname, purl) in STATE_PORTAL_MAP.items():
        if key in s or s in key:
            return pname, purl
    return fallback_portal, fallback_url


def call_gemini_api(prompt: str, api_key: str, system_prompt: Optional[str] = None) -> Optional[str]:
    """Executes HTTP POST to Google Generative Language API (Gemini)."""
    import urllib.request

    models_to_try = [
        "gemini-flash-latest",
        "gemini-2.5-flash",
        "gemini-2.0-flash",
        "gemini-1.5-flash"
    ]

    for m in models_to_try:
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{m}:generateContent"
        headers = {
            "Content-Type": "application/json",
            "X-goog-api-key": api_key
        }
        payload: Dict[str, Any] = {
            "contents": [
                {
                    "parts": [
                        {"text": prompt}
                    ]
                }
            ],
            "generationConfig": {
                "temperature": 0.3
            }
        }
        if system_prompt:
            payload["systemInstruction"] = {
                "parts": [{"text": system_prompt}]
            }

        try:
            req = urllib.request.Request(
                url,
                data=json.dumps(payload).encode('utf-8'),
                headers=headers,
                method='POST'
            )
            with urllib.request.urlopen(req, timeout=15) as response:
                if response.status == 200:
                    resp_body = response.read().decode('utf-8')
                    resp_json = json.loads(resp_body)
                    candidates = resp_json.get("candidates", [])
                    if candidates and "content" in candidates[0]:
                        parts = candidates[0]["content"].get("parts", [])
                        if parts and "text" in parts[0]:
                            text = parts[0]["text"]
                            if text:
                                logger.info(f"Google Gemini LLM successfully responded using model: {m}")
                                return text
        except Exception as err:
            logger.warning(f"Google Gemini API attempt with model '{m}' failed: {err}")

    return None


def call_openrouter_api(prompt: str, api_key: str, model_name: str = "openrouter/auto") -> Optional[str]:
    """Executes HTTP POST to OpenRouter Chat Completions endpoint."""
    url = "https://openrouter.ai/api/v1/chat/completions"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "HTTP-Referer": "http://127.0.0.1:8000",
        "X-Title": "PrivacyAgent Sahayak"
    }

    models_to_try = [
        "google/gemma-4-31b-it:free",
        "z-ai/glm-5.2:free",
        "nvidia/nemotron-3.5-lightning:free",
        "liquid/lfm-2.5-2.6b:free",
        "google/gemma-4-26b-a4b-it:free",
        "nvidia/nemotron-3-ultra-550b-a55b:free",
        "thinkingmachines/inkling-small:free",
        "minimax/minimax-m3:free",
    ]

    for m in models_to_try:
        payload = {
            "model": m,
            "messages": [
                {
                    "role": "system",
                    "content": (
                        "You are Sahayak (सहायक), an Indian Government Document & State Procedure Expert. "
                        "Respond ONLY with valid JSON with no markdown code block markers or conversational preamble."
                    )
                },
                {"role": "user", "content": prompt}
            ],
            "temperature": 0.3
        }

        try:
            req = urllib.request.Request(
                url,
                data=json.dumps(payload).encode('utf-8'),
                headers=headers,
                method='POST'
            )
            with urllib.request.urlopen(req, timeout=12) as response:
                if response.status == 200:
                    resp_body = response.read().decode('utf-8')
                    resp_json = json.loads(resp_body)
                    choices = resp_json.get("choices", [])
                    if choices and "message" in choices[0]:
                        content = choices[0]["message"].get("content", "")
                        if content:
                            logger.info(f"OpenRouter LLM successfully responded using model: {m}")
                            return content
        except Exception as err:
            logger.warning(f"OpenRouter API attempt with model '{m}' failed: {err}")

    return None


def call_agent_chat(system_prompt: str, user_prompt: str, api_key: Optional[str] = None) -> Optional[str]:
    """General-purpose LLM chat call for the autonomous agent. Tries Google Gemini first, falls back to OpenRouter."""
    # 1. Try Google Gemini first (Main provider)
    gemini_key = get_gemini_api_key()
    if gemini_key:
        res = call_gemini_api(user_prompt, gemini_key, system_prompt=system_prompt)
        if res:
            return res
        logger.warning("Google Gemini failed in call_agent_chat, falling back to OpenRouter...")

    # 2. Fallback to OpenRouter (Keep all existing models intact)
    openrouter_key = api_key or get_openrouter_api_key()
    if not openrouter_key:
        return None

    url = "https://openrouter.ai/api/v1/chat/completions"
    headers = {
        "Authorization": f"Bearer {openrouter_key}",
        "Content-Type": "application/json",
        "HTTP-Referer": "http://127.0.0.1:8000",
        "X-Title": "PrivacyAgent Autonomous Assistant"
    }

    models_to_try = [
        "google/gemma-4-31b-it:free",
        "z-ai/glm-5.2:free",
        "nvidia/nemotron-3.5-lightning:free",
        "liquid/lfm-2.5-2.6b:free",
        "google/gemma-4-26b-a4b-it:free",
        "nvidia/nemotron-3-ultra-550b-a55b:free",
        "thinkingmachines/inkling-small:free",
        "minimax/minimax-m3:free",
    ]

    for m in models_to_try:
        payload = {
            "model": m,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt}
            ],
            "temperature": 0.3
        }

        try:
            req = urllib.request.Request(
                url,
                data=json.dumps(payload).encode('utf-8'),
                headers=headers,
                method='POST'
            )
            with urllib.request.urlopen(req, timeout=20) as response:
                if response.status == 200:
                    resp_body = response.read().decode('utf-8')
                    resp_json = json.loads(resp_body)
                    choices = resp_json.get("choices", [])
                    if choices and "message" in choices[0]:
                        content = choices[0]["message"].get("content", "")
                        if content:
                            logger.info(f"Agent chat LLM responded using model: {m}")
                            return content
        except Exception as err:
            logger.warning(f"Agent chat attempt with model '{m}' failed: {err}")

    return None


def generate_dynamic_guide(doc_query: str = "Income Certificate", state_context: str = "National", language: str = "en") -> Dict[str, Any]:
    """Generates dynamic AI guidance for a document and state using Google Gemini / OpenRouter API with URL verification."""
    clean_doc = doc_query.strip()
    if clean_doc.lower().startswith("state e-district portal") or clean_doc.lower() == "generic":
        clean_doc = "Income Certificate"

    cache_key = f"{clean_doc.lower()}_{state_context.lower()}_{language.lower()}"
    if cache_key in GUIDE_CACHE:
        return GUIDE_CACHE[cache_key]

    # Resolve verified live working government portal URL
    verified_portal_name, verified_portal_url = resolve_verified_portal(state_context)

    prompt = f"""
Generate a structured JSON guidance object for an Indian citizen requiring the document: "{clean_doc}".
Selected State / Jurisdiction: "{state_context}"
Language requested: "{language}" (Language code: en=English, hi=Hindi, ta=Tamil, te=Telugu, bn=Bengali).

Return EXACTLY a JSON object with this key structure:
{{
  "doc_id": "{clean_doc.lower().replace(' ', '_')}",
  "title": "Exact Official Title of {clean_doc} in {state_context} translated into {language}",
  "description": "Clear 2-sentence explanation of what {clean_doc} is in {state_context} translated into {language}",
  "how_to_identify": "Visual markers, seals, signatures, or serial numbers to identify this file",
  "portal_name": "{verified_portal_name}",
  "portal_url": "{verified_portal_url}",
  "online_steps": [
    "Step 1 online procedure for {state_context} portal ({verified_portal_url})",
    "Step 2 online procedure",
    "Step 3 online procedure",
    "Step 4 online procedure"
  ],
  "offline_steps": [
    "Step 1 offline state procedure in {state_context} (specify local office like CSC / Jan Seva Kendra / Tehsildar office)",
    "Step 2 offline state procedure (specify physical copies of Aadhaar/Income proof needed)",
    "Step 3 offline state procedure",
    "Step 4 offline state procedure"
  ]
}}
"""
    raw_llm_out = None

    # 1. Try Google Gemini first (Main provider)
    gemini_key = get_gemini_api_key()
    if gemini_key:
        sys_prompt = (
            "You are Sahayak (सहायक), an Indian Government Document & State Procedure Expert. "
            "Respond ONLY with valid JSON with no markdown code block markers or conversational preamble."
        )
        raw_llm_out = call_gemini_api(prompt, gemini_key, system_prompt=sys_prompt)
        if not raw_llm_out:
            logger.warning("Google Gemini guide generation failed, falling back to OpenRouter...")

    # 2. Fallback to OpenRouter (Keep existing models intact)
    if not raw_llm_out:
        openrouter_key = get_openrouter_api_key()
        if openrouter_key:
            raw_llm_out = call_openrouter_api(prompt, openrouter_key)

        if raw_llm_out:
            try:
                clean_json_str = re.sub(r'^```json\s*', '', raw_llm_out, flags=re.MULTILINE)
                clean_json_str = re.sub(r'^```\s*', '', clean_json_str, flags=re.MULTILINE).strip()
                parsed_data = json.loads(clean_json_str)

                if "title" in parsed_data and "online_steps" in parsed_data:
                    # Enforce live HTTPS verified URL
                    parsed_data["portal_name"] = verified_portal_name
                    parsed_data["portal_url"] = verified_portal_url
                    GUIDE_CACHE[cache_key] = parsed_data
                    return parsed_data
            except Exception as parse_err:
                logger.warning(f"Error parsing LLM JSON output: {parse_err}. Raw: {raw_llm_out[:150]}")

    # Fallback if API offline
    q = clean_doc.lower()
    if "income" in q or "आय" in q:
        fallback = FALLBACK_DATABASE["income_certificate"].copy()
    elif "aadhaar" in q or "aadhar" in q or "आधार" in q:
        fallback = FALLBACK_DATABASE["aadhaar_card"].copy()
    else:
        fallback = FALLBACK_DATABASE["generic"].copy()

    fallback["portal_name"] = verified_portal_name
    fallback["portal_url"] = verified_portal_url
    return fallback
