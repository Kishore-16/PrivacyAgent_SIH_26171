class ActionValidator {
  static ALLOWED_ACTIONS = new Set([
    'CLICK', 'CLICK_COORDINATE', 'SCROLL', 'HIGHLIGHT', 'TYPE', 'TYPE_AND_ENTER', 'TYPE_AND_SELECT',
    'SELECT', 'WAIT', 'DISMISS_MODAL',
    'LOCAL_AUTOFILL', 'NAVIGATE', 'COMPLETE', 'NO_ACTION'
  ]);
  static DISALLOWED_ACTIONS = new Set(['EXECUTE_JAVASCRIPT', 'RUN_COMMAND', 'NAVIGATE_ANYWHERE', 'DOWNLOAD_FILE']);

  static HIGH_RISK_KEYWORDS = ['submit', 'confirm', 'pay', 'delete', 'remove', 'checkout', 'transfer', 'password'];

  static validate(action) {
    if (!action || typeof action !== 'object') {
      return { valid: false, error: 'Invalid action object' };
    }

    const type = (action.type || '').toUpperCase();

    if (this.DISALLOWED_ACTIONS.has(type)) {
      return { valid: false, error: `Action '${type}' is strictly prohibited by security policy.` };
    }

    if (!this.ALLOWED_ACTIONS.has(type)) {
      return { valid: false, error: `Action '${type}' is not on the safe allow-list.` };
    }

    const label = (action.label || action.selector || '').toLowerCase();
    const isHighRisk = action.risk === 'high' || this.HIGH_RISK_KEYWORDS.some(kw => label.includes(kw));

    return {
      valid: true,
      action: { ...action, type, isHighRisk },
      requiresConfirmation: isHighRisk
    };
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = ActionValidator;
}
