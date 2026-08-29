import unittest
import sys
from pathlib import Path

TESTS_DIR = Path(__file__).resolve().parent

if __name__ == '__main__':
    print("========================================")
    print("RUNNING PRIVACYAGENT AUTOMATED TEST SUITE")
    print("========================================")
    
    loader = unittest.TestLoader()
    suite = loader.discover(start_dir=str(TESTS_DIR), pattern="test_*.py")
    
    runner = unittest.TextTestRunner(verbosity=2)
    result = runner.run(suite)

    if result.wasSuccessful():
        print("\n[SUCCESS] All PrivacyAgent tests passed cleanly!")
        sys.exit(0)
    else:
        print("\n[FAILURE] Some PrivacyAgent tests failed.")
        sys.exit(1)
