import os
from pathlib import Path
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel
from typing import Optional, Dict, Any

from app.vision import analyze_and_redact_screenshot
from app.planner import plan_action
from app.firewall import sanitize_text, contains_raw_pii, log_safe_audit

app = FastAPI(
    title="PrivacyAgent Local Vision Server",
    description="On-device local vision analysis & privacy agent server for SIH 26171",
    version="2.0.0"
)

# Enable CORS for local extension requests
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class VisionRequest(BaseModel):
    image: str
    redaction_mode: Optional[str] = "BLUR"

class PlanRequest(BaseModel):
    context: Dict[str, Any]

@app.get("/health")
def get_health():
    return {
        "status": "ok",
        "service": "privacyagent-local-vision",
        "mode": "on-device-only",
        "version": "2.0.0"
    }

@app.post("/vision/analyze")
@app.post("/analyze")
def vision_analyze(req: VisionRequest):
    if not req.image:
        raise HTTPException(status_code=400, detail="Missing image data")
    
    result = analyze_and_redact_screenshot(req.image, redaction_mode=req.redaction_mode)
    log_safe_audit("VISION_ANALYZE", {
        "detections_count": len(result.get("detections", [])),
        "faces_count": len(result.get("faces", [])),
        "redactions_applied": result.get("redactions", 0),
        "latency_ms": result.get("latency_ms", 0)
    })
    return result

@app.post("/plan")
def planner_endpoint(req: PlanRequest):
    context = req.context or {}
    # Verify no raw PII in text payload
    title = sanitize_text(context.get("title", ""))
    url = sanitize_text(context.get("url", ""))
    
    context["title"] = title
    context["url"] = url

    res = plan_action(context)
    log_safe_audit("PLAN_ACTION", {
        "action_type": res.get("action", {}).get("type") if res.get("ok") else "ERROR",
        "risk_level": res.get("action", {}).get("risk") if res.get("ok") else "NONE"
    })
    return res

# Mount Demo Web Application statically
demo_dir = Path(__file__).resolve().parent.parent.parent / "demo"
if demo_dir.exists():
    app.mount("/demo", StaticFiles(directory=str(demo_dir), html=True), name="demo")
    @app.get("/demo-page")
    def get_demo():
        index_file = demo_dir / "index.html"
        if index_file.exists():
            return FileResponse(str(index_file))
        raise HTTPException(status_code=404, detail="Demo index file not found")
