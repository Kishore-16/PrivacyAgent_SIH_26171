/**
 * Sahayak (सहायक) Missing Document Detector
 * Detects empty file inputs or missing document requirements on active web pages,
 * seamlessly pausing automation and delegating file collection & local redaction to SahayakModal.
 */
window.SahayakDetector = (() => {

  function identifyDocumentType(element) {
    if (!element) return 'generic';

    const rawText = [
      element.getAttribute('aria-label'),
      element.getAttribute('placeholder'),
      element.title,
      element.labels ? Array.from(element.labels).map(l => l.innerText).join(' ') : '',
      element.name,
      element.id,
      element.parentElement ? element.parentElement.innerText : ''
    ].filter(Boolean).join(' ').trim();

    const labelText = rawText.toLowerCase();

    if (labelText.includes('income') || labelText.includes('आय')) return 'income_certificate';
    if (labelText.includes('aadhaar') || labelText.includes('aadhar') || labelText.includes('आधार')) return 'aadhaar_card';
    if (labelText.includes('caste') || labelText.includes('जाति')) return 'caste_certificate';
    if (labelText.includes('ration') || labelText.includes('राशन')) return 'ration_card';
    if (labelText.includes('pan') || labelText.includes('पैन')) return 'pan_card';
    if (labelText.includes('birth') || labelText.includes('जन्म')) return 'birth_certificate';
    if (labelText.includes('driving') || labelText.includes('license') || labelText.includes('ड्राइविंग')) return 'driving_license';

    // Extract cleanest title snippet from element label if available
    const primaryLabel = (element.labels && element.labels.length > 0) ? element.labels[0].innerText.trim() : 
                         (element.getAttribute('aria-label') || element.name || element.id || '');
    
    let cleanedName = primaryLabel.replace(/choose file|upload|select|attach|no file chosen|browse/gi, '').trim();
    if (cleanedName.length >= 3 && cleanedName.length <= 40) {
      return cleanedName;
    }

    return 'generic';
  }

  function findMissingFileInputs() {
    const fileInputs = Array.from(document.querySelectorAll('input[type="file"]'));
    return fileInputs.filter(input => !input.files || input.files.length === 0);
  }

  async function handleMissingDocument(targetEl = null) {
    const el = targetEl || findMissingFileInputs()[0];
    if (!el) {
      return { ok: false, error: 'No missing document field found on page' };
    }

    const docType = identifyDocumentType(el);
    console.log(`[Sahayak] Missing document detected: '${docType}'. Highlighting field for sidebar assistant...`);

    // Highlight target element on webpage
    try {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.style.outline = '3px solid #6366f1';
      setTimeout(() => { el.style.outline = ''; }, 4000);
    } catch (e) {}

    return { ok: true, detail: `Highlighted ${docType} field for sidepanel Sahayak Assistant` };
  }

  return {
    identifyDocumentType,
    findMissingFileInputs,
    handleMissingDocument
  };
})();
