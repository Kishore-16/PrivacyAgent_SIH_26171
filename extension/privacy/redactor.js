class RedactionEngine {
  static sanitizeText(text, mode = 'SEMANTIC') {
    if (!text) return '';
    let out = text;
    
    if (mode === 'BLACKOUT') {
      out = out.replace(PrivacyPatterns.EMAIL, '████████')
               .replace(PrivacyPatterns.PHONE, '████████')
               .replace(PrivacyPatterns.PAN, '████████')
               .replace(PrivacyPatterns.AADHAAR, '████████')
               .replace(PrivacyPatterns.CARD, '████████');
    } else {
      // SEMANTIC or BLUR replacement
      out = out.replace(PrivacyPatterns.EMAIL, '[EMAIL]')
               .replace(PrivacyPatterns.PHONE, '[PHONE]')
               .replace(PrivacyPatterns.PAN, '[PAN]')
               .replace(PrivacyPatterns.AADHAAR, '[AADHAAR]')
               .replace(PrivacyPatterns.CARD, '[CARD]');
    }
    return out;
  }

  static createSanitizedSnapshot(mode = 'SEMANTIC', conservativeMode = false) {
    const scanResult = DOMPrivacyDetector.scanPage();
    const clone = document.documentElement.cloneNode(true);

    // Strip unsafe elements
    clone.querySelectorAll('script, style, noscript, iframe').forEach(el => el.remove());

    // Sanitize interactive form inputs
    clone.querySelectorAll('input, textarea, select').forEach(el => {
      const kind = DOMPrivacyDetector.isSensitiveElement(el);
      if (kind || conservativeMode) {
        const replacementTag = kind ? `[${kind}]` : '[REDACTED_FIELD]';
        el.removeAttribute('value');
        el.setAttribute('data-privacy-redacted', 'true');
        el.value = replacementTag;
        el.setAttribute('placeholder', replacementTag);
      }
    });

    // Sanitize text nodes
    const walker = document.createTreeWalker(clone, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      node.nodeValue = this.sanitizeText(node.nodeValue, mode);
    }

    const serializedHtml = new XMLSerializer().serializeToString(clone);
    return {
      html: serializedHtml.slice(0, 180000),
      scan: scanResult,
      timestamp: Date.now()
    };
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = RedactionEngine;
}
