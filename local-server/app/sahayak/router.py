import logging
from typing import Optional, Dict, Any
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.sahayak.guide_engine import generate_dynamic_guide, FALLBACK_DATABASE
from app.vision import analyze_and_redact_screenshot
from app.firewall import log_safe_audit

logger = logging.getLogger("SahayakRouter")

router = APIRouter()

class DocumentProcessRequest(BaseModel):
    document_type: Optional[str] = "generic"
    image_data: str
    redaction_mode: Optional[str] = "BLUR"
    client_attestation: bool = True

class DynamicGuideRequest(BaseModel):
    doc_name: Optional[str] = "Income Certificate"
    state_context: Optional[str] = "General India"
    language: Optional[str] = "en"

@router.get("/health")
def sahayak_health():
    return {
        "status": "ok",
        "module": "sahayak-smart-document-helper-v2",
        "ai_engine": "openrouter-dynamic-llm",
        "supported_languages": ["en", "hi", "ta", "te", "bn"],
        "mode": "on-device-privacy-redacted"
    }

@router.get("/guides")
def get_guides(doc: Optional[str] = "Income Certificate", state: Optional[str] = "General India", lang: Optional[str] = "en"):
    guide = generate_dynamic_guide(doc_query=doc, state_context=state, language=lang)
    return {
        "ok": True,
        "guide": guide
    }

@router.post("/guides/generate")
def generate_guides_post(req: DynamicGuideRequest):
    guide = generate_dynamic_guide(
        doc_query=req.doc_name or "Income Certificate",
        state_context=req.state_context or "General India",
        language=req.language or "en"
    )
    return {
        "ok": True,
        "guide": guide
    }

@router.post("/process-document")
def process_document(req: DocumentProcessRequest):
    if not req.image_data:
        raise HTTPException(status_code=400, detail="Missing document image data")
    
    if not req.client_attestation:
        raise HTTPException(
            status_code=400,
            detail="Sahayak privacy error: Client-side privacy attestation is required"
        )
    
    # Process document image through local vision redaction pipeline
    result = analyze_and_redact_screenshot(req.image_data, redaction_mode=req.redaction_mode)
    
    log_safe_audit("SAHAYAK_DOCUMENT_PROCESSED", {
        "doc_type": req.document_type,
        "redactions_applied": result.get("redactions", 0),
        "faces_detected": len(result.get("faces", [])),
        "latency_ms": result.get("latency_ms", 0)
    })
    
    return {
        "ok": True,
        "document_type": req.document_type,
        "sanitized_document": result.get("sanitized_image"),
        "redactions_count": result.get("redactions", 0),
        "faces_count": len(result.get("faces", [])),
        "tesseract_available": result.get("tesseract_available", False),
        "latency_ms": result.get("latency_ms", 0),
        "message": f"Document '{req.document_type}' sanitized locally by Sahayak Privacy Engine"
    }
