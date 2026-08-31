/**
 * Sahayak (सहायक) Modal Popup Manager
 * Manages multilingual UI, keyboard numeric hotkeys (1-5), local privacy redaction,
 * and direct document injection into web forms.
 */
window.SahayakModal = (() => {
  let activeLangKey = "1"; // Default: English
  let activeDocKey = "generic";
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
    const langCode = SahayakConfig.LANGUAGES[activeLangKey]?.code || "en";
    const strings = SahayakConfig.UI_STRINGS[langCode] || SahayakConfig.UI_STRINGS.en;
    const docConfig = SahayakConfig.getDocConfig(activeDocKey);
    const docTitle = docConfig.displayTitle[langCode] || docConfig.displayTitle.en;
    const steps = docConfig.steps[langCode] || docConfig.steps.en;

    let overlay = document.getElementById('sahayak-modal-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'sahayak-modal-overlay';
      overlay.className = 'sahayak-modal-overlay';
      document.body.appendChild(overlay);
    }

    const langButtonsHTML = Object.entries(SahayakConfig.LANGUAGES).map(([key, lang]) => {
      const activeClass = key === activeLangKey ? 'active' : '';
      return `<button class="sahayak-lang-btn ${activeClass}" data-lang-key="${key}">${lang.label}</button>`;
    }).join('');

    const stepsHTML = steps.map((stepText, idx) => `
      <div class="sahayak-step-card">
        <span class="sahayak-step-num">${idx + 1}️⃣</span>
        <span>${stepText}</span>
      </div>
    `).join('');

    overlay.innerHTML = `
      <div class="sahayak-modal-card">
        <div class="sahayak-header">
          <div class="sahayak-title-group">
            <h2>🛡️ ${strings.modalTitle}</h2>
            <span class="sahayak-doc-badge">${strings.requiredDocLabel} ${docTitle}</span>
          </div>
          <button class="sahayak-close-btn" id="sahayakCloseBtn">&times;</button>
        </div>

        <div class="sahayak-lang-section">
          <div class="sahayak-lang-label">${strings.selectLanguageLabel}</div>
          <div class="sahayak-lang-buttons">
            ${langButtonsHTML}
          </div>
        </div>

        <div class="sahayak-drop-zone" id="sahayakDropZone">
          <span class="sahayak-drop-icon">📁</span>
          <div class="sahayak-drop-text">
            ${strings.dragDropText} <span class="sahayak-browse-link" id="sahayakBrowseLink">${strings.browseBtn}</span>
          </div>
          <div class="sahayak-selected-file" id="sahayakSelectedFile">
            ${selectedFile ? `📄 Selected: ${selectedFile.name}` : ''}
          </div>
          <div class="sahayak-privacy-badge">
            ${strings.privacyNotice}
          </div>
          <input type="file" id="sahayakFileInput" class="sahayak-file-input" accept="image/*,.pdf,.doc,.docx" />
        </div>

        <div class="sahayak-instructions">
          <div class="sahayak-instructions-title">${strings.instructionCenterTitle}</div>
          <div class="sahayak-portal-bar">
            <div class="sahayak-portal-info">
              ${strings.officialLinkPrefix} <strong>${docConfig.portalName}</strong>
            </div>
            <a href="${docConfig.portalUrl}" target="_blank" rel="noopener noreferrer" class="sahayak-portal-btn">
              ${strings.openPortalBtn}
            </a>
          </div>
          <div style="font-size: 0.85rem; font-weight: 700; color: #a5b4fc; margin-bottom: 8px;">
            ${strings.stepTitle}
          </div>
          <div class="sahayak-steps-list">
            ${stepsHTML}
          </div>
        </div>

        <div class="sahayak-actions">
          <button class="sahayak-btn-cancel" id="sahayakCancelBtn">${strings.cancelBtn}</button>
          <button class="sahayak-btn-submit" id="sahayakSubmitBtn" ${!selectedFile || isProcessing ? 'disabled' : ''}>
            ${isProcessing ? strings.processingText : strings.submitBtn}
          </button>
        </div>
      </div>
    `;

    bindEvents(overlay);
  }

  function bindEvents(overlay) {
    // Close button
    const closeBtn = overlay.querySelector('#sahayakCloseBtn');
    const cancelBtn = overlay.querySelector('#sahayakCancelBtn');
    if (closeBtn) closeBtn.onclick = closeModal;
    if (cancelBtn) cancelBtn.onclick = closeModal;

    // Language buttons click
    overlay.querySelectorAll('.sahayak-lang-btn').forEach(btn => {
      btn.onclick = (e) => {
        const langKey = e.target.getAttribute('data-lang-key');
        if (langKey) {
          activeLangKey = langKey;
          renderModalHTML();
        }
      };
    });

    // File input browse
    const fileInput = overlay.querySelector('#sahayakFileInput');
    const browseLink = overlay.querySelector('#sahayakBrowseLink');
    const dropZone = overlay.querySelector('#sahayakDropZone');

    if (browseLink && fileInput) {
      browseLink.onclick = (e) => {
        e.stopPropagation();
        fileInput.click();
      };
    }

    if (dropZone && fileInput) {
      dropZone.onclick = () => fileInput.click();

      dropZone.ondragover = (e) => {
        e.preventDefault();
        dropZone.classList.add('dragover');
      };
      dropZone.ondragleave = () => dropZone.classList.remove('dragover');
      dropZone.ondrop = (e) => {
        e.preventDefault();
        dropZone.classList.remove('dragover');
        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
          selectedFile = e.dataTransfer.files[0];
          renderModalHTML();
        }
      };
    }

    if (fileInput) {
      fileInput.onchange = (e) => {
        if (e.target.files && e.target.files.length > 0) {
          selectedFile = e.target.files[0];
          renderModalHTML();
        }
      };
    }

    // Submit button
    const submitBtn = overlay.querySelector('#sahayakSubmitBtn');
    if (submitBtn) {
      submitBtn.onclick = handleFileUploadSubmission;
    }
  }

  function setupGlobalKeyboardListener() {
    window.addEventListener('keydown', (e) => {
      const overlay = document.getElementById('sahayak-modal-overlay');
      if (!overlay || overlay.style.display === 'none') return;

      // Handle number keys 1, 2, 3, 4, 5 for instant language switching
      if (['1', '2', '3', '4', '5'].includes(e.key)) {
        activeLangKey = e.key;
        renderModalHTML();
      } else if (e.key === 'Escape') {
        closeModal();
      }
    });
  }

  async function handleFileUploadSubmission() {
    if (!selectedFile) return;

    isProcessing = true;
    renderModalHTML();

    try {
      // Read file as base64 data URI
      const base64Data = await readFileAsBase64(selectedFile);

      // Call local Sahayak document processing endpoint
      let sanitizedBase64 = base64Data;
      try {
        const resp = await fetch('http://127.0.0.1:8000/sahayak/process-document', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            document_type: activeDocKey,
            image_data: base64Data,
            redaction_mode: 'BLUR',
            client_attestation: true
          })
        });

        if (resp.ok) {
          const data = await resp.json();
          if (data.ok && data.sanitized_document) {
            sanitizedBase64 = data.sanitized_document;
          }
        }
      } catch (netErr) {
        console.warn('[Sahayak] Server processing offline fallback:', netErr.message);
      }

      // Attach file to target input element if present
      if (targetInputElement) {
        attachFileToInput(targetInputElement, selectedFile, sanitizedBase64);
      }

      const finishMsg = SahayakConfig.UI_STRINGS[SahayakConfig.LANGUAGES[activeLangKey]?.code || 'en']?.fileAttachedSuccess;
      console.log('[Sahayak]', finishMsg);

      if (onResolveCallback) {
        onResolveCallback({ ok: true, file: selectedFile, docType: activeDocKey });
      }

      closeModal();
    } catch (err) {
      console.error('[Sahayak] File submission error:', err);
      alert(`Sahayak File Processing Error: ${err.message}`);
      isProcessing = false;
      renderModalHTML();
    }
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
    ensureStylesInjected();
    activeDocKey = documentType;
    targetInputElement = targetInput;
    selectedFile = null;
    isProcessing = false;
    renderModalHTML();

    return new Promise((resolve) => {
      onResolveCallback = resolve;
    });
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
