import logging
import re
from typing import Dict, Any, List
from app.agent.schema import AgentStepRequest, AgentStepResponse, ActionModel
from app.agent.safety import evaluate_action_risk

logger = logging.getLogger("AgentPlanner")

def plan_next_agent_step(req: AgentStepRequest) -> AgentStepResponse:
    goal = req.goal
    goal_lower = goal.lower()
    nodes = req.dom_nodes or []
    step_num = req.step_number
    url = req.url or ""

    # Sanity check: Ensure nodes list has structured dicts
    valid_nodes = [n for n in nodes if isinstance(n, dict) and (n.get("text") or n.get("placeholder") or n.get("ariaLabel") or n.get("tag"))]

    # Helper: Find node by tag or text keyword match
    def find_node(keywords: List[str], tags: List[str] = None):
        for node in valid_nodes:
            if tags and node.get("tag", "").lower() not in tags:
                continue
            text_blob = f"{node.get('text', '')} {node.get('placeholder', '')} {node.get('ariaLabel', '')}".lower()
            if any(kw in text_blob for kw in keywords):
                return node
        return None

    # Step logic based on task intent
    
    # 1. Product Search / E-commerce Comparison Intent
    if any(k in goal_lower for k in ["laptop", "buy", "price", "nitro", "item", "search", "shop"]):
        # Search input matching
        search_input = find_node(["search", "find", "query", "type"], tags=["input", "textarea"])
        if not search_input and valid_nodes:
            # Fallback to any visible text input if goal mentions searching
            for n in valid_nodes:
                if n.get("tag") == "input" and n.get("type") in (None, "text", "search", ""):
                    search_input = n
                    break

        if search_input and step_num == 1:
            action = ActionModel(
                type="TYPE_AND_ENTER",
                target_id=search_input.get("agentId"),
                selector=search_input.get("selector"),
                value=goal.replace("find", "").replace("buy", "").replace("i want to", "").strip(),
                label=f"Type query into search input ({search_input.get('placeholder') or 'Search'})",
                risk="low",
                reason="Searching for items on web store"
            )
            return AgentStepResponse(
                task_id=req.task_id,
                step_number=step_num,
                thought="Entering user search query into e-commerce search bar.",
                action=action,
                requires_hitl=False,
                completed=False,
                status_summary="Searching for requested product..."
            )

        # Look for lowest price option or product card
        lowest_price_node = None
        min_price = float('inf')
        
        for n in valid_nodes:
            text = n.get("text", "")
            price_match = re.search(r'(?:₹|\$|USD|INR)\s*([\d,]+)', text)
            if price_match:
                try:
                    price_val = float(price_match.group(1).replace(",", ""))
                    if price_val < min_price:
                        min_price = price_val
                        lowest_price_node = n
                except ValueError:
                    pass

        if lowest_price_node and step_num >= 2:
            risk_level, hitl_req, reason = evaluate_action_risk("CLICK", lowest_price_node.get("text", ""), "", url, lowest_price_node)
            action = ActionModel(
                type="CLICK",
                target_id=lowest_price_node.get("agentId"),
                selector=lowest_price_node.get("selector"),
                label=f"Select lowest price item ({lowest_price_node.get('text')[:40]})",
                risk=risk_level,
                reason=reason
            )
            return AgentStepResponse(
                task_id=req.task_id,
                step_number=step_num,
                thought=f"Found lowest price match (Price: {min_price}). Selecting item.",
                action=action,
                requires_hitl=hitl_req,
                hitl_prompt=f"Confirm opening item priced at {min_price}?" if hitl_req else None,
                completed=False,
                status_summary=f"Found item at best price ({min_price})"
            )

    # 2. Banking / Deposit / Transfer Intent
    if any(k in goal_lower for k in ["deposit", "money", "bank", "account", "transfer", "pay"]):
        # Find account / amount inputs
        account_input = find_node(["account", "acc", "iban", "recipient", "bank"], tags=["input"])
        if account_input and step_num == 1:
            action = ActionModel(
                type="LOCAL_AUTOFILL",
                target_id=account_input.get("agentId"),
                selector=account_input.get("selector"),
                value="account_number",
                label="Fill Account Number from Local Vault",
                risk="medium",
                reason="Autofilling bank account details from encrypted local extension storage."
            )
            return AgentStepResponse(
                task_id=req.task_id,
                step_number=step_num,
                thought="Autofilling account information securely using local vault.",
                action=action,
                requires_hitl=False,
                completed=False,
                status_summary="Filled account details from local secure storage."
            )

        # Deposit / Submit button
        submit_btn = find_node(["deposit", "transfer", "send", "pay", "submit", "confirm"], tags=["button", "a", "input"])
        if submit_btn:
            risk_level, hitl_req, reason = evaluate_action_risk("CLICK", submit_btn.get("text", ""), "", url, submit_btn)
            action = ActionModel(
                type="CLICK",
                target_id=submit_btn.get("agentId"),
                selector=submit_btn.get("selector"),
                label=submit_btn.get("text") or "Submit Deposit",
                risk=risk_level,
                reason=reason
            )
            return AgentStepResponse(
                task_id=req.task_id,
                step_number=step_num,
                thought="Targeting monetary transfer/deposit completion button.",
                action=action,
                requires_hitl=True,
                hitl_prompt=f"⚠️ SAFETY GUARDIAN: Confirm executing '{submit_btn.get('text')}' for task '{goal}'?",
                completed=False,
                status_summary="Action paused: High-risk financial submission requires your explicit confirmation."
            )

    # Generic Fallback: Click first relevant interactive element or complete task
    if valid_nodes:
        first_btn = valid_nodes[0]
        risk_level, hitl_req, reason = evaluate_action_risk("CLICK", first_btn.get("text", ""), "", url, first_btn)
        action = ActionModel(
            type="CLICK",
            target_id=first_btn.get("agentId"),
            selector=first_btn.get("selector"),
            label=first_btn.get("text") or "Interact",
            risk=risk_level,
            reason=reason
        )
        return AgentStepResponse(
            task_id=req.task_id,
            step_number=step_num,
            thought=f"Interacting with candidate control '{first_btn.get('text')[:30]}'.",
            action=action,
            requires_hitl=hitl_req,
            completed=False,
            status_summary="Executing next step..."
        )

    # Completion state if no actions remain
    return AgentStepResponse(
        task_id=req.task_id,
        step_number=step_num,
        thought="Goal execution complete. No further actions required.",
        action=ActionModel(type="COMPLETE", label="Task Finished", risk="low", reason="All steps executed"),
        requires_hitl=False,
        completed=True,
        status_summary="Task completed successfully!"
    )
