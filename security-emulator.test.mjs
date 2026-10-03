import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { get, ref, set, update } from 'firebase/database';

const require = createRequire(import.meta.url);
const { createTaskScopedSubmitGuard, installRegularWorkCommentClickDelegation, validateRegularWorkComment } = require('./regular-work-comment-guard.js');
const { createViewRouter, hashForView, resolveView, views: navigableViews } = require('./view-routing.js');

const projectId = 'demo-execution-hub-security';
const databaseRules = fs.readFileSync(new URL('./database.rules.json', import.meta.url), 'utf8');
const systemAdminEmail = 'ashish@arpitatravels.com';
const uidA = 'employee-a-auth';
const uidB = 'employee-b-auth';
const uidInactive = 'employee-inactive-auth';
const appA = 'empA';
const appB = 'empB';
const appInactive = 'empInactive';
const results = [];
let env;

function record(account, path, operation, expected, actual, detail = '') {
  results.push({ account, path, operation, expected, actual, detail });
  const marker = actual === expected ? 'PASS' : 'FAIL';
  console.log(`${marker}\t${account}\t${path}\t${operation}\texpected=${expected}\tactual=${actual}${detail ? `\t${detail}` : ''}`);
}

async function expectAllowed(account, path, operation, promise) {
  try {
    await assertSucceeds(promise);
    record(account, path, operation, 'ALLOWED', 'ALLOWED');
  } catch (error) {
    record(account, path, operation, 'ALLOWED', 'DENIED', error?.message || String(error));
  }
}

async function expectDenied(account, path, operation, promise) {
  try {
    await assertFails(promise);
    record(account, path, operation, 'DENIED', 'DENIED');
  } catch (error) {
    record(account, path, operation, 'DENIED', 'ALLOWED', error?.message || String(error));
  }
}

function profile(uid, appUserId, email, status = 'active', role = 'employee') {
  return { uid, appUserId, email, role, status, name: appUserId, department: 'Engineering', departmentId: 'dept-eng' };
}

async function seedFixtures() {
  await env.withSecurityRulesDisabled(async context => {
    const db = context.database();
    const fixture = {
      executionHub: {
        users: {
          [uidA]: profile(uidA, appA, 'employee-a@example.test'),
          [uidB]: profile(uidB, appB, 'employee-b@example.test'),
          [uidInactive]: profile(uidInactive, appInactive, 'inactive@example.test', 'exited'),
          'system-admin-auth': profile('system-admin-auth', 'systemAdmin', systemAdminEmail, 'active', 'admin')
        },
        employeeDirectory: {
          safe: {
            users: [
              { id: appA, appUserId: appA, name: 'Employee A', displayName: 'Employee A', designation: 'Analyst', department: 'Engineering', departmentId: 'dept-eng', initials: 'EA', status: 'active', active: true },
              { id: appB, appUserId: appB, name: 'Employee B', displayName: 'Employee B', designation: 'Designer', department: 'Design', departmentId: 'dept-design', initials: 'EB', status: 'active', active: true }
            ],
            departments: [{ id: 'dept-eng', name: 'Engineering', active: true }, { id: 'dept-design', name: 'Design', active: true }]
          }
        },
        userViews: {
          [uidA]: {
            projectAccess: { 'project-a': true },
            taskAccess: { 'task-a': true },
            projectTaskAccess: { 'task-a': true },
            approvalAccess: { 'approval-a': true },
            calendarAccess: { 'event-a': true },
            teamAccess: { 'team-a': true },
            departmentAccess: { 'dept-eng': true }
          },
          [uidB]: {
            projectAccess: { 'project-b': true },
            taskAccess: { 'task-b': true },
            approvalAccess: { 'approval-b': true },
            calendarAccess: { 'event-b': true },
            teamAccess: { 'team-b': true },
            departmentAccess: { 'dept-design': true }
          },
          [uidInactive]: {
            projectAccess: { 'project-a': true },
            taskAccess: { 'task-a': true },
            approvalAccess: { 'approval-a': true },
            calendarAccess: { 'event-a': true }
          }
        },
        userWork: {
          [uidA]: { plannerRead: { 'event-a-empA': true }, note: 'private-a' },
          [uidB]: { plannerRead: { 'event-b-empB': true }, note: 'private-b' },
          [uidInactive]: { note: 'inactive-private' }
        },
        private: {
          [uidA]: { snapshot: { owner: uidA, value: 'private-a' } },
          [uidB]: { snapshot: { owner: uidB, value: 'private-b' } },
          [uidInactive]: { snapshot: { owner: uidInactive, value: 'inactive-private' } }
        },
        workspace: {
          employeeVisibleData: {
            state: { marker: 'legacy-state' },
            directory: { marker: 'legacy-directory', users: [{ email: 'legacy@example.test', uid: 'secret' }] }
          }
        },
        workspaces: { default: { state: { marker: 'legacy-default-state' } } },
        shared: {
          projects: {
            'project-a': { id: 'project-a', name: 'Project A', projectLead: 'leadA', team: [appA] },
            'project-b': { id: 'project-b', name: 'Project B', projectLead: appB, team: [appB] }
          },
          tasks: {
            'task-a': { id: 'task-a', project: 'project-a', owner: appA, createdByUid: uidA, reviewer: appB, title: 'Assigned to A' },
            'task-b': { id: 'task-b', project: 'project-b', owner: appB, createdByUid: uidB, title: 'Assigned to B' }
          },
          approvals: {
            'approval-a': { id: 'approval-a', requestedBy: appA, approverIds: { [appB]: true }, task: 'task-a', status: 'Pending' },
            'approval-b': { id: 'approval-b', requestedBy: appB, approverIds: { [appB]: true }, task: 'task-b', status: 'Pending' }
          },
          calendar: {
            'event-a': { id: 'event-a', createdByUid: uidA, participants: [appA], participantUserIds: { [appA]: true }, title: 'A event' },
            'event-b': { id: 'event-b', createdByUid: uidB, participants: [appB], participantUserIds: { [appB]: true }, title: 'B event' }
          }
        },
        regularWork: {
          owners: {
            [uidA]: { folders: { 'folder-a': { id: 'folder-a', name: 'A folder', ownerUid: uidA } }, categories: {} },
            [uidB]: { folders: { 'folder-b': { id: 'folder-b', name: 'B folder', ownerUid: uidB } }, categories: {} }
          },
          tasks: {
            'rw-a': { id: 'rw-a', owner: appA, createdByUid: uidA, folderOwnerUid: uidA, regularFolderId: 'folder-a', regularCategoryId: 'cat-a', title: 'Owned by A' },
            'rw-assigned-b': { id: 'rw-assigned-b', owner: appB, createdByUid: uidA, folderOwnerUid: uidA, regularFolderId: 'folder-a', regularCategoryId: 'cat-a', title: 'Assigned to B' },
            'rw-b': { id: 'rw-b', owner: appB, createdByUid: uidB, folderOwnerUid: uidB, regularFolderId: 'folder-b', regularCategoryId: 'cat-b', title: 'Owned by B' }
          },
          taskAccess: {
            [appA]: { 'rw-a': true },
            [appB]: { 'rw-assigned-b': true, 'rw-b': true }
          },
          dailyTasks: {
            'rw-a': { 'daily-a': { id: 'daily-a', parentTaskId: 'rw-a', title: 'A daily' } },
            'rw-assigned-b': { 'daily-assigned-b': { id: 'daily-assigned-b', parentTaskId: 'rw-assigned-b', assignedTo: appB, title: 'B daily', date: '2026-10-03', notes: '', priority: 'P2', createdByUid: uidA, status: 'Not Started' } },
            'rw-b': { 'daily-b': { id: 'daily-b', parentTaskId: 'rw-b', title: 'B daily' } }
          }
        }
      }
    };
    await set(ref(db, '/'), fixture);
  });
}

async function runMatrix() {
  const a = env.authenticatedContext(uidA, { email: 'employee-a@example.test' }).database();
  const b = env.authenticatedContext(uidB, { email: 'employee-b@example.test' }).database();
  const inactive = env.authenticatedContext(uidInactive, { email: 'inactive@example.test' }).database();
  const admin = env.authenticatedContext('system-admin-auth', { email: systemAdminEmail }).database();

  for (const view of navigableViews) {
    const location = { hash: hashForView(view) };
    const history = { pushState(_state, _title, hash) { location.hash = hash; }, replaceState(_state, _title, hash) { location.hash = hash; } };
    const router = createViewRouter({ location, history, isSystemAdmin: () => view === 'performance' });
    assert.equal(router.current, view);
    assert.equal(router.sync(view), view);
  }
  assert.equal(resolveView('#daily-work-performance'), 'dailywork');
  assert.equal(resolveView('#people'), 'team');
  const employeeLocation = { hash: '#performance' };
  const employeeHistory = { replaceState(_state, _title, hash) { employeeLocation.hash = hash; }, pushState(_state, _title, hash) { employeeLocation.hash = hash; } };
  const employeeRouter = createViewRouter({ location: employeeLocation, history: employeeHistory, isSystemAdmin: () => false });
  assert.equal(employeeRouter.current, 'dashboard');
  assert.equal(employeeLocation.hash, '#performance');
  employeeRouter.restore();
  assert.equal(employeeLocation.hash, '#dashboard');
  record('Navigation', 'all routes restore and restricted Performance falls back', `${navigableViews.length} routes`, 'PASS', 'PASS');

  const historyLocation = { hash: '' }, historyStack = ['']; let historyIndex = 0;
  const browserHistory = {
    pushState(_state, _title, hash) { historyStack.splice(historyIndex + 1);historyStack.push(hash);historyIndex++;historyLocation.hash=hash; },
    replaceState(_state, _title, hash) { historyStack[historyIndex]=hash;historyLocation.hash=hash; },
    back() { if(historyIndex>0)historyLocation.hash=historyStack[--historyIndex]; },
    forward() { if(historyIndex<historyStack.length-1)historyLocation.hash=historyStack[++historyIndex]; }
  };
  const browserRouter = createViewRouter({ location: historyLocation, history: browserHistory, isSystemAdmin: () => true });
  browserRouter.sync('projects');browserRouter.sync('mywork');browserHistory.back();assert.equal(browserRouter.restore(),'projects');browserHistory.forward();assert.equal(browserRouter.restore(),'mywork');
  record('Navigation', 'browser back/forward restore', 'Projects ↔ My Work', 'PASS', 'PASS');

  const clickListeners = [];
  let renderedAddButton;
  const fakeDocument = {
    addEventListener(type, listener, capture) { if (type === 'click' && capture) clickListeners.push(listener); },
    contains(element) { return element === renderedAddButton; }
  };
  const deliveredTaskIds = [];
  assert.equal(installRegularWorkCommentClickDelegation(fakeDocument, taskId => deliveredTaskIds.push(taskId)), true);
  assert.equal(installRegularWorkCommentClickDelegation(fakeDocument, taskId => deliveredTaskIds.push(taskId)), false);
  const clickRenderedAddButton = () => {
    const button = renderedAddButton;
    const event = { target: { closest: selector => selector === '#addComment' ? button : null }, prevented: false, stopped: false, preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; } };
    clickListeners.forEach(listener => listener(event));
    assert.equal(event.prevented, true);
    assert.equal(event.stopped, true);
  };
  renderedAddButton = { dataset: { task: 'rw-dom-test' }, disabled: false };
  clickRenderedAddButton();
  assert.equal(deliveredTaskIds.length, 1);
  renderedAddButton = { dataset: { task: 'rw-dom-test' }, disabled: false };
  clickRenderedAddButton();
  assert.deepEqual(deliveredTaskIds, ['rw-dom-test', 'rw-dom-test']);
  record('Regular Work UI', 'delegated Add click after drawer rerender', 'one handler per rendered button', 'PASS', 'PASS');

  for (const input of ['', '   ', '\n\t']) {
    const validation = validateRegularWorkComment(input);
    let writes = 0;
    if (validation.text) writes += 1;
    assert.equal(validation.text, '');
    assert.equal(validation.error, 'Please enter a comment.');
    assert.equal(writes, 0);
    record('Regular Work UI', 'comment validation', JSON.stringify(input), 'NO WRITE + VALIDATION', 'NO WRITE + VALIDATION');
  }

  const submitGuard = createTaskScopedSubmitGuard();
  let commentWrites = 0;
  let releaseFirstSubmit;
  const firstSubmit = submitGuard.run('rw-submit-test', async () => {
    commentWrites += 1;
    await new Promise(resolve => { releaseFirstSubmit = resolve; });
  });
  const secondSubmit = await submitGuard.run('rw-submit-test', async () => { commentWrites += 1; });
  record('Regular Work UI', 'task-scoped submit guard', 'two immediate submits', 'BLOCKED', secondSubmit === false ? 'BLOCKED' : 'SUBMITTED');
  releaseFirstSubmit();
  await firstSubmit;
  record('Regular Work UI', 'comment record count', 'pending save completion', 1, commentWrites);

  for (const path of [
    `executionHub/users/${uidA}`,
    `executionHub/userViews/${uidA}`,
    `executionHub/userWork/${uidA}`,
    `executionHub/private/${uidA}`
  ]) await expectAllowed('Employee A', path, 'read', get(ref(a, path)));
  for (const path of [
    `executionHub/users/${uidB}`,
    `executionHub/userViews/${uidB}`,
    `executionHub/userWork/${uidB}`,
    `executionHub/private/${uidB}`
  ]) await expectDenied('Employee A', path, 'read', get(ref(a, path)));

  for (const path of [
    `executionHub/users/${uidB}`,
    `executionHub/userViews/${uidB}`,
    `executionHub/userWork/${uidB}`,
    `executionHub/private/${uidB}`
  ]) await expectAllowed('Employee B', path, 'read', get(ref(b, path)));
  for (const path of [
    `executionHub/users/${uidA}`,
    `executionHub/userViews/${uidA}`,
    `executionHub/userWork/${uidA}`,
    `executionHub/private/${uidA}`
  ]) await expectDenied('Employee B', path, 'read', get(ref(b, path)));

  for (const uid of [uidA, uidB]) {
    for (const path of [`executionHub/users/${uid}`, `executionHub/userViews/${uid}`, `executionHub/userWork/${uid}`, `executionHub/private/${uid}`]) {
      await expectAllowed('System Admin', path, 'read', get(ref(admin, path)));
    }
  }

  for (const path of [
    `executionHub/users/${uidInactive}`,
    `executionHub/userViews/${uidInactive}`,
    `executionHub/userWork/${uidInactive}`,
    `executionHub/private/${uidInactive}`,
    'executionHub/employeeDirectory/safe',
    'executionHub/shared/projects/project-a',
    'executionHub/shared/tasks/task-a',
    'executionHub/shared/approvals/approval-a',
    'executionHub/shared/calendar/event-a',
    `executionHub/regularWork/owners/${uidA}`,
    'executionHub/regularWork/tasks/rw-a',
    `executionHub/regularWork/taskAccess/${appA}/rw-a`,
    'executionHub/regularWork/dailyTasks/rw-a'
  ]) await expectDenied('Inactive employee', path, 'read', get(ref(inactive, path)));

  await expectAllowed('Employee A', 'executionHub/shared/projects/project-a', 'read', get(ref(a, 'executionHub/shared/projects/project-a')));
  await expectDenied('Employee A', 'executionHub/shared/projects/project-b', 'read', get(ref(a, 'executionHub/shared/projects/project-b')));
  await expectAllowed('Employee A', 'executionHub/shared/tasks/task-a', 'read', get(ref(a, 'executionHub/shared/tasks/task-a')));
  await expectDenied('Employee A', 'executionHub/shared/tasks/task-b', 'read', get(ref(a, 'executionHub/shared/tasks/task-b')));

  await expectAllowed('Employee A (folder owner)', 'executionHub/regularWork/owners/' + uidA, 'read', get(ref(a, `executionHub/regularWork/owners/${uidA}`)));
  await expectDenied('Employee B (unrelated folder)', 'executionHub/regularWork/owners/' + uidA, 'read', get(ref(b, `executionHub/regularWork/owners/${uidA}`)));
  await expectAllowed('Employee A (task owner)', 'executionHub/regularWork/tasks/rw-a', 'read', get(ref(a, 'executionHub/regularWork/tasks/rw-a')));
  await expectAllowed('Employee B (assigned task)', 'executionHub/regularWork/tasks/rw-assigned-b', 'read', get(ref(b, 'executionHub/regularWork/tasks/rw-assigned-b')));
  await expectDenied('Employee A (unrelated task)', 'executionHub/regularWork/tasks/rw-b', 'read', get(ref(a, 'executionHub/regularWork/tasks/rw-b')));
  await expectAllowed('Employee A', 'executionHub/regularWork/dailyTasks/rw-a', 'read', get(ref(a, 'executionHub/regularWork/dailyTasks/rw-a')));
  await expectDenied('Employee A', 'executionHub/regularWork/dailyTasks/rw-b', 'read', get(ref(a, 'executionHub/regularWork/dailyTasks/rw-b')));

  await expectAllowed('Employee A', 'executionHub/shared/approvals/approval-a', 'read', get(ref(a, 'executionHub/shared/approvals/approval-a')));
  await expectDenied('Employee A', 'executionHub/shared/approvals/approval-b', 'read', get(ref(a, 'executionHub/shared/approvals/approval-b')));
  await expectAllowed('Employee B (approver)', 'executionHub/shared/approvals/approval-a', 'read', get(ref(b, 'executionHub/shared/approvals/approval-a')));
  await expectAllowed('Employee A (Planner participant)', 'executionHub/shared/calendar/event-a', 'read', get(ref(a, 'executionHub/shared/calendar/event-a')));
  await expectDenied('Employee A (unrelated Planner)', 'executionHub/shared/calendar/event-b', 'read', get(ref(a, 'executionHub/shared/calendar/event-b')));
  await expectAllowed('Employee A', 'executionHub/employeeDirectory/safe', 'read', get(ref(a, 'executionHub/employeeDirectory/safe')));

  await expectAllowed('Employee A (task owner)', 'executionHub/shared/tasks/task-a/status', 'write status', set(ref(a, 'executionHub/shared/tasks/task-a/status'), 'In Progress'));
  await expectAllowed('Employee A (project member)', 'executionHub/shared/comments/task-a/comment-a', 'write comment', set(ref(a, 'executionHub/shared/comments/task-a/comment-a'), { id: 'comment-a', task: 'task-a', user: appA, text: 'Progress update' }));
  await expectAllowed('Employee A (requester)', 'executionHub/shared/approvals/approval-a-new', 'create approval', set(ref(a, 'executionHub/shared/approvals/approval-a-new'), { id: 'approval-a-new', requestedBy: appA, approvers: [appB], approverIds: { [appB]: true }, task: 'task-a', status: 'Pending' }));
  await expectAllowed('Employee B (assigned approver)', 'executionHub/shared/approvals/approval-a/decisions/empB', 'write decision', set(ref(b, 'executionHub/shared/approvals/approval-a/decisions/empB'), { status: 'Approved', at: '2026-10-03T10:00:00.000Z' }));
  await expectAllowed('Employee B (Planner participant)', 'executionHub/shared/calendar/event-b/responses/empB', 'write own RSVP', set(ref(b, 'executionHub/shared/calendar/event-b/responses/empB'), 'accepted'));
  await expectAllowed('Employee A (Regular Work folder owner)', 'executionHub/regularWork/tasks/rw-new-a', 'create assigned task', set(ref(a, 'executionHub/regularWork/tasks/rw-new-a'), { id: 'rw-new-a', owner: appB, createdByUid: uidA, folderOwnerUid: uidA, folderOwnerUserId: appA, regularFolderId: 'folder-a', regularCategoryId: 'cat-a', title: 'New task for B' }));
  await expectAllowed('Employee A (task creator)', 'executionHub/regularWork/taskAccess/empB/rw-new-a', 'grant actual assignee index', set(ref(a, 'executionHub/regularWork/taskAccess/empB/rw-new-a'), true));
  await expectAllowed('Employee B (new assignee)', 'executionHub/regularWork/tasks/rw-new-a', 'read assigned task', get(ref(b, 'executionHub/regularWork/tasks/rw-new-a')));
  await expectDenied('Employee A (unrelated assignment)', 'executionHub/regularWork/taskAccess/empA/rw-b', 'grant unrelated task access', set(ref(a, 'executionHub/regularWork/taskAccess/empA/rw-b'), true));
  await expectAllowed('Employee A (Regular Work task owner)', 'executionHub/regularWork/comments/rw-a/comment-rwa', 'write Regular Work comment', set(ref(a, 'executionHub/regularWork/comments/rw-a/comment-rwa'), { id: 'comment-rwa', task: 'rw-a', user: appA, authorUid: uidA, actorUid: uidA, createdByUid: uidA, text: 'Owner comment' }));
  await expectAllowed('Employee A (Regular Work task owner)', 'executionHub/regularWork/comments/rw-a', 'read saved Regular Work comments', get(ref(a, 'executionHub/regularWork/comments/rw-a')));
  await expectAllowed('Employee A (Regular Work task owner)', 'executionHub/regularWork/activity/rw-a/activity-rwa', 'write comment audit activity', set(ref(a, 'executionHub/regularWork/activity/rw-a/activity-rwa'), { id: 'activity-rwa', task: 'rw-a', user: appA, authorUid: uidA, actorUid: uidA, createdByUid: uidA, type: 'Comment', text: 'added a comment' }));
  await expectAllowed('Employee B (assigned Regular Work task)', 'executionHub/regularWork/comments/rw-assigned-b/comment-rwb', 'write assigned-task comment', set(ref(b, 'executionHub/regularWork/comments/rw-assigned-b/comment-rwb'), { id: 'comment-rwb', task: 'rw-assigned-b', user: appB, authorUid: uidB, actorUid: uidB, createdByUid: uidB, text: 'Assignee comment' }));
  await expectDenied('Employee A (unrelated Regular Work task)', 'executionHub/regularWork/comments/rw-b/comment-unrelated', 'write unrelated-task comment', set(ref(a, 'executionHub/regularWork/comments/rw-b/comment-unrelated'), { id: 'comment-unrelated', task: 'rw-b', user: appA, authorUid: uidA, actorUid: uidA, createdByUid: uidA, text: 'Unauthorized comment' }));
  await expectDenied('Employee A (unrelated Regular Work task)', 'executionHub/regularWork/activity/rw-b/activity-unrelated', 'write unrelated-task comment activity', set(ref(a, 'executionHub/regularWork/activity/rw-b/activity-unrelated'), { id: 'activity-unrelated', task: 'rw-b', user: appA, authorUid: uidA, actorUid: uidA, createdByUid: uidA, type: 'Comment', text: 'added a comment' }));

  await expectAllowed('Employee A (Regular Work owner)', 'executionHub/regularWork', 'atomic owner comment and activity update', update(ref(a, 'executionHub/regularWork'), {
    'comments/rw-a/comment-atomic-owner': { id: 'comment-atomic-owner', task: 'rw-a', user: appA, authorUid: uidA, actorUid: uidA, createdByUid: uidA, text: 'Atomic owner comment' },
    'activity/rw-a/activity-atomic-owner': { id: 'activity-atomic-owner', task: 'rw-a', user: appA, authorUid: uidA, actorUid: uidA, createdByUid: uidA, type: 'Comment', text: 'added a comment' }
  }));
  await expectAllowed('Employee B (assigned Regular Work task)', 'executionHub/regularWork', 'atomic assignee comment and activity update', update(ref(b, 'executionHub/regularWork'), {
    'comments/rw-assigned-b/comment-atomic-assignee': { id: 'comment-atomic-assignee', task: 'rw-assigned-b', user: appB, authorUid: uidB, actorUid: uidB, createdByUid: uidB, text: 'Atomic assignee comment' },
    'activity/rw-assigned-b/activity-atomic-assignee': { id: 'activity-atomic-assignee', task: 'rw-assigned-b', user: appB, authorUid: uidB, actorUid: uidB, createdByUid: uidB, type: 'Comment', text: 'added a comment' }
  }));
  await expectAllowed('Employee A (Regular Work owner)', 'executionHub/regularWork/comments/rw-a/comment-atomic-owner', 'read back atomic comment', get(ref(a, 'executionHub/regularWork/comments/rw-a/comment-atomic-owner')));
  await expectAllowed('Employee A (Regular Work owner)', 'executionHub/regularWork/activity/rw-a/activity-atomic-owner', 'read back atomic activity', get(ref(a, 'executionHub/regularWork/activity/rw-a/activity-atomic-owner')));
  await expectAllowed('Employee B (assigned Regular Work task)', 'executionHub/regularWork/comments/rw-assigned-b/comment-atomic-assignee', 'read back atomic assignee comment', get(ref(b, 'executionHub/regularWork/comments/rw-assigned-b/comment-atomic-assignee')));
  await expectAllowed('Employee B (assigned Regular Work task)', 'executionHub/regularWork/activity/rw-assigned-b/activity-atomic-assignee', 'read back atomic assignee activity', get(ref(b, 'executionHub/regularWork/activity/rw-assigned-b/activity-atomic-assignee')));
  await assertFails(update(ref(a, 'executionHub/regularWork'), {
    'comments/rw-a/comment-atomic-rollback': { id: 'comment-atomic-rollback', task: 'rw-a', user: appA, authorUid: uidA, actorUid: uidA, createdByUid: uidA, text: 'Must not partially persist' },
    'activity/rw-b/activity-atomic-denied': { id: 'activity-atomic-denied', task: 'rw-b', user: appA, authorUid: uidA, actorUid: uidA, createdByUid: uidA, type: 'Comment', text: 'added a comment' }
  }));
  const partialComment = await get(ref(a, 'executionHub/regularWork/comments/rw-a/comment-atomic-rollback'));
  record('Employee A (Regular Work owner)', 'executionHub/regularWork', 'atomic write with denied activity target', 'NO PARTIAL COMMENT', partialComment.exists() ? 'PARTIAL COMMENT' : 'NO PARTIAL COMMENT');
  await expectAllowed('Employee B (Daily Task assignee)', 'executionHub/regularWork/dailyTasks/rw-assigned-b/daily-assigned-b', 'update own Daily Task status', set(ref(b, 'executionHub/regularWork/dailyTasks/rw-assigned-b/daily-assigned-b/status'), 'Completed'));

  for (const key of ['projectAccess', 'taskAccess', 'approvalAccess', 'calendarAccess', 'teamAccess', 'departmentAccess']) {
    const path = `executionHub/userViews/${uidA}/${key}/self-grant-attempt`;
    await expectDenied('Employee A', path, 'write true', set(ref(a, path), true));
  }

  for (const path of [
    'executionHub/workspace/employeeVisibleData/state',
    'executionHub/workspace/employeeVisibleData/directory',
    'executionHub/workspaces/default/state'
  ]) await expectDenied('Employee A', path, 'read legacy Admin-only path', get(ref(a, path)));
  for (const path of [
    'executionHub/workspace/employeeVisibleData/state',
    'executionHub/workspace/employeeVisibleData/directory',
    'executionHub/workspaces/default/state'
  ]) await expectAllowed('System Admin', path, 'read legacy path', get(ref(admin, path)));

  const safeSnapshot = await assertSucceeds(get(ref(a, 'executionHub/employeeDirectory/safe')));
  const safeValue = safeSnapshot.val();
  const forbiddenKeys = new Set(['email', 'uid', 'authUid', 'firebaseUid', 'salary', 'attendance', 'leave', 'password', 'management', 'mobile', 'phone']);
  function inspectSafe(value) {
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      assert.equal(forbiddenKeys.has(key.toLowerCase()), false, `forbidden safe directory key: ${key}`);
      inspectSafe(child);
    }
  }
  inspectSafe(safeValue);
  record('Employee A', 'executionHub/employeeDirectory/safe', 'inspect fields', 'SAFE-ONLY', 'SAFE-ONLY');

  for (const path of [
    `executionHub/private/${uidA}`,
    `executionHub/userViews/${uidA}`,
    `executionHub/userWork/${uidA}`,
    `executionHub/shared/projects/project-a`,
    `executionHub/shared/tasks/task-a`,
    `executionHub/shared/approvals/approval-a`,
    `executionHub/shared/calendar/event-a`,
    `executionHub/regularWork/tasks/rw-a`,
    `executionHub/regularWork/dailyTasks/rw-a`
  ]) await expectAllowed('System Admin', path, 'read', get(ref(admin, path)));

  const failures = results.filter(result => result.actual !== result.expected);
  console.log(`\nSUMMARY ${results.length - failures.length}/${results.length} assertions passed`);
  if (failures.length) {
    console.error('FAILED ASSERTIONS:', JSON.stringify(failures, null, 2));
    process.exitCode = 1;
  }
}

try {
  env = await initializeTestEnvironment({
    projectId,
    database: { host: '127.0.0.1', port: 9000, rules: databaseRules }
  });
  await env.clearDatabase();
  await seedFixtures();
  await runMatrix();
} finally {
  await env?.cleanup();
}
