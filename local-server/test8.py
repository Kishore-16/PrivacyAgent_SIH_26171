import requests
import base64
import os
import json
from dotenv import load_dotenv

load_dotenv(".env")
api_key = os.getenv("OPENROUTER_API_KEY")

# Create a 2MB dummy image
dummy_data = os.urandom(2 * 1024 * 1024)
encoded = base64.b64encode(dummy_data).decode("utf-8")
image = f"data:image/jpeg;base64,{encoded}"

payload = {
    "model": "dots-studio/dots-3-note-preview:free",
    "messages": [
        {
            "role": "user",
            "content": [
                {"type": "text", "text": "test"},
                {"type": "image_url", "image_url": {"url": image}}
            ]
        }
    ]
}

resp = requests.post(
    "https://openrouter.ai/api/v1/chat/completions",
    headers={
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json"
    },
    json=payload
)
print("STATUS:", resp.status_code)
try:
    print(resp.json())
except:
    print(resp.text)
