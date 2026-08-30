import base64
import io
import json
import os
import re
import shutil
import subprocess
import tempfile
import time
import logging
from pathlib import Path
from PIL import Image, ImageFilter, ImageDraw, ImageFont
import cv2
import numpy as np

logger = logging.getLogger("LocalVisionEngine")

EMAIL_RE = re.compile(r'\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b', re.I)
PHONE_RE = re.compile(r'\b(?:\+?91[-\s]?)?[6-9]\d{9}\b')
PAN_RE = re.compile(r'\b[A-Z]{5}\d{4}[A-Z]\b', re.I)
AADHAAR_RE = re.compile(r'\b\d{4}[\s-]?\d{4}[\s-]?\d{4}\b')
CARD_RE = re.compile(r'\b(?:\d[ -]*?){13,19}\b')

# Attempt to load pytesseract safely
# Auto-configure Tesseract binary path for Windows
TESS_PATHS = [
    r"C:\Program Files\Tesseract-OCR\tesseract.exe",
    r"C:\Program Files (x86)\Tesseract-OCR\tesseract.exe",
    os.path.join(os.getenv("LOCALAPPDATA", ""), "Tesseract-OCR", "tesseract.exe"),
    os.getenv("TESSERACT_CMD", ""),
]

HAS_PYTESSERACT = False
try:
    import pytesseract
    HAS_PYTESSERACT = True
    # Auto-configure tesseract_cmd if not already found on PATH
    if not shutil.which("tesseract"):
        for p in TESS_PATHS:
            if p and os.path.isfile(p):
                pytesseract.pytesseract.tesseract_cmd = p
                logger.info(f"Tesseract binary configured at: {p}")
                break
    else:
        logger.info("Tesseract binary found on system PATH")
except ImportError:
    HAS_PYTESSERACT = False

# Detect Node.js and tesseract.js OCR worker
HAS_NODE = shutil.which("node") is not None
OCR_WORKER_PATH = Path(__file__).resolve().parent.parent / "ocr_worker.js"
HAS_TESSERACTJS = HAS_NODE and OCR_WORKER_PATH.exists()
if HAS_TESSERACTJS:
    logger.info(f"tesseract.js OCR worker available at: {OCR_WORKER_PATH}")


def _run_tesseractjs_ocr(im: 'Image.Image') -> dict:
    """Run OCR via tesseract.js Node.js worker subprocess.
    Returns a dict with keys: text, conf, left, top, width, height (lists).
    """
    # Save image to a temp file as base64 data URI
    buf = io.BytesIO()
    im.save(buf, format='PNG')
    data_uri = 'data:image/png;base64,' + base64.b64encode(buf.getvalue()).decode('utf-8')

    tmp_file = Path(tempfile.gettempdir()) / 'privacyagent_ocr_input.txt'
    tmp_file.write_text(data_uri, encoding='utf-8')

    result = subprocess.run(
        ['node', str(OCR_WORKER_PATH), str(tmp_file), '--psm', '6'],
        capture_output=True, text=True, timeout=30,
        cwd=str(OCR_WORKER_PATH.parent.parent)  # project root with node_modules
    )

    # Clean up temp file
    try:
        tmp_file.unlink()
    except OSError:
        pass

    if result.returncode != 0:
        raise RuntimeError(f"tesseract.js worker failed: {result.stderr}")

    return json.loads(result.stdout)

def decode_base64_image(data_str: str) -> Image.Image:
    if ',' in data_str:
        data_str = data_str.split(',', 1)[1]
    image_bytes = base64.b64decode(data_str)
    return Image.open(io.BytesIO(image_bytes)).convert('RGB')

def encode_image_base64(img: Image.Image) -> str:
    buf = io.BytesIO()
    img.save(buf, format='PNG')
    return 'data:image/png;base64,' + base64.b64encode(buf.getvalue()).decode('utf-8')

def detect_pii_kind(text: str) -> str:
    if not text:
        return None
    if EMAIL_RE.search(text):
        return 'EMAIL'
    if PHONE_RE.search(text):
        return 'PHONE'
    if PAN_RE.search(text):
        return 'PAN'
    if AADHAAR_RE.search(text):
        return 'AADHAAR'
    if CARD_RE.search(text):
        return 'CARD'
    low = text.lower()
    if any(k in low for k in ['password', 'passcode', 'otp', 'account number', 'ssn', 'dob', 'date of birth']):
        return 'PASSWORD'
    return None

def analyze_and_redact_screenshot(image_data: str, redaction_mode: str = "BLUR"):
    started = time.perf_counter()
    im = decode_base64_image(image_data)
    arr = cv2.cvtColor(np.array(im), cv2.COLOR_RGB2BGR)
    gray = cv2.cvtColor(arr, cv2.COLOR_BGR2GRAY)

    detections = []
    faces = []
    
    # 1. OpenCV Haar Cascade Face Detection
    try:
        cascade_path = Path(cv2.data.haarcascades) / 'haarcascade_frontalface_default.xml'
        if cascade_path.exists():
            detector = cv2.CascadeClassifier(str(cascade_path))
            detected_faces = detector.detectMultiScale(gray, scaleFactor=1.1, minNeighbors=5, minSize=(40, 40))
            for (x, y, w, h) in detected_faces:
                faces.append({'x': int(x), 'y': int(y), 'width': int(w), 'height': int(h), 'confidence': 0.92})
                detections.append({
                    'type': 'face',
                    'x': int(x),
                    'y': int(y),
                    'width': int(w),
                    'height': int(h),
                    'confidence': 0.92
                })
    except Exception as e:
        logger.warning(f"Face detection fallback: {e}")

    ocr_results = []
    tesseract_available = False

    # 2. Text Region Analysis / OCR
    # Engine B1: Try system pytesseract first
    if HAS_PYTESSERACT:
        try:
            data = pytesseract.image_to_data(im, output_type=pytesseract.Output.DICT, config='--psm 6')
            tesseract_available = True
            logger.info("OCR engine: system pytesseract")
        except Exception as e:
            logger.info(f"System pytesseract unavailable: {e}")
            data = None
    else:
        data = None

    # Engine B2: Fall back to tesseract.js (Node.js WASM) if system Tesseract unavailable
    if data is None and HAS_TESSERACTJS:
        try:
            data = _run_tesseractjs_ocr(im)
            tesseract_available = True
            logger.info("OCR engine: tesseract.js (Node.js WASM)")
        except Exception as e:
            logger.warning(f"tesseract.js OCR failed: {e}")
            data = None

    # Process OCR results from either engine
    if data is not None:
        for i, text in enumerate(data.get('text', [])):
            text = (text or '').strip()
            if not text:
                continue
            try:
                conf = float(data['conf'][i])
            except (ValueError, TypeError):
                conf = 0.0
            if conf < 30:
                continue
            x, y, w, h = int(data['left'][i]), int(data['top'][i]), int(data['width'][i]), int(data['height'][i])
            ocr_results.append({'text': text, 'confidence': round(conf, 1), 'box': [x, y, w, h]})

            kind = detect_pii_kind(text)
            if kind:
                detections.append({
                    'type': kind.lower(),
                    'x': x,
                    'y': y,
                    'width': w,
                    'height': h,
                    'confidence': round(conf / 100.0, 2)
                })

    # Fallback OpenCV text contour region analysis if Tesseract is absent or found 0 text
    if not tesseract_available or len(ocr_results) == 0:
        # Detect text-like regions using MSER or Morphological Contours
        kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (15, 3))
        grad = cv2.morphologyEx(gray, cv2.MORPH_GRADIENT, kernel)
        _, thresh = cv2.threshold(grad, 0, 255, cv2.THRESH_BINARY | cv2.THRESH_OTSU)
        contours, _ = cv2.findContours(thresh, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        for c in contours:
            x, y, w, h = cv2.boundingRect(c)
            if w > 30 and h > 10 and w < arr.shape[1] * 0.9 and h < arr.shape[0] * 0.5:
                ocr_results.append({'text': '[VISUAL_TEXT_REGION]', 'confidence': 75.0, 'box': [int(x), int(y), int(w), int(h)]})
                detections.append({
                    'type': 'visual_text',
                    'x': int(x),
                    'y': int(y),
                    'width': int(w),
                    'height': int(h),
                    'confidence': 0.75
                })

    # 3. Apply Visual Redactions (BLACKOUT, BLUR, SEMANTIC)
    out_img = im.copy()
    draw = ImageDraw.Draw(out_img)
    redaction_count = 0

    mode = (redaction_mode or "BLUR").upper()

    for det in detections:
        x, y, w, h = det['x'], det['y'], det['width'], det['height']
        dtype = det['type']
        
        if mode == "BLACKOUT":
            draw.rectangle([x, y, x + w, y + h], fill=(15, 15, 20))
        elif mode == "SEMANTIC":
            draw.rectangle([x, y, x + w, y + h], fill=(240, 240, 245), outline=(124, 58, 237), width=2)
            label_str = f"[{dtype.upper()}]"
            draw.text((x + 4, y + 2), label_str, fill=(124, 58, 237))
        else: # Default: BLUR
            try:
                crop = out_img.crop((x, y, x + w, y + h)).filter(ImageFilter.GaussianBlur(16))
                out_img.paste(crop, (x, y))
            except Exception:
                draw.rectangle([x, y, x + w, y + h], fill=(30, 30, 30))
        
        redaction_count += 1

    latency_ms = round((time.perf_counter() - started) * 1000, 1)

    return {
        "ok": True,
        "detections": detections,
        "faces": faces,
        "ocr_count": len(ocr_results),
        "redactions": redaction_count,
        "mode_applied": mode,
        "tesseract_available": tesseract_available,
        "latency_ms": latency_ms,
        "sanitized_image": encode_image_base64(out_img)
    }
