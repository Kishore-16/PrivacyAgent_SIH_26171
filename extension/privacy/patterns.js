const PrivacyPatterns = {
  EMAIL: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/ig,
  PHONE: /\b(?:\+?91[-\s]?)?[6-9]\d{9}\b/g,
  PAN: /\b[A-Z]{5}\d{4}[A-Z]\b/g,
  AADHAAR: /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g,
  CARD: /\b(?:\d[ -]*?){13,19}\b/g,
  ACCOUNT: /\b\d{4}[-]?\d{4}[-]?\d{4}\b/g,
  
  SENSITIVE_LABELS: /password|passcode|otp|email|e-mail|phone|mobile|telephone|pan|aadhaar|aadhar|account|card|ssn|personal id|date of birth|dob|address|bank|credit|debit/i
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = PrivacyPatterns;
}
