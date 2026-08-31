class PrivacyFirewall {
  static checkPayload(payload) {
    const jsonString = typeof payload === 'string' ? payload : JSON.stringify(payload);
    
    // We remove numbers that look like timestamps (13 digits starting with 17) 
    // from the string before checking, to avoid false positives on the CARD regex.
    const stringToTest = jsonString.replace(/\b17\d{11}\b/g, 'TIMESTAMP');

    // Test payload for any unredacted raw PII patterns
    const unredactedPII = [
      PrivacyPatterns.EMAIL,
      PrivacyPatterns.PHONE,
      PrivacyPatterns.PAN,
      PrivacyPatterns.AADHAAR,
      PrivacyPatterns.CARD
    ].some(re => {
      re.lastIndex = 0;
      return re.test(stringToTest);
    });

    if (unredactedPII) {
      throw new Error("NETWORK BLOCKED — UNSANITIZED DATA DETECTED");
    }

    return true;
  }

  static sanitizePayload(payload) {
    if (!payload) return payload;

    // Safely sanitize strings recursively to avoid corrupting JSON structure
    const sanitizeDeep = (obj) => {
      if (typeof obj === 'string') {
        return RedactionEngine.sanitizeText(obj, 'SEMANTIC');
      } else if (Array.isArray(obj)) {
        return obj.map(sanitizeDeep);
      } else if (obj !== null && typeof obj === 'object') {
        const sanitizedObj = {};
        for (const key in obj) {
          sanitizedObj[key] = sanitizeDeep(obj[key]);
        }
        return sanitizedObj;
      }
      return obj; // Keep numbers, booleans, etc. intact
    };

    let parsed = payload;
    if (typeof payload === 'string') {
      try { parsed = JSON.parse(payload); } catch(e) {}
    }

    const sanitizedObject = sanitizeDeep(parsed);
    const serialized = JSON.stringify(sanitizedObject);
    
    // Final verification check
    this.checkPayload(serialized);

    return sanitizedObject;
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = PrivacyFirewall;
}
