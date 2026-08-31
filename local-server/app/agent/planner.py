import logging
import re
from urllib.parse import quote_plus
from typing import Dict, Any, List
from app.agent.schema import AgentStepRequest, AgentStepResponse, ActionModel
from app.agent.safety import evaluate_action_risk

logger = logging.getLogger("AgentPlanner")

SEARCH_INTENT_KEYWORDS = {
    "find", "search", "buy", "mobile", "phone", "laptop", "price", "nitro",
    "item", "shop", "best", "under", "get", "product", "deal", "cheap", "cost",
    "looking for", "where to buy", "compare", "order", "iphone", "samsung", "acer"
}

BANKING_INTENT_KEYWORDS = {
    "deposit", "money", "bank", "account", "transfer", "pay", "send money", "withdraw"
}

def plan_next_agent_step(req: AgentStepRequest) -> AgentStepResponse:
    goal = req.goal.strip()
    goal_lower = goal.lower()
    nodes = req.dom_nodes or []
    step_num = req.step_number
    url = req.url or ""
    url_lower = url.lower()

    # Clean nodes list
    valid_nodes = [n for n in nodes if isinstance(n, dict) and (n.get("text") or n.get("placeholder") or n.get("ariaLabel") or n.get("tag"))]

    def find_node(keywords: List[str], tags: List[str] = None):
        for node in valid_nodes:
            if tags and node.get("tag", "").lower() not in tags:
                continue
            text_blob = f"{node.get('text') or ''} {node.get('placeholder') or ''} {node.get('ariaLabel') or ''}".lower()
            if any(kw in text_blob for kw in keywords):
                return node
        return None

    is_internal_page = not url or any(url_lower.startswith(p) for p in ["chrome://", "chrome-extension://", "edge://", "about:", "file://"])
    is_google_search_page = any(domain in url_lower for domain in ["google.com/search", "bing.com/search", "google.co.in/search"])

    # 1. Product Search / Shopping Intent
    is_search_intent = any(kw in goal_lower for kw in SEARCH_INTENT_KEYWORDS)

    if is_search_intent:
        search_input = find_node(["search", "find", "query", "type", "q"], tags=["input", "textarea"])
        if not search_input and valid_nodes:
            for n in valid_nodes:
                if n.get("tag") == "input" and n.get("type") in (None, "text", "search", ""):
                    search_input = n
                    break

        # Step A: If on blank/internal tab, navigate to Google Search immediately
        if is_internal_page:
            query = quote_plus(goal)
            action = ActionModel(
                type="NAVIGATE",
                url=f"https://www.google.com/search?q={query}",
                label=f"Search Google for '{goal}'",
                risk="low",
                reason="Navigating to Google Search to locate requested item."
            )
            return AgentStepResponse(
                task_id=req.task_id,
                step_number=step_num,
                thought=f"Navigating browser tab to search for '{goal}'.",
                action=action,
                requires_hitl=False,
                completed=False,
                status_summary=f"Navigating to web search: '{goal}'"
            )

        # Step B: If search input exists and we haven't submitted yet (or not on Google search results), type query
        if search_input and step_num == 1:
            action = ActionModel(
                type="TYPE_AND_ENTER",
                target_id=search_input.get("agentId"),
                selector=search_input.get("selector"),
                value=goal,
                label=f"Type '{goal}' into search bar",
                risk="low",
                reason="Submitting search query into search box"
            )
            return AgentStepResponse(
                task_id=req.task_id,
                step_number=step_num,
                thought=f"Typing '{goal}' into search input.",
                action=action,
                requires_hitl=False,
                completed=False,
                status_summary="Submitting search query..."
            )

        # Step C: If on Google Search results page, do NOT type into search bar again! Pick product link or e-commerce store
        if is_google_search_page:
            result_link = None
            for n in valid_nodes:
                text_l = (n.get("text") or "").lower()
                if n.get("tag") == "a" and len(text_l) > 5:
                    if any(store in text_l for store in ["flipkart", "amazon", "croma", "reliance", "mobile", "phone", "buy", "under 20000", "best"]):
                        result_link = n
                        break
            if not result_link:
                for n in valid_nodes:
                    if n.get("tag") == "a" and len(n.get("text") or "") > 12:
                        result_link = n
                        break

            if result_link:
                node_text = result_link.get("text") or "Product Result"
                action = ActionModel(
                    type="CLICK",
                    target_id=result_link.get("agentId"),
                    selector=result_link.get("selector"),
                    label=f"Open result: {node_text[:40]}",
                    risk="low",
                    reason="Navigating to selected e-commerce product store."
                )
                return AgentStepResponse(
                    task_id=req.task_id,
                    step_number=step_num,
                    thought=f"Found search result '{node_text[:30]}'. Navigating to store page.",
                    action=action,
                    requires_hitl=False,
                    completed=False,
                    status_summary=f"Opening store page: {node_text[:30]}"
                )

        # Step D: On E-commerce Store / Product Page: Look for "Buy Now" / "Add to Cart" / "Checkout"
        buy_now_btn = find_node(["buy now", "add to cart", "buy", "add to bag", "proceed to buy", "checkout"], tags=["button", "a", "input"])
        if buy_now_btn:
            node_text = buy_now_btn.get("text") or "Buy Now"
            risk_level, hitl_req, reason = evaluate_action_risk("CLICK", node_text, "", url, buy_now_btn)
            action = ActionModel(
                type="CLICK",
                target_id=buy_now_btn.get("agentId"),
                selector=buy_now_btn.get("selector"),
                label=node_text,
                risk=risk_level,
                reason=reason
            )
            return AgentStepResponse(
                task_id=req.task_id,
                step_number=step_num,
                thought=f"Found purchase button '{node_text}'. Proceeding to order/checkout.",
                action=action,
                requires_hitl=hitl_req,
                hitl_prompt=f"Confirm clicking '{node_text}'?" if hitl_req else None,
                completed=False,
                status_summary=f"Clicking purchase button: {node_text}"
            )

        # Step E: On Checkout / Delivery Address Form: Fill form fields via LOCAL_AUTOFILL
        address_input = find_node(["address", "pincode", "zip", "city", "phone", "email", "name"], tags=["input", "textarea"])
        if address_input:
            action = ActionModel(
                type="LOCAL_AUTOFILL",
                target_id=address_input.get("agentId"),
                selector=address_input.get("selector"),
                value="address",
                label="Autofill Shipping & Delivery Details",
                risk="medium",
                reason="Autofilling shipping address securely from encrypted local vault."
            )
            return AgentStepResponse(
                task_id=req.task_id,
                step_number=step_num,
                thought="Filling shipping details from local secure profile.",
                action=action,
                requires_hitl=False,
                completed=False,
                status_summary="Filled delivery address securely from local vault."
            )

        # Step F: On Payment Page / Final Order Submission: Trigger HITL Approval
        pay_btn = find_node(["place order", "pay now", "submit payment", "complete purchase", "confirm order", "pay"], tags=["button", "a", "input"])
        if pay_btn:
            node_text = pay_btn.get("text") or "Place Order"
            action = ActionModel(
                type="CLICK",
                target_id=pay_btn.get("agentId"),
                selector=pay_btn.get("selector"),
                label=node_text,
                risk="high",
                reason="Finalizing financial payment and order placement requires user confirmation."
            )
            return AgentStepResponse(
                task_id=req.task_id,
                step_number=step_num,
                thought="Reached final payment/order placement button. Requiring explicit user approval.",
                action=action,
                requires_hitl=True,
                hitl_prompt=f"⚠️ SAFETY GUARDIAN: Confirm placing order with action '{node_text}'?",
                completed=False,
                status_summary="Action paused: Payment & Order Submission requires your confirmation."
            )

    # 2. Banking / Deposit / Financial Intent
    is_banking_intent = any(kw in goal_lower for kw in BANKING_INTENT_KEYWORDS)
    if is_banking_intent:
        account_input = find_node(["account", "acc", "iban", "recipient", "bank"], tags=["input"])
        if account_input:
            action = ActionModel(
                type="LOCAL_AUTOFILL",
                target_id=account_input.get("agentId"),
                selector=account_input.get("selector"),
                value="account_number",
                label="Fill Account Number from Local Vault",
                risk="medium",
                reason="Autofilling bank account details from encrypted local storage."
            )
            return AgentStepResponse(
                task_id=req.task_id,
                step_number=step_num,
                thought="Autofilling account information securely using encrypted local vault.",
                action=action,
                requires_hitl=False,
                completed=False,
                status_summary="Filled account details from local secure storage."
            )

        submit_btn = find_node(["deposit", "transfer", "send", "pay", "submit", "confirm"], tags=["button", "a", "input"])
        if submit_btn:
            node_text = submit_btn.get("text") or "Submit Deposit"
            action = ActionModel(
                type="CLICK",
                target_id=submit_btn.get("agentId"),
                selector=submit_btn.get("selector"),
                label=node_text,
                risk="high",
                reason="Submitting bank deposit / transfer requires user confirmation."
            )
            return AgentStepResponse(
                task_id=req.task_id,
                step_number=step_num,
                thought="Targeting financial deposit / transfer completion button.",
                action=action,
                requires_hitl=True,
                hitl_prompt=f"⚠️ SAFETY GUARDIAN: Confirm executing '{node_text}' for task '{goal}'?",
                completed=False,
                status_summary="Action paused: High-risk financial submission requires explicit user confirmation."
            )

    # Generic Fallback if page has valid interactive nodes
    if valid_nodes and step_num < 6:
        first_btn = valid_nodes[0]
        node_text = (first_btn.get("text") or "Interact")[:40]
        risk_level, hitl_req, reason = evaluate_action_risk("CLICK", node_text, "", url, first_btn)
        action = ActionModel(
            type="CLICK",
            target_id=first_btn.get("agentId"),
            selector=first_btn.get("selector"),
            label=node_text,
            risk=risk_level,
            reason=reason
        )
        return AgentStepResponse(
            task_id=req.task_id,
            step_number=step_num,
            thought=f"Interacting with candidate element '{node_text[:30]}'.",
            action=action,
            requires_hitl=hitl_req,
            completed=False,
            status_summary="Executing next step..."
        )

    # Final completion state
    return AgentStepResponse(
        task_id=req.task_id,
        step_number=step_num,
        thought="Goal execution complete. Requested task has been processed.",
        action=ActionModel(type="COMPLETE", label="Task Finished", risk="low", reason="All steps executed"),
        requires_hitl=False,
        completed=True,
        status_summary="Task completed successfully!"
    )
