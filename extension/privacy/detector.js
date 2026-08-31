class DOMPrivacyDetector {
  static getLabel(el) {
    if (!el) return '';
    return [
      el.getAttribute('aria-label'),
      el.getAttribute('name'),
      el.id,
      el.getAttribute('placeholder'),
      el.getAttribute('autocomplete'),
      el.getAttribute('title')
    ].filter(Boolean).join(' ').toLowerCase();
  }

  static isSensitiveElement(el) {
    if (!el || el.nodeType !== 1) return null;
    const tag = el.tagName.toLowerCase();
    
    if (['input', 'textarea', 'select'].includes(tag) || el.isContentEditable) {
      const type = (el.getAttribute('type') || '').toLowerCase();
      const label = this.getLabel(el);

      if (type === 'password' || /password|passcode|otp/.test(label)) return 'PASSWORD';
      if (type === 'email' || /email|e-mail/.test(label)) return 'EMAIL';
      if (type === 'tel' || /phone|mobile|telephone/.test(label)) return 'PHONE';
      if (/(^|\W)pan(\W|$)/.test(label)) return 'PAN';
      if (/aadhaar|aadhar/.test(label)) return 'AADHAAR';
      if (/account|card|credit|debit/.test(label)) return 'CARD';
      if (/(^|\W)(first|last|full)?\s*name(\W|$)/.test(label)) return 'NAME';
      if (PrivacyPatterns.SENSITIVE_LABELS.test(label)) return 'PII';
    }
    return null;
  }

  static getSelector(el) {
    if (!el) return '';
    if (el.id) return `#${CSS.escape(el.id)}`;
    const name = el.getAttribute('name');
    if (name) return `${el.tagName.toLowerCase()}[name="${CSS.escape(name)}"]`;
    
    let path = [], node = el;
    while (node && node.nodeType === 1 && node !== document.body) {
      let index = 1, sibling = node;
      while ((sibling = sibling.previousElementSibling)) index++;
      path.unshift(`${node.tagName.toLowerCase()}:nth-child(${index})`);
      node = node.parentElement;
    }
    return path.join(' > ') || el.tagName.toLowerCase();
  }

  static scanPage() {
    const findings = [];
    const controls = [...document.querySelectorAll('input, textarea, select, [contenteditable="true"]')];
    
    // 1. Layer 1 — DOM Detection
    controls.forEach(el => {
      const kind = this.isSensitiveElement(el);
      if (kind) {
        findings.push({
          kind,
          selector: this.getSelector(el),
          // Findings are included in planner context.  Never retain the raw
          // form value there: the kind is sufficient for redaction/auditing.
          value: `[${kind}]`,
          source: 'DOM'
        });
      }
    });

    // 2. Layer 2 — Pattern Detection across visible text nodes
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node, count = 0;
    while ((node = walker.nextNode()) && count++ < 8000) {
      const text = node.nodeValue || '';
      for (const [kind, re] of Object.entries(PrivacyPatterns)) {
        // SENSITIVE_LABELS classifies form controls; it is not a text/PII pattern.
        if (kind !== 'SENSITIVE_LABELS' && re instanceof RegExp) {
          re.lastIndex = 0;
          if (re.test(text)) {
            findings.push({
              kind,
              selector: this.getSelector(node.parentElement),
              value: `[${kind}]`,
              source: 'PATTERN'
            });
          }
        }
      }
    }

    // Deduplicate findings
    const unique = findings.filter((x, i, arr) => 
      i === arr.findIndex(y => y.kind === x.kind && y.selector === x.selector)
    );

    return {
      findings: unique,
      scannedElements: document.querySelectorAll('*').length,
      formControlsCount: controls.length,
      timestamp: Date.now()
    };
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = DOMPrivacyDetector;
}
