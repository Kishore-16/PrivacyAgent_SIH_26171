# PrivacyAgent — On-device Visual Perception for Lightweight Browser Agents
## SIH Problem Statement 26171 Final Project

PrivacyAgent is a Chrome Manifest V3 extension and on-device privacy engine. It enforces strict DOM PII detection, local image/OCR visual redaction, sanitized context generation, a constrained safe-action planner, and user-gated browser action execution. Zero raw sensitive information ever leaves the user's device.

---

## 🚀 Quick Start (One-Click Setup)

### 1. Extract & Launch
1. Extract the project ZIP folder.
2. Double-click `START.bat`.
   - `START.bat` automatically checks Python, initializes the virtual environment (`.venv`), installs dependencies, launches the local server on `http://127.0.0.1:8000`, and opens the demo application automatically.

### 2. One-Time Chrome Extension Installation
1. Open Google Chrome and navigate to `chrome://extensions`.
2. Enable **Developer mode** (toggle in the top-right corner).
3. Click **Load unpacked**.
4. Select the `extension/` directory from the extracted project folder.
5. Pin **PrivacyAgent** to your extension bar.

---

## 🎯 Demo & Verification Workflow

1. With `START.bat` running, open `http://127.0.0.1:8000/demo` (Mock Banking Portal).
2. Click the **PrivacyAgent** extension icon to open the Privacy Dashboard.
3. Verify status pill displays `🟢 PRIVACY FIREWALL ACTIVE`.
4. Click **`1. Scan Page & Detect PII`**:
   - Inspect local DOM and pattern detection metrics (Emails, Phones, PANs, Passwords).
5. Click **`2. Show Sanitized View`**:
   - Compare the original page against the sanitized visual screenshot and DOM structure.
6. Click **`3. Get Safe Agent Action`**:
   - The deterministic planner recommends an action (`CLICK` "SUBMIT APPLICATION").
   - Since "Submit" is a high-risk action, PrivacyAgent prompts the mandatory confirmation dialog: `PrivacyAgent wants to execute high-risk action: CLICK "Submit Application"`.
7. Click **`ALLOW ONCE`** to execute the safe browser action.

---

## 🛡️ Architecture & Security Guarantees

- **Target Architecture**:
  ```
  USER → CHROME EXTENSION → DOM PRIVACY ENGINE → PATTERN/PII DETECTOR
       → LOCAL REDACTION ENGINE → SCREENSHOT / VISUAL ANALYSIS → LOCAL VISION SERVICE
       → SANITIZED CONTEXT → LOCAL PLANNER → SAFE ACTION VALIDATOR
       → USER CONFIRMATION → BROWSER EXECUTION
  ```
- **Local Vision Server**: Runs strictly bound to `127.0.0.1:8000` (never `0.0.0.0`).
- **Privacy Firewall**: Intercepts outgoing payloads; blocks requests if unredacted PII is detected (`NETWORK BLOCKED — UNSANITIZED DATA DETECTED`).
- **Safe Action Allow-list**: Permits `CLICK`, `SCROLL`, `HIGHLIGHT`, `TYPE`; strictly rejects `EXECUTE_JAVASCRIPT`, `RUN_COMMAND`, `NAVIGATE_ANYWHERE`, `DOWNLOAD_FILE`.
- **Zero Raw PII Storage**: Server logs and local audit logs store counts and event metadata only.

---

## 🛑 Stopping the Server

Double-click `STOP.bat` to safely terminate the local PrivacyAgent server listening on port 8000.
