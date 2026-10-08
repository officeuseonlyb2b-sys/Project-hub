const fixtureTask = {
  id: 'rw-status-dom-fixture', contextType: 'regular_work', folderId: 'folder-dom', categoryId: 'category-dom',
  regularFolderId: 'folder-dom', regularCategoryId: 'category-dom', regularFolderName: 'Operations', regularCategoryName: 'Reviews',
  folderOwnerUid: 'auth-fixture', folderOwnerUserId: 'fixture-user', createdByUid: 'auth-fixture', createdBy: 'fixture-user',
  owner: 'fixture-user', title: 'Verify weekly report', priority: 'P2', status: 'Pending', progress: 0,
  currentDue: '2026-10-20', originalDue: '2026-10-20', next: 'Begin review', waitingOn: null
};
let state = {
  currentUser: 'fixture-user', tasks: [fixtureTask], comments: [], activity: [], approvals: [], calendarEvents: [],
  regularWorkFolders: [{ id: 'folder-dom', name: 'Operations', ownerUid: 'auth-fixture', ownerUserId: 'fixture-user' }],
  regularWorkCategories: [{ id: 'category-dom', folderId: 'folder-dom', name: 'Reviews', ownerUid: 'auth-fixture', status: 'Pending' }],
  users: [{ id: 'fixture-user', name: 'Fixture User', active: true }], projects: []
};
let activeView = 'mywork';
let activeProject = null;
let activeProjectTab = 'overview';
const el = id => document.getElementById(id);
const task = id => state.tasks.find(item => item.id === id);
const user = id => state.users.find(item => item.id === id) || { id, name: String(id || 'Unassigned'), initials: 'FU' };
const isOverdue = () => false;
const daysDiff = () => 1;
const priorityPill = value => `<span class="priority-pill">${value || 'P2'}</span>`;
const statusPill = value => `<span class="status-pill">${value || 'Pending'}</span>`;
const fmtDate = value => value || '—';
const fmtDateFull = value => value || '—';
const fmtTime = value => value || '';
const avatar = () => '<span class="avatar">FU</span>';
const activityItem = item => `<div class="activity-item"><strong>${item.text || ''}</strong></div>`;
const toast = message => { el('fixture-result').dataset.toast = message; };
const setTitle = () => {};
let openFolderForm = () => {};
let openCategoryForm = () => {};
let renderMyWork = () => { el('content').innerHTML = '<div class="role-split"></div><div class="metrics"></div>'; };
let wireDynamic = () => {};
let render = () => { renderMyWork(); };
const wireDrawer = () => {};
let log = (uid, projectId, taskId, type, text, change = '') => {
  state.activity.unshift({ id: `fixture-${state.activity.length}`, time: new Date().toISOString(), user: uid, task: taskId, type, text, change });
};
window.firebaseHub = {
  firebaseUid: 'auth-fixture',
  isSystemAdmin: () => false,
  canAccessRegularWorkTask: id => id === fixtureTask.id
};
window.fixtureStatusTransitions = [];
function updateStatus(taskId, nextStatus) {
  const current = task(taskId);
  const transition = window.regularWorkTaskStatus.createRegularWorkTaskStatusChange(current, nextStatus, window.firebaseHub.firebaseUid, new Date().toISOString());
  if (!transition) return;
  Object.assign(current, transition.updates);
  window.fixtureStatusTransitions.push(nextStatus);
  render();
  openTask(taskId);
}
function openTask(taskId) {
  const current = task(taskId);
  el('drawerEyebrow').textContent = 'REGULAR WORK';
  el('drawerTitle').textContent = current.title;
  el('drawerBody').innerHTML = `
    <section class="drawer-section"><div class="drawer-actions">${priorityPill(current.priority)}${statusPill(current.status)}</div></section>
    <section class="drawer-section"><h4>Task details</h4><div class="detail-grid"><div class="detail-box">${current.title}</div></div></section>
    <section class="drawer-section"><h4>Update work</h4><div class="drawer-actions">
      <button class="btn status-update" data-task="${taskId}" data-status="In Progress">Start / Resume</button>
      <button class="btn status-update" data-task="${taskId}" data-status="Ready for Review">Ready for Review</button>
      <button class="btn deadline-request" data-task="${taskId}">Request Deadline Change</button>
      <button class="schedule-task-btn" data-task="${taskId}">Schedule</button>
    </div></section>
    <section class="drawer-section"><h4>Comments</h4><div class="comment-box"><textarea id="newComment"></textarea><button id="addComment" data-task="${taskId}">Add</button></div></section>
    <section class="drawer-section"><h4>Activity history</h4><div class="activity"></div></section>`;
  el('taskDrawer').classList.add('open');
  el('drawerBackdrop').classList.add('open');
  wireDrawer(taskId);
}
