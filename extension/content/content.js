(() => {
  const state = {
    lastScan: null,
    auditLog: []
  };

  function addAuditRecord(event, details = {}) {
    const record = {
      timestamp: new Date().toISOString(),
      page: location.hostname || location.pathname,
      event,
      elementsScanned: details.elementsScanned || 0,
      piiDetected: details.piiDetected || 0,
      redactionsApplied: details.redactionsApplied || 0,
      action: details.action || 'NONE',
      rawPiiTransmittedBytes: 0
    };
    state.auditLog.push(record);
    if (state.auditLog.length > 100) state.auditLog.shift();

    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.set({ auditLog: state.auditLog });
    }
  }

  function getFormControlsSummary() {
    return [...document.querySelectorAll('button, input[type=submit], [role=button], a.btn')].map((el, i) => ({
      id: i,
      text: (el.innerText || el.value || el.getAttribute('aria-label') || '').trim().slice(0, 80),
      selector: DOMPrivacyDetector.getSelector(el)
    })).filter(x => x.text);
  }

  function performScan() {
    const scanRes = DOMPrivacyDetector.scanPage();
    state.lastScan = scanRes;
    addAuditRecord('SCAN_PAGE', {
      elementsScanned: scanRes.scannedElements,
      piiDetected: scanRes.findings.length,
      redactionsApplied: scanRes.findings.length
    });
    
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.set({ lastScan: scanRes });
    }
    return scanRes;
  }

  function getSanitizedContext() {
    const scanRes = performScan();
    const snapshotRes = RedactionEngine.createSanitizedSnapshot();
    
    // Pass outgoing context through PrivacyFirewall
    const sanitizedPayload = PrivacyFirewall.sanitizePayload({
      title: document.title,
      url: location.href,
      controls: getFormControlsSummary(),
      scan: scanRes
    });

    return {
      payload: sanitizedPayload,
      snapshot: snapshotRes
    };
  }

  function visibleRect(rect) {
    const left = Math.max(0, rect.left);
    const top = Math.max(0, rect.top);
    const right = Math.min(window.innerWidth, rect.right);
    const bottom = Math.min(window.innerHeight, rect.bottom);
    if (right <= left || bottom <= top) return null;
    return { left, top, width: right - left, height: bottom - top };
  }

  function getVisualRedactionRegions() {
    const regions = [];
    const addRect = (rect, kind) => {
      const visible = visibleRect(rect);
      if (visible) {
        visible.kind = kind;
        regions.push(visible);
      }
    };

    // Only mask form controls that contain sensitive data
    document.querySelectorAll('input, textarea, select, [contenteditable="true"]').forEach(el => {
      const kind = DOMPrivacyDetector.isSensitiveElement(el);
      if (kind) {
        addRect(el.getBoundingClientRect(), kind);
      }
    });

    // Add exact visible ranges for pattern-detected PII rendered as page text.
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node;
    const patterns = [
      ['EMAIL', PrivacyPatterns.EMAIL],
      ['PHONE', PrivacyPatterns.PHONE],
      ['PAN', PrivacyPatterns.PAN],
      ['AADHAAR', PrivacyPatterns.AADHAAR],
      ['CARD', PrivacyPatterns.CARD]
    ];
    
    while ((node = walker.nextNode()) && regions.length < 500) {
      const text = node.nodeValue || '';
      for (const [kind, pattern] of patterns) {
        pattern.lastIndex = 0;
        let match;
        while ((match = pattern.exec(text)) && regions.length < 500) {
          const range = document.createRange();
          range.setStart(node, match.index);
          range.setEnd(node, match.index + match[0].length);
          addRect(range.getBoundingClientRect(), kind);
          if (!pattern.global) break;
        }
      }
    }

    return {
      regions,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight
    };
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    try {
      if (msg.type === 'PING') {
        sendResponse({ ok: true });
      } else if (msg.type === 'SCAN') {
        sendResponse(performScan());
      } else if (msg.type === 'SNAPSHOT') {
        sendResponse(RedactionEngine.createSanitizedSnapshot());
      } else if (msg.type === 'DOM_CONTEXT') {
        sendResponse(getSanitizedContext());
      } else if (msg.type === 'VISUAL_REDACTION_REGIONS') {
        sendResponse(getVisualRedactionRegions());
      } else if (msg.type === 'EXECUTE_ACTION') {
        const res = ActionExecutor.execute(msg.action);
        addAuditRecord('EXECUTE_ACTION', { action: msg.action?.type || 'UNKNOWN' });
        sendResponse(res);
      } else if (msg.type === 'AUTOFILL') {
        const profile = msg.profile || {};
        let filledCount = 0;
        document.querySelectorAll('input, textarea, select, [contenteditable="true"]').forEach(el => {
          const kind = DOMPrivacyDetector.isSensitiveElement(el);
          if (kind && profile[kind]) {
            el.value = profile[kind];
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
            filledCount++;
          }
        });
        addAuditRecord('AUTOFILL', { redactionsApplied: filledCount });
        sendResponse({ ok: true, filledCount });
      }
    } catch (err) {
      sendResponse({ ok: false, error: err.message });
    }
    return true;
  });

  // Capture form submissions to update the secure profile locally
  const captureFormData = () => {
    console.log('[PrivacyAgent] Capturing profile updates...');
    const profileUpdate = {};
    let hasData = false;
    document.querySelectorAll('input, textarea, select').forEach(el => {
      const kind = DOMPrivacyDetector.isSensitiveElement(el);
      if (kind && el.value) {
        profileUpdate[kind] = el.value;
        hasData = true;
        console.log(`[PrivacyAgent] Captured ${kind}: ${el.value}`);
      }
    });

    if (hasData && typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      try {
        chrome.storage.local.get(['secureProfile'], (result) => {
          const currentProfile = result.secureProfile || {};
          const newProfile = { ...currentProfile, ...profileUpdate };
          console.log('[PrivacyAgent] Saving new profile to chrome.storage.local:', newProfile);
          chrome.storage.local.set({ secureProfile: newProfile }, () => {
            console.log('[PrivacyAgent] Save complete. Error:', chrome.runtime.lastError);
          });
          addAuditRecord('PROFILE_UPDATED', { action: 'Saved to Local Extension Storage' });
        });
      } catch (err) {
        if (err.message.includes('Extension context invalidated')) {
          alert('⚠️ PrivacyAgent Extension was reloaded!\n\nPlease refresh this webpage (F5) so the extension can reconnect and save your data.');
        } else {
          console.error('[PrivacyAgent] Storage error:', err);
        }
      }
    } else {
      console.log('[PrivacyAgent] No data captured or chrome storage unavailable.');
    }
  };

  document.addEventListener('submit', (e) => {
    captureFormData();
  }, true); // Use capturing phase to ensure we catch it

  document.addEventListener('click', (e) => {
    const target = e.target;
    // If they clicked a submit button or something inside a submit button
    if (target && (target.type === 'submit' || target.closest('button[type="submit"]', 'input[type="submit"]'))) {
      captureFormData();
    }
  }, true);

  // Initial scan on document load
  performScan();
})();
