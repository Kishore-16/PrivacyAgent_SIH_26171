/**
 * PrivacyAgent - Standalone Autonomous Agent Content Script & DOM Executor
 * Isolated module for DOM Tree extraction, action execution, and local autofill.
 * v2.0 — Enhanced with shadow DOM/iframe traversal, scored modal detection,
 *         CLICK_COORDINATE, SELECT, DISMISS_MODAL, WAIT, screenshot redaction.
 */
window.PrivacyAgentExecutor = (() => {
  let agentNodeCounter = 0;

  // -----------------------------------------------------------------------
  // Utility: safe text extraction (respects privacy redaction)
  // -----------------------------------------------------------------------
  function safeNodeText(el, value) {
    const kind = DOMPrivacyDetector.isSensitiveElement(el);
    return kind ? `[${kind}]` : RedactionEngine.sanitizeText(value || '');
  }

  function getSimpleCssSelector(el) {
    if (el.id) return `#${CSS.escape(el.id)}`;
    if (el.name) return `${el.tagName.toLowerCase()}[name="${CSS.escape(el.name)}"]`;
    const agentId = el.getAttribute('data-agent-id');
    if (agentId) return `[data-agent-id="${agentId}"]`;
    return el.tagName.toLowerCase();
  }

  // -----------------------------------------------------------------------
  // Interactive element selectors — expanded for richer coverage
  // -----------------------------------------------------------------------
  const INTERACTIVE_SELECTOR = [
    'button', 'a', 'input', 'select', 'textarea',
    '[role="button"]', '[role="tab"]', '[role="menuitem"]',
    '[role="listbox"]', '[role="option"]', '[role="link"]',
    '[role="checkbox"]', '[role="radio"]', '[role="switch"]',
    '[role="combobox"]', '[role="searchbox"]', '[role="textbox"]',
    '[data-autocomplete]', '[aria-autocomplete]', '[aria-haspopup="listbox"]',
    '[contenteditable="true"]',
    'canvas', 'svg a', 'svg text', 'svg [role]'
  ].join(', ');

  // -----------------------------------------------------------------------
  // Tag interactive elements — with shadow DOM & iframe traversal
  // -----------------------------------------------------------------------
  function tagInteractiveElements() {
    agentNodeCounter = 0;
    const nodes = [];
    _tagElementsInContext(document, nodes, '');
    return nodes;
  }

  function _tagElementsInContext(root, nodes, prefix) {
    const elements = root.querySelectorAll(INTERACTIVE_SELECTOR);

    elements.forEach((el) => {
      const agentId = _assignAgentId(el, prefix);
      const rect = el.getBoundingClientRect();
      const isFileInput = el.tagName.toLowerCase() === 'input' && el.type === 'file';

      if ((rect.width > 0 && rect.height > 0) || isFileInput) {
        let textVal = (el.innerText || el.value || el.name || el.id ||
                       el.getAttribute('aria-label') || el.placeholder || '').trim();

        if (isFileInput && (!textVal || textVal.toLowerCase() === 'file')) {
          const labelOrParent = el.labels && el.labels.length > 0
            ? el.labels[0].innerText
            : (el.parentElement ? el.parentElement.innerText : '');
          textVal = (labelOrParent || 'File Upload Field').slice(0, 100);
        }

        const nodeData = {
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
        };

        // Capture dropdown options for <select> elements
        if (el.tagName.toLowerCase() === 'select') {
          const options = [...el.options].map(o => o.textContent.trim()).filter(t => t);
          nodeData.options = options.slice(0, 20);
          nodeData.selectedOption = el.options[el.selectedIndex]
            ? el.options[el.selectedIndex].textContent.trim()
            : '';
        }
        
        // Capture autocomplete indicators
        if (el.tagName.toLowerCase() === 'input') {
          const role = (el.getAttribute('role') || '').toLowerCase();
          const hasAutocomplete = el.hasAttribute('aria-autocomplete') || el.hasAttribute('data-autocomplete');
          const hasListbox = el.hasAttribute('aria-haspopup') || el.nextElementSibling?.getAttribute('role') === 'listbox';
          if (role === 'combobox' || role === 'searchbox' || hasAutocomplete || hasListbox) {
            nodeData.isAutocomplete = true;
          }
        }

        nodes.push(nodeData);
      }
    });

    // --- Shadow DOM traversal ---
    const allElements = root.querySelectorAll('*');
    allElements.forEach((el) => {
      if (el.shadowRoot) {
        const shadowPrefix = prefix
          ? `${prefix}/shadow-${_assignAgentId(el, prefix)}`
          : `shadow-${_assignAgentId(el, '')}`;
        _tagElementsInContext(el.shadowRoot, nodes, shadowPrefix);
      }
    });

    // --- Same-origin iframe traversal ---
    const iframes = root.querySelectorAll('iframe');
    iframes.forEach((iframe, idx) => {
      try {
        const iframeDoc = iframe.contentDocument;
        if (iframeDoc) {
          const iframePrefix = prefix ? `${prefix}/iframe-${idx}` : `iframe-${idx}`;
          _tagElementsInContext(iframeDoc, nodes, iframePrefix);
        }
      } catch (e) {
        // Cross-origin iframe — cannot access, skip silently
      }
    });
  }

  function _assignAgentId(el, prefix) {
    let agentId = el.getAttribute('data-agent-id');
    if (!agentId) {
      agentId = `${prefix ? prefix + '/' : ''}node-${++agentNodeCounter}`;
      el.setAttribute('data-agent-id', agentId);
    }
    return agentId;
  }

  // -----------------------------------------------------------------------
  // Scored heuristic modal/alert detection
  // -----------------------------------------------------------------------
  function getPageAlerts() {
    const candidates = [];
    const seen = new Set();

    // Scan elements that are likely modals/alerts
    const allElements = document.querySelectorAll('*');

    for (const el of allElements) {
      if (seen.has(el)) continue;

      const style = window.getComputedStyle(el);
      const role = (el.getAttribute('role') || '').toLowerCase();
      const classAndId = `${el.className || ''} ${el.id || ''}`.toLowerCase();
      const rect = el.getBoundingClientRect();

      let score = 0;

      // ARIA role signals
      if (['dialog', 'alertdialog', 'alert'].includes(role)) score += 40;

      // Position signals
      if (['fixed', 'sticky'].includes(style.position)) score += 25;

      // Z-index signals
      const zIndex = parseInt(style.zIndex, 10);
      if (!isNaN(zIndex) && zIndex > 1000) score += 20;
      else if (!isNaN(zIndex) && zIndex > 100) score += 10;

      // Class/ID name hints
      if (/modal|popup|toast|alert|dialog|overlay|error|notification|banner|snackbar/i.test(classAndId)) {
        score += 15;
      }

      // Visibility + size check
      if (style.display !== 'none' && style.visibility !== 'hidden' &&
          parseFloat(style.opacity) !== 0 && rect.width > 100 && rect.height > 50) {
        score += 10;
      }

      // Penalty for hidden elements
      if (style.display === 'none' || style.visibility === 'hidden' || parseFloat(style.opacity) === 0) {
        score -= 50;
      }

      // Threshold
      if (score >= 50) {
        seen.add(el);

        // Check if it has a close button
        const closeBtn = el.querySelector(
          'button, [role="button"], a, [class*="close"], [class*="dismiss"], [aria-label*="close"], [aria-label*="dismiss"]'
        );
        let hasCloseButton = false;
        if (closeBtn) {
          const btnText = (closeBtn.innerText || closeBtn.getAttribute('aria-label') || '').toLowerCase();
          if (/ok|close|dismiss|cancel|got it|×|✕|✖|accept|understand|no thanks/i.test(btnText) ||
              closeBtn.getAttribute('aria-label')?.toLowerCase().includes('close')) {
            hasCloseButton = true;
          }
        }

        const textContent = (el.innerText || '').trim().slice(0, 200);
        if (textContent) {
          candidates.push({
            text: textContent,
            score: score,
            rect: {
              x: Math.round(rect.left),
              y: Math.round(rect.top),
              width: Math.round(rect.width),
              height: Math.round(rect.height)
            },
            hasCloseButton: hasCloseButton,
            _element: el // internal ref, not serialized
          });
        }
      }
    }

    // Sort by score descending, return top 5
    candidates.sort((a, b) => b.score - a.score);
    return candidates.slice(0, 5).map(c => ({
      text: c.text,
      score: c.score,
      rect: c.rect,
      hasCloseButton: c.hasCloseButton
    }));
  }

  // -----------------------------------------------------------------------
  // Visible text content capture
  // -----------------------------------------------------------------------
  function getVisibleTextContent() {
    const parts = [];

    // Headings
    const headings = document.querySelectorAll('h1, h2, h3');
    headings.forEach((h) => {
      const text = (h.innerText || '').trim();
      if (text && text.length < 200) {
        parts.push(`[${h.tagName}] ${text}`);
      }
    });

    // Error messages and status text
    const errorEls = document.querySelectorAll(
      '[class*="error"], [class*="warning"], [class*="success"], [class*="info"], ' +
      '[class*="message"], [class*="status"], [role="alert"], [role="status"]'
    );
    errorEls.forEach((el) => {
      const style = window.getComputedStyle(el);
      if (style.display !== 'none' && style.visibility !== 'hidden') {
        const text = (el.innerText || '').trim();
        if (text && text.length > 3 && text.length < 300) {
          parts.push(`[STATUS] ${text}`);
        }
      }
    });

    // Labels near form controls
    const labels = document.querySelectorAll('label');
    labels.forEach((label) => {
      const text = (label.innerText || '').trim();
      if (text && text.length < 100) {
        parts.push(`[LABEL] ${text}`);
      }
    });

    return parts.slice(0, 30).join('\n').slice(0, 1500);
  }

  // -----------------------------------------------------------------------
  // Screenshot input-field redaction
  // -----------------------------------------------------------------------
  function getInputRedactionRegions() {
    const regions = [];
    const inputs = document.querySelectorAll('input, textarea, [contenteditable="true"]');

    inputs.forEach((el) => {
      const val = el.value || el.textContent || '';
      if (!val.trim()) return;

      const rect = el.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;

      const kind = DOMPrivacyDetector.isSensitiveElement(el);
      regions.push({
        x: Math.round(rect.left),
        y: Math.round(rect.top),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        label: kind ? `[${kind}]` : '[INPUT]'
      });
    });

    return regions;
  }

  // -----------------------------------------------------------------------
  // Set element value with proper event dispatch
  // -----------------------------------------------------------------------
  function setElementValue(el, value) {
    if (el.tagName.toLowerCase() === 'select') {
      const option = [...el.options].find(o => o.value === value || o.textContent.trim() === value);
      if (!option) return false;
      el.value = option.value;
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }
    
    // Simulate realistic typing for text inputs/contenteditable
    el.focus();
    
    // Clear existing value if it's an input/textarea
    if (!el.isContentEditable) {
      const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      if (setter) setter.call(el, '');
      else el.value = '';
    } else {
      el.textContent = '';
    }
    
    // Type character by character
    const textToType = String(value);
    for (let i = 0; i < textToType.length; i++) {
      const char = textToType[i];
      const keyCode = char.charCodeAt(0);
      
      const keydownEvent = new KeyboardEvent('keydown', { key: char, code: `Key${char.toUpperCase()}`, keyCode, which: keyCode, bubbles: true });
      el.dispatchEvent(keydownEvent);
      
      const keypressEvent = new KeyboardEvent('keypress', { key: char, code: `Key${char.toUpperCase()}`, keyCode, which: keyCode, bubbles: true });
      el.dispatchEvent(keypressEvent);
      
      if (el.isContentEditable) {
        el.textContent += char;
      } else {
        const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
        if (setter) setter.call(el, el.value + char);
        else el.value += char;
      }
      
      el.dispatchEvent(new Event('input', { bubbles: true }));
      
      const keyupEvent = new KeyboardEvent('keyup', { key: char, code: `Key${char.toUpperCase()}`, keyCode, which: keyCode, bubbles: true });
      el.dispatchEvent(keyupEvent);
    }
    
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }

  // -----------------------------------------------------------------------
  // Resolve target element from action (by agent-id, selector, or text fallback)
  // -----------------------------------------------------------------------
  function _resolveTarget(action) {
    const targetId = action.target_id;
    const selector = action.selector;

    let targetEl = null;
    if (targetId) {
      try { targetEl = document.querySelector(`[data-agent-id="${targetId}"]`); } catch (e) {}
    }
    if (!targetEl && selector) {
      try { targetEl = document.querySelector(selector); } catch (err) {
        console.warn('Invalid selector provided by AI:', selector);
      }
    }

    // Fallback: text-based search
    if (!targetEl && selector) {
      let textMatch = selector;
      const quoteMatch = selector.match(/['"](.*?)['"]/);
      if (quoteMatch && quoteMatch[1]) {
        textMatch = quoteMatch[1];
      } else {
        textMatch = selector.replace(/^text=/, '');
      }
      textMatch = textMatch.trim().toLowerCase();

      if (textMatch) {
        const allNodes = Array.from(document.querySelectorAll('button, a, input, select, textarea, [role="button"]'));
        for (const el of allNodes) {
          const elText = (el.innerText || el.value || el.placeholder || el.getAttribute('aria-label') || '').toLowerCase();
          if (elText.includes(textMatch)) {
            targetEl = el;
            break;
          }
        }
      }
    }

    return targetEl;
  }

  // -----------------------------------------------------------------------
  // Execute actions — including all new types
  // -----------------------------------------------------------------------
  async function executeAction(action) {
    if (!action) return { ok: false, error: 'No action provided' };

    const type = action.type;

    // --- NAVIGATE ---
    if (type === 'NAVIGATE' && action.url) {
      window.location.href = action.url;
      return { ok: true, detail: `Navigating to ${action.url}` };
    }

    // --- SCROLL ---
    if (type === 'SCROLL') {
      const direction = action.direction || 'down';
      const distance = direction === 'up' ? -window.innerHeight * 0.7 : window.innerHeight * 0.7;
      window.scrollBy({ top: distance, behavior: 'smooth' });
      return { ok: true, detail: `Scrolled page ${direction}` };
    }

    // --- WAIT ---
    if (type === 'WAIT') {
      return { ok: true, detail: 'Waiting for page update' };
    }

    // --- COMPLETE ---
    if (type === 'COMPLETE') {
      return { ok: true, detail: 'Task complete' };
    }

    // --- CLICK_COORDINATE ---
    if (type === 'CLICK_COORDINATE') {
      const x = action.x;
      const y = action.y;

      if (x == null || y == null) {
        return { ok: false, error: 'CLICK_COORDINATE requires x and y coordinates' };
      }

      // Validate bounds
      if (x < 0 || y < 0 || x > window.innerWidth || y > window.innerHeight) {
        return { ok: false, error: `Coordinates (${x}, ${y}) out of viewport bounds (${window.innerWidth}x${window.innerHeight})` };
      }

      // Check the element at point — reject if it's a sensitive field
      const elAtPoint = document.elementFromPoint(x, y);
      if (elAtPoint) {
        const kind = DOMPrivacyDetector.isSensitiveElement(elAtPoint);
        if (kind === 'PASSWORD') {
          return { ok: false, error: 'Cannot coordinate-click on a password field' };
        }
      }

      // Dispatch real mouse events
      const eventOpts = { bubbles: true, cancelable: true, clientX: x, clientY: y, view: window };
      const target = elAtPoint || document.body;
      target.dispatchEvent(new MouseEvent('mousedown', eventOpts));
      target.dispatchEvent(new MouseEvent('mouseup', eventOpts));
      target.dispatchEvent(new MouseEvent('click', eventOpts));

      return { ok: true, detail: `Clicked at coordinates (${x}, ${y}) on <${target.tagName.toLowerCase()}>` };
    }

    // --- DISMISS_MODAL ---
    if (type === 'DISMISS_MODAL') {
      // Use the scored heuristic to find the top modal
      const alerts = getPageAlerts();
      if (alerts.length === 0) {
        return { ok: true, detail: 'No active modal found to dismiss' };
      }

      // Re-scan to get the internal element reference
      const allElements = document.querySelectorAll('*');
      let bestModal = null;
      let bestScore = 0;

      for (const el of allElements) {
        const style = window.getComputedStyle(el);
        const role = (el.getAttribute('role') || '').toLowerCase();
        const classAndId = `${el.className || ''} ${el.id || ''}`.toLowerCase();
        const rect = el.getBoundingClientRect();

        let score = 0;
        if (['dialog', 'alertdialog', 'alert'].includes(role)) score += 40;
        if (['fixed', 'sticky'].includes(style.position)) score += 25;
        const zIdx = parseInt(style.zIndex, 10);
        if (!isNaN(zIdx) && zIdx > 1000) score += 20;
        else if (!isNaN(zIdx) && zIdx > 100) score += 10;
        if (/modal|popup|toast|alert|dialog|overlay|error|notification|banner|snackbar/i.test(classAndId)) score += 15;
        if (style.display !== 'none' && style.visibility !== 'hidden' &&
            parseFloat(style.opacity) !== 0 && rect.width > 100 && rect.height > 50) score += 10;
        if (style.display === 'none' || style.visibility === 'hidden' || parseFloat(style.opacity) === 0) score -= 50;

        if (score >= 50 && score > bestScore) {
          bestScore = score;
          bestModal = el;
        }
      }

      if (!bestModal) {
        return { ok: true, detail: 'No dismissible modal found' };
      }

      // Find a close/OK button within the modal
      const closeBtns = bestModal.querySelectorAll('button, [role="button"], a, [class*="close"], [class*="dismiss"]');
      const closePattern = /ok|close|dismiss|cancel|got it|×|✕|✖|accept|understand|no thanks|alright/i;

      for (const btn of closeBtns) {
        const btnText = (btn.innerText || btn.getAttribute('aria-label') || '').trim();
        if (closePattern.test(btnText)) {
          btn.scrollIntoView({ behavior: 'smooth', block: 'center' });
          btn.click();
          return { ok: true, detail: `Dismissed modal by clicking "${btnText}"` };
        }
      }

      // Fallback: click the first button in the modal
      if (closeBtns.length > 0) {
        closeBtns[0].click();
        return { ok: true, detail: `Dismissed modal by clicking first button` };
      }

      // Last resort: try clicking an overlay backdrop
      const overlay = document.querySelector('[class*="overlay"], [class*="backdrop"]');
      if (overlay) {
        overlay.click();
        return { ok: true, detail: 'Dismissed modal by clicking overlay backdrop' };
      }

      return { ok: false, error: 'Modal detected but no close button found' };
    }

    // --- SELECT ---
    if (type === 'SELECT') {
      const targetEl = _resolveTarget(action);
      if (!targetEl) return { ok: false, error: `Select target not found: ${action.target_id || action.selector}` };

      if (targetEl.tagName.toLowerCase() !== 'select') {
        // If it's not a native <select>, try clicking it (for custom dropdowns)
        targetEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
        targetEl.click();
        return { ok: true, detail: `Clicked custom dropdown element (not a native <select>)` };
      }

      const optionValue = action.value || '';
      const option = [...targetEl.options].find(
        o => o.value === optionValue || o.textContent.trim().toLowerCase() === optionValue.toLowerCase()
      );

      if (!option) {
        return { ok: false, error: `Option "${optionValue}" not found in select. Available: ${[...targetEl.options].map(o => o.textContent.trim()).join(', ')}` };
      }

      targetEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      targetEl.value = option.value;
      targetEl.dispatchEvent(new Event('change', { bubbles: true }));
      targetEl.dispatchEvent(new Event('input', { bubbles: true }));

      return { ok: true, detail: `Selected "${option.textContent.trim()}" in <select>` };
    }

    // --- CLICK / CLICK_AND_WAIT ---
    if (type === 'CLICK' || type === 'CLICK_AND_WAIT') {
      const targetEl = _resolveTarget(action);
      if (!targetEl) return { ok: false, error: `Element not found: ${action.target_id || action.selector}` };

      targetEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      targetEl.focus();
      targetEl.click();
      return { ok: true, detail: `Clicked element ${targetEl.tagName}` };
    }

    // --- SAHAYAK_TRIGGER / UPLOAD_DOCUMENT ---
    if (type === 'SAHAYAK_TRIGGER' || type === 'UPLOAD_DOCUMENT') {
      const targetEl = _resolveTarget(action);
      if (window.SahayakDetector) {
        window.SahayakDetector.handleMissingDocument(targetEl);
        return { ok: true, detail: 'Sahayak Smart Document Helper activated' };
      }
    }

    // --- TYPE / TYPE_AND_ENTER / TYPE_AND_SELECT ---
    if (type === 'TYPE' || type === 'TYPE_AND_ENTER' || type === 'TYPE_AND_SELECT') {
      const targetEl = _resolveTarget(action);
      if (!targetEl) return { ok: false, error: `Target element not found for typing` };

      targetEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      targetEl.focus();
      setElementValue(targetEl, action.value || '');

      if (type === 'TYPE_AND_ENTER') {
        const enterEvent = new KeyboardEvent('keydown', {
          key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true
        });
        targetEl.dispatchEvent(enterEvent);

        if (targetEl.form) {
          targetEl.form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        }
      } else if (type === 'TYPE_AND_SELECT') {
        // Wait for autocomplete popup to appear
        await new Promise(r => setTimeout(r, 800));

        const typedText = (action.value || '').toLowerCase();
        // Look for dropdown options
        const options = Array.from(document.querySelectorAll('[role="option"], [role="listbox"] > *, .autocomplete-suggestion, .tt-suggestion, li[role="treeitem"], ul[class*="dropdown"] li, ul[class*="menu"] li, div[class*="option"], li[class*="option"], div[class*="item"]'));
        let clicked = false;
        
        // Find best match
        for (const opt of options) {
          if ((opt.innerText || '').toLowerCase().includes(typedText)) {
            opt.scrollIntoView({ behavior: 'smooth', block: 'center' });
            opt.click();
            clicked = true;
            break;
          }
        }

        if (!clicked) {
          // Fallback: Try pressing down arrow and enter
          const downEvent = new KeyboardEvent('keydown', { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40, which: 40, bubbles: true });
          targetEl.dispatchEvent(downEvent);
          const enterEvent = new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true });
          targetEl.dispatchEvent(enterEvent);
        }
      }

      return { ok: true, detail: `Typed '${(action.value || '').slice(0, 30)}' into ${targetEl.tagName}` };
    }

    // --- LOCAL_AUTOFILL ---
    if (type === 'LOCAL_AUTOFILL') {
      const targetEl = _resolveTarget(action);
      if (!targetEl) return { ok: false, error: 'Target element for autofill not found' };

      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        chrome.storage.local.get(['secureProfile'], (res) => {
          const profile = res.secureProfile || {};
          const filledVal = profile[action.value];
          if (filledVal !== undefined) setElementValue(targetEl, filledVal);
        });
        return { ok: true, detail: `Injected field '${action.value}' from encrypted local vault` };
      }
    }

    return { ok: false, error: `Unknown action type: ${type}` };
  }

  // -----------------------------------------------------------------------
  // Message listener — handles all agent commands from the side panel
  // -----------------------------------------------------------------------
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      if (msg.type === 'AGENT_GET_DOM') {
        const nodes = tagInteractiveElements();
        sendResponse({
          ok: true,
          nodes,
          url: location.href,
          title: document.title,
          sanitized_findings: DOMPrivacyDetector.scanPage().findings,
          page_alerts: getPageAlerts(),
          visible_text: getVisibleTextContent(),
          input_redaction_regions: getInputRedactionRegions()
        });
      } else if (msg.type === 'AGENT_EXECUTE_ACTION') {
        Promise.resolve(executeAction(msg.action)).then(sendResponse).catch(err => sendResponse({ok: false, error: err.message}));
      } else if (msg.type === 'SAHAYAK_TRIGGER') {
        if (window.SahayakDetector) {
          window.SahayakDetector.handleMissingDocument().then(res => sendResponse(res || {ok: true})).catch(err => sendResponse({ok: false, error: err.message}));
        } else {
          sendResponse({ok: false, error: 'SahayakDetector not found'});
        }
      } else if (msg.type === 'SAHAYAK_ATTACH_FILE') {
        let el = msg.selector ? document.querySelector(msg.selector) : document.querySelector('input[type="file"]');
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          el.style.outline = '3px solid #10b981';
          setTimeout(() => { el.style.outline = ''; }, 3000);
          
          if (msg.fileData) {
            try {
              const arr = msg.fileData.split(',');
              const mime = arr[0].match(/:(.*?);/)[1];
              const bstr = atob(arr[1]);
              let n = bstr.length;
              const u8arr = new Uint8Array(n);
              while(n--){
                u8arr[n] = bstr.charCodeAt(n);
              }
              const file = new File([u8arr], msg.fileName || 'document', { type: msg.fileType || mime });
              const dt = new DataTransfer();
              dt.items.add(file);
              el.files = dt.files;
              el.dispatchEvent(new Event('input', { bubbles: true }));
              el.dispatchEvent(new Event('change', { bubbles: true }));
            } catch (e) {
              console.error('Failed to attach file:', e);
            }
          }
          
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
    executeAction,
    getPageAlerts,
    getVisibleTextContent,
    getInputRedactionRegions
  };
})();
