import os
import sys
from pathlib import Path
import uvicorn
from dotenv import load_dotenv

# Ensure local-server root is on Python path
SERVER_DIR = Path(__file__).resolve().parent
if str(SERVER_DIR) not in sys.path:
    sys.path.insert(0, str(SERVER_DIR))

# Load .env if present
env_file = SERVER_DIR / ".env"
if env_file.exists():
    load_dotenv(env_file)

HOST = os.getenv("PRIVACYAGENT_HOST", "127.0.0.1")
PORT = int(os.getenv("PRIVACYAGENT_PORT", "8000"))

# Enforce binding strictly to localhost / 127.0.0.1 for security
if HOST not in ("127.0.0.1", "localhost"):
    print(f"[SECURITY WARNING] Requested host '{HOST}' changed to '127.0.0.1' (Privacy Requirement).")
    HOST = "127.0.0.1"

if __name__ == "__main__":
    print(f"========================================")
    print(f"PRIVACYAGENT LOCAL VISION SERVER")
    print(f"Binding: http://{HOST}:{PORT}")
    print(f"Health:  http://{HOST}:{PORT}/health")
    print(f"Demo:    http://{HOST}:{PORT}/demo")
    print(f"========================================")
    uvicorn.run("app.main:app", host=HOST, port=PORT, log_level="info")
