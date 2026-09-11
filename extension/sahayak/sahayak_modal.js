/**
 * Sahayak (सहायक) Modal Popup Manager
 * Manages multilingual UI, keyboard numeric hotkeys (1-5), local privacy redaction,
 * and direct document injection into web forms.
 */
window.SahayakModal = (() => {
  let activeLangKey = "1"; // Default: English
  let activeDocKey = "generic";
  let selectedState = "National"; // Default state
  let targetInputElement = null;
  let onResolveCallback = null;
  let selectedFile = null;
  let isProcessing = false;

  function ensureStylesInjected() {
    if (document.getElementById('sahayak-styles')) return;
    const link = document.createElement('link');
    link.id = 'sahayak-styles';
    link.rel = 'stylesheet';
    link.href = typeof chrome !== 'undefined' && chrome.runtime ? chrome.runtime.getURL('sahayak/sahayak_modal.css') : '';
    if (!link.href) {
      // Fallback inline injected stylesheet reference
      const style = document.createElement('style');
      style.id = 'sahayak-styles';
      style.textContent = `
        .sahayak-modal-overlay { position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background: rgba(15,23,42,0.75); backdrop-filter: blur(8px); z-index: 2147483647; display: flex; align-items: center; justify-content: center; font-family: system-ui, sans-serif; }
        .sahayak-modal-card { width: 92%; max-width: 640px; background: #1e293b; border: 1px solid #334155; border-radius: 16px; color: #f8fafc; padding: 24px; display: flex; flex-direction: column; gap: 16px; }
        .sahayak-lang-buttons { display: flex; gap: 8px; flex-wrap: wrap; }
        .sahayak-lang-btn { flex: 1; min-width: 90px; padding: 8px; background: #334155; border: 1px solid #475569; color: #e2e8f0; border-radius: 8px; cursor: pointer; text-align: center; font-weight: 600; }
        .sahayak-lang-btn.active { background: #6366f1; color: #fff; border-color: #818cf8; }
        .sahayak-drop-zone { border: 2px dashed #475569; background: rgba(15,23,42,0.4); border-radius: 12px; padding: 20px; text-align: center; cursor: pointer; }
        .sahayak-instructions { background: rgba(15,23,42,0.5); border: 1px solid #334155; border-radius: 12px; padding: 16px; }
        .sahayak-step-card { display: flex; gap: 8px; background: rgba(30,41,59,0.6); padding: 8px 12px; border-radius: 8px; border-left: 3px solid #6366f1; font-size: 0.85rem; margin-bottom: 6px; }
        .sahayak-actions { display: flex; justify-content: flex-end; gap: 12px; }
        .sahayak-btn-cancel { padding: 10px 16px; background: transparent; border: 1px solid #334155; color: #94a3b8; border-radius: 8px; cursor: pointer; }
        .sahayak-btn-submit { padding: 10px 20px; background: #6366f1; border: none; color: #fff; border-radius: 8px; cursor: pointer; font-weight: 700; }
      `;
      document.head.appendChild(style);
    } else {
      document.head.appendChild(link);
    }
  }

  function renderModalHTML() {
    // Injected DOM overlay disabled — Sahayak UI is handled by extension sidebar/popup
    const overlay = document.getElementById('sahayak-modal-overlay');
    if (overlay) overlay.remove();
  }

  async function fetchDynamicGuide(overlay) {
    if (!overlay) return;
  }

  function bindEvents(overlay) {
  }

  function setupGlobalKeyboardListener() {
  }

  async function handleFileUploadSubmission() {
  }

  function readFileAsBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = (err) => reject(err);
      reader.readAsDataURL(file);
    });
  }

  function attachFileToInput(inputEl, originalFile, base64Data) {
    try {
      // Create a DataTransfer container
      const dt = new DataTransfer();
      dt.items.add(originalFile);
      inputEl.files = dt.files;

      // Trigger change and input events
      inputEl.dispatchEvent(new Event('input', { bubbles: true }));
      inputEl.dispatchEvent(new Event('change', { bubbles: true }));

      // Visual feedback on input element
      inputEl.style.outline = '3px solid #10b981';
      setTimeout(() => { inputEl.style.outline = ''; }, 3000);
    } catch (err) {
      console.error('[Sahayak] Direct file attachment error:', err);
    }
  }

  function openModal({ documentType = 'generic', targetInput = null } = {}) {
    activeDocKey = documentType;
    targetInputElement = targetInput;
    selectedFile = null;
    isProcessing = false;
    renderModalHTML();
    if (targetInputElement) {
      try {
        targetInputElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
        targetInputElement.style.outline = '3px solid #6366f1';
        setTimeout(() => { targetInputElement.style.outline = ''; }, 4000);
      } catch (e) {}
    }
    return Promise.resolve({ ok: true, reason: 'sidepanel_handled' });
  }

  function closeModal() {
    const overlay = document.getElementById('sahayak-modal-overlay');
    if (overlay) {
      overlay.remove();
    }
    if (onResolveCallback) {
      onResolveCallback({ ok: false, reason: 'user_cancelled' });
      onResolveCallback = null;
    }
  }

  // Initialize keyboard listener once
  setupGlobalKeyboardListener();

  return {
    open: openModal,
    close: closeModal
  };
})();
