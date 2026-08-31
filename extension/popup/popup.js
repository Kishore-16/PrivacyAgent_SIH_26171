document.addEventListener('DOMContentLoaded', () => {
  const $ = selector => document.querySelector(selector);

  async function getActiveTab() {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    return tabs[0];
  }

  // Programmatically inject content scripts if they aren't already loaded.
  // This fixes the "receiving end does not exist" error for tabs that were
  // open before the extension was installed or reloaded.
  async function ensureContentScripts(tab) {
    if (!tab || !tab.id) return;

    // Skip chrome:// and other restricted pages
    const url = tab.url || '';
    if (url.startsWith('chrome://') || url.startsWith('chrome-extension://') ||
        url.startsWith('edge://') || url.startsWith('about:') || url === '') {
      throw new Error('Cannot scan browser internal pages. Please navigate to a website first.');
    }

    try {
      // Try a quick ping to see if content scripts are already loaded
      await new Promise((resolve, reject) => {
        chrome.tabs.sendMessage(tab.id, { type: 'PING' }, response => {
          if (chrome.runtime.lastError) {
            reject(chrome.runtime.lastError);
          } else {
            resolve(response);
          }
        });
      });
    } catch (e) {
      // Content scripts not loaded — inject them now
      console.log('Content scripts not found, injecting into tab', tab.id);
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: [
          'privacy/patterns.js',
          'privacy/detector.js',
          'privacy/redactor.js',
          'privacy/firewall.js',
          'actions/validator.js',
          'actions/executor.js',
          'content/content.js'
        ]
      });
    }
  }

  async function sendTabMessage(tab, msg) {
    await ensureContentScripts(tab);
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

  async function createSanitizedScreenshot(tab) {
    const mask = await sendTabMessage(tab, { type: 'VISUAL_REDACTION_REGIONS' });
    const rawImage = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
    const image = new Image();
    image.src = rawImage;
    await image.decode();

    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d');
    context.drawImage(image, 0, 0);
    // captureVisibleTab dimensions can differ at browser zoom, so derive scale
    // from the captured bitmap instead of assuming devicePixelRatio.
    const scaleX = image.naturalWidth / mask.viewportWidth;
    const scaleY = image.naturalHeight / mask.viewportHeight;
    
    for (const region of mask.regions || []) {
      const paddingX = 3 * scaleX;
      const paddingY = 3 * scaleY;
      const rx = Math.max(0, region.left * scaleX - paddingX);
      const ry = Math.max(0, region.top * scaleY - paddingY);
      const rw = region.width * scaleX + paddingX * 2;
      const rh = region.height * scaleY + paddingY * 2;
      
      // Draw semantic box
      context.fillStyle = 'rgb(240, 240, 245)';
      context.fillRect(rx, ry, rw, rh);
      context.strokeStyle = 'rgb(124, 58, 237)';
      context.lineWidth = 2 * scaleX;
      context.strokeRect(rx, ry, rw, rh);
      
      context.fillStyle = 'rgb(124, 58, 237)';
      context.font = `bold ${14 * scaleX}px sans-serif`;
      context.fillText(region.kind ? `[${region.kind.toUpperCase()}]` : '[REDACTED]', rx + 4 * scaleX, ry + 16 * scaleY);
    }
    return { image: canvas.toDataURL('image/png'), redactedRegions: (mask.regions || []).length };
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

    // The raw capture remains in extension memory only.  Only the canvas copy
    // with local DOM/image redactions is eligible for server transmission.
    const sanitized = await createSanitizedScreenshot(tab);
    const visionRes = await sendBgMessage({
      type: 'VISION_ANALYZE',
      image: sanitized.image,
      mode: 'SEMANTIC',
      sanitized: true,
      redactedRegions: sanitized.redactedRegions
    });

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

  // 4. Auto-fill Secure Data
  $('#btn-autofill').onclick = async () => {
    try {
      $('#decision-out').textContent = 'Fetching secure data from extension storage...';
      
      let profile = null;
      
      // Promisify chrome.storage.local.get
      const stored = await new Promise((resolve) => {
        chrome.storage.local.get(['secureProfile'], resolve);
      });
      
      if (stored.secureProfile && Object.keys(stored.secureProfile).length > 0) {
        profile = stored.secureProfile;
      } else {
        // Fallback to reading dummy data from local extension package
        const res = await fetch(chrome.runtime.getURL('profile.json'));
        profile = await res.json();
        // Save it to storage for next time
        chrome.storage.local.set({ secureProfile: profile });
      }
      
      if (!profile) {
        throw new Error('Failed to load secure profile data');
      }

      const tab = await getActiveTab();
      const fillRes = await sendTabMessage(tab, { type: 'AUTOFILL', profile: profile });
      
      if (fillRes?.ok) {
        $('#decision-out').textContent = `Auto-fill Complete: ${fillRes.filledCount} fields populated securely from local storage.`;
      } else {
        throw new Error(fillRes?.error || 'Unknown error during autofill');
      }
    } catch (err) {
      $('#decision-out').textContent = `Auto-fill Error: ${err.message}`;
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
