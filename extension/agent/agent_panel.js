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

  // Sahayak State
  let shkActiveLangKey = "1"; // Default: English
  let shkActiveDocType = "generic";
  let shkSelectedFileObj = null;
  let shkTargetSelector = null;
  let shkIsProcessing = false;

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

  async function getActiveTab() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab;
  }

  async function requestTabDomNodes(tabId) {
    try {
      const res = await chrome.tabs.sendMessage(tabId, { type: 'AGENT_GET_DOM' });
      return res || { ok: false, nodes: [] };
    } catch (e) {
      console.warn('DOM script missing, injecting...', e);
      await chrome.scripting.executeScript({
        target: { tabId },
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
      const res = await chrome.tabs.sendMessage(tabId, { type: 'AGENT_GET_DOM' });
      return res || { ok: false, nodes: [] };
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

  // --- SAHAYAK SIDEPANEL MANAGER ---
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

    // Read selected State / Jurisdiction from state dropdown
    const shkStateSelect = $('#shkStateSelect');
    const selectedState = shkStateSelect?.value || 'National';

    // Apply Skeleton Loading state while OpenRouter AI generates content
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

    // Fetch dynamic state-specific AI guidance from OpenRouter API via local server
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
      // Remove Skeleton Loading classes
      if (shkDocTitle) shkDocTitle.classList.remove('sahayak-skeleton');
      if (shkDocDesc) shkDocDesc.classList.remove('sahayak-skeleton');
      if (shkIdentifyText) shkIdentifyText.classList.remove('sahayak-skeleton');
      if (shkPortalName) shkPortalName.classList.remove('sahayak-skeleton');
    }

    if (shkStateSelect && !shkStateSelect.dataset.bound) {
      shkStateSelect.dataset.bound = 'true';
      shkStateSelect.onchange = () => renderSahayakUI();
    }



    // Header & Titles
    if (shkModalTitle) shkModalTitle.textContent = strings.modalTitle;
    if (shkDocBadge) shkDocBadge.textContent = `${strings.requiredDocLabel} ${docTitleText}`;
    if (shkAboutTitle) shkAboutTitle.textContent = strings.aboutTitle;
    if (shkDocTitle) shkDocTitle.textContent = docTitleText;
    if (shkDocDesc) shkDocDesc.textContent = descText;
    if (shkIdentifyTitle) shkIdentifyTitle.textContent = strings.identifyTitle;
    if (shkIdentifyText) shkIdentifyText.textContent = identifyText;

    // Language Buttons Active State
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

    // Selected File
    if (shkSelectedFile) {
      shkSelectedFile.textContent = shkSelectedFileObj ? `📄 Selected: ${shkSelectedFileObj.name}` : '';
    }

    // Help Center
    if (shkHelpTitle) shkHelpTitle.textContent = strings.instructionCenterTitle;
    if (shkPortalPrefix) shkPortalPrefix.textContent = strings.officialLinkPrefix;
    if (shkPortalName) shkPortalName.textContent = portalName;
    if (shkPortalBtn) {
      shkPortalBtn.href = portalUrl;
      shkPortalBtn.textContent = strings.openPortalBtn;
    }
    if (shkOnlineProcTitle) shkOnlineProcTitle.textContent = strings.onlineProcedureTitle;
    if (shkOfflineProcTitle) shkOfflineProcTitle.textContent = strings.offlineProcedureTitle;

    // Steps Lists
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

    // Submit Button state
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

        // Call local vision redaction engine
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

        // Attach file to webpage input element
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

        // Resume step execution if pending
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

  // --- MAIN AGENT LOOP ---
  async function startAgentTask(goalText) {
    currentGoal = RedactionEngine.sanitizeText(goalText);
    stepCounter = 1;
    setStatus('Initializing...', true);

    appendMessage('user', goalText);

    try {
      const activeTab = await getActiveTab();
      const resp = await fetch(`${SERVER_BASE}/task/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task: currentGoal, url: RedactionEngine.sanitizeText(activeTab?.url || '') })
      });
      
      const data = await resp.json();
      if (!data.ok) throw new Error(data.detail || 'Failed to start task');

      currentTaskId = data.task_id;
      appendMessage('system', `Task initialized (${currentTaskId}). Beginning autonomous browser loop...`);

      runNextStep();
    } catch (err) {
      setStatus('Error');
      appendMessage('system', `❌ Error initializing agent task: ${err.message}`);
    }
  }

  async function runNextStep() {
    if (!currentTaskId) return;

    setStatus(`Executing Step ${stepCounter}...`, true);
    const activeTab = await getActiveTab();
    if (!activeTab?.id) {
      setStatus('Paused (No active tab)');
      appendMessage('system', '⚠️ No active browser tab is available for the next safe step.');
      return;
    }
    const domData = await requestTabDomNodes(activeTab.id);

    // Check if DOM contains empty file input requiring Sahayak
    const missingFileInput = (domData.nodes || []).find(n => n.tag === 'input' && n.type === 'file');
    if (missingFileInput) {
      const docName = missingFileInput.text || missingFileInput.placeholder || 'Income Certificate';
      appendMessage('system', `📄 Sahayak Assistant triggered for '${docName}'.`);
      openSahayakCard(docName, missingFileInput.selector);
      setStatus('Awaiting Document Upload', true);
      return;
    }


    const stepPayload = {
      task_id: currentTaskId,
      goal: currentGoal,
      step_number: stepCounter,
      dom_nodes: domData.nodes || [],
      sanitized_findings: domData.sanitized_findings || [],
      url: domData.url || activeTab.url,
      title: RedactionEngine.sanitizeText(domData.title || activeTab.title || ''),
      client_attested: true
    };

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

      appendStepCard(stepResult.thought || 'Next safe step', stepResult.action?.label || stepResult.action?.type || 'NO_ACTION', stepResult.action?.risk || 'low');

      if (stepResult.requires_hitl) {
        pendingStepData = { stepResult, activeTabId: activeTab.id };
        showHitlModal(stepResult.action.reason, stepResult.hitl_prompt || stepResult.action.label);
        return;
      }

      await performActionAndContinue(activeTab.id, stepResult);

    } catch (err) {
      setStatus('Paused (Error)');
      appendMessage('system', `⚠️ Step Execution Error: ${err.message}`);
    }
  }

  async function performActionAndContinue(tabId, stepResult) {
    if (!stepResult?.action) {
      setStatus('Paused (Invalid action)');
      appendMessage('system', '⚠️ The local planner returned no executable action.');
      return;
    }
    if (stepResult.completed || stepResult.action?.type === 'COMPLETE') {
      setStatus('Completed');
      appendMessage('system', `🎉 Task Complete! ${stepResult.status_summary}`);
      currentTaskId = null;
      return;
    }

    if (stepResult.action?.type === 'NAVIGATE' && stepResult.action.url) {
      appendMessage('system', `🌐 Navigating tab to: ${stepResult.action.url}`);
      await chrome.tabs.update(tabId, { url: stepResult.action.url });
      stepCounter++;
      setTimeout(() => {
        runNextStep();
      }, 3000);
      return;
    }

    const execRes = await executeTabAction(tabId, stepResult.action);
    if (!execRes.ok) {
      appendMessage('system', `⚠️ Local Action Notice: ${execRes.error || 'Action delayed'}`);
    }

    stepCounter++;
    setTimeout(() => {
      runNextStep();
    }, 1500);
  }

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
      const { activeTabId, stepResult } = pendingStepData;
      pendingStepData = null;
      appendMessage('system', '✅ High-risk action approved by user. Resuming autonomous task...');
      await performActionAndContinue(activeTabId, stepResult);
    }
  });

  btnCancelHitl.addEventListener('click', () => {
    hideHitlModal();
    pendingStepData = null;
    currentTaskId = null;
    setStatus('Cancelled');
    appendMessage('system', '🚫 Task cancelled by user.');
  });

  taskForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const val = taskInput.value.trim();
    if (!val) return;
    taskInput.value = '';
    startAgentTask(val);
  });
});
