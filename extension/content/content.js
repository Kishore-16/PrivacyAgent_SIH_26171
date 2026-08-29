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

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    try {
      if (msg.type === 'SCAN') {
        sendResponse(performScan());
      } else if (msg.type === 'SNAPSHOT') {
        sendResponse(RedactionEngine.createSanitizedSnapshot());
      } else if (msg.type === 'DOM_CONTEXT') {
        sendResponse(getSanitizedContext());
      } else if (msg.type === 'EXECUTE_ACTION') {
        const res = ActionExecutor.execute(msg.action);
        addAuditRecord('EXECUTE_ACTION', { action: msg.action?.type || 'UNKNOWN' });
        sendResponse(res);
      }
    } catch (err) {
      sendResponse({ ok: false, error: err.message });
    }
    return true;
  });

  // Initial scan on document load
  performScan();
})();
