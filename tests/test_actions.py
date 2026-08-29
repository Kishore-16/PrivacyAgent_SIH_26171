import unittest
import sys
from pathlib import Path

SERVER_DIR = Path(__file__).resolve().parent.parent / "local-server"
if str(SERVER_DIR) not in sys.path:
    sys.path.insert(0, str(SERVER_DIR))

from app.planner import ALLOWED_ACTIONS, DISALLOWED_ACTIONS, plan_action

class TestActionValidation(unittest.TestCase):
    def test_allow_list(self):
        self.assertIn("CLICK", ALLOWED_ACTIONS)
        self.assertIn("SCROLL", ALLOWED_ACTIONS)
        self.assertIn("HIGHLIGHT", ALLOWED_ACTIONS)
        self.assertNotIn("EXECUTE_JAVASCRIPT", ALLOWED_ACTIONS)

    def test_rejection(self):
        self.assertIn("EXECUTE_JAVASCRIPT", DISALLOWED_ACTIONS)
        self.assertIn("RUN_COMMAND", DISALLOWED_ACTIONS)

    def test_planner_safe_action(self):
        context = {
            'controls': [{'selector': '#btn-submit', 'text': 'Submit Application'}],
            'scan': {'findings': []}
        }
        res = plan_action(context)
        self.assertTrue(res['ok'])
        self.assertEqual(res['action']['type'], 'CLICK')
        self.assertEqual(res['action']['risk'], 'high')

if __name__ == '__main__':
    unittest.main()
