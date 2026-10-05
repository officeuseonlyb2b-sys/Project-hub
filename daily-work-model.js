(function (root, factory) {
  const model = factory();
  if (typeof module === 'object' && module.exports) module.exports = model;
  if (root) root.DailyWorkModel = model;
})(typeof globalThis === 'undefined' ? this : globalThis, function () {
  const identityFields = ['id', 'appUserId', 'authUid', 'uid', 'firebaseUid', 'employeeId'];
  const terminalStatuses = new Set(['completed', 'cancelled', 'canceled', 'archived']);

  function identityValues(value) {
    if (value == null) return [];
    if (typeof value !== 'object') return [String(value)];
    return identityFields.map(field => value[field]).filter(item => item != null && String(item)).map(String);
  }

  function resolveEmployee(value, employees = []) {
    const aliases = new Set(identityValues(value));
    if (!aliases.size) return null;
    return employees.find(employee => identityValues(employee).some(alias => aliases.has(alias))) || null;
  }

  function matchesEmployee(value, employeeOrId, employees = []) {
    const employee = typeof employeeOrId === 'object' && employeeOrId
      ? employeeOrId
      : resolveEmployee(employeeOrId, employees);
    const expected = new Set(identityValues(employee || employeeOrId));
    return identityValues(value).some(alias => expected.has(alias));
  }

  function normalizeDailyTask(parent, record, employees = []) {
    if (!parent || !record || record.archived === true || String(record.status || '').toLowerCase() === 'archived') return null;
    const employee = resolveEmployee(record.assignedTo, employees);
    const sourceId = String(record.id || '');
    const parentTaskId = String(parent.id || record.parentTaskId || '');
    if (!sourceId || !parentTaskId) return null;
    return {
      id: `daily:${parentTaskId}:${sourceId}`,
      workItemKey: `daily:${parentTaskId}:${sourceId}`,
      sourceId,
      parentId: parentTaskId,
      parentTaskId,
      kind: 'daily',
      contextType: 'regular',
      title: record.title || 'Daily task',
      status: record.status || 'Not Started',
      priority: record.priority || parent.priority || '',
      dueDate: String(record.date || '').slice(0, 10),
      completedAt: record.completedAt || '',
      createdAt: record.createdAt || '',
      assignedAt: record.assignedAt || record.createdAt || '',
      owner: employee?.id || record.assignedTo,
      assignedTo: employee?.id || record.assignedTo,
      assignedToRaw: record.assignedTo,
      source: 'Regular Work',
      sourceDetail: 'Daily Task',
      cancelledAt: record.cancelledAt || '',
      archived: false,
      record,
      parentTask: parent,
      waitingOn: record.waitingOn || ''
    };
  }

  function uniqueWorkItems(items = []) {
    const keyed = new Map();
    for (const item of items) {
      const key = item.workItemKey
        || (item.kind === 'daily' ? `daily:${item.parentId}:${item.sourceId || item.record?.id || item.id}`
          : item.kind === 'approval' ? `approval:${item.id}`
            : `${item.contextType === 'regular' ? 'regular' : 'project'}:${item.parentId || item.id}`);
      keyed.set(key, item);
    }
    return [...keyed.values()];
  }

  function filterDailyItems(items = [], { scope = 'my', allEmployees = false, employeeId = '', departmentIds = [], employees = [] } = {}) {
    if (scope === 'my' && !allEmployees) return items.filter(item => matchesEmployee(item.assignedTo, employeeId, employees));
    if (scope === 'department') return items.filter(item => departmentIds.some(id => matchesEmployee(item.assignedTo, id, employees)));
    return items;
  }

  function dateOf(value) {
    const text = String(value || '');
    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
    const parsed = new Date(text);
    if (!Number.isNaN(parsed.getTime())) {
      return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, '0')}-${String(parsed.getDate()).padStart(2, '0')}`;
    }
    return text.slice(0, 10);
  }
  function inWindow(value, range) {
    const date = dateOf(value);
    return !!date && date >= range.start && date <= range.end;
  }
  function isTerminal(item) {
    return item.archived === true || terminalStatuses.has(String(item.status || '').toLowerCase());
  }
  function isOpen(item) { return !isTerminal(item); }

  function getWorkMetrics(items, range, today) {
    const work = uniqueWorkItems(items);
    const due = work.filter(item => inWindow(item.dueDate, range) && !['cancelled', 'canceled', 'archived'].includes(String(item.status || '').toLowerCase()));
    const completed = work.filter(item => String(item.status || '').toLowerCase() === 'completed' && inWindow(item.completedAt, range));
    const pending = work.filter(item => isOpen(item) && item.dueDate && dateOf(item.dueDate) <= range.end);
    const overdue = work.filter(item => isOpen(item) && item.status !== 'Ready for Review' && item.dueDate && dateOf(item.dueDate) < today);
    const active = work.filter(isOpen);
    const table = work.filter(item => (isOpen(item) && item.dueDate && dateOf(item.dueDate) <= range.end)
      || (isOpen(item) && !item.dueDate && (inWindow(item.createdAt, range) || inWindow(item.assignedAt, range)))
      || (String(item.status || '').toLowerCase() === 'completed' && inWindow(item.completedAt, range)));
    const created = work.filter(item => inWindow(item.createdAt, range) || inWindow(item.assignedAt, range));
    const upcoming = work.filter(item => isOpen(item) && item.dueDate && dateOf(item.dueDate) > today);
    return { work, due, completed, pending, overdue, active, table, created, upcoming };
  }

  return { identityValues, resolveEmployee, matchesEmployee, normalizeDailyTask, uniqueWorkItems, filterDailyItems, dateOf, getWorkMetrics };
});