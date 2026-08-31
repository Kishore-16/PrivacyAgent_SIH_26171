import requests
import json
resp = requests.get("https://openrouter.ai/api/v1/models")
models = resp.json().get("data", [])
for m in models:
    if "free" in m["id"].lower():
        print(m["id"])
