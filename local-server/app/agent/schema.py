from pydantic import BaseModel, Field
from typing import Optional, List, Dict, Any

class ActionModel(BaseModel):
    type: str = Field(..., description="Action type: CLICK, CLICK_COORDINATE, TYPE, TYPE_AND_ENTER, TYPE_AND_SELECT, SELECT, NAVIGATE, SCROLL, WAIT, DISMISS_MODAL, LOCAL_AUTOFILL, COMPLETE")
    target_id: Optional[str] = Field(None, description="DOM element agent ID (e.g. node-3 or shadow-host-2/node-5)")
    selector: Optional[str] = Field(None, description="CSS selector of target element")
    value: Optional[str] = Field(None, description="Text value to type, option to select, or profile field key to fill")
    url: Optional[str] = Field(None, description="Target URL for navigation")
    x: Optional[int] = Field(None, description="Viewport X coordinate for CLICK_COORDINATE actions")
    y: Optional[int] = Field(None, description="Viewport Y coordinate for CLICK_COORDINATE actions")
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
    url: Optional[str] = None
    title: Optional[str] = None
    client_attested: bool = True
    # --- New fields for intelligent agent loop ---
    screenshot: Optional[str] = Field(None, description="Redacted base64 screenshot of the current page")
    action_history: List[Dict[str, Any]] = Field(default_factory=list, description="History of previous actions and their outcomes")
    page_alerts: List[Dict[str, Any]] = Field(default_factory=list, description="Detected modals, popups, errors, and alert dialogs on the page")
    visible_text: Optional[str] = Field(None, description="Key visible text content from the page (headings, labels, error messages)")
    last_action_result: Optional[str] = Field(None, description="Outcome of the last action: success, no_change, error_detected, navigation")

class AgentStepResponse(BaseModel):
    task_id: str
    step_number: int
    thought: str
    action: ActionModel
    requires_hitl: bool = False
    hitl_prompt: Optional[str] = None
    completed: bool = False
    status_summary: str
