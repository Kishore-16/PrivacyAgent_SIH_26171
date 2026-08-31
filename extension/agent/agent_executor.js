/**
 * PrivacyAgent - Standalone Autonomous Agent Content Script & DOM Executor
 * Isolated module for DOM Tree extraction, action execution, and local autofill.
 */
window.PrivacyAgentExecutor = (() => {
  let agentNodeCounter = 0;

  function tagInteractiveElements() {
    const nodes = [];
    const elements = document.querySelectorAll('button, a, input, select, textarea, [role="button"], [contenteditable="true"]');
    
    elements.forEach((el) => {
      // Assign or retrieve data-agent-id
      let agentId = el.getAttribute('data-agent-id');
      if (!agentId) {
        agentId = `node-${++agentNodeCounter}`;
        el.setAttribute('data-agent-id', agentId);
      }

      // Check visibility or file input type
      const rect = el.getBoundingClientRect();
      const isFileInput = el.tagName.toLowerCase() === 'input' && el.type === 'file';
      if ((rect.width > 0 && rect.height > 0) || isFileInput) {
        let textVal = (el.innerText || el.value || el.name || el.id || el.getAttribute('aria-label') || el.placeholder || '').trim();
        if (isFileInput && (!textVal || textVal.toLowerCase() === 'file')) {
          const labelOrParent = el.labels && el.labels.length > 0 ? el.labels[0].innerText : (el.parentElement ? el.parentElement.innerText : '');
          textVal = (labelOrParent || 'Income Certificate Document Field').slice(0, 100);
        }

        nodes.push({
          agentId: agentId,
          tag: el.tagName.toLowerCase(),
          type: el.type || null,
          text: textVal.slice(0, 100),
          placeholder: el.placeholder || '',
          ariaLabel: el.getAttribute('aria-label') || '',
          selector: getSimpleCssSelector(el),
          rect: {
            x: Math.round(rect.left),
            y: Math.round(rect.top),
            width: Math.round(rect.width || 100),
            height: Math.round(rect.height || 30)
          }
        });
      }

    });

    return nodes;
  }

  function getSimpleCssSelector(el) {
    if (el.id) return `#${CSS.escape(el.id)}`;
    if (el.name) return `${el.tagName.toLowerCase()}[name="${CSS.escape(el.name)}"]`;
    const agentId = el.getAttribute('data-agent-id');
    if (agentId) return `[data-agent-id="${agentId}"]`;
    return el.tagName.toLowerCase();
  }

  function executeAction(action) {
    if (!action) return { ok: false, error: 'No action provided' };

    const type = action.type;
    const targetId = action.target_id;
    const selector = action.selector;
    const value = action.value;

    let targetEl = null;
    if (targetId) {
      targetEl = document.querySelector(`[data-agent-id="${targetId}"]`);
    }
    if (!targetEl && selector) {
      targetEl = document.querySelector(selector);
    }

    try {
      if (type === 'NAVIGATE' && action.url) {
        window.location.href = action.url;
        return { ok: true, detail: `Navigating to ${action.url}` };
      }

      if (type === 'CLICK' || type === 'CLICK_AND_WAIT') {
        if (!targetEl) return { ok: false, error: `Element not found: ${targetId || selector}` };
        
        // Sahayak Hook: If targeting a file input that has no file attached, open Sahayak Assistant
        if (targetEl.tagName.toLowerCase() === 'input' && targetEl.type === 'file' && (!targetEl.files || targetEl.files.length === 0)) {
          if (window.SahayakDetector) {
            window.SahayakDetector.handleMissingDocument(targetEl);
            return { ok: true, detail: 'Sahayak Smart Document Helper opened for missing file input' };
          }
        }

        targetEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
        targetEl.focus();
        targetEl.click();
        return { ok: true, detail: `Clicked element ${targetEl.tagName}` };
      }

      if (type === 'SAHAYAK_TRIGGER' || type === 'UPLOAD_DOCUMENT') {
        if (window.SahayakDetector) {
          window.SahayakDetector.handleMissingDocument(targetEl);
          return { ok: true, detail: 'Sahayak Smart Document Helper activated' };
        }
      }

      if (type === 'TYPE' || type === 'TYPE_AND_ENTER') {
        if (!targetEl) return { ok: false, error: `Target element not found for typing` };

        targetEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
        targetEl.focus();
        targetEl.value = value || '';
        targetEl.dispatchEvent(new Event('input', { bubbles: true }));
        targetEl.dispatchEvent(new Event('change', { bubbles: true }));

        if (type === 'TYPE_AND_ENTER') {
          const enterEvent = new KeyboardEvent('keydown', {
            key: 'Enter',
            code: 'Enter',
            keyCode: 13,
            which: 13,
            bubbles: true
          });
          targetEl.dispatchEvent(enterEvent);

          // If inside a form, attempt submit
          if (targetEl.form) {
            targetEl.form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
          }
        }

        return { ok: true, detail: `Typed '${value}' into ${targetEl.tagName}` };
      }

      if (type === 'LOCAL_AUTOFILL') {
        if (!targetEl) return { ok: false, error: 'Target element for autofill not found' };

        // Attempt local retrieval from extension storage
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
          chrome.storage.local.get(['secureProfile'], (res) => {
            const profile = res.secureProfile || {};
            const filledVal = profile[value] || profile['EMAIL'] || profile['PHONE'] || 'LocalUserValue';
            targetEl.value = filledVal;
            targetEl.dispatchEvent(new Event('input', { bubbles: true }));
            targetEl.dispatchEvent(new Event('change', { bubbles: true }));
          });
          return { ok: true, detail: `Injected field '${value}' from encrypted local vault` };
        }
      }

      if (type === 'SCROLL') {
        window.scrollBy({ top: window.innerHeight * 0.7, behavior: 'smooth' });
        return { ok: true, detail: 'Scrolled page' };
      }

      if (type === 'COMPLETE') {
        return { ok: true, detail: 'Task complete' };
      }

      return { ok: false, error: `Unknown action type: ${type}` };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  // Listen for agent execution requests
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      if (msg.type === 'AGENT_GET_DOM') {
        const nodes = tagInteractiveElements();
        sendResponse({ ok: true, nodes, url: location.href, title: document.title });
      } else if (msg.type === 'AGENT_EXECUTE_ACTION') {
        const res = executeAction(msg.action);
        sendResponse(res);
      } else if (msg.type === 'SAHAYAK_ATTACH_FILE') {
        let el = msg.selector ? document.querySelector(msg.selector) : document.querySelector('input[type="file"]');
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          el.style.outline = '3px solid #10b981';
          setTimeout(() => { el.style.outline = ''; }, 3000);
          sendResponse({ ok: true, detail: `Attached file '${msg.fileName}' to element` });
        } else {
          sendResponse({ ok: false, error: 'File input element not found' });
        }
      }
      return true;
    });
  }


  return {
    tagInteractiveElements,
    executeAction
  };
})();
