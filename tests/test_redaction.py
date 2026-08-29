import unittest
import sys
from pathlib import Path

# Add local-server root to python path
SERVER_DIR = Path(__file__).resolve().parent.parent / "local-server"
if str(SERVER_DIR) not in sys.path:
    sys.path.insert(0, str(SERVER_DIR))

from app.firewall import sanitize_text

class TestRedaction(unittest.TestCase):
    def test_semantic_redaction(self):
        text = "User Rahul (rahul@gmail.com, Phone: 9876543210, PAN: ABCDE1234F)"
        redacted = sanitize_text(text)
        self.assertNotIn("rahul@gmail.com", redacted)
        self.assertNotIn("9876543210", redacted)
        self.assertNotIn("ABCDE1234F", redacted)
        self.assertIn("[EMAIL]", redacted)
        self.assertIn("[PHONE]", redacted)
        self.assertIn("[PAN]", redacted)

if __name__ == '__main__':
    unittest.main()
