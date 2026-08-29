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

    if (!selector) {
      return { ok: false, error: 'Missing element selector' };
    }

    const element = document.querySelector(selector);
    if (!element) {
      return { ok: false, error: `Target element not found: ${selector}` };
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
