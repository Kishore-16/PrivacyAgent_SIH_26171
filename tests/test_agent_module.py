import sys
import unittest
from pathlib import Path
from fastapi.testclient import TestClient

SERVER_DIR = Path(__file__).resolve().parent.parent / "local-server"
if str(SERVER_DIR) not in sys.path:
    sys.path.insert(0, str(SERVER_DIR))

from app.main import app
from app.agent.safety import evaluate_action_risk
from app.agent.planner import plan_next_agent_step
from app.agent.schema import AgentStepRequest

class TestAgentModule(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)

    def test_agent_health(self):
        response = self.client.get("/agent/health")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data.get("status"), "ok")
        self.assertEqual(data.get("module"), "autonomous-privacy-agent-v1")

    def test_agent_task_start(self):
        response = self.client.post("/agent/task/start", json={"task": "Find Nitro V15 laptop"})
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertTrue(data.get("ok"))
        self.assertTrue(data.get("task_id").startswith("task-"))

    def test_agent_step_requires_attestation(self):
        response = self.client.post("/agent/task/step", json={
            "task_id": "test-1",
            "goal": "Buy laptop",
            "step_number": 1,
            "client_attested": False
        })
        self.assertEqual(response.status_code, 400)
        self.assertIn("attestation is missing", response.json().get("detail", ""))

    def test_agent_step_rejects_raw_pii(self):
        response = self.client.post("/agent/task/step", json={
            "task_id": "test-2",
            "goal": "Send deposit",
            "step_number": 1,
            "client_attested": True,
            "sanitized_findings": [{"type": "EMAIL", "value": "unredacted@user.com"}]
        })
        self.assertEqual(response.status_code, 400)
        self.assertIn("Raw unredacted data detected", response.json().get("detail", ""))

    def test_safety_gate_triggers_hitl_on_financial_operations(self):
        risk_level, requires_hitl, reason = evaluate_action_risk("CLICK", "Submit Deposit", "", "http://bank.com/transfer")
        self.assertEqual(risk_level, "high")
        self.assertTrue(requires_hitl)
        self.assertIn("sensitive operation", reason)

    def test_product_search_planning(self):
        req = AgentStepRequest(
            task_id="task-3",
            goal="Find Nitro V15 laptop at lowest price",
            step_number=1,
            url="http://amazon.in/search",
            dom_nodes=[
                {"agentId": "node-1", "tag": "input", "type": "text", "placeholder": "Search items", "selector": "#search"}
            ],
            client_attested=True
        )

        res = plan_next_agent_step(req)
        self.assertEqual(res.action.type, "TYPE_AND_ENTER")
        self.assertEqual(res.action.target_id, "node-1")
        self.assertFalse(res.requires_hitl)

if __name__ == "__main__":
    unittest.main()
