import unittest
import sys
from pathlib import Path

SERVER_DIR = Path(__file__).resolve().parent.parent / "local-server"
if str(SERVER_DIR) not in sys.path:
    sys.path.insert(0, str(SERVER_DIR))

from app.firewall import contains_raw_pii, contains_unsafe_payload

class TestPrivacyFirewall(unittest.TestCase):
    def test_contains_raw_pii(self):
        self.assertTrue(contains_raw_pii("Contact me at user@domain.com"))
        self.assertTrue(contains_raw_pii("My phone is 9876543210"))
        self.assertFalse(contains_raw_pii("Sanitized: [EMAIL] and [PHONE]"))

    def test_nested_payload_rejects_raw_pii_and_password_values(self):
        self.assertTrue(contains_unsafe_payload({'nested': {'email': 'user@domain.com'}}))
        self.assertTrue(contains_unsafe_payload({'password': 'not-a-placeholder'}))
        self.assertFalse(contains_unsafe_payload({'scan': {'value': '[PASSWORD]'}}))

if __name__ == '__main__':
    unittest.main()
