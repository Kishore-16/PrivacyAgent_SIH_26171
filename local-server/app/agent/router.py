import uuid
import logging
from fastapi import APIRouter, HTTPException
from app.agent.schema import AgentTaskStartRequest, AgentStepRequest, AgentStepResponse
from app.agent.planner import plan_next_agent_step
from app.firewall import contains_unsafe_payload, log_safe_audit

logger = logging.getLogger("AgentRouter")

router = APIRouter()

@router.get("/health")
def agent_health():
    return {
        "status": "ok",
        "module": "autonomous-privacy-agent-v1",
        "mode": "on-device-privacy-guarded"
    }

@router.post("/task/start")
def start_task(req: AgentTaskStartRequest):
    if not req.task:
        raise HTTPException(status_code=400, detail="Task string is required")
    
    task_id = f"task-{uuid.uuid4().hex[:8]}"
    log_safe_audit("AGENT_TASK_START", {"task_id": task_id, "url": req.url})
    
    return {
        "ok": True,
        "task_id": task_id,
        "task": req.task,
        "message": f"Autonomous agent initialized for task: '{req.task}'"
    }

@router.post("/task/step", response_model=AgentStepResponse)
def execute_step(req: AgentStepRequest):
    if not req.client_attested:
        raise HTTPException(
            status_code=400,
            detail="Agent step rejected: Client-side privacy attestation is missing"
        )

    # Privacy verification boundary: Ensure no raw sensitive values escaped content script
    if req.sanitized_findings:
        for finding in req.sanitized_findings:
            val = finding.get("value", "")
            if val and not (val.startswith("[") and val.endswith("]")):
                raise HTTPException(
                    status_code=400,
                    detail="Agent step rejected by Local Privacy Firewall: Raw unredacted data detected"
                )

    step_response = plan_next_agent_step(req)
    
    log_safe_audit("AGENT_STEP_EXECUTED", {
        "task_id": req.task_id,
        "step_number": req.step_number,
        "action_type": step_response.action.type,
        "risk_level": step_response.action.risk,
        "requires_hitl": step_response.requires_hitl
    })

    return step_response
