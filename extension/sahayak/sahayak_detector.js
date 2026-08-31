/**
 * Sahayak (सहायक) Missing Document Detector
 * Detects empty file inputs or missing document requirements on active web pages,
 * seamlessly pausing automation and delegating file collection & local redaction to SahayakModal.
 */
window.SahayakDetector = (() => {

  function identifyDocumentType(element) {
    if (!element) return 'generic';

    const labelText = [
      element.id,
      element.name,
      element.getAttribute('aria-label'),
      element.getAttribute('placeholder'),
      element.title,
      element.labels ? Array.from(element.labels).map(l => l.innerText).join(' ') : '',
      element.parentElement ? element.parentElement.innerText : ''
    ].filter(Boolean).join(' ').toLowerCase();

    if (labelText.includes('income') || labelText.includes('आय')) return 'income_certificate';
    if (labelText.includes('aadhaar') || labelText.includes('aadhar') || labelText.includes('आधार')) return 'aadhaar_card';
    if (labelText.includes('caste') || labelText.includes('जाति')) return 'caste_certificate';
    if (labelText.includes('ration') || labelText.includes('राशन')) return 'ration_card';

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
    console.log(`[Sahayak] Missing document detected: '${docType}'. Opening Sahayak Assistant...`);

    // Highlight target element on webpage
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.style.outline = '3px solid #6366f1';

    // Open Sahayak Multilingual Assistant Modal
    const result = await SahayakModal.open({
      documentType: docType,
      targetInput: el
    });

    el.style.outline = '';
    return result;
  }

  return {
    identifyDocumentType,
    findMissingFileInputs,
    handleMissingDocument
  };
})();
