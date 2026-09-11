import logging
import json
import re
from urllib.parse import quote_plus
from typing import Dict, Any, List, Optional
from app.agent.schema import AgentStepRequest, AgentStepResponse, ActionModel
from app.agent.safety import evaluate_action_risk
from app.sahayak.guide_engine import call_agent_chat, get_openrouter_api_key, get_gemini_api_key
from app.agent.compressor import compress_agent_state

logger = logging.getLogger("AgentPlanner")

# ---------------------------------------------------------------------------
# LLM System Prompt — Full Observe-Plan-Act architecture
# ---------------------------------------------------------------------------
AGENT_SYSTEM_PROMPT = """\
You are PrivacyAgent Autonomous Assistant — a smart AI browser agent that operates
in a continuous Observe-Plan-Act loop.

## YOUR CAPABILITIES
You receive: the user's goal, current page URL, interactive DOM elements with
bounding-box coordinates, detected page alerts/modals/errors, a history of your
previous actions and their outcomes, and optionally a redacted screenshot.

## DECISION PROCESS
1. OBSERVE: Analyze the DOM elements + alerts + visible text to understand the current page state.
2. REFLECT: Review your action_history — what have you already done? Did your last
   action succeed or fail? If it failed (last_action_result = "no_change"), you MUST
   try a DIFFERENT approach (different element, different action type, scroll first, etc.)
3. PLAN: Determine the single best next action to advance toward the goal.

## MULTI-STEP WORKFLOW REASONING
- Break complex goals into ordered sub-tasks.
- Track which sub-tasks are complete based on the current URL and page state.
- If the page shows a form with required fields (dropdowns, inputs), fill them
  IN ORDER before clicking Submit/Book/Confirm.
- DO NOT click on navigation tabs or menus (e.g., "Bus Booking", "Home") if the required form fields (like Origin, Destination, Date) are already visible in the DOM. Start typing in them immediately!
- If a dropdown/select needs to be set, use the SELECT action with the option text as value.
- Compound Instructions: If the goal has multiple steps (e.g., "go to X, search Y, open Z"),
  look at the Current Page URL and action_history.
  - If you have already completed earlier steps, move on to the NEXT incomplete step.
  - If all steps of the goal are achieved, return intent "complete".

## ERROR & MODAL HANDLING
- If page_alerts contains active modals, popups, or error messages, ALWAYS handle them FIRST
  before attempting any other action.
- Use DISMISS_MODAL to close informational popups, cookie banners, "Please fill the form"
  errors, or any blocking overlay.
- After dismissing, re-assess the page state before continuing.

## AUTOCOMPLETE / CUSTOM DROPDOWN HANDLING
- City pickers, airport selectors, station selectors, and search-as-you-type inputs
  are NOT native <select> elements. Typing text alone does NOT select the value.
- For these fields, use the "type_and_select" intent. This will type the text,
  wait for the dropdown suggestions to appear, and click the matching option.
- Signs that a field is an autocomplete widget:
  - It's an <input> next to a [role="listbox"] or [role="combobox"]
  - The placeholder says "Search", "Select city", "Type to search", etc.
  - The page is a travel/booking site (bus, train, flight)
  - It has isAutocomplete=true in the DOM representation

## CANVAS/SVG/VISUAL ELEMENTS
- For elements that cannot be targeted by CSS selector (seat maps, canvas charts,
  SVG diagrams, color pickers), use CLICK_COORDINATE with viewport x,y coordinates.
- Estimate the coordinates from the bounding-box data of nearby labeled elements.
- Validate that coordinates are within the viewport (0 <= x <= viewportWidth, 0 <= y <= viewportHeight).

## AVAILABLE ACTION TYPES
- click: Click a DOM element by selector/agent-id
- click_coordinate: Click at viewport (x,y) for canvas/SVG/visual elements. If the provided DOM nodes are missing elements (like seat maps) or previous DOM clicks failed, YOU MUST visually analyze the provided screenshot and output this intent with the exact x and y coordinates.
- type: Type text into an input field (no Enter key)
- type_and_enter: Type text and press Enter to submit
- type_and_select: Type text, wait for autocomplete suggestions, and click the matching option
- select: Choose an option in a <select> dropdown by option text
- scroll: Scroll the page up or down
- navigate: Go to a specific URL
- search: Build a Google search URL
- wait: Wait for the page to finish loading/updating
- dismiss_modal: Close the currently active modal/popup/error dialog
- sahayak_trigger: Activate Sahayak Multilingual Assistant when encountering an <input type="file"> or missing document requirement. Browser security prevents automated text entry into file fields, so use this action to prompt the user.
- local_autofill: Fill a form field from the user's saved profile
- chat: Answer a conversational question (no browser action needed)
- wait_for_user: Pauses the automation to let the human user perform the next step manually (e.g. solving a captcha, picking an unselectable element).
- complete: The task is finished

## RESPONSE SCHEMA
Return EXACTLY this JSON structure (no markdown, no explanation outside JSON):
{
  "intent": "<one of the action types above>",
  "thought": "<your step-by-step reasoning about what you observe and why you chose this action>",
  "plan_sequence": "<1. Step 1, 2. Step 2, 3. Step 3> (Be specific about the overarching plan and what step you are currently on)",
  "url": "<full URL, only for navigate/search intent>",
  "target_selector": "<CSS selector or data-agent-id of the element>",
  "target_label": "<human-readable label of the element>",
  "type_value": "<text to type or option to select>",
  "x": null,
  "y": null,
  "chat_answer": "<your answer, only for chat intent>",
  "risk": "<low|medium|high>",
  "reason": "<safety reasoning>"
}

## CRITICAL RULES
- For "navigate": Extract just the website URL. "go to flipkart" → url: "https://www.flipkart.com".
  Do NOT put the entire sentence as the URL.
- For "search": Build a Google search URL from the query.
- For "chat": Provide a helpful answer in chat_answer. Do NOT try to navigate or click.
- For "click"/"type"/"select": Use ONLY selectors from the provided DOM nodes. NEVER fabricate selectors.
- If DOM nodes have text like [NAME], [EMAIL], [PASSWORD] — these are REDACTED sensitive fields.
  Do NOT click or interact with them.
- If you are completely stuck and cannot advance automatically, return intent "wait_for_user" with a thought explaining what the user needs to do manually.
- CRITICAL: Review your action_history. If you have already completed a step (e.g., searching for a movie), DO NOT repeat it. Move to the next logical step. NEVER repeat the exact same action.
- If you are stuck in a loop and cannot advance even with manual intervention, return intent "complete" with thought "Task stuck, stopping."
"""


def _summarize_dom_nodes(nodes: List[Dict[str, Any]], max_nodes: int = 40) -> str:
    """Create a concise text summary of DOM nodes for the LLM prompt."""
    if not nodes:
        return "No interactive elements found on this page."

    useful = []
    for n in nodes:
        if not isinstance(n, dict):
            continue
        text = (n.get("text") or "").strip()
        tag = n.get("tag", "")
        # Skip nodes that are just redacted placeholders
        if text in ("[NAME]", "[EMAIL]", "[PASSWORD]", "[PHONE]", "[PAN]", "[AADHAAR]", "[CARD]"):
            continue
        if not text and not n.get("placeholder") and not n.get("ariaLabel"):
            continue
        useful.append(n)

    if not useful:
        return "No useful interactive elements on this page (all content is redacted/empty)."

    lines = []
    for n in useful[:max_nodes]:
        text = n.get("text", "")[:80]
        ph = n.get("placeholder", "")[:40]
        aria = n.get("ariaLabel", "")[:40]
        tag = n.get("tag", "?")
        ntype = n.get("type", "")
        aid = n.get("agentId", "")
        sel = n.get("selector", "")
        rect = n.get("rect", {})

        desc = text or ph or aria or f"<{tag}>"
        extra = f" type={ntype}" if ntype else ""

        # Include bounding-box coordinates for visual grounding
        rect_str = ""
        if rect:
            rect_str = f" rect=({rect.get('x', '?')},{rect.get('y', '?')},{rect.get('width', '?')},{rect.get('height', '?')})"

        # Include dropdown options if present
        options_str = ""
        options = n.get("options", [])
        if options:
            opts_preview = ", ".join(str(o)[:30] for o in options[:8])
            if len(options) > 8:
                opts_preview += f", ... (+{len(options) - 8} more)"
            options_str = f" options=[{opts_preview}]"

        selected_str = ""
        if n.get("selectedOption"):
            selected_str = f" selected=\"{n['selectedOption'][:30]}\""

        lines.append(f"- [{aid}] <{tag}{extra}> \"{desc}\" selector=\"{sel}\"{rect_str}{options_str}{selected_str}")

    return "\n".join(lines)


def _format_action_history(history: List[Dict[str, Any]]) -> str:
    """Format action history for the LLM prompt, with summarization for older entries."""
    if not history:
        return "No previous actions."

    if len(history) <= 5:
        # All entries fit in detail
        lines = []
        for h in history:
            step = h.get("step", "?")
            action = h.get("action", {})
            if isinstance(action, dict):
                action = action.get("label") or action.get("type") or "Interacted"
            result = h.get("result", "?")
            thought = h.get("thought", "")[:60]
            url = h.get("url", "")[:60]
            lines.append(f"  Step {step}: {action} → result={result} | {thought} | url={url}")
        return "\n".join(lines)

    # Summarize older entries, keep last 5 in detail
    older = history[:-5]
    recent = history[-5:]

    # Build a compressed summary of older steps
    summary_parts = []
    for h in older:
        action = h.get("action", {})
        if isinstance(action, dict):
            label = action.get("label") or action.get("type") or "Interacted"
        else:
            label = str(action)
            
        result = h.get("result", "")
        if result == "success":
            summary_parts.append(f"{label} ✓")
        elif result == "no_change":
            summary_parts.append(f"{label} ✗")
        else:
            summary_parts.append(label)

    summary_line = f"  Steps 1-{older[-1].get('step', '?')} (summarized): {' → '.join(summary_parts)}"

    detail_lines = []
    for h in recent:
        step = h.get("step", "?")
        action = h.get("action", {})
        if isinstance(action, dict):
            action = action.get("label") or action.get("type") or "Interacted"
            
        result = h.get("result", "?")
        thought = h.get("thought", "")[:60]
        url = h.get("url", "")[:60]
        detail_lines.append(f"  Step {step}: {action} → result={result} | {thought} | url={url}")

    return summary_line + "\n" + "\n".join(detail_lines)


def _format_page_alerts(alerts: List[Dict[str, Any]]) -> str:
    """Format detected page alerts/modals for the LLM prompt."""
    if not alerts:
        return "None detected."

    lines = []
    for a in alerts[:5]:
        text = (a.get("text") or "")[:120]
        score = a.get("score", 0)
        has_close = a.get("hasCloseButton", False)
        lines.append(f"  - \"{text}\" (confidence={score}, closeable={has_close})")
    return "\n".join(lines)


def _call_google_gemini_agent(user_prompt: str, screenshot: Optional[str], api_key: str) -> Optional[str]:
    """Call Google Gemini API (Main Provider) with optional screenshot inline_data and systemInstruction."""
    import urllib.request

    if not api_key or not api_key.startswith("AIza"):
        return None

    google_models = [
        "gemini-2.0-flash",
        "gemini-1.5-flash",
        "gemini-1.5-pro",
        "gemini-2.0-flash-lite"
    ]

    parts: List[Dict[str, Any]] = [{"text": user_prompt}]

    if screenshot:
        raw_b64 = screenshot
        mime_type = "image/png"
        if "data:" in screenshot and ";base64," in screenshot:
            header, raw_b64 = screenshot.split(";base64,", 1)
            mime_type = header.replace("data:", "").strip() or "image/png"

        parts.append({
            "inline_data": {
                "mime_type": mime_type,
                "data": raw_b64
            }
        })

    payload = {
        "contents": [
            {
                "role": "user",
                "parts": parts
            }
        ],
        "systemInstruction": {
            "parts": [{"text": AGENT_SYSTEM_PROMPT}]
        },
        "generationConfig": {
            "temperature": 0.2
        }
    }

    payload_bytes = json.dumps(payload).encode('utf-8')

    for m in google_models:
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{m}:generateContent?key={api_key}"
        headers = {
            "Content-Type": "application/json",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
            "X-goog-api-key": api_key
        }

        try:
            req = urllib.request.Request(
                url,
                data=payload_bytes,
                headers=headers,
                method='POST'
            )
            with urllib.request.urlopen(req, timeout=25) as response:
                if response.status == 200:
                    resp_body = response.read().decode('utf-8')
                    resp_json = json.loads(resp_body)
                    candidates = resp_json.get("candidates", [])
                    if candidates and "content" in candidates[0]:
                        res_parts = candidates[0]["content"].get("parts", [])
                        if res_parts and "text" in res_parts[0]:
                            content = res_parts[0]["text"]
                            if content:
                                logger.info(f"Agent LLM responded using Google Gemini model: {m}")
                                return content
                else:
                    logger.warning(f"Google Gemini model '{m}' returned status {response.status}")
        except Exception as err:
            logger.warning(f"Google Gemini attempt with model '{m}' failed: {err}")

    return None


def _call_agent_llm(goal: str, url: str, dom_summary: str, step_number: int,
                     screenshot: str = None, action_history: str = "",
                     page_alerts: str = "", visible_text: str = "",
                     last_action_result: str = None) -> Optional[Dict]:
    """Call the LLM to decide the next agent action. Tries Google Gemini first, falls back to OpenRouter."""
    gemini_key = get_gemini_api_key()
    openrouter_key = get_openrouter_api_key()

    if not gemini_key and not openrouter_key:
        logger.warning("No Google Gemini or OpenRouter API key available for agent LLM call")
        return None

    # Build rich user prompt with all context
    sections = [
        f"## User Goal\n{goal}",
        f"## Current Page\nURL: {url or 'blank/internal page'}\nStep number: {step_number}",
    ]

    if last_action_result:
        result_emoji = {"success": "✅", "no_change": "⚠️", "error_detected": "🚨", "navigation": "🌐"}.get(last_action_result, "❓")
        sections.append(f"## Last Action Result\n{result_emoji} {last_action_result}")
        if last_action_result == "no_change":
            sections.append("> ⚠️ YOUR LAST ACTION HAD NO EFFECT. You MUST try a different approach.")

    if page_alerts and page_alerts != "None detected.":
        sections.append(f"## ⚠️ Active Page Alerts/Modals\n{page_alerts}\n> IMPORTANT: Handle these alerts FIRST before any other action.")

    if visible_text:
        sections.append(f"## Visible Page Text\n{visible_text[:1500]}")

    if action_history and action_history != "No previous actions.":
        sections.append(f"## Action History\n{action_history}")

    sections.append(f"## Interactive DOM Elements\n{dom_summary}")

    user_prompt = "\n\n".join(sections)

    raw = None

    # 1. Try Google Gemini first (Main provider)
    if gemini_key:
        raw = _call_google_gemini_agent(user_prompt, screenshot, gemini_key)
        if not raw:
            logger.warning("Google Gemini failed for agent step, falling back to OpenRouter...")

    # 2. Fallback to OpenRouter (Keep all existing models intact)
    if not raw and openrouter_key:
        # Build the messages array — use multimodal format if screenshot is available
        if screenshot:
            screenshot_url = screenshot if screenshot.startswith("data:") else f"data:image/png;base64,{screenshot}"
            user_message = {
                "role": "user",
                "content": [
                    {"type": "text", "text": user_prompt},
                    {"type": "image_url", "image_url": {"url": screenshot_url}}
                ]
            }
        else:
            user_message = {"role": "user", "content": user_prompt}

        messages = [
            {"role": "system", "content": AGENT_SYSTEM_PROMPT},
            user_message
        ]

        if screenshot:
            models_to_try = [
                "openrouter/auto",
                "google/gemini-2.0-pro-exp-02-05:free",
                "google/gemini-2.0-flash-exp:free",
                "qwen/qwen-2-vl-7b-instruct:free"
            ]
        else:
            models_to_try = [
                "openrouter/auto",
                "meta-llama/llama-3.3-70b-instruct:free",
                "google/gemini-2.0-flash-lite-preview-02-05:free",
                "qwen/qwen-2.5-coder-32b-instruct:free"
            ]

        raw = _call_llm_with_models(messages, models_to_try, openrouter_key)

    if not raw:
        return None

    try:
        # Strip markdown code fences if present
        cleaned = re.sub(r'^```(?:json)?\s*', '', raw, flags=re.MULTILINE)
        cleaned = re.sub(r'^```\s*$', '', cleaned, flags=re.MULTILINE).strip()

        # Try to extract JSON object
        match = re.search(r'\{[\s\S]*\}', cleaned)
        if match:
            cleaned = match.group(0)

        parsed = json.loads(cleaned)
        if isinstance(parsed, dict) and "intent" in parsed:
            return parsed
        logger.warning(f"LLM returned JSON without 'intent' key: {list(parsed.keys())}")
    except Exception as e:
        logger.warning(f"Failed to parse agent LLM response: {e}. Raw: {raw[:200]}")

    return None


def _call_llm_with_models(messages: list, models: list, api_key: str) -> Optional[str]:
    """Try multiple models in order, return first successful response content."""
    import urllib.request

    url = "https://openrouter.ai/api/v1/chat/completions"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "HTTP-Referer": "http://127.0.0.1:8000",
        "X-Title": "PrivacyAgent Autonomous Assistant"
    }

    for m in models:
        payload = {
            "model": m,
            "messages": messages,
            "temperature": 0.2
        }

        try:
            req = urllib.request.Request(
                url,
                data=json.dumps(payload).encode('utf-8'),
                headers=headers,
                method='POST'
            )
            with urllib.request.urlopen(req, timeout=30) as response:
                if response.status == 200:
                    resp_body = response.read().decode('utf-8')
                    resp_json = json.loads(resp_body)

                    if "error" in resp_json:
                        logger.error(f"OpenRouter returned an error for {m}: {resp_json['error']}")
                        continue

                    choices = resp_json.get("choices", [])
                    if choices and "message" in choices[0]:
                        content = choices[0]["message"].get("content", "")
                        if content:
                            logger.info(f"Agent LLM responded using model: {m}")
                            return content
        except Exception as err:
            logger.warning(f"Agent LLM attempt with model '{m}' failed: {err}")

    return None


def _resolve_node_target(req: AgentStepRequest, target_selector: str):
    if not target_selector:
        return None, None
    nodes = req.dom_nodes or []
    # 1. Direct agentId match
    for n in nodes:
        if isinstance(n, dict):
            aid = n.get("agentId")
            sel = n.get("selector")
            if aid and (aid == target_selector or aid in target_selector):
                return aid, sel or f'[data-agent-id="{aid}"]'
    # 2. Selector match
    for n in nodes:
        if isinstance(n, dict):
            aid = n.get("agentId")
            sel = n.get("selector")
            if sel and (sel == target_selector or target_selector in sel):
                return aid, sel
    # 3. Fallback
    if target_selector.startswith("node-"):
        return target_selector, f'[data-agent-id="{target_selector}"]'
    return None, target_selector


def _build_response_from_llm(req: AgentStepRequest, llm_result: Dict) -> AgentStepResponse:
    """Convert LLM JSON output into a proper AgentStepResponse."""
    intent = llm_result.get("intent", "complete").lower().replace("_", "_")
    thought = llm_result.get("thought", "Processing...")
    plan_seq = llm_result.get("plan_sequence", "")
    risk = llm_result.get("risk", "low")
    reason = llm_result.get("reason", "AI-planned action")

    def format_status(msg: str) -> str:
        if plan_seq:
            return f"Plan: {plan_seq}\n\nAction: {msg}"
        return msg

    # --- CHAT ---
    if intent == "chat":
        answer = llm_result.get("chat_answer", "I couldn't generate a response.")
        return AgentStepResponse(
            task_id=req.task_id,
            step_number=req.step_number,
            thought=thought,
            action=ActionModel(
                type="COMPLETE",
                label="Chat Answer",
                risk="low",
                reason="Answered the user's question directly."
            ),
            requires_hitl=False,
            completed=True,
            status_summary=answer
        )

    # --- NAVIGATE ---
    if intent == "navigate":
        url = llm_result.get("url", "")
        if not url:
            return _wait_for_user_fallback(req, "Could not determine URL to navigate to.")
        return AgentStepResponse(
            task_id=req.task_id,
            step_number=req.step_number,
            thought=thought,
            action=ActionModel(
                type="NAVIGATE",
                url=url,
                label=f"Navigate to {url}",
                risk=risk,
                reason=reason
            ),
            requires_hitl=False,
            completed=False,
            status_summary=format_status(f"Navigating to {url}")
        )

    # --- SEARCH ---
    if intent == "search":
        query = llm_result.get("url", "")
        if not query:
            return _wait_for_user_fallback(req, "Could not determine search query.")
        search_url = f"https://www.google.com/search?q={quote_plus(query)}"
        return AgentStepResponse(
            task_id=req.task_id,
            step_number=req.step_number,
            thought=thought,
            action=ActionModel(
                type="NAVIGATE",
                url=search_url,
                label=f"Search Google for '{query}'",
                risk=risk,
                reason=reason
            ),
            requires_hitl=False,
            completed=False,
            status_summary=format_status(f"Searching for '{query}'...")
        )

    # --- CLICK ---
    if intent == "click":
        raw_sel = llm_result.get("target_selector", "")
        label = llm_result.get("target_label", "Element")
        target_id, selector = _resolve_node_target(req, raw_sel)
        
        if not target_id and not selector:
            return _wait_for_user_fallback(req, "I wanted to click something but couldn't find a valid target_selector.")

        risk_level, hitl_req, safety_reason = evaluate_action_risk("CLICK", label, "", req.url or "", None)
        
        return AgentStepResponse(
            task_id=req.task_id,
            step_number=req.step_number,
            thought=thought,
            action=ActionModel(
                type="CLICK",
                target_id=target_id,
                selector=selector,
                label=label[:60],
                risk=risk_level,
                reason=reason or safety_reason
            ),
            requires_hitl=hitl_req,
            hitl_prompt=f"Confirm clicking '{label}'?" if hitl_req else None,
            completed=False,
            status_summary=format_status(f"Clicking: {label[:40]}")
        )

    # --- CLICK_COORDINATE ---
    if intent in ("click_coordinate", "tap_xy"):
        x = llm_result.get("x")
        y = llm_result.get("y")
        label = llm_result.get("target_label", "Coordinate click")

        if x is None or y is None:
            return _wait_for_user_fallback(req, "I wanted to click coordinates but they were invalid.")

        try:
            x = int(x)
            y = int(y)
        except (TypeError, ValueError):
            return _wait_for_user_fallback(req, f"Invalid coordinates: x={x}, y={y}")

        if x < 0 or y < 0 or x > 4000 or y > 4000:
            return _wait_for_user_fallback(req, f"Coordinates out of bounds: x={x}, y={y}")

        risk_level, hitl_req, safety_reason = evaluate_action_risk("CLICK_COORDINATE", label, "", req.url or "", None)

        return AgentStepResponse(
            task_id=req.task_id,
            step_number=req.step_number,
            thought=thought,
            action=ActionModel(
                type="CLICK_COORDINATE",
                x=x,
                y=y,
                label=label[:60],
                risk=risk_level,
                reason=reason or safety_reason
            ),
            requires_hitl=hitl_req,
            hitl_prompt=f"Confirm coordinate click at ({x}, {y})?" if hitl_req else None,
            completed=False,
            status_summary=format_status(f"Clicking at ({x}, {y}): {label[:30]}")
        )

    # --- TYPE ---
    if intent == "type":
        raw_sel = llm_result.get("target_selector", "")
        label = llm_result.get("target_label", "Input field")
        value = llm_result.get("type_value", "")
        target_id, selector = _resolve_node_target(req, raw_sel)

        return AgentStepResponse(
            task_id=req.task_id,
            step_number=req.step_number,
            thought=thought,
            action=ActionModel(
                type="TYPE",
                target_id=target_id,
                selector=selector,
                value=value,
                label=f"Type '{value[:30]}' into {label[:30]}",
                risk=risk,
                reason=reason
            ),
            requires_hitl=False,
            completed=False,
            status_summary=format_status(f"Typing into {label[:30]}...")
        )

    # --- TYPE_AND_ENTER ---
    if intent == "type_and_enter":
        raw_sel = llm_result.get("target_selector", "")
        label = llm_result.get("target_label", "Input field")
        value = llm_result.get("type_value", "")
        target_id, selector = _resolve_node_target(req, raw_sel)

        return AgentStepResponse(
            task_id=req.task_id,
            step_number=req.step_number,
            thought=thought,
            action=ActionModel(
                type="TYPE_AND_ENTER",
                target_id=target_id,
                selector=selector,
                value=value,
                label=f"Type '{value[:30]}' and Enter in {label[:30]}",
                risk=risk,
                reason=reason
            ),
            requires_hitl=False,
            completed=False,
            status_summary=format_status(f"Typing and submitting in {label[:30]}...")
        )

    # --- TYPE_AND_SELECT ---
    if intent == "type_and_select":
        raw_sel = llm_result.get("target_selector", "")
        label = llm_result.get("target_label", "Autocomplete field")
        value = llm_result.get("type_value", "")
        target_id, selector = _resolve_node_target(req, raw_sel)

        return AgentStepResponse(
            task_id=req.task_id,
            step_number=req.step_number,
            thought=thought,
            action=ActionModel(
                type="TYPE_AND_SELECT",
                target_id=target_id,
                selector=selector,
                value=value,
                label=f"Type & Select '{value[:30]}' in {label[:30]}",
                risk=risk,
                reason=reason
            ),
            requires_hitl=False,
            completed=False,
            status_summary=format_status(f"Typing & Selecting '{value[:30]}' in {label[:30]}...")
        )

    # --- SELECT ---
    if intent == "select":
        raw_sel = llm_result.get("target_selector", "")
        label = llm_result.get("target_label", "Dropdown")
        value = llm_result.get("type_value", "")
        target_id, selector = _resolve_node_target(req, raw_sel)

        return AgentStepResponse(
            task_id=req.task_id,
            step_number=req.step_number,
            thought=thought,
            action=ActionModel(
                type="SELECT",
                target_id=target_id,
                selector=selector,
                value=value,
                label=f"Select '{value[:30]}' in {label[:30]}",
                risk="low",
                reason=reason
            ),
            requires_hitl=False,
            completed=False,
            status_summary=format_status(f"Selecting '{value[:30]}' in {label[:30]}...")
        )

    # --- SCROLL ---
    if intent == "scroll":
        return AgentStepResponse(
            task_id=req.task_id,
            step_number=req.step_number,
            thought=thought,
            action=ActionModel(
                type="SCROLL",
                label="Scroll page",
                risk="low",
                reason=reason
            ),
            requires_hitl=False,
            completed=False,
            status_summary=format_status("Scrolling page...")
        )

    # --- WAIT ---
    if intent == "wait":
        return AgentStepResponse(
            task_id=req.task_id,
            step_number=req.step_number,
            thought=thought,
            action=ActionModel(
                type="WAIT",
                label="Wait for page updates",
                risk="low",
                reason=reason
            ),
            requires_hitl=False,
            completed=False,
            status_summary=format_status("Waiting for page updates...")
        )

    # --- DISMISS_MODAL ---
    if intent == "dismiss_modal":
        raw_sel = llm_result.get("target_selector", "")
        label = llm_result.get("target_label", "Close button")
        target_id, selector = _resolve_node_target(req, raw_sel)

        if not target_id and not selector:
            return _wait_for_user_fallback(req, "I tried to dismiss a modal but couldn't find the close button.")

        return AgentStepResponse(
            task_id=req.task_id,
            step_number=req.step_number,
            thought=thought,
            action=ActionModel(
                type="DISMISS_MODAL",
                target_id=target_id,
                selector=selector,
                label=label[:60],
                risk="low",
                reason=reason
            ),
            requires_hitl=False,
            completed=False,
            status_summary=format_status("Dismissing modal/popup...")
        )

    # --- SAHAYAK_TRIGGER ---
    if intent in ("sahayak_trigger", "upload_document", "sahayak"):
        raw_sel = llm_result.get("target_selector", "")
        label = llm_result.get("target_label", "File upload field")
        target_id, selector = _resolve_node_target(req, raw_sel)

        return AgentStepResponse(
            task_id=req.task_id,
            step_number=req.step_number,
            thought=thought or "Encountered document field. Activating Sahayak Assistant.",
            action=ActionModel(
                type="SAHAYAK_TRIGGER",
                target_id=target_id,
                selector=selector,
                label=f"Activate Sahayak for {label[:40]}",
                risk="low",
                reason="Activating Sahayak for document upload."
            ),
            requires_hitl=False,
            completed=False,
            status_summary=format_status(f"Activating Sahayak for {label[:40]}...")
        )

    # --- WAIT_FOR_USER ---
    if intent == "wait_for_user":
        return AgentStepResponse(
            task_id=req.task_id,
            step_number=req.step_number,
            thought=thought,
            action=ActionModel(
                type="WAIT_FOR_USER",
                label="Manual Intervention Required",
                risk="low",
                reason=reason
            ),
            requires_hitl=True,
            hitl_prompt=thought or "Please perform the next step manually, then click Resume Automation.",
            completed=False,
            status_summary=format_status("Waiting for user intervention...")
        )

    # --- COMPLETE / DEFAULT ---
    summary = llm_result.get("chat_answer") or llm_result.get("thought") or "Task completed."
    return _fallback_complete(req, format_status(summary))


def _wait_for_user_fallback(req: AgentStepRequest, reason: str) -> AgentStepResponse:
    """Return a WAIT_FOR_USER response instead of halting the task."""
    return AgentStepResponse(
        task_id=req.task_id,
        step_number=req.step_number,
        thought=f"I encountered an issue: {reason}",
        action=ActionModel(
            type="WAIT_FOR_USER",
            label="Manual Intervention Required",
            risk="low",
            reason=reason
        ),
        requires_hitl=True,
        hitl_prompt=f"{reason}. Please resolve this manually, then click Resume Automation.",
        completed=False,
        status_summary="Waiting for user intervention..."
    )

def _fallback_complete(req: AgentStepRequest, summary: str) -> AgentStepResponse:
    """Return a clean COMPLETE response."""
    return AgentStepResponse(
        task_id=req.task_id,
        step_number=req.step_number,
        thought="Task processing finished.",
        action=ActionModel(type="COMPLETE", label="Task Finished", risk="low", reason="Completed"),
        requires_hitl=False,
        completed=True,
        status_summary=summary
    )


# ---------------------------------------------------------------------------
# Keyword-based fallback (used only when LLM is unavailable)
# ---------------------------------------------------------------------------
SEARCH_INTENT_KEYWORDS = {
    "find", "search", "buy", "mobile", "phone", "laptop", "price",
    "item", "shop", "best", "under", "get", "product", "deal", "cheap", "cost",
    "looking for", "where to buy", "compare", "order"
}

BANKING_INTENT_KEYWORDS = {
    "deposit", "money", "bank", "account", "transfer", "pay", "send money", "withdraw"
}

NAVIGATION_PATTERNS = [
    (r'^(?:go\s+to|open|visit|navigate\s+to)\s+(\S+)', None),
]


def _keyword_fallback(req: AgentStepRequest) -> AgentStepResponse:
    """Fallback rule-based planner when LLM is unavailable."""
    goal = req.goal.strip()
    goal_lower = goal.lower()
    nodes = req.dom_nodes or []
    step_num = req.step_number
    url = req.url or ""
    url_lower = url.lower()

    executed_selectors = set()
    for h in (req.action_history or []):
        act = h.get("action", {})
        if isinstance(act, dict):
            sel = act.get("selector") or act.get("target_id")
            if sel:
                executed_selectors.add(sel)

    # 1. Prioritize unhandled file input fields (Sahayak trigger)
    for node in nodes:
        if isinstance(node, dict) and (node.get("type") == "file" or "file" in (node.get("text") or "").lower()):
            node_aid = node.get("agentId")
            node_sel = node.get("selector") or (f'[data-agent-id="{node_aid}"]' if node_aid else None)
            if node_sel not in executed_selectors and node_aid not in executed_selectors:
                node_label = node.get("text") or node.get("ariaLabel") or "File Upload Field"
                return AgentStepResponse(
                    task_id=req.task_id,
                    step_number=step_num,
                    thought=f"Encountered file input field '{node_label}'. Activating Sahayak Assistant.",
                    action=ActionModel(
                        type="SAHAYAK_TRIGGER",
                        target_id=node_aid,
                        selector=node_sel,
                        label=f"Activate Sahayak for {node_label[:30]}",
                        risk="low",
                        reason="Delegating document collection to Sahayak"
                    ),
                    requires_hitl=False,
                    completed=False,
                    status_summary=f"Activating Sahayak for {node_label[:30]}..."
                )

    # 2. Check for route origin/destination inputs (e.g. From / Origin, To / Destination)
    for node in nodes:
        if isinstance(node, dict):
            ph = (node.get("placeholder") or "").lower()
            text = (node.get("text") or "").lower()
            aria = (node.get("ariaLabel") or "").lower()
            blob = f"{ph} {text} {aria}"
            if "from" in blob or "origin" in blob:
                node_aid = node.get("agentId")
                node_sel = node.get("selector") or (f'[data-agent-id="{node_aid}"]' if node_aid else None)
                if node_sel not in executed_selectors and node_aid not in executed_selectors:
                    match = re.search(r'from\s+([a-zA-Z\s]+?)(?:\s+to|\s*$)', goal_lower)
                    origin_val = match.group(1).strip() if match else "chennai"
                    return AgentStepResponse(
                        task_id=req.task_id,
                        step_number=step_num,
                        thought=f"Typing origin city '{origin_val}' into route picker.",
                        action=ActionModel(
                            type="TYPE_AND_SELECT",
                            target_id=node_aid,
                            selector=node_sel,
                            value=origin_val,
                            label=f"Select Origin '{origin_val}'",
                            risk="low",
                            reason="Route origin input"
                        ),
                        requires_hitl=False,
                        completed=False,
                        status_summary=f"Selecting origin '{origin_val}'..."
                    )

    # 3. Check for search inputs (e.g. input matching search/find/buy)
    for node in nodes:
        if isinstance(node, dict):
            tag = (node.get("tag") or "").lower()
            ntype = (node.get("type") or "").lower()
            ph = (node.get("placeholder") or "").lower()
            blob = f"{ph} {node.get('text') or ''} {node.get('ariaLabel') or ''}".lower()
            if tag == "input" and (ntype in ["text", "search", ""] or "search" in blob or "item" in blob or "find" in goal_lower or "search" in goal_lower):
                node_aid = node.get("agentId")
                node_sel = node.get("selector") or (f'[data-agent-id="{node_aid}"]' if node_aid else None)
                if node_sel not in executed_selectors and node_aid not in executed_selectors:
                    query = goal
                    query = re.sub(r'^(?:find|search|buy|look for|get|order)\s+', '', query, flags=re.IGNORECASE).strip()
                    return AgentStepResponse(
                        task_id=req.task_id,
                        step_number=step_num,
                        thought=f"Typing search query '{query}' into search field.",
                        action=ActionModel(
                            type="TYPE_AND_ENTER",
                            target_id=node_aid,
                            selector=node_sel,
                            value=query,
                            label=f"Search '{query}'",
                            risk="low",
                            reason="Product/Item search input"
                        ),
                        requires_hitl=False,
                        completed=False,
                        status_summary=f"Searching for '{query}'..."
                    )

    # 4. Check for terms/consent checkboxes
    for node in nodes:
        if isinstance(node, dict):
            tag = (node.get("tag") or "").lower()
            ntype = (node.get("type") or "").lower()
            text_blob = f"{node.get('text') or ''} {node.get('ariaLabel') or ''}".lower()
            if ntype == "checkbox" or tag == "checkbox" or "accept" in text_blob or "terms" in text_blob:
                node_aid = node.get("agentId")
                node_sel = node.get("selector") or (f'[data-agent-id="{node_aid}"]' if node_aid else None)
                if node_sel not in executed_selectors and node_aid not in executed_selectors:
                    return AgentStepResponse(
                        task_id=req.task_id,
                        step_number=step_num,
                        thought="Accepting form terms and conditions checkbox.",
                        action=ActionModel(
                            type="CLICK",
                            target_id=node_aid,
                            selector=node_sel,
                            label="Accept terms & conditions",
                            risk="low",
                            reason="Checking consent checkbox"
                        ),
                        requires_hitl=False,
                        completed=False,
                        status_summary="Accepting terms and conditions..."
                    )

    # 5. Form submission button detection (e.g. SUBMIT APPLICATION, Submit, Save, Continue)
    submit_keywords = ["submit", "apply", "register", "confirm", "proceed", "continue", "save"]
    for node in nodes:
        if isinstance(node, dict):
            tag = (node.get("tag") or "").lower()
            text = (node.get("text") or "").lower()
            if tag in ["button", "input", "a"] and any(kw in text for kw in submit_keywords):
                node_aid = node.get("agentId")
                node_sel = node.get("selector") or (f'[data-agent-id="{node_aid}"]' if node_aid else None)
                if node_sel not in executed_selectors and node_aid not in executed_selectors:
                    node_text = node.get("text") or "Submit Application"
                    return AgentStepResponse(
                        task_id=req.task_id,
                        step_number=step_num,
                        thought=f"Submitting form application via button '{node_text}'.",
                        action=ActionModel(
                            type="CLICK",
                            target_id=node_aid,
                            selector=node_sel,
                            label=node_text[:40],
                            risk="low",
                            reason="Submitting application form"
                        ),
                        requires_hitl=False,
                        completed=False,
                        status_summary=f"Submitting application: {node_text[:30]}..."
                    )

    # 4. If form submitted or all actions executed, return COMPLETE
    if executed_selectors:
        return _fallback_complete(req, "Form completed and submitted successfully.")

    return AgentStepResponse(
        task_id=req.task_id,
        step_number=step_num,
        thought="I couldn't find an obvious safe action to take automatically.",
        action=ActionModel(
            type="WAIT_FOR_USER",
            label="Manual Intervention Required",
            risk="low",
            reason="Automation stuck"
        ),
        requires_hitl=True,
        hitl_prompt="I am unable to determine the next step automatically. Please perform the action manually, then click Resume Automation.",
        completed=False,
        status_summary="Waiting for user intervention..."
    )


# ---------------------------------------------------------------------------
# Main entry point
# ---------------------------------------------------------------------------
def plan_next_agent_step(req: AgentStepRequest) -> AgentStepResponse:
    """Main planner: tries LLM first, falls back to keyword matching."""
    goal = req.goal.strip()
    if not goal:
        return _fallback_complete(req, "No task provided.")

    # Compress state to reduce latency and token usage
    req = compress_agent_state(req)

    # Step limit guard — raised to 50 for complex multi-step flows
    if req.step_number > 50:
        return _fallback_complete(req, "Maximum step limit reached (50 steps). Task stopped for safety.")

    # Summarize DOM for LLM
    dom_summary = _summarize_dom_nodes(req.dom_nodes or [])

    # Format action history with summarization for long flows
    action_history_str = _format_action_history(req.action_history or [])

    # Format page alerts
    page_alerts_str = _format_page_alerts(req.page_alerts or [])

    # Try LLM-powered planning first
    llm_result = _call_agent_llm(
        goal=goal,
        url=req.url or "",
        dom_summary=dom_summary,
        step_number=req.step_number,
        screenshot=req.screenshot,
        action_history=action_history_str,
        page_alerts=page_alerts_str,
        visible_text=req.visible_text or "",
        last_action_result=req.last_action_result
    )
    if llm_result:
        logger.info(f"LLM agent decided: intent={llm_result.get('intent')}, thought={llm_result.get('thought', '')[:60]}")
        return _build_response_from_llm(req, llm_result)

    logger.warning("LLM unavailable or failed to process step. Executing rule-based fallback planner...")
    return _keyword_fallback(req)
