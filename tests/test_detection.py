import unittest
import re

EMAIL_RE = re.compile(r'\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b', re.I)
PHONE_RE = re.compile(r'\b(?:\+?91[-\s]?)?[6-9]\d{9}\b')
PAN_RE = re.compile(r'\b[A-Z]{5}\d{4}[A-Z]\b', re.I)
AADHAAR_RE = re.compile(r'\b\d{4}[\s-]?\d{4}[\s-]?\d{4}\b')
CARD_RE = re.compile(r'\b(?:\d[ -]*?){13,19}\b')

class TestPrivacyDetection(unittest.TestCase):
    def test_email_detection(self):
        sample = "Contact us at rahul.kumar@example.com for support."
        match = EMAIL_RE.search(sample)
        self.assertIsNotNone(match)
        self.assertEqual(match.group(0), "rahul.kumar@example.com")

    def test_phone_detection(self):
        sample = "Call +91 9876543210 for urgent updates."
        match = PHONE_RE.search(sample)
        self.assertIsNotNone(match)

    def test_pan_detection(self):
        sample = "User PAN is ABCDE1234F."
        match = PAN_RE.search(sample)
        self.assertIsNotNone(match)
        self.assertEqual(match.group(0), "ABCDE1234F")

    def test_aadhaar_detection(self):
        sample = "Aadhaar ID: 1234 5678 9012"
        match = AADHAAR_RE.search(sample)
        self.assertIsNotNone(match)

    def test_card_detection(self):
        sample = "Card number 4111 2222 3333 4444"
        match = CARD_RE.search(sample)
        self.assertIsNotNone(match)

if __name__ == '__main__':
    unittest.main()
