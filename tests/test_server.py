import unittest
import sys
from pathlib import Path
from fastapi.testclient import TestClient

SERVER_DIR = Path(__file__).resolve().parent.parent / "local-server"
if str(SERVER_DIR) not in sys.path:
    sys.path.insert(0, str(SERVER_DIR))

from app.main import app

class TestServerAPI(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)

    def test_health_endpoint(self):
        response = self.client.get("/health")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data.get("status"), "ok")
        self.assertEqual(data.get("service"), "privacyagent-local-vision")

    def test_plan_endpoint(self):
        response = self.client.post("/plan", json={"context": {"controls": [], "scan": {"findings": []}}})
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertTrue(data.get("ok"))

    def test_plan_endpoint_rejects_nested_raw_pii(self):
        response = self.client.post("/plan", json={"context": {"nested": {"email": "user@domain.com"}}})
        self.assertEqual(response.status_code, 400)

    def test_vision_endpoint_requires_client_redaction_attestation(self):
        response = self.client.post("/vision/analyze", json={"image": "not-an-image", "sanitized": False})
        self.assertEqual(response.status_code, 400)

if __name__ == '__main__':
    unittest.main()
