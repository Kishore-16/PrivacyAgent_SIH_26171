document.addEventListener('DOMContentLoaded', () => {
  const $ = selector => document.querySelector(selector);

  async function getActiveTab() {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    return tabs[0];
  }

  function sendTabMessage(tab, msg) {
    return new Promise((resolve, reject) => {
      chrome.tabs.sendMessage(tab.id, msg, response => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(response);
        }
      });
    });
  }

  function sendBgMessage(msg) {
    return new Promise(resolve => {
      chrome.runtime.sendMessage(msg, response => {
        resolve(response || { ok: false, error: chrome.runtime.lastError?.message || 'No response from service worker' });
      });
    });
  }

  async function checkHealth() {
    const res = await sendBgMessage({ type: 'HEALTH' });
    if (res && res.status === 'ok') {
      $('#st-vision').textContent = 'ACTIVE (LOCAL ONLY)';
      $('#st-vision').style.color = '#10b981';
      return true;
    } else {
      $('#st-vision').textContent = 'OFFLINE (Start START.bat)';
      $('#st-vision').style.color = '#ef4444';
      return false;
    }
  }

  async function runScan() {
    const tab = await getActiveTab();
    if (!tab) return null;
    try {
      $('#st-host').textContent = new URL(tab.url || 'http://localhost').hostname;
    } catch (e) {
      $('#st-host').textContent = 'local-page';
    }

    const scanResult = await sendTabMessage(tab, { type: 'SCAN' });
    if (scanResult) {
      $('#m-scanned').textContent = scanResult.scannedElements || 0;
      $('#m-sensitive').textContent = scanResult.findings?.length || 0;
      $('#m-redactions').textContent = scanResult.findings?.length || 0;
      $('#footer-status').textContent = `Scanned at ${new Date(scanResult.timestamp).toLocaleTimeString()}`;
    }
    return scanResult;
  }

  async function runVisualAnalysis() {
    const startTime = performance.now();
    const tab = await getActiveTab();
    await runScan();

    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
    const visionRes = await sendBgMessage({ type: 'VISION_ANALYZE', image: dataUrl });

    const totalLatency = Math.round(performance.now() - startTime);
    $('#st-latency').textContent = `${visionRes.latency_ms || totalLatency} ms`;

    if (!visionRes.ok) {
      $('#decision-out').textContent = `Vision analysis error: ${visionRes.error || 'Local server unreachable'}`;
      return null;
    }

    $('#m-redactions').textContent = (visionRes.redactions || 0) + (parseInt($('#m-sensitive').textContent) || 0);
    $('#decision-out').textContent = `Visual Analysis Complete: ${visionRes.detections?.length || 0} region(s) detected & redacted locally.`;
    return visionRes;
  }

  // 1. Scan Button
  $('#btn-scan').onclick = async () => {
    try {
      $('#decision-out').textContent = 'Scanning DOM & evaluating PII patterns...';
      const vRes = await runVisualAnalysis();
      if (vRes) {
        $('#decision-out').textContent = `PRIVACY FIREWALL ACTIVE:\nDOM scanned. ${vRes.redactions} visual/text region(s) redacted. Zero PII transmitted.`;
      }
    } catch (err) {
      $('#decision-out').textContent = `Error: ${err.message}`;
    }
  };

  // 2. Show Sanitized Preview
  $('#btn-preview').onclick = async () => {
    try {
      const tab = await getActiveTab();
      const vRes = await runVisualAnalysis();
      const snapshot = await sendTabMessage(tab, { type: 'SNAPSHOT' });

      $('#preview-section').style.display = 'block';
      if (vRes?.sanitized_image) {
        $('#sanitized-img').src = vRes.sanitized_image;
      }
      if (snapshot?.html) {
        $('#dom-preview').textContent = snapshot.html.replace(/></g, '>\n<').slice(0, 1000) + '...';
      }
    } catch (err) {
      $('#decision-out').textContent = `Preview Error: ${err.message}`;
    }
  };

  // 3. Get Safe Agent Action
  let pendingAction = null;

  $('#btn-plan').onclick = async () => {
    try {
      const tab = await getActiveTab();
      const domContext = await sendTabMessage(tab, { type: 'DOM_CONTEXT' });
      
      const planRes = await sendBgMessage({
        type: 'PLAN',
        context: domContext.payload
      });

      if (!planRes.ok) {
        $('#decision-out').textContent = `Planner Error: ${planRes.error}`;
        return;
      }

      const action = planRes.action;
      $('#decision-out').textContent = `Planned Safe Action:\nType: ${action.type}\nLabel: "${action.label}"\nRisk: ${action.risk}\nReason: ${action.reason}`;

      if (action.risk === 'high') {
        pendingAction = { tabId: tab.id, action };
        $('#confirm-msg').textContent = `PrivacyAgent wants to execute high-risk action: ${action.type} "${action.label}". Proceed?`;
        $('#confirm-modal').style.display = 'flex';
      } else {
        // Low-risk action executes immediately
        const execRes = await sendBgMessage({
          type: 'EXECUTE_ACTION',
          tabId: tab.id,
          action,
          confirmed: true
        });
        $('#decision-out').textContent += `\n\nExecution Result: ${JSON.stringify(execRes)}`;
      }
    } catch (err) {
      $('#decision-out').textContent = `Plan Error: ${err.message}`;
    }
  };

  // Modal handlers
  $('#btn-confirm-yes').onclick = async () => {
    $('#confirm-modal').style.display = 'none';
    if (pendingAction) {
      const execRes = await sendBgMessage({
        type: 'EXECUTE_ACTION',
        tabId: pendingAction.tabId,
        action: pendingAction.action,
        confirmed: true
      });
      $('#decision-out').textContent += `\n\n[USER APPROVED] Execution Result: ${JSON.stringify(execRes)}`;
      pendingAction = null;
    }
  };

  $('#btn-confirm-no').onclick = () => {
    $('#confirm-modal').style.display = 'none';
    $('#decision-out').textContent += `\n\n[USER BLOCKED] High-risk action cancelled by user.`;
    pendingAction = null;
  };

  // Initial load checks
  checkHealth().then(() => runScan().catch(() => {}));
});
