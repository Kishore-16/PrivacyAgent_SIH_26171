class PrivacyFirewall {
  static checkPayload(payload) {
    const jsonString = typeof payload === 'string' ? payload : JSON.stringify(payload);
    
    // Test payload for any unredacted raw PII patterns
    const unredactedPII = [
      PrivacyPatterns.EMAIL,
      PrivacyPatterns.PHONE,
      PrivacyPatterns.PAN,
      PrivacyPatterns.AADHAAR,
      PrivacyPatterns.CARD
    ].some(re => {
      re.lastIndex = 0;
      return re.test(jsonString);
    });

    if (unredactedPII) {
      throw new Error("NETWORK BLOCKED — UNSANITIZED DATA DETECTED");
    }

    return true;
  }

  static sanitizePayload(payload) {
    if (!payload) return payload;
    let serialized = typeof payload === 'string' ? payload : JSON.stringify(payload);
    
    serialized = RedactionEngine.sanitizeText(serialized, 'SEMANTIC');
    
    // Final verification check
    this.checkPayload(serialized);

    try {
      return JSON.parse(serialized);
    } catch (e) {
      return serialized;
    }
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = PrivacyFirewall;
}
