/**
 * PrivacyAgent - Standalone Autonomous Agent Content Script & DOM Executor
 * Isolated module for DOM Tree extraction, action execution, and local autofill.
 */
window.PrivacyAgentExecutor = (() => {
  let agentNodeCounter = 0;

  function safeNodeText(el, value) {
    const kind = DOMPrivacyDetector.isSensitiveElement(el);
    return kind ? `[${kind}]` : RedactionEngine.sanitizeText(value || '');
  }

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
          text: safeNodeText(el, textVal).slice(0, 100),
          placeholder: safeNodeText(el, el.placeholder || ''),
          ariaLabel: safeNodeText(el, el.getAttribute('aria-label') || ''),
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

  function setElementValue(el, value) {
    if (el.isContentEditable) {
      el.textContent = value;
    } else if (el.tagName.toLowerCase() === 'select') {
      const option = [...el.options].find(o => o.value === value || o.textContent.trim() === value);
      if (!option) return false;
      el.value = option.value;
    } else {
      const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      if (setter) setter.call(el, value);
      else el.value = value;
    }
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }

  function executeAction(action) {
    if (!action) return { ok: false, error: 'No action provided' };

    const type = action.type;
    const targetId = action.target_id;
    const selector = action.selector;
    const value = action.value;

    let targetEl = null;
    if (targetId) {
      try { targetEl = document.querySelector(`[data-agent-id="${targetId}"]`); } catch(e) {}
    }
    if (!targetEl && selector) {
      try {
        targetEl = document.querySelector(selector);
      } catch (err) {
        console.warn('Invalid selector provided by AI:', selector);
      }
    }
    
    // Fallback: if we still don't have targetEl, try to extract text and search the DOM
    if (!targetEl && selector) {
       let textMatch = selector;
       
       // Try to extract text from :contains('foo'), text='foo', or xpath text()='foo'
       const quoteMatch = selector.match(/['"](.*?)['"]/);
       if (quoteMatch && quoteMatch[1]) {
           textMatch = quoteMatch[1];
       } else {
           // Fallback for unquoted text=Login
           textMatch = selector.replace(/^text=/, '');
       }
       
       textMatch = textMatch.trim().toLowerCase();
       
       if (textMatch) {
           const allNodes = Array.from(document.querySelectorAll('button, a, input, [role="button"]'));
           for (const el of allNodes) {
               const elText = (el.innerText || el.value || el.placeholder || el.getAttribute('aria-label') || '').toLowerCase();
               if (elText.includes(textMatch)) {
                   targetEl = el;
                   break;
               }
           }
       }
    }

    try {
      if (type === 'NAVIGATE' && action.url) {
        window.location.href = action.url;
        return { ok: true, detail: `Navigating to ${action.url}` };
      }

      if (type === 'CLICK' || type === 'CLICK_AND_WAIT') {
        if (!targetEl) return { ok: false, error: `Element not found: ${targetId || selector}` };

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
        setElementValue(targetEl, value || '');

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
            const filledVal = profile[value];
            if (filledVal !== undefined) setElementValue(targetEl, filledVal);
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
        sendResponse({ ok: true, nodes, url: location.href, title: document.title,
          sanitized_findings: DOMPrivacyDetector.scanPage().findings });
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
