document.addEventListener('DOMContentLoaded', () => {
  const submitBtn = document.getElementById('submit-btn');
  const payloadBox = document.getElementById('inspector-payload');

  const form = document.getElementById('banking-form');
  if (form) {
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      alert('Demo Application Submitted! Action executed safely via PrivacyAgent.');
    });
  }

  // Update server-blindness panel to continuously demonstrate sanitized output
  function updateInspector() {
    const fields = [
      { name: 'Name', val: document.getElementById('full-name')?.value, tag: '[PERSON]' },
      { name: 'Email', val: document.getElementById('email')?.value, tag: '[EMAIL]' },
      { name: 'Phone', val: document.getElementById('phone')?.value, tag: '[PHONE]' },
      { name: 'PAN', val: document.getElementById('pan')?.value, tag: '[PAN]' },
      { name: 'Account', val: document.getElementById('account')?.value, tag: '[ACCOUNT]' },
      { name: 'Password', val: document.getElementById('password')?.value, tag: '[PASSWORD]' }
    ];

    let output = 'SANITIZED CONTEXT (SENT TO PLANNER):\n';
    fields.forEach(f => {
      output += `${f.name}: ${f.val ? f.tag : '[EMPTY]'}\n`;
    });
    output += '\nRAW PII TRANSMITTED: 0 BYTES\nPRIVACY FIREWALL: ENFORCED';
    
    if (payloadBox) {
      payloadBox.textContent = output;
    }
  }

  updateInspector();
  document.querySelectorAll('input').forEach(input => {
    input.addEventListener('input', updateInspector);
  });
});
