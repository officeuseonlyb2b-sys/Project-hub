(async function runRegularWorkStatusMenuDomTest() {
  const expected = ['Pending', 'In Progress', 'Working', 'On Hold', 'Ready for Review', 'Completed', 'Discarded'];
  const result = document.getElementById('fixture-result');
  const failures = [];
  const visible = element => !!element && !element.hidden && element.getClientRects().length > 0;
  const normalizeLabel = button => button.textContent.trim().replace(/^[✓×]\s*/, '');
  const waitFor = async predicate => {
    for (let attempt = 0; attempt < 40; attempt += 1) {
      if (predicate()) return true;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    return false;
  };
  try {
    render();
    openTask(fixtureTask.id);
    const toggle = document.querySelector('#drawerBody .rw-update-toggle');
    if (!toggle || toggle.textContent.trim() !== 'Update Status') failures.push('Update Status control missing/incorrect');
    if (document.querySelectorAll('#drawerBody .rw-update-toggle').length !== 1) failures.push('Expected exactly one Update Status control');
    toggle?.click();
    const initialMenu = document.querySelector('#drawerBody .rw-update-status-menu');
    if (!visible(initialMenu)) failures.push('Update Status did not open a visible menu');
    const initialOptions = [...(initialMenu?.querySelectorAll('button.status-update') || [])];
    const visibleLabels = initialOptions.filter(visible).map(normalizeLabel);
    if (JSON.stringify(visibleLabels) !== JSON.stringify(expected)) failures.push(`Visible statuses were ${JSON.stringify(visibleLabels)}`);
    if ([...document.querySelectorAll('#drawerBody .status-update')].some(button => !button.closest('.rw-update-status-menu'))) failures.push('A duplicate quick-status button remains outside the menu');
    if (initialMenu?.querySelector('[data-current-status="true"]')?.dataset.status !== 'Pending') failures.push('Pending is not highlighted as the selected status');

    for (const status of ['In Progress', 'Working', 'On Hold', 'Ready for Review', 'Completed', 'Working', 'Discarded']) {
      const menu = document.querySelector('#drawerBody .rw-update-status-menu');
      if (!visible(menu)) document.querySelector('#drawerBody .rw-update-toggle')?.click();
      const highlighted = menu?.querySelector('[data-current-status="true"]')?.dataset.status;
      if (highlighted !== fixtureTask.status) failures.push(`${fixtureTask.status} was not highlighted when the menu reopened`);
      const option = [...document.querySelectorAll('#drawerBody .rw-update-status-menu button.status-update')].find(button => button.dataset.status === status);
      if (!option || !visible(option)) { failures.push(`${status} is not visibly clickable`); continue; }
      option.click();
      const saved = await waitFor(() => fixtureTask.status === status && !visible(document.querySelector('#drawerBody .rw-update-status-menu')));
      if (!saved) failures.push(`${status} did not update the task and close the menu`);
      const statusCard = [...document.querySelectorAll('#drawerBody .rw-task-info-card')].find(card => card.querySelector('span')?.textContent === 'STATUS');
      if (statusCard?.querySelector('strong')?.textContent !== status) failures.push(`${status} did not refresh the drawer status card`);
      const rowStatus = document.querySelector(`#content tr[data-regular-task-row="${fixtureTask.id}"] td:nth-child(4) .status-pill`);
      if (rowStatus?.textContent.trim() !== status) failures.push(`${status} did not refresh the task row`);
    }
    if (JSON.stringify(window.fixtureStatusTransitions) !== JSON.stringify(['In Progress', 'Working', 'On Hold', 'Ready for Review', 'Completed', 'Working', 'Discarded'])) failures.push('Options did not call the existing updateStatus engine in order');
  } catch (error) {
    failures.push(error?.stack || String(error));
  }
  result.textContent = failures.length
    ? `FAIL\n${failures.join('\n')}`
    : `PASS\nUpdate Status opens a visible menu.\nAll 7 options are visible and clickable.\nSelected status is highlighted.\nSelections call updateStatus, refresh drawer and task row, and close the menu.`;
  result.dataset.result = failures.length ? 'FAIL' : 'PASS';
})();
