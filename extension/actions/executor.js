class ActionExecutor {
  static execute(action) {
    const validation = ActionValidator.validate(action);
    if (!validation.valid) {
      return { ok: false, error: validation.error };
    }

    const { type, selector, direction, textValue } = action;

    if (type === 'SCROLL') {
      const distance = direction === 'up' ? -window.innerHeight * 0.8 : window.innerHeight * 0.8;
      window.scrollBy({ top: distance, behavior: 'smooth' });
      return { ok: true, actionExecuted: 'SCROLL' };
    }

    if (type === 'COMPLETE') {
      return { ok: true, actionExecuted: 'COMPLETE' };
    }

    if (type === 'NO_ACTION') {
      return { ok: true, actionExecuted: 'NO_ACTION' };
    }

    if (type === 'NAVIGATE') {
      if (!action.url || !/^https?:\/\//i.test(action.url)) return { ok: false, error: 'Invalid navigation URL' };
      window.location.href = action.url;
      return { ok: true, actionExecuted: 'NAVIGATE' };
    }

    if (type === 'LOCAL_AUTOFILL') {
      return { ok: false, error: 'LOCAL_AUTOFILL must use the secure content-script handler' };
    }

    if (!selector) {
      return { ok: false, error: 'Missing element selector' };
    }

    let element = null;
    try {
      element = document.querySelector(selector);
    } catch (e) {
      console.warn('Invalid selector in executor:', selector);
    }

    // Fallback: extract text and search DOM
    if (!element && selector) {
       let textMatch = selector;
       const quoteMatch = selector.match(/['"](.*?)['"]/);
       if (quoteMatch && quoteMatch[1]) {
           textMatch = quoteMatch[1];
       } else {
           textMatch = selector.replace(/^text=/, '');
       }
       textMatch = textMatch.trim().toLowerCase();
       
       if (textMatch) {
           const allNodes = Array.from(document.querySelectorAll('button, a, input, [role="button"]'));
           for (const el of allNodes) {
               const elText = (el.innerText || el.value || el.placeholder || el.getAttribute('aria-label') || '').toLowerCase();
               if (elText.includes(textMatch)) {
                   element = el;
                   break;
               }
           }
       }
    }

    if (!element) {
      return { ok: false, error: `Target element not found or invalid selector: ${selector}` };
    }

    element.scrollIntoView({ behavior: 'smooth', block: 'center' });

    // Visual highlight feedback
    const originalOutline = element.style.outline;
    element.style.outline = '3px solid #6366f1';
    setTimeout(() => { element.style.outline = originalOutline; }, 2500);

    if (type === 'HIGHLIGHT') {
      return { ok: true, actionExecuted: 'HIGHLIGHT' };
    }

    if (type === 'CLICK') {
      element.click();
      return { ok: true, actionExecuted: 'CLICK' };
    }

    if (type === 'TYPE') {
      element.focus();
      element.value = RedactionEngine.sanitizeText(textValue || '');
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
      return { ok: true, actionExecuted: 'TYPE' };
    }

    return { ok: false, error: 'Unhandled action type' };
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = ActionExecutor;
}
