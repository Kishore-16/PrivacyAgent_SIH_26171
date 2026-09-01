from pydantic import BaseModel, Field
from typing import Optional, List, Dict, Any

class ActionModel(BaseModel):
    type: str = Field(..., description="Action type: CLICK, TYPE, NAVIGATE, SCROLL, LOCAL_AUTOFILL, COMPLETE")
    target_id: Optional[str] = Field(None, description="DOM element agent ID (e.g. agent-node-3)")
    selector: Optional[str] = Field(None, description="CSS selector of target element")
    value: Optional[str] = Field(None, description="Text value to type or profile field key to fill")
    url: Optional[str] = Field(None, description="Target URL for navigation")
    label: Optional[str] = Field(None, description="Human readable label of action")
    risk: str = Field("low", description="Risk level: low, medium, high")
    reason: Optional[str] = Field(None, description="Explanation for safety classification")

class AgentTaskStartRequest(BaseModel):
    task: str = Field(..., description="Natural language goal provided by user")
    url: Optional[str] = Field(None, description="Current page URL")

class AgentStepRequest(BaseModel):
    task_id: str
    goal: str
    step_number: int = 1
    dom_nodes: List[Dict[str, Any]] = Field(default_factory=list)
    sanitized_findings: List[Dict[str, Any]] = Field(default_factory=list)
    sanitized_image: Optional[str] = Field(None, description="Final 2-stage dual-sanitized image (Stage 1 DOM + Stage 2 Florence-2)")
    url: Optional[str] = None
    title: Optional[str] = None
    client_attested: bool = True
    stage2_attested: bool = True


class AgentStepResponse(BaseModel):
    task_id: str
    step_number: int
    thought: str
    action: ActionModel
    requires_hitl: bool = False
    hitl_prompt: Optional[str] = None
    completed: bool = False
    status_summary: str
