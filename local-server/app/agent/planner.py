import logging
import json
import re
from urllib.parse import quote_plus
from typing import Dict, Any, List, Optional
from app.agent.schema import AgentStepRequest, AgentStepResponse, ActionModel
from app.agent.safety import evaluate_action_risk
from app.sahayak.guide_engine import call_agent_chat, get_openrouter_api_key

logger = logging.getLogger("AgentPlanner")

# ---------------------------------------------------------------------------
# LLM System Prompt — Instructs the AI how to behave as an autonomous agent
# ---------------------------------------------------------------------------
AGENT_SYSTEM_PROMPT = """\
You are PrivacyAgent Autonomous Assistant — a smart AI browser agent.
You receive the user's goal, the current page URL, and a summary of interactive DOM elements on the page.

Your job is to decide the SINGLE next best action. Respond with ONLY a valid JSON object (no markdown, no explanation outside JSON).

## Intent Classification
First determine the user's intent:
- "chat": The user is asking a question, making conversation, or requesting information that does NOT require browser interaction. Answer the question directly.
- "navigate": The user wants to go to a specific website. Extract ONLY the website domain/URL.
- "search": The user wants to search for something on the web. 
- "click": Click a specific element on the current page.
- "type": Type text into a specific input field on the current page.
- "scroll": Scroll the page to find more content.
- "complete": The task is done or there's nothing more to do.

## Response Schema
Return EXACTLY this JSON structure:
{
  "intent": "<chat|navigate|search|click|type|scroll|complete>",
  "thought": "<brief reasoning about what you're doing>",
  "url": "<full URL to navigate to, only for navigate/search intent>",
  "target_selector": "<CSS selector or data-agent-id of the element to interact with, for click/type>",
  "target_label": "<human-readable label of the element>",
  "type_value": "<text to type, only for type intent>",
  "chat_answer": "<your answer to the user's question, only for chat intent>",
  "risk": "<low|medium|high>",
  "reason": "<why this action is safe/risky>"
}

## Rules
- For "navigate": Extract just the website name/URL from the sentence. "go to flipkart" → url: "https://www.flipkart.com". "open youtube" → url: "https://www.youtube.com". Do NOT put the entire sentence as the URL.
- For "search": Build a Google search URL. "find best phones under 20000" → url: "https://www.google.com/search?q=best+phones+under+20000"
- For "chat": Provide a helpful, concise answer in chat_answer. Do NOT try to navigate or click anything.
- For "click": Use the target_selector from the DOM nodes provided. Pick the most relevant element.
- For "type": Identify the input field and what to type.
- If the user gives a compound instruction like "go to flipkart and search for phones", handle ONLY the first part (navigate to flipkart). The next step will handle the search.
- If you see DOM nodes with text like [NAME], [EMAIL], [PASSWORD] — these are REDACTED sensitive fields. Do NOT click or interact with them.
- If no relevant interactive elements exist on the page, return intent "complete".
- Never fabricate selectors. Only use selectors from the provided DOM nodes.
"""


def _summarize_dom_nodes(nodes: List[Dict[str, Any]], max_nodes: int = 30) -> str:
    """Create a concise text summary of DOM nodes for the LLM prompt."""
    if not nodes:
        return "No interactive elements found on this page."

    # Filter out redacted/noise nodes
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
        text = n.get("text", "")[:60]
        ph = n.get("placeholder", "")[:40]
        aria = n.get("ariaLabel", "")[:40]
        tag = n.get("tag", "?")
        ntype = n.get("type", "")
        aid = n.get("agentId", "")
        sel = n.get("selector", "")

        desc = text or ph or aria or f"<{tag}>"
        extra = f" type={ntype}" if ntype else ""
        lines.append(f"- [{aid}] <{tag}{extra}> \"{desc}\" selector=\"{sel}\"")

    return "\n".join(lines)


def _call_agent_llm(goal: str, url: str, dom_summary: str, step_number: int) -> Optional[Dict]:
    """Call the LLM to decide the next agent action. Returns parsed JSON dict or None."""
    api_key = get_openrouter_api_key()
    if not api_key:
        logger.warning("No OpenRouter API key available for agent LLM call")
        return None

    user_prompt = (
        f"## User Goal\n{goal}\n\n"
        f"## Current Page\nURL: {url or 'blank/internal page'}\n"
        f"Step number: {step_number}\n\n"
        f"## Interactive DOM Elements\n{dom_summary}"
    )

    raw = call_agent_chat(AGENT_SYSTEM_PROMPT, user_prompt, api_key)
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


def _build_response_from_llm(req: AgentStepRequest, llm_result: Dict) -> AgentStepResponse:
    """Convert LLM JSON output into a proper AgentStepResponse."""
    intent = llm_result.get("intent", "complete").lower()
    thought = llm_result.get("thought", "Processing...")
    risk = llm_result.get("risk", "low")
    reason = llm_result.get("reason", "AI-planned action")

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
            return _fallback_complete(req, "Could not determine URL to navigate to.")
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
            status_summary=f"Navigating to {url}"
        )

    # --- SEARCH ---
    if intent == "search":
        url = llm_result.get("url", "")
        if not url:
            # Build Google search URL from goal
            url = f"https://www.google.com/search?q={quote_plus(req.goal)}"
        return AgentStepResponse(
            task_id=req.task_id,
            step_number=req.step_number,
            thought=thought,
            action=ActionModel(
                type="NAVIGATE",
                url=url,
                label=f"Search: {req.goal[:40]}",
                risk="low",
                reason=reason
            ),
            requires_hitl=False,
            completed=False,
            status_summary=f"Searching the web..."
        )

    # --- CLICK ---
    if intent == "click":
        selector = llm_result.get("target_selector", "")
        label = llm_result.get("target_label", "Element")

        # Validate risk
        risk_level, hitl_req, safety_reason = evaluate_action_risk(
            "CLICK", label, "", req.url or "", {}
        )
        # Use the higher risk between LLM assessment and safety gate
        if risk_level == "high" or risk == "high":
            risk_level = "high"
            hitl_req = True

        return AgentStepResponse(
            task_id=req.task_id,
            step_number=req.step_number,
            thought=thought,
            action=ActionModel(
                type="CLICK",
                target_id=selector if selector.startswith("node-") else None,
                selector=selector if not selector.startswith("node-") else f'[data-agent-id="{selector}"]',
                label=label[:60],
                risk=risk_level,
                reason=reason or safety_reason
            ),
            requires_hitl=hitl_req,
            hitl_prompt=f"Confirm clicking '{label}'?" if hitl_req else None,
            completed=False,
            status_summary=f"Clicking: {label[:40]}"
        )

    # --- TYPE ---
    if intent == "type":
        selector = llm_result.get("target_selector", "")
        label = llm_result.get("target_label", "Input field")
        value = llm_result.get("type_value", "")

        return AgentStepResponse(
            task_id=req.task_id,
            step_number=req.step_number,
            thought=thought,
            action=ActionModel(
                type="TYPE_AND_ENTER",
                target_id=selector if selector.startswith("node-") else None,
                selector=selector if not selector.startswith("node-") else f'[data-agent-id="{selector}"]',
                value=value,
                label=f"Type '{value[:30]}' into {label[:30]}",
                risk=risk,
                reason=reason
            ),
            requires_hitl=False,
            completed=False,
            status_summary=f"Typing into {label[:30]}..."
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
            status_summary="Scrolling page..."
        )

    # --- COMPLETE / DEFAULT ---
    summary = llm_result.get("chat_answer") or llm_result.get("thought") or "Task completed."
    return _fallback_complete(req, summary)


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
    (r'^(?:go\s+to|open|visit|navigate\s+to)\s+(\S+)', None),  # "go to flipkart" → extract first word
]


def _keyword_fallback(req: AgentStepRequest) -> AgentStepResponse:
    """Fallback rule-based planner when LLM is unavailable."""
    goal = req.goal.strip()
    goal_lower = goal.lower()
    nodes = req.dom_nodes or []
    step_num = req.step_number
    url = req.url or ""
    url_lower = url.lower()

    valid_nodes = [
        n for n in nodes
        if isinstance(n, dict)
        and (n.get("text") or n.get("placeholder") or n.get("ariaLabel"))
        and (n.get("text") or "") not in ("[NAME]", "[EMAIL]", "[PASSWORD]", "[PHONE]", "[PAN]", "[AADHAAR]", "[CARD]")
    ]

    def find_node(keywords: List[str], tags: List[str] = None):
        for node in valid_nodes:
            if tags and node.get("tag", "").lower() not in tags:
                continue
            text_blob = f"{node.get('text') or ''} {node.get('placeholder') or ''} {node.get('ariaLabel') or ''}".lower()
            if any(kw in text_blob for kw in keywords):
                return node
        return None

    is_internal_page = not url or any(url_lower.startswith(p) for p in ["chrome://", "chrome-extension://", "edge://", "about:", "file://"])

    # Navigation intent
    for pattern, _ in NAVIGATION_PATTERNS:
        match = re.match(pattern, goal_lower)
        if match:
            target = match.group(1).strip()
            if not target.startswith("http"):
                if "." not in target:
                    target = f"https://www.{target}.com"
                else:
                    target = f"https://{target}"
            return AgentStepResponse(
                task_id=req.task_id,
                step_number=step_num,
                thought=f"Navigating to {target}",
                action=ActionModel(type="NAVIGATE", url=target, label=f"Navigate to {target}", risk="low", reason="Navigation request"),
                requires_hitl=False,
                completed=False,
                status_summary=f"Navigating to {target}"
            )

    # Search intent
    is_search_intent = any(kw in goal_lower for kw in SEARCH_INTENT_KEYWORDS)
    if is_search_intent and is_internal_page:
        query = quote_plus(goal)
        return AgentStepResponse(
            task_id=req.task_id,
            step_number=step_num,
            thought=f"Searching Google for '{goal}'",
            action=ActionModel(type="NAVIGATE", url=f"https://www.google.com/search?q={query}", label=f"Search: {goal[:40]}", risk="low", reason="Web search"),
            requires_hitl=False,
            completed=False,
            status_summary=f"Searching: {goal[:40]}"
        )

    if is_search_intent:
        search_input = find_node(["search", "find", "query", "type", "q"], tags=["input", "textarea"])
        if search_input and step_num <= 2:
            return AgentStepResponse(
                task_id=req.task_id,
                step_number=step_num,
                thought=f"Typing '{goal}' into search input.",
                action=ActionModel(
                    type="TYPE_AND_ENTER",
                    target_id=search_input.get("agentId"),
                    selector=search_input.get("selector"),
                    value=goal,
                    label=f"Search for '{goal[:30]}'",
                    risk="low",
                    reason="Submitting search query"
                ),
                requires_hitl=False,
                completed=False,
                status_summary="Submitting search query..."
            )

    # Banking intent
    is_banking_intent = any(kw in goal_lower for kw in BANKING_INTENT_KEYWORDS)
    if is_banking_intent:
        submit_btn = find_node(["deposit", "transfer", "send", "pay", "submit", "confirm"], tags=["button", "a", "input"])
        if submit_btn:
            node_text = submit_btn.get("text") or "Submit"
            return AgentStepResponse(
                task_id=req.task_id,
                step_number=step_num,
                thought=f"Found financial action button '{node_text}'.",
                action=ActionModel(
                    type="CLICK",
                    target_id=submit_btn.get("agentId"),
                    selector=submit_btn.get("selector"),
                    label=node_text,
                    risk="high",
                    reason="Financial action requires confirmation."
                ),
                requires_hitl=True,
                hitl_prompt=f"⚠️ Confirm executing '{node_text}'?",
                completed=False,
                status_summary="Awaiting confirmation for financial action."
            )

    # REMOVED: blind node[0] clicking fallback — this caused the [NAME] spam
    # Instead, return a helpful completion message
    return _fallback_complete(req, "I understand your request but I'm unable to determine the next step without AI assistance. Please ensure the local server is running with a valid API key.")


# ---------------------------------------------------------------------------
# Main entry point
# ---------------------------------------------------------------------------
def plan_next_agent_step(req: AgentStepRequest) -> AgentStepResponse:
    """Main planner: tries LLM first, falls back to keyword matching."""
    goal = req.goal.strip()
    if not goal:
        return _fallback_complete(req, "No task provided.")

    # Step limit guard — prevent infinite loops
    if req.step_number > 15:
        return _fallback_complete(req, "Maximum step limit reached. Task stopped for safety.")

    # Summarize DOM for LLM
    dom_summary = _summarize_dom_nodes(req.dom_nodes or [])

    # Try LLM-powered planning first
    llm_result = _call_agent_llm(goal, req.url or "", dom_summary, req.step_number)
    if llm_result:
        logger.info(f"LLM agent decided: intent={llm_result.get('intent')}, thought={llm_result.get('thought', '')[:60]}")
        return _build_response_from_llm(req, llm_result)

    # Fallback to keyword-based planning
    logger.warning("LLM unavailable, using keyword fallback planner")
    return _keyword_fallback(req)
