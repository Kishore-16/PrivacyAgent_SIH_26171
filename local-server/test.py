import os
import json
from app.planner import plan_action

# Make sure we use the same dot env
from dotenv import load_dotenv
load_dotenv(".env")

context = {
    "controls": [{"text": "Forgot password?", "selector": "#forgot"}],
    "scan": {"findings": []}
}
image = "https://example.com/image.png"

res = plan_action(context, image, "Log in")
print(json.dumps(res, indent=2))
