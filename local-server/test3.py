import requests
import json
import os
from dotenv import load_dotenv
load_dotenv(".env")
api_key = os.getenv("OPENROUTER_API_KEY")
payload = {
    "model": "meta-llama/llama-3.2-11b-vision-instruct:free",
    "messages": [
        {"role": "user", "content": "hi"}
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
