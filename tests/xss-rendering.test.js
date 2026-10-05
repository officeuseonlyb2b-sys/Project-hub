(() => {
  const payloads = [
    '<img src=x onerror="window.__xssExecuted=true">',
    '<svg onload="window.__xssExecuted=true"><text>test</text></svg>',
    '</p><script>window.__xssExecuted=true</script><p>',
    '\" autofocus onfocus=\"window.__xssExecuted=true'
  ];
  const output = document.getElementById('test-output');
  let passed = 0;
  const failures = [];

  for (const payload of payloads) {
    const target = document.createElement('div');
    target.innerHTML = window.ExecutionHubSecurity.escapeHtml(payload);
    const isTextOnly = target.childNodes.length === 1
      && target.firstChild.nodeType === Node.TEXT_NODE
      && target.textContent === payload
      && !target.querySelector('*');
    if (isTextOnly) passed += 1;
    else failures.push(payload);
    output.appendChild(target);
  }

  const ok = failures.length === 0 && window.__xssExecuted !== true;
  document.getElementById('result').textContent = `${ok ? 'PASS' : 'FAIL'}: ${passed}/${payloads.length} payloads rendered as text; executable markup count ${window.__xssExecuted === true ? '1' : '0'}.`;
  document.body.dataset.testResult = ok ? 'pass' : 'fail';
  if (!ok) throw new Error(`XSS rendering regressions failed: ${failures.join(', ')}`);
})();
