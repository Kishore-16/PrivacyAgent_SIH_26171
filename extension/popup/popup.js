document.addEventListener('DOMContentLoaded', () => {
  const $ = selector => document.querySelector(selector);

  async function getActiveTab() {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    return tabs[0];
  }

  async function ensureContentScripts(tab) {
    if (!tab || !tab.id) return;
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
      console.warn('Content scripts not responding on tab', tab.id);
      throw new Error("Content script not found. Please refresh the page so PrivacyAgent can attach to it.");
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

    const scaleX = image.naturalWidth / mask.viewportWidth;
    const scaleY = image.naturalHeight / mask.viewportHeight;
    
    for (const region of mask.regions || []) {
      const paddingX = 3 * scaleX;
      const paddingY = 3 * scaleY;
      const rx = Math.max(0, region.left * scaleX - paddingX);
      const ry = Math.max(0, region.top * scaleY - paddingY);
      const rw = region.width * scaleX + paddingX * 2;
      const rh = region.height * scaleY + paddingY * 2;
      
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

  // Dashboard Buttons
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

      // Preview is also the hand-off point for the next-safe-step workflow.
      // Generate a recommendation from the same sanitized DOM/image pair,
      // but never execute it from a preview action.
      const domContext = await sendTabMessage(tab, { type: 'DOM_CONTEXT' });
      const nextStep = await sendBgMessage({
        type: 'PLAN',
        context: domContext.payload,
        image: vRes?.sanitized_image,
        task: 'Analyze the page and determine the next safe action'
      });
      if (nextStep?.ok && nextStep.action) {
        const action = nextStep.action;
        $('#decision-out').textContent = `Sanitized view ready.\nNext safe action: ${action.type} — ${action.label || 'No label'}\nRisk: ${(action.risk || 'low').toUpperCase()}\nReason: ${action.reason || 'Local safety planner recommendation'}`;
      }
    } catch (err) {
      $('#decision-out').textContent = `Preview Error: ${err.message}`;
    }
  };

  let pendingAction = null;

  $('#btn-plan').onclick = async () => {
    try {
      $('#decision-out').textContent = 'Generating sanitized screenshot and fetching DOM context...';
      const tab = await getActiveTab();
      
      // Ensure we have a sanitized screenshot for the AI
      const sanitized = await createSanitizedScreenshot(tab);
      const domContext = await sendTabMessage(tab, { type: 'DOM_CONTEXT' });
      
      const userTask = prompt("What is your task for this page? (Leave blank for generic analysis)", "Analyze the page and determine the next safe action");
      
      $('#decision-out').textContent = 'Requesting safe action from AI planner...';
      const planRes = await sendBgMessage({
        type: 'PLAN',
        context: domContext.payload,
        image: sanitized.image,
        task: userTask || 'Analyze the page and determine the next safe action'
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

  $('#btn-autofill').onclick = async () => {
    try {
      $('#decision-out').textContent = 'Fetching secure data from extension storage...';
      let profile = null;
      const stored = await new Promise((resolve) => {
        chrome.storage.local.get(['secureProfile'], resolve);
      });
      
      if (stored.secureProfile && Object.keys(stored.secureProfile).length > 0) {
        profile = stored.secureProfile;
      } else {
        const res = await fetch(chrome.runtime.getURL('profile.json'));
        profile = await res.json();
        chrome.storage.local.set({ secureProfile: profile });
      }
      
      if (!profile) throw new Error('Failed to load secure profile data');

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

  // --- SAHAYAK ASSISTANT POPUP MANAGER ---
  const sahayakPopupCard = $('#sahayakPopupCard');
  const pkModalTitle = $('#pkModalTitle');
  const pkDocBadge = $('#pkDocBadge');
  const pkCloseBtn = $('#pkCloseBtn');
  const pkCancelBtn = $('#pkCancelBtn');
  const pkSubmitBtn = $('#pkSubmitBtn');
  const pkLangButtons = $('#pkLangButtons');
  const pkAboutTitle = $('#pkAboutTitle');
  const pkDocTitle = $('#pkDocTitle');
  const pkDocDesc = $('#pkDocDesc');
  const pkIdentifyTitle = $('#pkIdentifyTitle');
  const pkIdentifyText = $('#pkIdentifyText');
  const pkDropZone = $('#pkDropZone');
  const pkDropText = $('#pkDropText');
  const pkBrowseLink = $('#pkBrowseLink');
  const pkFileInput = $('#pkFileInput');
  const pkSelectedFile = $('#pkSelectedFile');
  const pkHelpTitle = $('#pkHelpTitle');
  const pkPortalPrefix = $('#pkPortalPrefix');
  const pkPortalName = $('#pkPortalName');
  const pkPortalBtn = $('#pkPortalBtn');
  const pkOnlineProcTitle = $('#pkOnlineProcTitle');
  const pkOnlineStepsList = $('#pkOnlineStepsList');
  const pkOfflineProcTitle = $('#pkOfflineProcTitle');
  const pkOfflineStepsList = $('#pkOfflineStepsList');

  let pkActiveLangKey = "1";
  let pkActiveDocType = "generic";
  let pkSelectedFileObj = null;
  let pkTargetSelector = null;
  let pkIsProcessing = false;

  function openSahayakPopup(docType = "generic", selector = null) {
    if (!sahayakPopupCard) return;
    pkActiveDocType = docType;
    pkTargetSelector = selector;
    pkSelectedFileObj = null;
    pkIsProcessing = false;
    sahayakPopupCard.classList.remove('hidden');
    renderSahayakPopupUI();
  }

  function closeSahayakPopup() {
    if (sahayakPopupCard) sahayakPopupCard.classList.add('hidden');
  }

  async function renderSahayakPopupUI() {
    if (typeof SahayakConfig === 'undefined') return;

    const langCode = SahayakConfig.LANGUAGES[pkActiveLangKey]?.code || "en";
    const strings = SahayakConfig.UI_STRINGS[langCode] || SahayakConfig.UI_STRINGS.en;
    const docConfig = SahayakConfig.getDocConfig(pkActiveDocType);

    let docTitleText = docConfig.displayTitle[langCode] || docConfig.displayTitle.en;
    let descText = docConfig.description[langCode] || docConfig.description.en;
    let identifyText = docConfig.howToIdentify[langCode] || docConfig.howToIdentify.en;
    let onlineSteps = docConfig.onlineSteps[langCode] || docConfig.onlineSteps.en;
    let offlineSteps = docConfig.offlineSteps[langCode] || docConfig.offlineSteps.en;
    let portalName = docConfig.portalName;
    let portalUrl = docConfig.portalUrl;

    // Read selected State / Jurisdiction from state dropdown
    const pkStateSelect = $('#pkStateSelect');
    const selectedState = pkStateSelect?.value || 'National';

    // Apply Skeleton Loading state while OpenRouter AI generates content
    if (pkDocTitle) pkDocTitle.classList.add('sahayak-skeleton');
    if (pkDocDesc) pkDocDesc.classList.add('sahayak-skeleton');
    if (pkIdentifyText) pkIdentifyText.classList.add('sahayak-skeleton');
    if (pkPortalName) pkPortalName.classList.add('sahayak-skeleton');
    if (pkOnlineStepsList) {
      pkOnlineStepsList.innerHTML = `
        <div class="sahayak-step-card sahayak-skeleton" style="height:36px; margin-bottom:6px;"></div>
        <div class="sahayak-step-card sahayak-skeleton" style="height:36px;"></div>
      `;
    }
    if (pkOfflineStepsList) {
      pkOfflineStepsList.innerHTML = `
        <div class="sahayak-step-card sahayak-skeleton" style="height:36px; margin-bottom:6px;"></div>
        <div class="sahayak-step-card sahayak-skeleton" style="height:36px;"></div>
      `;
    }

    // Fetch dynamic state-specific AI guidance from OpenRouter API via local server
    try {
      const aiResp = await fetch(`http://127.0.0.1:8000/sahayak/guides?doc=${encodeURIComponent(pkActiveDocType)}&state=${encodeURIComponent(selectedState)}&lang=${langCode}`);
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
      console.warn('[Sahayak Popup] AI Guide endpoint fallback:', netErr.message);
    } finally {
      // Remove Skeleton Loading classes
      if (pkDocTitle) pkDocTitle.classList.remove('sahayak-skeleton');
      if (pkDocDesc) pkDocDesc.classList.remove('sahayak-skeleton');
      if (pkIdentifyText) pkIdentifyText.classList.remove('sahayak-skeleton');
      if (pkPortalName) pkPortalName.classList.remove('sahayak-skeleton');
    }

    if (pkStateSelect && !pkStateSelect.dataset.bound) {
      pkStateSelect.dataset.bound = 'true';
      pkStateSelect.onchange = () => renderSahayakPopupUI();
    }



    if (pkModalTitle) pkModalTitle.textContent = strings.modalTitle;
    if (pkDocBadge) pkDocBadge.textContent = `${strings.requiredDocLabel} ${docTitleText}`;
    if (pkAboutTitle) pkAboutTitle.textContent = strings.aboutTitle;
    if (pkDocTitle) pkDocTitle.textContent = docTitleText;
    if (pkDocDesc) pkDocDesc.textContent = descText;
    if (pkIdentifyTitle) pkIdentifyTitle.textContent = strings.identifyTitle;
    if (pkIdentifyText) pkIdentifyText.textContent = identifyText;

    if (pkLangButtons) {
      pkLangButtons.querySelectorAll('.sahayak-lang-btn').forEach(btn => {
        const key = btn.getAttribute('data-lang-key');
        if (key === pkActiveLangKey) {
          btn.classList.add('active');
        } else {
          btn.classList.remove('active');
        }
      });
    }

    if (pkSelectedFile) {
      pkSelectedFile.textContent = pkSelectedFileObj ? `📄 Selected: ${pkSelectedFileObj.name}` : '';
    }

    if (pkHelpTitle) pkHelpTitle.textContent = strings.instructionCenterTitle;
    if (pkPortalPrefix) pkPortalPrefix.textContent = strings.officialLinkPrefix;
    if (pkPortalName) pkPortalName.textContent = portalName;
    if (pkPortalBtn) {
      pkPortalBtn.href = portalUrl;
      pkPortalBtn.textContent = strings.openPortalBtn;
    }
    if (pkOnlineProcTitle) pkOnlineProcTitle.textContent = strings.onlineProcedureTitle;
    if (pkOfflineProcTitle) pkOfflineProcTitle.textContent = strings.offlineProcedureTitle;

    if (pkOnlineStepsList) {
      pkOnlineStepsList.innerHTML = onlineSteps.map((step, idx) => `
        <div class="sahayak-step-card">
          <span class="sahayak-step-num">${idx + 1}️⃣</span>
          <span>${step}</span>
        </div>
      `).join('');
    }

    if (pkOfflineStepsList) {
      pkOfflineStepsList.innerHTML = offlineSteps.map((step, idx) => `
        <div class="sahayak-step-card" style="border-left-color: #fbbf24;">
          <span class="sahayak-step-num" style="color: #fbbf24;">🏛️</span>
          <span>${step}</span>
        </div>
      `).join('');
    }

    if (pkSubmitBtn) {
      pkSubmitBtn.disabled = !pkSelectedFileObj || pkIsProcessing;
      pkSubmitBtn.textContent = pkIsProcessing ? strings.processingText : strings.submitBtn;
    }
  }


  if (pkLangButtons) {
    pkLangButtons.querySelectorAll('.sahayak-lang-btn').forEach(btn => {
      btn.onclick = (e) => {
        const key = e.target.getAttribute('data-lang-key');
        if (key) {
          pkActiveLangKey = key;
          renderSahayakPopupUI();
        }
      };
    });
  }

  window.addEventListener('keydown', (e) => {
    if (!sahayakPopupCard || sahayakPopupCard.classList.contains('hidden')) return;
    if (['1', '2', '3', '4', '5'].includes(e.key)) {
      pkActiveLangKey = e.key;
      renderSahayakPopupUI();
    } else if (e.key === 'Escape') {
      closeSahayakPopup();
    }
  });

  if (pkBrowseLink && pkFileInput) {
    pkBrowseLink.onclick = (e) => {
      e.stopPropagation();
      pkFileInput.click();
    };
  }

  if (pkDropZone && pkFileInput) {
    pkDropZone.onclick = () => pkFileInput.click();
    pkDropZone.ondragover = (e) => {
      e.preventDefault();
      pkDropZone.classList.add('dragover');
    };
    pkDropZone.ondragleave = () => pkDropZone.classList.remove('dragover');
    pkDropZone.ondrop = (e) => {
      e.preventDefault();
      pkDropZone.classList.remove('dragover');
      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        pkSelectedFileObj = e.dataTransfer.files[0];
        renderSahayakPopupUI();
      }
    };
  }

  if (pkFileInput) {
    pkFileInput.onchange = (e) => {
      if (e.target.files && e.target.files.length > 0) {
        pkSelectedFileObj = e.target.files[0];
        renderSahayakPopupUI();
      }
    };
  }

  if (pkCloseBtn) pkCloseBtn.onclick = closeSahayakPopup;
  if (pkCancelBtn) pkCancelBtn.onclick = closeSahayakPopup;

  if (pkSubmitBtn) {
    pkSubmitBtn.onclick = async () => {
      if (!pkSelectedFileObj) return;
      pkIsProcessing = true;
      renderSahayakPopupUI();

      try {
        const base64Data = await new Promise((res, rej) => {
          const r = new FileReader();
          r.onload = () => res(r.result);
          r.onerror = (e) => rej(e);
          r.readAsDataURL(pkSelectedFileObj);
        });

        try {
          await fetch('http://127.0.0.1:8000/sahayak/process-document', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              document_type: pkActiveDocType,
              image_data: base64Data,
              redaction_mode: 'BLUR',
              client_attestation: true
            })
          });
        } catch (netErr) {
          console.warn('[Sahayak Popup] Server processing fallback:', netErr);
        }

        const activeTab = await getActiveTab();
        if (activeTab) {
          await sendTabMessage(activeTab, {
            type: 'SAHAYAK_ATTACH_FILE',
            selector: pkTargetSelector,
            fileName: pkSelectedFileObj.name,
            fileType: pkSelectedFileObj.type,
            fileData: base64Data
          });
        }

        appendPopupMsg('system', `✅ Sahayak attached '${pkSelectedFileObj.name}' to form.`);
        closeSahayakPopup();

        if (popupTaskId) {
          popupStepCount++;
          setTimeout(runNextPopupAgentStep, 1500);
        }
      } catch (err) {
        appendPopupMsg('system', `⚠️ Sahayak File Error: ${err.message}`);
        pkIsProcessing = false;
        renderSahayakPopupUI();
      }
    };
  }

  // --- POPUP AGENT LOOP ---
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
  let popupActionHistory = [];
  let popupLastActionResult = null;
  let popupLastPageFingerprint = null;
  let popupAgentRunning = false;
  const SERVER_AGENT_BASE = 'http://127.0.0.1:8000/agent';

  function saveAgentState() {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.set({
        agentState: {
           popupTaskId,
           popupGoal,
           popupStepCount,
           // Never persist entered values or DOM text.  The history is solely a
           // privacy-safe execution trace for loop prevention and recovery.
           popupActionHistory,
           popupLastActionResult,
           popupLastPageFingerprint,
           chatHtml: popupChatViewport.innerHTML
        }
      });
    }
  }

  function loadAgentState() {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.get(['agentState'], (res) => {
        if (res.agentState && res.agentState.chatHtml) {
          popupTaskId = res.agentState.popupTaskId;
          popupGoal = res.agentState.popupGoal;
          popupStepCount = res.agentState.popupStepCount || 1;
          popupActionHistory = Array.isArray(res.agentState.popupActionHistory) ? res.agentState.popupActionHistory : [];
          popupLastActionResult = res.agentState.popupLastActionResult || null;
          popupLastPageFingerprint = res.agentState.popupLastPageFingerprint || null;
          popupChatViewport.innerHTML = res.agentState.chatHtml;
          popupChatViewport.scrollTop = popupChatViewport.scrollHeight;
        }
      });
    }
  }

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
    saveAgentState();
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
    saveAgentState();
  }

  async function startPopupAgentTask(goalText) {
    popupGoal = RedactionEngine.sanitizeText(goalText);
    popupStepCount = 1;
    popupActionHistory = [];
    popupLastActionResult = null;
    popupLastPageFingerprint = null;
    appendPopupMsg('user', goalText);

    try {
      const activeTab = await getActiveTab();
      const resp = await fetch(`${SERVER_AGENT_BASE}/task/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task: popupGoal, url: RedactionEngine.sanitizeText(activeTab?.url || '') })
      });
      const data = await resp.json();
      if (!data.ok) throw new Error(data.detail || 'Failed to start agent task');

      popupTaskId = data.task_id;
      saveAgentState();
      appendPopupMsg('system', `Agent active (${popupTaskId}). Processing task...`);
      runNextPopupAgentStep();
    } catch (err) {
      appendPopupMsg('system', `❌ Error starting task: ${err.message}`);
    }
  }

  async function runNextPopupAgentStep() {
    if (!popupTaskId || popupAgentRunning) return;
    popupAgentRunning = true;

    try {
    const activeTab = await getActiveTab();
    if (!activeTab?.id) {
      appendPopupMsg('system', '⚠️ No active browser tab is available for the next safe step.');
      popupTaskId = null;
      return;
    }
      let domNodes = [];
      let domRes = null;
      let retries = 3;
      while (retries > 0) {
        try {
          const activeTab = await getActiveTab();
          domRes = await sendTabMessage(activeTab, { type: 'AGENT_GET_DOM' });
          if (domRes) {
            domNodes = domRes.nodes || [];
            popupLastPageFingerprint = domRes.page_fingerprint || popupLastPageFingerprint;
            break;
          }
        } catch (e) {
          console.warn(`DOM fetch failed (retries left: ${retries - 1})`, e);
        }
        retries--;
        if (retries > 0) await new Promise(r => setTimeout(r, 1500));
      }

    // Auto-detect if user wants to upload a document
    const isUploadIntent = popupGoal.toLowerCase().includes('upload') || popupGoal.toLowerCase().includes('certificate') || popupGoal.toLowerCase().includes('document');
    if (isUploadIntent) {
      const fileInputNode = (domNodes || []).find(n => n.tag === 'input' && n.type === 'file');
      if (fileInputNode) {
        const docName = fileInputNode.text || fileInputNode.placeholder || 'Income Certificate';
        appendPopupMsg('system', `📄 Sahayak Assistant activated for '${docName}'.`);
        openSahayakPopup(docName, fileInputNode.selector);

        // Trigger webpage popup overlay as well
        try {
          await sendTabMessage(activeTab, { type: 'SAHAYAK_TRIGGER' });
        } catch (e) {}

        return;
      }
    }


    const payload = {
      task_id: popupTaskId,
      goal: popupGoal,
      step_number: popupStepCount,
      dom_nodes: domNodes,
      sanitized_findings: domRes?.sanitized_findings || [],
      url: RedactionEngine.sanitizeText(activeTab?.url || ''),
      title: RedactionEngine.sanitizeText(activeTab?.title || ''),
      client_attested: true,
      page_alerts: domRes?.page_alerts || [],
      visible_text: domRes?.visible_text || '',
      action_history: popupActionHistory.slice(-12),
      last_action_result: popupLastActionResult
    };

    // Visual grounding is an explicit recovery tool, not a continuous leak of
    // page pixels.  It is only supplied after an empty DOM or a failed action,
    // and uses the extension's redacted screenshot pipeline.
    if (domNodes.length === 0 || popupLastActionResult === 'no_change' || popupLastActionResult === 'error_detected') {
      try {
        const visual = await createSanitizedScreenshot(activeTab);
        payload.screenshot = visual.image;
      } catch (e) {
        console.warn('Redacted visual recovery unavailable', e);
      }
    }

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
      
      // For chat answers, skip the step card — display directly as a message
      if (stepRes.action?.label === 'Chat Answer') {
        await executeStepAndAdvance(activeTab.id, stepRes);
        return;
      }

      appendPopupStepCard(stepRes.thought || 'Next safe step', stepRes.action?.label || stepRes.action?.type || 'NO_ACTION', stepRes.action?.risk || 'low');

      if (stepRes.requires_hitl) {
        popupPendingStep = { stepRes, tabId: activeTab.id };
        if (popupHitlReason) popupHitlReason.textContent = stepRes.action.reason;
        if (popupHitlPromptText) popupHitlPromptText.textContent = stepRes.hitl_prompt || stepRes.action.label;
        if (popupBtnApproveHitl) popupBtnApproveHitl.textContent = stepRes.action.type === 'WAIT_FOR_USER' ? 'Resume Automation' : 'Approve Action';
        if (popupHitlModal) popupHitlModal.classList.remove('hidden');
        return;
      }

      await executeStepAndAdvance(activeTab.id, stepRes);
    } catch (err) {
      appendPopupMsg('system', `⚠️ Step Error: ${err.message}`);
    }
    } finally {
      popupAgentRunning = false;
    }
  }

  function recordActionOutcome(action, outcome, detail, url) {
    const actionSummary = {
      type: action?.type || 'UNKNOWN',
      label: String(action?.label || action?.type || 'Interaction').slice(0, 100)
    };
    popupActionHistory.push({
      step: popupStepCount,
      action: actionSummary,
      result: outcome,
      detail: String(detail || '').slice(0, 160),
      url: RedactionEngine.sanitizeText(url || '')
    });
    popupActionHistory = popupActionHistory.slice(-20);
    popupLastActionResult = outcome;
    saveAgentState();
  }

  function outcomeFromObservation(action, execution, beforeFingerprint, afterObservation) {
    if (!execution?.ok) return 'error_detected';
    const alerts = afterObservation?.page_alerts || [];
    const hasError = alerts.some((alert) => /error|invalid|required|failed|unable|try again/i.test(alert?.text || ''));
    if (hasError) return 'error_detected';
    const afterFingerprint = afterObservation?.page_fingerprint;
    if (afterFingerprint && beforeFingerprint && afterFingerprint !== beforeFingerprint) return 'success';
    // Typing can leave a page structurally unchanged; a successful executor
    // report is enough for the planner to move to the dependent field.
    if (['TYPE', 'TYPE_AND_SELECT', 'SELECT', 'WAIT', 'SCROLL'].includes(action?.type)) return 'success';
    return 'no_change';
  }

  async function executeStepAndAdvance(tabId, stepRes) {
    if (!stepRes?.action) {
      appendPopupMsg('system', '⚠️ The local planner returned no executable action.');
      popupTaskId = null;
      return;
    }

    // Chat answer — display cleanly as a message, not a step card
    if (stepRes.action?.label === 'Chat Answer' && (stepRes.completed || stepRes.action?.type === 'COMPLETE')) {
      appendPopupMsg('system', stepRes.status_summary);
      popupGoal += `\nAgent Output: ${stepRes.status_summary}`;
      return;
    }

    // Task complete (non-chat)
    if (stepRes.completed || stepRes.action?.type === 'COMPLETE') {
      appendPopupMsg('system', `🎉 Task Complete! ${stepRes.status_summary}`);
      popupGoal += `\nAgent Output: Task Complete! ${stepRes.status_summary}`;
      return;
    }

    // Navigate action
    if (stepRes.action?.type === 'NAVIGATE' && stepRes.action.url) {
      appendPopupMsg('system', `🌐 Navigating to: ${stepRes.action.url}`);
      await chrome.tabs.update(tabId, { url: stepRes.action.url });
      recordActionOutcome(stepRes.action, 'navigation', 'Navigation started', stepRes.action.url);
      popupStepCount++;
      // Wait for page to load before continuing
      setTimeout(() => {
        runNextPopupAgentStep();
      }, 4000);
      return;
    }

    // Execute other actions (CLICK, TYPE, SCROLL, etc.)
    try {
      const beforeFingerprint = popupLastPageFingerprint;
      const execution = await sendTabMessage({ id: tabId }, { type: 'AGENT_EXECUTE_ACTION', action: stepRes.action });
      // The executor waits for DOM mutation quiescence.  Re-observe rather than
      // assuming a synthetic click worked; this is what enables recovery on
      // stateful booking widgets and stale elements.
      const activeTab = await getActiveTab();
      const observation = activeTab?.id === tabId
        ? await sendTabMessage(activeTab, { type: 'AGENT_GET_DOM' })
        : null;
      popupLastPageFingerprint = observation?.page_fingerprint || execution?.page_fingerprint || popupLastPageFingerprint;
      const outcome = outcomeFromObservation(stepRes.action, execution, beforeFingerprint, observation);
      recordActionOutcome(stepRes.action, outcome, execution?.detail || execution?.error, activeTab?.url);
      if (outcome !== 'success' && outcome !== 'navigation') {
        appendPopupMsg('system', `↻ Step did not verify (${execution?.error || execution?.detail || 'no visible page change'}). Trying a different safe approach.`);
      }
          } catch (e) {
      console.warn('Action execute notice', e);
      const msg = (e.message || "").toLowerCase();
      if (msg.includes('closed before a response') || msg.includes('receiving end does not exist') || msg.includes('back/forward cache')) {
        recordActionOutcome(stepRes.action, 'navigation', 'Page navigated', '');
      } else {
        recordActionOutcome(stepRes.action, 'error_detected', e.message, '');
      }
    }

    popupStepCount++;
    setTimeout(() => {
      runNextPopupAgentStep();
    }, 2000);
  }

  if (popupBtnApproveHitl) {
    popupBtnApproveHitl.onclick = async () => {
      if (popupHitlModal) popupHitlModal.classList.add('hidden');
      if (popupPendingStep) {
        const { tabId, stepRes } = popupPendingStep;
        popupPendingStep = null;
        if (stepRes.action.type === 'WAIT_FOR_USER') {
          appendPopupMsg('system', '🔄 User manually intervened. Resuming automation...');
          popupStepCount++;
          setTimeout(runNextPopupAgentStep, 1500);
        } else {
          appendPopupMsg('system', '✅ High-risk action approved by user. Executing...');
          await executeStepAndAdvance(tabId, stepRes);
        }
      }
    };
  }

  if (popupBtnCancelHitl) {
    popupBtnCancelHitl.onclick = () => {
      if (popupHitlModal) popupHitlModal.classList.add('hidden');
      popupPendingStep = null;
      popupTaskId = null;
      popupActionHistory = [];
      popupLastActionResult = null;
      popupLastPageFingerprint = null;
      appendPopupMsg('system', '🚫 Task cancelled by user.');
    };
  }

  if (popupTaskForm) {
    popupTaskForm.onsubmit = (e) => {
      e.preventDefault();
      const val = popupTaskInput.value.trim();
      if (!val) return;
      popupTaskInput.value = '';
      
      if (popupTaskId) {
        // Continue existing task
        popupGoal += `\nUser Input: ${RedactionEngine.sanitizeText(val)}`;
        appendPopupMsg('user', val);
        if (!popupAgentRunning) {
          runNextPopupAgentStep();
        }
      } else {
        startPopupAgentTask(val);
      }
    };
  }
  // loadAgentState(); // Disabled: Start a fresh conversation every time popup opens
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    chrome.storage.local.remove(['agentState']);
  }

  
  checkHealth().then(() => runScan().catch(() => {}));

  // -----------------------------------------------------------------------
  // Florence-2 Layer-2 Vision Shield Button (Restored)
  // -----------------------------------------------------------------------
  const btnFlorence = document.getElementById('btn-florence-layer2');
  if (btnFlorence) {
    btnFlorence.onclick = async () => {
      try {
        $('#decision-out').textContent = 'Initializing Layer-2 Vision Shield (onnx-community/Florence-2-base)...';
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

        $('#decision-out').textContent = `🛡️ LAYER-2 FLORENCE-2 VISION SHIELD ACTIVE:\nModel: ${fRes.model_id}\nNon-DOM Canvas/Image Redactions: ${fRes.redactions} region(s) covered with PrivacyAgent placeholders.\nLatency: ${fRes.latency_ms} ms`;

        // Inject sanitized image into preview
        $('#sanitized-img').src = fRes.sanitized_image || rawImage;
        $('#preview-section').style.display = 'block';
      } catch (err) {
        console.error(err);
        $('#decision-out').textContent = `⚠️ Florence-2 Engine offline or failed: ${err.message}`;
      }
    };
  }
});
