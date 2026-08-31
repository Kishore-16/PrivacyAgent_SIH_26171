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

  const SERVER_BASE = 'http://127.0.0.1:8000/agent';
  let currentTaskId = null;
  let currentGoal = '';
  let stepCounter = 1;
  let pendingStepData = null;

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
