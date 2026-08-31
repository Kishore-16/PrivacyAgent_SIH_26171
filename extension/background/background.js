const SERVER_BASE = 'http://127.0.0.1:8000';

async function fetchLocalServer(path, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60000);
  try {
    const res = await fetch(`${SERVER_BASE}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {})
      },
      signal: controller.signal
    });
    if (!res.ok) {
      throw new Error(`Local server returned HTTP ${res.status}`);
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    if (msg.type === 'HEALTH') {
      try {
        const res = await fetchLocalServer('/health');
        return res;
      } catch (e) {
        return { status: 'error', service: 'offline', error: e.message };
      }
    }

    if (msg.type === 'VISION_ANALYZE') {
      return await fetchLocalServer('/vision/analyze', {
        method: 'POST',
        body: JSON.stringify({
          image: msg.image,
          redaction_mode: msg.mode || 'BLUR',
          sanitized: msg.sanitized === true,
          redacted_regions: Number.isInteger(msg.redactedRegions) ? msg.redactedRegions : 0
        })
      });
    }

    if (msg.type === 'PLAN') {
      const sanitizedContext = msg.context || {};
      return await fetchLocalServer('/plan', {
        method: 'POST',
        body: JSON.stringify({
          context: sanitizedContext,
          image: msg.image,
          task: msg.task
        })
      });
    }

    if (msg.type === 'EXECUTE_ACTION') {
      const action = msg.action || {};
      const allowed = ['CLICK', 'SCROLL', 'HIGHLIGHT', 'TYPE', 'LOCAL_AUTOFILL', 'NAVIGATE', 'COMPLETE', 'NO_ACTION'];
      
      if (!allowed.includes(action.type)) {
        return { ok: false, error: 'Action not allow-listed' };
      }

      if (action.risk === 'high' && !msg.confirmed) {
        return { ok: false, requiresConfirmation: true };
      }

      const messageType = ['LOCAL_AUTOFILL', 'NAVIGATE', 'COMPLETE'].includes(action.type)
        ? 'AGENT_EXECUTE_ACTION'
        : 'EXECUTE_ACTION';
      return await chrome.tabs.sendMessage(msg.tabId, {
        type: messageType,
        action
      });
    }

    return { ok: false, error: 'Unknown message type' };
  })()
  .then(sendResponse)
  .catch(err => sendResponse({ ok: false, error: err.message }));

  return true;
});
