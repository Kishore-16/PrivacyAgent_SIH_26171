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

    // Internal browser pages cannot receive content script DOM messages directly,
    // but the tab can still be navigated by the agent.
    const url = tab.url || '';
    if (url.startsWith('chrome://') || url.startsWith('chrome-extension://') ||
        url.startsWith('edge://') || url.startsWith('about:') || url === '') {
      return;
    }

    try {
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
          'agent/agent_executor.js',
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

  // Tab Navigation Switching
  const tabBtnAgent = $('#tab-btn-agent');
  const tabBtnDashboard = $('#tab-btn-dashboard');
  const tabViewAgent = $('#tab-view-agent');
  const tabViewDashboard = $('#tab-view-dashboard');

  if (tabBtnAgent && tabBtnDashboard) {
    tabBtnAgent.onclick = () => {
      tabBtnAgent.classList.add('active');
      tabBtnDashboard.classList.remove('active');
      tabViewAgent.classList.remove('hidden');
      tabViewAgent.classList.add('active');
      tabViewDashboard.classList.add('hidden');
      tabViewDashboard.classList.remove('active');
    };

    tabBtnDashboard.onclick = () => {
      tabBtnDashboard.classList.add('active');
      tabBtnAgent.classList.remove('active');
      tabViewDashboard.classList.remove('hidden');
      tabViewDashboard.classList.add('active');
      tabViewAgent.classList.add('hidden');
      tabViewAgent.classList.remove('active');
    };
  }

  // Popup Embedded Agent Task Loop
  const popupTaskForm = $('#popupTaskForm');
  const popupTaskInput = $('#popupTaskInput');
  const popupChatViewport = $('#popupChatViewport');
  const popupHitlModal = $('#popupHitlModal');
  const popupHitlReason = $('#popupHitlReason');
  const popupHitlPromptText = $('#popupHitlPromptText');
  const popupBtnApproveHitl = $('#popupBtnApproveHitl');
  const popupBtnCancelHitl = $('#popupBtnCancelHitl');

  let popupTaskId = null;
  let popupGoal = '';
  let popupStepCount = 1;
  let popupPendingStep = null;
  const SERVER_AGENT_BASE = 'http://127.0.0.1:8000/agent';

  function appendPopupMsg(role, text) {
    if (!popupChatViewport) return;
    const msgDiv = document.createElement('div');
    msgDiv.className = `message ${role === 'user' ? 'user-msg' : 'system-msg'}`;
    const avatar = role === 'user' ? '👤' : '🤖';
    msgDiv.innerHTML = `
      <div class="msg-avatar">${avatar}</div>
      <div class="msg-content"><p>${(text || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</p></div>
    `;
    popupChatViewport.appendChild(msgDiv);
    popupChatViewport.scrollTop = popupChatViewport.scrollHeight;
  }

  function appendPopupStepCard(thought, actionLabel, risk) {
    if (!popupChatViewport) return;
    const card = document.createElement('div');
    card.className = 'step-card';
    card.innerHTML = `
      <div class="step-thought">💡 ${(thought || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>
      <div class="step-action">⚡ ${(actionLabel || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')} <span style="font-size:0.65rem;">[${(risk||'').toUpperCase()}]</span></div>
    `;
    popupChatViewport.appendChild(card);
    popupChatViewport.scrollTop = popupChatViewport.scrollHeight;
  }

  async function startPopupAgentTask(goalText) {
    popupGoal = goalText;
    popupStepCount = 1;
    appendPopupMsg('user', goalText);

    try {
      const activeTab = await getActiveTab();
      const resp = await fetch(`${SERVER_AGENT_BASE}/task/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task: goalText, url: activeTab?.url })
      });
      const data = await resp.json();
      if (!data.ok) throw new Error(data.detail || 'Failed to start agent task');

      popupTaskId = data.task_id;
      appendPopupMsg('system', `Agent active (${popupTaskId}). Processing task...`);
      runNextPopupAgentStep();
    } catch (err) {
      appendPopupMsg('system', `❌ Error starting task: ${err.message}`);
    }
  }

  async function runNextPopupAgentStep() {
    if (!popupTaskId) return;

    const activeTab = await getActiveTab();
    let domNodes = [];
    try {
      const domRes = await sendTabMessage(activeTab, { type: 'AGENT_GET_DOM' });
      domNodes = domRes?.nodes || [];
    } catch (e) {
      console.warn('Fallback DOM fetch', e);
    }

    const payload = {
      task_id: popupTaskId,
      goal: popupGoal,
      step_number: popupStepCount,
      dom_nodes: domNodes,
      sanitized_findings: [],
      url: activeTab?.url,
      title: activeTab?.title,
      client_attested: true
    };

    try {
      const resp = await fetch(`${SERVER_AGENT_BASE}/task/step`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!resp.ok) {
        const errJson = await resp.json();
        throw new Error(errJson.detail || 'Step rejected');
      }

      const stepRes = await resp.json();
      appendPopupStepCard(stepRes.thought, stepRes.action.label || stepRes.action.type, stepRes.action.risk);

      if (stepRes.requires_hitl) {
        popupPendingStep = { stepRes, tabId: activeTab.id };
        if (popupHitlReason) popupHitlReason.textContent = stepRes.action.reason;
        if (popupHitlPromptText) popupHitlPromptText.textContent = stepRes.hitl_prompt || stepRes.action.label;
        if (popupHitlModal) popupHitlModal.classList.remove('hidden');
        return;
      }

      await executeStepAndAdvance(activeTab.id, stepRes);
    } catch (err) {
      appendPopupMsg('system', `⚠️ Step Error: ${err.message}`);
    }
  }

  async function executeStepAndAdvance(tabId, stepRes) {
    if (stepRes.completed || stepRes.action.type === 'COMPLETE') {
      appendPopupMsg('system', `🎉 Task Complete! ${stepRes.status_summary}`);
      popupTaskId = null;
      return;
    }

    if (stepRes.action.type === 'NAVIGATE' && stepRes.action.url) {
      appendPopupMsg('system', `🌐 Navigating tab to: ${stepRes.action.url}`);
      await chrome.tabs.update(tabId, { url: stepRes.action.url });
      popupStepCount++;
      // Give page 3 seconds to load before next DOM step
      setTimeout(() => {
        runNextPopupAgentStep();
      }, 3000);
      return;
    }

    try {
      await sendTabMessage({ id: tabId }, { type: 'AGENT_EXECUTE_ACTION', action: stepRes.action });
    } catch (e) {
      console.warn('Action execute notice', e);
    }

    popupStepCount++;
    setTimeout(() => {
      runNextPopupAgentStep();
    }, 1500);
  }


  if (popupBtnApproveHitl) {
    popupBtnApproveHitl.onclick = async () => {
      if (popupHitlModal) popupHitlModal.classList.add('hidden');
      if (popupPendingStep) {
        const { tabId, stepRes } = popupPendingStep;
        popupPendingStep = null;
        appendPopupMsg('system', '✅ High-risk action approved by user. Executing...');
        await executeStepAndAdvance(tabId, stepRes);
      }
    };
  }

  if (popupBtnCancelHitl) {
    popupBtnCancelHitl.onclick = () => {
      if (popupHitlModal) popupHitlModal.classList.add('hidden');
      popupPendingStep = null;
      popupTaskId = null;
      appendPopupMsg('system', '🚫 Task cancelled by user.');
    };
  }

  if (popupTaskForm) {
    popupTaskForm.onsubmit = (e) => {
      e.preventDefault();
      const val = popupTaskInput.value.trim();
      if (!val) return;
      popupTaskInput.value = '';
      startPopupAgentTask(val);
    };
  }

  // Initial load checks
  checkHealth().then(() => runScan().catch(() => {}));
});

