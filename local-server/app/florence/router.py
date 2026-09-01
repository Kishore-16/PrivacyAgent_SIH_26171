import logging
from typing import Optional, Dict, Any
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.florence.florence_engine import florence_engine, MODEL_NAME
from app.firewall import log_safe_audit

logger = logging.getLogger("FlorenceRouter")

router = APIRouter()

class FlorenceLayer2Request(BaseModel):
    image: str
    redaction_mode: Optional[str] = "BLUR"
    client_attestation: Optional[bool] = True

@router.get("/health")
def florence_health():
    return {
        "status": "ok",
        "module": "florence2-vision-layer2-sanitizer",
        "model": MODEL_NAME,
        "mode": "on-device-non-dom-vision-redaction"
    }

@router.post("/analyze-layer2")
def analyze_layer2(req: FlorenceLayer2Request):
    if not req.image:
        raise HTTPException(status_code=400, detail="Missing canvas/image screenshot data")
    
    result = florence_engine.process_layer2_sanitization(req.image)
    
    log_safe_audit("FLORENCE_LAYER2_SANITY", {
        "model": MODEL_NAME,
        "detections_count": len(result.get("detections", [])),
        "faces_count": result.get("faces_count", 0),
        "redactions_applied": result.get("redactions", 0),
        "latency_ms": result.get("latency_ms", 0)
    })
    
    return result
