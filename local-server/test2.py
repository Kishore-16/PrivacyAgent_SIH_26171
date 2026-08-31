import requests
import json
import os
from dotenv import load_dotenv
load_dotenv(".env")
api_key = os.getenv("OPENROUTER_API_KEY")
payload = {
    "model": "dots-studio/dots-3-note-preview:free",
    "messages": [
        {
            "role": "user", 
            "content": [
                {"type": "text", "text": "hi"},
                {"type": "image_url", "image_url": {"url": "https://example.com/image.png"}}
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
print(resp.status_code)
print(resp.json())
