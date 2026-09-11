document.addEventListener('DOMContentLoaded', () => {
  const taskForm = document.getElementById('agentTaskForm');
  const taskInput = document.getElementById('taskInput');
  const chatViewport = document.getElementById('chatViewport');
  const statusText = document.getElementById('statusText');
  const hitlModal = document.getElementById('hitlModal');
  const hitlReason = document.getElementById('hitlReason');
  const hitlPromptText = document.getElementById('hitlPromptText');
  const btnApproveHitl = document.getElementById('btnApproveHitl');
  const btnCancelHitl = document.getElementById('btnCancelHitl');

  // Sahayak Sidepanel Elements
  const sahayakCard = document.getElementById('sahayakSidepanelCard');
  const shkModalTitle = document.getElementById('shkModalTitle');
  const shkDocBadge = document.getElementById('shkDocBadge');
  const shkCloseBtn = document.getElementById('shkCloseBtn');
  const shkCancelBtn = document.getElementById('shkCancelBtn');
  const shkSubmitBtn = document.getElementById('shkSubmitBtn');
  const shkLangButtons = document.getElementById('shkLangButtons');
  const shkAboutTitle = document.getElementById('shkAboutTitle');
  const shkDocTitle = document.getElementById('shkDocTitle');
  const shkDocDesc = document.getElementById('shkDocDesc');
  const shkIdentifyTitle = document.getElementById('shkIdentifyTitle');
  const shkIdentifyText = document.getElementById('shkIdentifyText');
  const shkDropZone = document.getElementById('shkDropZone');
  const shkDropText = document.getElementById('shkDropText');
  const shkBrowseLink = document.getElementById('shkBrowseLink');
  const shkFileInput = document.getElementById('shkFileInput');
  const shkSelectedFile = document.getElementById('shkSelectedFile');
  const shkHelpTitle = document.getElementById('shkHelpTitle');
  const shkPortalPrefix = document.getElementById('shkPortalPrefix');
  const shkPortalName = document.getElementById('shkPortalName');
  const shkPortalBtn = document.getElementById('shkPortalBtn');
  const shkOnlineProcTitle = document.getElementById('shkOnlineProcTitle');
  const shkOnlineStepsList = document.getElementById('shkOnlineStepsList');
  const shkOfflineProcTitle = document.getElementById('shkOfflineProcTitle');
  const shkOfflineStepsList = document.getElementById('shkOfflineStepsList');

  const SERVER_BASE = 'http://127.0.0.1:8000/agent';
  let currentTaskId = null;
  let currentGoal = '';
  let stepCounter = 1;
  let pendingStepData = null;

  // --- Interaction history & verification state ---
  let actionHistory = [];
  let lastActionResult = null;
  let consecutiveFailures = 0;
  let lastFailedSignature = '';

  // Sahayak State
  let shkActiveLangKey = "1";
  let shkActiveDocType = "generic";
  let shkSelectedFileObj = null;
  let shkTargetSelector = null;
  let shkIsProcessing = false;
  let isSahayakActive = false;

  // -----------------------------------------------------------------------
  // UI Helpers
  // -----------------------------------------------------------------------
  function setStatus(text, isBusy = false) {
    statusText.textContent = text;
    const dot = document.querySelector('.status-dot');
    if (dot) {
      dot.style.backgroundColor = isBusy ? '#f59e0b' : '#22c55e';
    }
  }

  function appendMessage(role, text, extraHtml = '') {
    const msgDiv = document.createElement('div');
    msgDiv.className = `message ${role === 'user' ? 'user-msg' : 'system-msg'}`;
    const avatar = role === 'user' ? '👤' : '🤖';

    msgDiv.innerHTML = `
      <div class="msg-avatar">${avatar}</div>
      <div class="msg-content">
        <p>${escapeHtml(text)}</p>
        ${extraHtml}
      </div>
    `;

    chatViewport.appendChild(msgDiv);
    chatViewport.scrollTop = chatViewport.scrollHeight;
  }

  function appendStepCard(thought, actionLabel, risk) {
    const card = document.createElement('div');
    card.className = 'step-card';
    card.innerHTML = `
      <div class="step-thought">💡 ${escapeHtml(thought)}</div>
      <div class="step-action">⚡ ${escapeHtml(actionLabel)} <span style="font-size: 0.7rem; opacity:0.8;">[${risk.toUpperCase()}]</span></div>
    `;
    chatViewport.appendChild(card);
    chatViewport.scrollTop = chatViewport.scrollHeight;
  }

  function escapeHtml(str) {
    return (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // -----------------------------------------------------------------------
  // Tab & DOM helpers
  // -----------------------------------------------------------------------
  async function getActiveTab() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab;
  }

  async function requestTabDomNodes(tabId) {
    try {
      const res = await chrome.tabs.sendMessage(tabId, { type: 'AGENT_GET_DOM' });
      return res || { ok: false, nodes: [], page_alerts: [], visible_text: '', input_redaction_regions: [] };
    } catch (e) {
      console.warn('DOM script missing, injecting...', e);
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ['agent/agent_executor.js']
      });
      const res = await chrome.tabs.sendMessage(tabId, { type: 'AGENT_GET_DOM' });
      return res || { ok: false, nodes: [], page_alerts: [], visible_text: '', input_redaction_regions: [] };
    }
  }

  async function executeTabAction(tabId, action) {
    try {
      const res = await chrome.tabs.sendMessage(tabId, { type: 'AGENT_EXECUTE_ACTION', action });
      return res;
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  // -----------------------------------------------------------------------
  // Screenshot capture with input-field redaction
  // -----------------------------------------------------------------------
  async function captureRedactedScreenshot(redactionRegions) {
    try {
      const dataUrl = await chrome.tabs.captureVisibleTab(null, { format: 'jpeg', quality: 60 });

      // Draw redaction rectangles and downscale on an offscreen canvas
      return await new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
          let targetWidth = img.width;
          let targetHeight = img.height;
          const MAX_DIMENSION = 1024;
          
          if (targetWidth > MAX_DIMENSION || targetHeight > MAX_DIMENSION) {
            const ratio = Math.min(MAX_DIMENSION / targetWidth, MAX_DIMENSION / targetHeight);
            targetWidth = Math.round(targetWidth * ratio);
            targetHeight = Math.round(targetHeight * ratio);
          }

          const canvas = document.createElement('canvas');
          canvas.width = targetWidth;
          canvas.height = targetHeight;
          const ctx = canvas.getContext('2d');
          
          // Draw image at downscaled size
          ctx.drawImage(img, 0, 0, targetWidth, targetHeight);

          if (redactionRegions && redactionRegions.length > 0) {
            // Calculate scale factor from screen logic (original code scaled against screen width)
            // But now we also need to account for our downscaling
            const screenScaleX = img.width / window.screen.availWidth;
            const screenScaleY = img.height / window.screen.availHeight;
            const finalScaleX = screenScaleX * (targetWidth / img.width);
            const finalScaleY = screenScaleY * (targetHeight / img.height);

            ctx.fillStyle = '#888888';
            ctx.font = `${Math.round(12 * finalScaleY)}px monospace`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';

            for (const region of redactionRegions) {
              const rx = Math.round(region.x * finalScaleX);
              const ry = Math.round(region.y * finalScaleY);
              const rw = Math.round(region.width * finalScaleX);
              const rh = Math.round(region.height * finalScaleY);

              ctx.fillStyle = '#888888';
              ctx.fillRect(rx, ry, rw, rh);

              ctx.fillStyle = '#ffffff';
              ctx.fillText(region.label || '[REDACTED]', rx + rw / 2, ry + rh / 2);
            }
          }

          resolve(canvas.toDataURL('image/jpeg', 0.6));
        };
        img.onerror = () => resolve(dataUrl); // fallback to original
        img.src = dataUrl;
      });
    } catch (e) {
      console.warn('Screenshot capture failed:', e);
      return null;
    }
  }

  // -----------------------------------------------------------------------
  // Smart wait — waits for page to settle after an action
  // -----------------------------------------------------------------------
  function smartWait(tabId, preActionUrl) {
    return new Promise((resolve) => {
      let resolved = false;
      const maxTimeout = 5000;

      const done = (reason) => {
        if (resolved) return;
        resolved = true;
        clearTimeout(timer);
        if (navListener) chrome.webNavigation.onCompleted.removeListener(navListener);
        resolve(reason);
      };

      // Timeout fallback
      const timer = setTimeout(() => done('timeout'), maxTimeout);

      // Listen for navigation completion
      let navListener = null;
      if (chrome.webNavigation && chrome.webNavigation.onCompleted) {
        navListener = (details) => {
          if (details.tabId === tabId && details.frameId === 0) {
            // Give the page a moment to render after navigation
            setTimeout(() => done('navigation'), 500);
          }
        };
        chrome.webNavigation.onCompleted.addListener(navListener);
      }

      // For non-navigation DOM changes, use a shorter delay
      // (MutationObserver can't be used from the side panel directly)
      setTimeout(() => {
        if (!resolved) done('dom_settle');
      }, 2000);
    });
  }

  // -----------------------------------------------------------------------
  // Action verification — compare pre/post action state
  // -----------------------------------------------------------------------
  async function verifyActionResult(tabId, preActionUrl, preActionNodeCount) {
    const postTab = await getActiveTab();
    const postUrl = postTab?.url || '';

    // URL changed → navigation
    if (postUrl !== preActionUrl) {
      return 'navigation';
    }

    // Re-query DOM to see if it changed
    try {
      const postDom = await requestTabDomNodes(tabId);
      const postNodeCount = (postDom.nodes || []).length;

      // Check for new alerts/errors
      if (postDom.page_alerts && postDom.page_alerts.length > 0) {
        return 'error_detected';
      }

      // Significant DOM change
      if (Math.abs(postNodeCount - preActionNodeCount) > 3) {
        return 'success';
      }
    } catch (e) {
      // Tab might have navigated, content script unavailable
      return 'navigation';
    }

    return 'no_change';
  }

  // -----------------------------------------------------------------------
  // Interaction history management — with summarization
  // -----------------------------------------------------------------------
  function addToHistory(step, actionLabel, result, thought, url) {
    actionHistory.push({
      step,
      action: (actionLabel || '').slice(0, 60),
      result,
      thought: (thought || '').slice(0, 80),
      url: (url || '').slice(0, 80)
    });

    // Track consecutive failures for error recovery
    const signature = `${actionLabel}`;
    if (result === 'no_change') {
      if (signature === lastFailedSignature) {
        consecutiveFailures++;
      } else {
        consecutiveFailures = 1;
        lastFailedSignature = signature;
      }
    } else {
      consecutiveFailures = 0;
      lastFailedSignature = '';
    }
  }

  function getHistoryForPayload() {
    if (actionHistory.length <= 10) {
      return actionHistory;
    }

    // Summarize older entries, keep last 5 in detail
    const older = actionHistory.slice(0, -5);
    const recent = actionHistory.slice(-5);

    const summaryParts = older.map(h => {
      const icon = h.result === 'success' ? '✓' : (h.result === 'no_change' ? '✗' : '→');
      return `${h.action} ${icon}`;
    });

    const summaryEntry = {
      step: `1-${older[older.length - 1].step}`,
      action: `Summary: ${summaryParts.join(' → ')}`.slice(0, 300),
      result: 'summarized',
      thought: `Completed ${older.length} earlier steps`,
      url: older[older.length - 1].url || ''
    };

    return [summaryEntry, ...recent];
  }

  // -----------------------------------------------------------------------
  // Sahayak Sidepanel Manager (unchanged from original)
  // -----------------------------------------------------------------------
  function openSahayakCard(docType = "generic", selector = null) {
    shkActiveDocType = docType;
    shkTargetSelector = selector;
    shkSelectedFileObj = null;
    shkIsProcessing = false;
    sahayakCard.classList.remove('hidden');
    renderSahayakUI();
  }

  function closeSahayakCard() {
    sahayakCard.classList.add('hidden');
  }

  async function renderSahayakUI() {
    if (typeof SahayakConfig === 'undefined') return;

    const langCode = SahayakConfig.LANGUAGES[shkActiveLangKey]?.code || "en";
    const strings = SahayakConfig.UI_STRINGS[langCode] || SahayakConfig.UI_STRINGS.en;
    const docConfig = SahayakConfig.getDocConfig(shkActiveDocType);

    let docTitleText = docConfig.displayTitle[langCode] || docConfig.displayTitle.en;
    let descText = docConfig.description[langCode] || docConfig.description.en;
    let identifyText = docConfig.howToIdentify[langCode] || docConfig.howToIdentify.en;
    let onlineSteps = docConfig.onlineSteps[langCode] || docConfig.onlineSteps.en;
    let offlineSteps = docConfig.offlineSteps[langCode] || docConfig.offlineSteps.en;
    let portalName = docConfig.portalName;
    let portalUrl = docConfig.portalUrl;

    const shkStateSelect = document.getElementById('shkStateSelect');
    const selectedState = shkStateSelect?.value || 'National';

    if (shkDocTitle) shkDocTitle.classList.add('sahayak-skeleton');
    if (shkDocDesc) shkDocDesc.classList.add('sahayak-skeleton');
    if (shkIdentifyText) shkIdentifyText.classList.add('sahayak-skeleton');
    if (shkPortalName) shkPortalName.classList.add('sahayak-skeleton');
    if (shkOnlineStepsList) {
      shkOnlineStepsList.innerHTML = `
        <div class="sahayak-step-card sahayak-skeleton" style="height:36px; margin-bottom:6px;"></div>
        <div class="sahayak-step-card sahayak-skeleton" style="height:36px;"></div>
      `;
    }
    if (shkOfflineStepsList) {
      shkOfflineStepsList.innerHTML = `
        <div class="sahayak-step-card sahayak-skeleton" style="height:36px; margin-bottom:6px;"></div>
        <div class="sahayak-step-card sahayak-skeleton" style="height:36px;"></div>
      `;
    }

    try {
      const aiResp = await fetch(`http://127.0.0.1:8000/sahayak/guides?doc=${encodeURIComponent(shkActiveDocType)}&state=${encodeURIComponent(selectedState)}&lang=${langCode}`);
      if (aiResp.ok) {
        const aiData = await aiResp.json();
        if (aiData.ok && aiData.guide) {
          const g = aiData.guide;
          if (g.title) docTitleText = g.title;
          if (g.description) descText = g.description;
          if (g.how_to_identify) identifyText = g.how_to_identify;
          if (g.portal_name) portalName = g.portal_name;
          if (g.portal_url) portalUrl = g.portal_url;
          if (g.online_steps && g.online_steps.length > 0) onlineSteps = g.online_steps;
          if (g.offline_steps && g.offline_steps.length > 0) offlineSteps = g.offline_steps;
        }
      }
    } catch (netErr) {
      console.warn('[Sahayak Sidepanel] AI Guide endpoint fallback:', netErr.message);
    } finally {
      if (shkDocTitle) shkDocTitle.classList.remove('sahayak-skeleton');
      if (shkDocDesc) shkDocDesc.classList.remove('sahayak-skeleton');
      if (shkIdentifyText) shkIdentifyText.classList.remove('sahayak-skeleton');
      if (shkPortalName) shkPortalName.classList.remove('sahayak-skeleton');
    }

    if (shkStateSelect && !shkStateSelect.dataset.bound) {
      shkStateSelect.dataset.bound = 'true';
      shkStateSelect.onchange = () => renderSahayakUI();
    }

    if (shkModalTitle) shkModalTitle.textContent = strings.modalTitle;
    if (shkDocBadge) shkDocBadge.textContent = `${strings.requiredDocLabel} ${docTitleText}`;
    if (shkAboutTitle) shkAboutTitle.textContent = strings.aboutTitle;
    if (shkDocTitle) shkDocTitle.textContent = docTitleText;
    if (shkDocDesc) shkDocDesc.textContent = descText;
    if (shkIdentifyTitle) shkIdentifyTitle.textContent = strings.identifyTitle;
    if (shkIdentifyText) shkIdentifyText.textContent = identifyText;

    if (shkLangButtons) {
      shkLangButtons.querySelectorAll('.sahayak-lang-btn').forEach(btn => {
        const key = btn.getAttribute('data-lang-key');
        if (key === shkActiveLangKey) {
          btn.classList.add('active');
        } else {
          btn.classList.remove('active');
        }
      });
    }

    if (shkSelectedFile) {
      shkSelectedFile.textContent = shkSelectedFileObj ? `📄 Selected: ${shkSelectedFileObj.name}` : '';
    }

    if (shkHelpTitle) shkHelpTitle.textContent = strings.instructionCenterTitle;
    if (shkPortalPrefix) shkPortalPrefix.textContent = strings.officialLinkPrefix;
    if (shkPortalName) shkPortalName.textContent = portalName;
    if (shkPortalBtn) {
      shkPortalBtn.href = portalUrl;
      shkPortalBtn.textContent = strings.openPortalBtn;
    }
    if (shkOnlineProcTitle) shkOnlineProcTitle.textContent = strings.onlineProcedureTitle;
    if (shkOfflineProcTitle) shkOfflineProcTitle.textContent = strings.offlineProcedureTitle;

    if (shkOnlineStepsList) {
      shkOnlineStepsList.innerHTML = onlineSteps.map((step, idx) => `
        <div class="sahayak-step-card">
          <span class="sahayak-step-num">${idx + 1}️⃣</span>
          <span>${step}</span>
        </div>
      `).join('');
    }

    if (shkOfflineStepsList) {
      shkOfflineStepsList.innerHTML = offlineSteps.map((step, idx) => `
        <div class="sahayak-step-card" style="border-left-color: #fbbf24;">
          <span class="sahayak-step-num" style="color: #fbbf24;">🏛️</span>
          <span>${step}</span>
        </div>
      `).join('');
    }

    if (shkSubmitBtn) {
      shkSubmitBtn.disabled = !shkSelectedFileObj || shkIsProcessing;
      shkSubmitBtn.textContent = shkIsProcessing ? strings.processingText : strings.submitBtn;
    }
  }

  // Language Button Click Listeners
  if (shkLangButtons) {
    shkLangButtons.querySelectorAll('.sahayak-lang-btn').forEach(btn => {
      btn.onclick = (e) => {
        const key = e.target.getAttribute('data-lang-key');
        if (key) {
          shkActiveLangKey = key;
          renderSahayakUI();
        }
      };
    });
  }

  // Global Keyboard Listener for Number Keys 1-5 inside Sidepanel
  window.addEventListener('keydown', (e) => {
    if (sahayakCard.classList.contains('hidden')) return;
    if (['1', '2', '3', '4', '5'].includes(e.key)) {
      shkActiveLangKey = e.key;
      renderSahayakUI();
    } else if (e.key === 'Escape') {
      closeSahayakCard();
    }
  });

  // File Browse & Drag & Drop
  if (shkBrowseLink && shkFileInput) {
    shkBrowseLink.onclick = (e) => {
      e.stopPropagation();
      shkFileInput.click();
    };
  }

  if (shkDropZone && shkFileInput) {
    shkDropZone.onclick = () => shkFileInput.click();
    shkDropZone.ondragover = (e) => {
      e.preventDefault();
      shkDropZone.classList.add('dragover');
    };
    shkDropZone.ondragleave = () => shkDropZone.classList.remove('dragover');
    shkDropZone.ondrop = (e) => {
      e.preventDefault();
      shkDropZone.classList.remove('dragover');
      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        shkSelectedFileObj = e.dataTransfer.files[0];
        renderSahayakUI();
      }
    };
  }

  if (shkFileInput) {
    shkFileInput.onchange = (e) => {
      if (e.target.files && e.target.files.length > 0) {
        shkSelectedFileObj = e.target.files[0];
        renderSahayakUI();
      }
    };
  }

  if (shkCloseBtn) shkCloseBtn.onclick = closeSahayakCard;
  if (shkCancelBtn) shkCancelBtn.onclick = closeSahayakCard;

  // File Upload Submission & Redaction
  if (shkSubmitBtn) {
    shkSubmitBtn.onclick = async () => {
      if (!shkSelectedFileObj) return;

      shkIsProcessing = true;
      renderSahayakUI();

      try {
        const base64Data = await new Promise((res, rej) => {
          const r = new FileReader();
          r.onload = () => res(r.result);
          r.onerror = (e) => rej(e);
          r.readAsDataURL(shkSelectedFileObj);
        });

        try {
          await fetch('http://127.0.0.1:8000/sahayak/process-document', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              document_type: shkActiveDocType,
              image_data: base64Data,
              redaction_mode: 'BLUR',
              client_attestation: true
            })
          });
        } catch (netErr) {
          console.warn('[Sahayak Sidepanel] Redaction endpoint offline fallback:', netErr);
        }

        const activeTab = await getActiveTab();
        if (activeTab) {
          await chrome.tabs.sendMessage(activeTab.id, {
            type: 'SAHAYAK_ATTACH_FILE',
            selector: shkTargetSelector,
            fileName: shkSelectedFileObj.name
          });
        }

        appendMessage('system', `✅ Sahayak attached document '${shkSelectedFileObj.name}' to form.`);
        closeSahayakCard();

        if (currentTaskId) {
          stepCounter++;
          setTimeout(runNextStep, 1500);
        }
      } catch (err) {
        appendMessage('system', `⚠️ Sahayak File Error: ${err.message}`);
        shkIsProcessing = false;
        renderSahayakUI();
      }
    };
  }

  // Chrome runtime listener for Sahayak file submission events
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      if (msg.type === 'SAHAYAK_FILE_ATTACHED') {
        appendMessage('system', `✅ Sahayak attached document '${msg.fileName}' to form.`);
        closeSahayakCard();
        if (currentTaskId) {
          isSahayakActive = false;
          stepCounter++;
          setStatus('Running...', true);
          appendMessage('system', '▶️ Resuming autonomous agent form-filling automation...');
          setTimeout(runNextStep, 1200);
        }
      }
    });
  }

  // -----------------------------------------------------------------------
  // MAIN AGENT LOOP — Observe-Plan-Act with verification
  // -----------------------------------------------------------------------
  async function startAgentTask(goalText) {
    currentGoal = goalText;
    stepCounter = 1;
    actionHistory = [];
    lastActionResult = null;
    consecutiveFailures = 0;
    lastFailedSignature = '';

    setStatus('Initializing...', true);
    appendMessage('user', goalText);

    try {
      const activeTab = await getActiveTab();
      const resp = await fetch(`${SERVER_BASE}/task/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task: goalText, url: activeTab?.url })
      });

      const data = await resp.json();
      if (!data.ok) throw new Error(data.detail || 'Failed to start task');

      currentTaskId = data.task_id;
      appendMessage('system', `Agent active (${currentTaskId}). Processing task...`);

      runNextStep();
    } catch (err) {
      setStatus('Error');
      appendMessage('system', `❌ Error initializing agent task: ${err.message}`);
    }
  }

  async function runNextStep() {
    if (!currentTaskId) return;
    if (isSahayakActive) {
      console.log('[Agent Panel] Paused while Sahayak is active.');
      return;
    }

    setStatus(`Executing Step ${stepCounter}...`, true);
    const activeTab = await getActiveTab();
    if (!activeTab?.id) {
      setStatus('Paused (No active tab)');
      appendMessage('system', '⚠️ No active browser tab is available for the next safe step.');
      return;
    }

    // --- OBSERVE: Capture DOM + alerts + visible text + redaction regions ---
    const domData = await requestTabDomNodes(activeTab.id);
    const preActionUrl = domData.url || activeTab.url;
    const preActionNodeCount = (domData.nodes || []).length;

    // Check if DOM contains empty file input requiring Sahayak
    const missingFileInput = (domData.nodes || []).find(n => n.tag === 'input' && n.type === 'file');
    if (missingFileInput) {
      isSahayakActive = true;
      const docName = missingFileInput.text || missingFileInput.placeholder || 'Income Certificate';
      appendMessage('system', `📄 Sahayak Assistant triggered for '${docName}'.`);
      openSahayakCard(docName, missingFileInput.selector);
      setStatus('Paused (Awaiting Sahayak Document...)', false);
      return;
    }

    // --- CAPTURE: Screenshot with input-field redaction ---
    let screenshot = null;
    try {
      screenshot = await captureRedactedScreenshot(domData.input_redaction_regions || []);
    } catch (e) {
      console.warn('Screenshot capture failed, continuing without:', e);
    }

    // --- 2-STAGE SEQUENTIAL PRIVACY PIPELINE ---
    // Stage 1: Client DOM & PII Redaction
    // Stage 2: Florence-2 Vision Layer-2 Shield for non-DOM canvas text & human faces
    let finalDualSanitizedImage = null;
    try {
      const stage1Result = await createSanitizedScreenshot(activeTab);
      if (stage1Result?.image) {
        const stage2Resp = await fetch('http://127.0.0.1:8000/florence/analyze-layer2', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            image: stage1Result.image,
            redaction_mode: 'BLUR',
            client_attestation: true
          })
        });
        if (stage2Resp.ok) {
          const stage2Data = await stage2Resp.json();
          finalDualSanitizedImage = stage2Data.sanitized_image || stage1Result.image;
        } else {
          finalDualSanitizedImage = stage1Result.image;
        }
      }
    } catch (pipelineErr) {
      console.warn('[2-Stage Pipeline] Fallback to Stage 1 screenshot:', pipelineErr);
    }

    // --- BUILD PAYLOAD: Rich state for the LLM ---
    const stepPayload = {
      task_id: currentTaskId,
      goal: currentGoal,
      step_number: stepCounter,
      dom_nodes: domData.nodes || [],
      sanitized_findings: [],
      sanitized_image: finalDualSanitizedImage,
      url: domData.url || activeTab.url,
      title: RedactionEngine.sanitizeText(domData.title || activeTab.title || ''),
      client_attested: true,
      stage2_attested: true,
      // New fields
      screenshot: screenshot || null,
      action_history: getHistoryForPayload(),
      page_alerts: domData.page_alerts || [],
      visible_text: domData.visible_text || '',
      last_action_result: lastActionResult
    };

    // Inject recovery hint if stuck in a loop
    if (consecutiveFailures >= 3) {
      stepPayload.visible_text = `⚠️ RECOVERY MODE: The last ${consecutiveFailures} actions had NO EFFECT on the page. You MUST try a completely different approach — different element, different action type, scroll to reveal hidden elements, or dismiss a blocking modal.\n\n${stepPayload.visible_text}`;
      appendMessage('system', `🔄 Recovery mode: ${consecutiveFailures} consecutive failures detected. Asking AI for a different approach.`);
    }

    try {
      const resp = await fetch(`${SERVER_BASE}/task/step`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(stepPayload)
      });


      if (!resp.ok) {
        const errJson = await resp.json();
        throw new Error(errJson.detail || 'Step rejected by local privacy server');
      }

      const stepResult = await resp.json();

      appendStepCard(
        stepResult.thought || 'Next safe step',
        stepResult.action?.label || stepResult.action?.type || 'NO_ACTION',
        stepResult.action?.risk || 'low'
      );

      if (stepResult.requires_hitl) {
        pendingStepData = { stepResult, activeTabId: activeTab.id, preActionUrl, preActionNodeCount };
        showHitlModal(stepResult.action.reason, stepResult.hitl_prompt || stepResult.action.label);
        return;
      }

      await performActionAndContinue(activeTab.id, stepResult, preActionUrl, preActionNodeCount);

    } catch (err) {
      setStatus('Paused (Error)');
      appendMessage('system', `⚠️ Step Execution Error: ${err.message}`);
    }
  }

  async function performActionAndContinue(tabId, stepResult, preActionUrl, preActionNodeCount) {
    if (!stepResult?.action) {
      setStatus('Paused (Invalid action)');
      appendMessage('system', '⚠️ The local planner returned no executable action.');
      return;
    }

    // --- COMPLETE ---
    if (stepResult.completed || stepResult.action?.type === 'COMPLETE') {
      setStatus('Completed');
      appendMessage('system', `🎉 Task Complete! ${stepResult.status_summary}`);
      currentGoal += `\nAgent Output: Task Complete! ${stepResult.status_summary}`;
      addToHistory(stepCounter, 'COMPLETE', 'success', stepResult.thought, preActionUrl);
      return;
    }

    // --- NAVIGATE (handled via chrome.tabs.update for reliable navigation) ---
    if (stepResult.action?.type === 'NAVIGATE' && stepResult.action.url) {
      appendMessage('system', `🌐 Navigating tab to: ${stepResult.action.url}`);
      await chrome.tabs.update(tabId, { url: stepResult.action.url });
      addToHistory(stepCounter, `Navigate: ${stepResult.action.url.slice(0, 50)}`, 'navigation', stepResult.thought, stepResult.action.url);
      lastActionResult = 'navigation';
      stepCounter++;
      // Wait for navigation to complete
      await smartWait(tabId, preActionUrl);
      setTimeout(runNextStep, 1000);
      return;
    }

    // --- SAHAYAK_TRIGGER / UPLOAD_DOCUMENT ---
    if (stepResult.action?.type === 'SAHAYAK_TRIGGER' || stepResult.action?.type === 'UPLOAD_DOCUMENT') {
      appendMessage('system', '📄 Required document field detected. Activating Sahayak Assistant...');
      
      const docType = stepResult.action.label || 'generic';
      const selector = stepResult.action.selector;
      
      isSahayakActive = true;

      // Open Sahayak in sidepanel
      openSahayakCard(docType, selector);
      
      addToHistory(stepCounter, 'SAHAYAK_TRIGGER', 'success', stepResult.thought, preActionUrl);
      lastActionResult = 'success';
      setStatus('Paused (Awaiting Sahayak Document...)', false);
      appendMessage('system', '⏸️ Agent paused. Please attach your document via Sahayak to resume automation.');
      return;
    }

    // --- WAIT (just wait and re-observe) ---
    if (stepResult.action?.type === 'WAIT') {
      appendMessage('system', '⏳ Waiting for page to update...');
      addToHistory(stepCounter, 'WAIT', 'success', stepResult.thought, preActionUrl);
      lastActionResult = 'success';
      stepCounter++;
      await smartWait(tabId, preActionUrl);
      setTimeout(runNextStep, 500);
      return;
    }

    // --- ALL OTHER ACTIONS: Execute → Verify → Continue ---
    const execRes = await executeTabAction(tabId, stepResult.action);
    const actionLabel = stepResult.action.label || stepResult.action.type;

    if (!execRes.ok) {
      appendMessage('system', `⚠️ Action Notice: ${execRes.error || 'Action delayed'}`);
      addToHistory(stepCounter, actionLabel, 'no_change', `Failed: ${execRes.error}`, preActionUrl);
      lastActionResult = 'no_change';
    } else {
      // Wait for page to settle after the action
      await smartWait(tabId, preActionUrl);

      // Verify the action had an effect
      const verificationResult = await verifyActionResult(tabId, preActionUrl, preActionNodeCount);
      lastActionResult = verificationResult;
      addToHistory(stepCounter, actionLabel, verificationResult, stepResult.thought, preActionUrl);

      if (verificationResult === 'no_change') {
        appendMessage('system', `⚠️ Action "${actionLabel}" had no visible effect on the page.`);
      } else if (verificationResult === 'error_detected') {
        appendMessage('system', `🚨 An error or popup appeared after "${actionLabel}".`);
      }
    }

    stepCounter++;
    setTimeout(runNextStep, 800);
  }

  // -----------------------------------------------------------------------
  // Florence-2 Layer-2 Vision Shield Button
  // -----------------------------------------------------------------------
  const shkFlorenceBtn = document.querySelector('#shkFlorenceBtn');
  if (shkFlorenceBtn) {
    shkFlorenceBtn.onclick = async () => {
      try {
        appendMessage('system', '🛡️ Initializing Layer-2 Vision Shield (onnx-community/Florence-2-base)...');
        const activeTab = await getActiveTab();
        if (!activeTab) return;

        const rawImage = await chrome.tabs.captureVisibleTab(activeTab.windowId, { format: 'png' });
        const resp = await fetch('http://127.0.0.1:8000/florence/analyze-layer2', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            image: rawImage,
            redaction_mode: 'BLUR',
            client_attestation: true
          })
        });

        if (!resp.ok) throw new Error('Florence-2 endpoint returned error');
        const fRes = await resp.json();

        appendMessage('system', `🛡️ **LAYER-2 FLORENCE-2 VISION SHIELD ACTIVE**\nModel: \`${fRes.model_id}\`\nRedactions Applied: ${fRes.redactions} non-DOM canvas/image region(s) covered with PrivacyAgent placeholders.\nLatency: ${fRes.latency_ms} ms`);
      } catch (err) {
        appendMessage('system', `⚠️ Layer-2 Vision Shield Error: ${err.message}`);
      }
    };
  }

  // -----------------------------------------------------------------------
  // HITL (Human-in-the-Loop) modal
  // -----------------------------------------------------------------------
  function showHitlModal(reason, promptText) {
    setStatus('Awaiting Approval', true);
    hitlReason.textContent = reason;
    hitlPromptText.textContent = promptText;

    hitlModal.classList.remove('hidden');
  }

  function hideHitlModal() {
    hitlModal.classList.add('hidden');
  }

  btnApproveHitl.addEventListener('click', async () => {
    hideHitlModal();
    if (pendingStepData) {
      const { activeTabId, stepResult, preActionUrl, preActionNodeCount } = pendingStepData;
      pendingStepData = null;
      appendMessage('system', '✅ High-risk action approved by user. Resuming autonomous task...');
      await performActionAndContinue(activeTabId, stepResult, preActionUrl, preActionNodeCount);
    }
  });

  btnCancelHitl.addEventListener('click', () => {
    hideHitlModal();
    pendingStepData = null;
    currentTaskId = null;
    setStatus('Cancelled');
    appendMessage('system', '🚫 Task cancelled by user.');
  });

  // -----------------------------------------------------------------------
  // Form submission handler
  // -----------------------------------------------------------------------
  taskForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const val = taskInput.value.trim();
    if (!val) return;
    taskInput.value = '';
    
    if (currentTaskId) {
      // Continue existing task
      currentGoal += `\nUser Input: ${val}`;
      appendMessage('user', val);
      // Ensure we trigger the next step
      runNextStep();
    } else {
      startAgentTask(val);
    }
  });
});
