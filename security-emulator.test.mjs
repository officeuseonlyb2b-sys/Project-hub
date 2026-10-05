import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { get, ref, set, update } from 'firebase/database';

const require = createRequire(import.meta.url);
const dailyWorkModel = require('./daily-work-model.js');
const { buildScopedWorkspaceMigration, isWorkspaceReady, isSystemAdminEmail, validateEmployeeProfile } = require('./scoped-workspace-migration.js');
const { createTaskScopedSubmitGuard, installRegularWorkCommentClickDelegation, validateRegularWorkComment } = require('./regular-work-comment-guard.js');
const { createRegularWorkTaskStatusChange } = require('./regular-work-task-status.js');
const { createViewRouter, hashForView, resolveView, views: navigableViews } = require('./view-routing.js');

const projectId = 'demo-execution-hub-security';
const databaseRules = fs.readFileSync(new URL('./database.rules.json', import.meta.url), 'utf8');
const systemAdminEmail = 'ashish@enchantingmp.in';
const trustedSystemAdminUid = 'lGhNVO4kclh133CqgCiyPo3V5DA3';
const uidA = 'employee-a-auth';
const uidB = 'employee-b-auth';
const uidInactive = 'employee-inactive-auth';
const appA = 'empA';
const appB = 'empB';
const appInactive = 'empInactive';
const migrationUid = 'scoped-migration-auth';
const migrationAppId = 'scoped-migration-app';
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

function runDailyWorkModelChecks() {
  const employees = [
    { id: appA, appUserId: appA, authUid: uidA, employeeId: 'employee-a-record', name: 'Employee A', active: true },
    { id: appB, appUserId: appB, authUid: uidB, employeeId: 'employee-b-record', name: 'Employee B', active: true }
  ];
  const parent = { id: 'parent-rw', priority: 'P1', contextType: 'regular_work' };
  const records = [
    { id: 'daily-start', title: 'Start', assignedTo: appA, date: '2026-10-05', status: 'Not Started', createdAt: '2026-10-05T08:00:00.000Z' },
    { id: 'daily-progress', title: 'Progress', assignedTo: uidA, date: '2026-10-05', status: 'In Progress', createdAt: '2026-10-05T08:00:00.000Z' },
    { id: 'daily-completed', title: 'Completed', assignedTo: 'employee-a-record', date: '2026-10-04', status: 'Completed', completedAt: '2026-10-05T11:00:00.000Z' },
    { id: 'daily-overdue', title: 'Overdue', assignedTo: appA, date: '2026-10-04', status: 'Not Started' },
    { id: 'daily-upcoming', title: 'Upcoming', assignedTo: appA, date: '2026-10-06', status: 'In Progress' },
    { id: 'daily-employee-b', title: 'Employee B', assignedTo: uidB, date: '2026-10-05', status: 'Not Started' },
    { id: 'daily-archived', title: 'Archived', assignedTo: appA, date: '2026-10-05', status: 'Not Started', archived: true }
  ];
  const normalized = records.map(record => dailyWorkModel.normalizeDailyTask(parent, record, employees)).filter(Boolean);
  const range = { start: '2026-10-05', end: '2026-10-05' };
  const allMetrics = dailyWorkModel.getWorkMetrics(normalized, range, '2026-10-05');
  const employeeAMetrics = dailyWorkModel.getWorkMetrics(dailyWorkModel.filterDailyItems(normalized, { employeeId: appA, scope: 'my', employees }), range, '2026-10-05');
  const employeeBItems = dailyWorkModel.filterDailyItems(normalized, { employeeId: uidB, scope: 'my', employees });
  const adminEmployeeBItems = dailyWorkModel.filterDailyItems(normalized, { employeeId: appB, scope: 'my', employees });
  const departmentItems = dailyWorkModel.filterDailyItems(normalized, { scope: 'department', departmentIds: [appA], employees });
  const teamItems = dailyWorkModel.filterDailyItems(normalized, { scope: 'team', employees });
  const allEmployeeItems = dailyWorkModel.filterDailyItems(normalized, { scope: 'my', allEmployees: true });
  assert.equal(dailyWorkModel.resolveEmployee(uidA, employees)?.id, appA);
  assert.equal(dailyWorkModel.resolveEmployee('employee-a-record', employees)?.id, appA);
  assert.equal(employeeBItems.length, 1);
  assert.equal(adminEmployeeBItems.length, 1);
  assert.equal(departmentItems.length, 5);
  assert.equal(teamItems.length, 6);
  assert.equal(allEmployeeItems.length, 6);
  assert.equal(employeeAMetrics.pending.length, 3);
  assert.equal(employeeAMetrics.due.length, 2);
  assert.equal(employeeAMetrics.overdue.length, 1);
  assert.equal(employeeAMetrics.completed.length, 1);
  assert.equal(employeeAMetrics.active.length, 4);
  assert.equal(employeeAMetrics.upcoming.length, 1);
  assert.equal(employeeAMetrics.created.length, 2);
  assert.equal(employeeAMetrics.table.some(item => item.sourceId === 'daily-completed'), true);
  assert.equal(allMetrics.work.length, 6);
  assert.equal(dailyWorkModel.uniqueWorkItems([...normalized, normalized[0]]).length, normalized.length);

  const reopened = dailyWorkModel.normalizeDailyTask(parent, { ...records[2], status: 'In Progress', completedAt: null }, employees);
  const reopenedMetrics = dailyWorkModel.getWorkMetrics([reopened], range, '2026-10-05');
  const reCompleted = dailyWorkModel.normalizeDailyTask(parent, { ...records[2], status: 'Completed', completedAt: '2026-10-05T12:00:00.000Z' }, employees);
  const reCompletedMetrics = dailyWorkModel.getWorkMetrics([reCompleted], range, '2026-10-05');
  assert.equal(reopenedMetrics.completed.length, 0);
  assert.equal(reopenedMetrics.active.length, 1);
  assert.equal(reCompletedMetrics.completed.length, 1);
  assert.equal(reCompletedMetrics.active.length, 0);
  const nearMidnight = '2026-10-04T18:36:42.595Z';
  const localCompletedDate = dailyWorkModel.dateOf(nearMidnight);
  const timezoneBoundaryRecord = dailyWorkModel.normalizeDailyTask(parent, { ...records[2], completedAt: nearMidnight }, employees);
  assert.equal(dailyWorkModel.getWorkMetrics([timezoneBoundaryRecord], { start: localCompletedDate, end: localCompletedDate }, localCompletedDate).completed.length, 1);
  record('Daily Work model', 'authorized identity/date/status matrix', 'employee + Admin aggregation, lifecycle and dedupe', 'PASS', 'PASS');
}

function runScopedMigrationPlannerChecks() {
  assert.equal(isWorkspaceReady({ status: 'completed', scopedDataVersion: 1 }), true);
  assert.equal(isWorkspaceReady({ status: 'completed' }), false);
  assert.equal(isWorkspaceReady({ status: 'running', scopedDataVersion: 1 }), false);
  const plan = buildScopedWorkspaceMigration({
    users: [
      { id: appA, appUserId: appA, authUid: uidA, email: 'employee-a@example.test', status: 'active', name: 'Employee A' },
      { id: appInactive, appUserId: appInactive, authUid: uidInactive, email: 'inactive@example.test', status: 'exited', name: 'Inactive' },
      { id: 'u1', appUserId: 'u1', authUid: trustedSystemAdminUid, email: systemAdminEmail, status: 'active', name: 'Admin' }
    ],
    departments: [{ id: 'dept-eng', name: 'Engineering', headId: appA }],
    projects: [{ id: 'project-a', name: 'Project A', team: [appA, appInactive], projectLead: appA }],
    tasks: [{ id: 'task-a', project: 'project-a', owner: appA, reviewer: appInactive, createdByUid: uidA, title: 'Task A' }],
    approvals: [], comments: [],
    activity: [
      { id: 'activity-linked', task: 'task-a', user: appA, text: 'Task update' },
      { id: 'activity-retained', type: 'Organisation', text: 'Legacy event remains in source' }
    ],
    calendarEvents: []
  });
  assert.equal(plan.ready, true, plan.blockers.join('; '));
  assert.equal(plan.counts.projects, 1);
  assert.equal(plan.counts.projectTasks, 1);
  assert.equal(plan.counts.userViews, 1);
  assert.equal(plan.counts.safeDirectoryUsers, 2);
  assert.equal(plan.counts.retainedLegacyActivity, 1);
  assert.equal(plan.updates[`executionHub/userViews/${uidA}`].projectAccess['project-a'], true);
  assert.equal(plan.updates[`executionHub/userViews/${uidA}`].taskAccess['task-a'], true);
  assert.equal(plan.updates[`executionHub/userViews/${uidA}`].projectTaskAccess['task-a'], true);
  assert.equal(plan.updates['executionHub/employeeDirectory/safe'].users.some(user => 'email' in user || 'authUid' in user), false);
  assert.equal(Object.values(plan.updates).some(value => value === null), false);

  const blocked = buildScopedWorkspaceMigration({ users: [{ id: appA, appUserId: appA, authUid: uidA, status: 'active' }], projects: [{ id: 'project-missing-owner', team: ['unknown-app-user'] }] });
  assert.equal(blocked.ready, false);
  assert.equal(blocked.blockers.some(issue => issue.includes('unknown-app-user')), true);
  record('Scoped migration planner', 'idempotent access mapping and retained history', 'inactive users denied; unmapped identity blocks readiness', 'PASS', 'PASS');
}

function runApplicationAuthorizationChecks() {
  const activeAuthUser = { uid: uidA, email: 'employee-a@example.test' };
  const activeProfile = { uid: uidA, email: activeAuthUser.email, role: 'employee', status: 'active', appUserId: appA };
  assert.equal(isSystemAdminEmail(systemAdminEmail.toUpperCase()), true);
  assert.equal(validateEmployeeProfile(activeAuthUser, activeProfile).allowed, true);
  assert.equal(validateEmployeeProfile(activeAuthUser, { ...activeProfile, status: 'exited' }).code, 'app/account-disabled');
  assert.equal(validateEmployeeProfile(activeAuthUser, null).code, 'app/not-authorized');
  assert.equal(validateEmployeeProfile(activeAuthUser, { ...activeProfile, role: 'manager' }).code, 'app/not-authorized');
  assert.equal(validateEmployeeProfile(activeAuthUser, { ...activeProfile, appUserId: '' }).code, 'app/not-authorized');
  assert.equal(isWorkspaceReady({ status: 'completed', scopedDataVersion: 1 }), true);
  assert.equal(isWorkspaceReady({ status: 'completed' }), false);
  record('Application authorization', 'Admin precedence + employee profile/readiness gates', 'Admin detected; active mapped employee allowed; invalid/inactive/stale readiness denied', 'PASS', 'PASS');
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
          [migrationUid]: profile(migrationUid, migrationAppId, 'scoped-migration@example.test'),
          [trustedSystemAdminUid]: profile(trustedSystemAdminUid, 'systemAdmin', systemAdminEmail, 'active', 'admin')
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
            'project-a': { id: 'project-a', name: 'Project A', projectLead: appA, owner: appA, createdBy: uidA, team: [appA] },
            'project-b': { id: 'project-b', name: 'Project B', projectLead: appB, team: [appB] }
          },
          tasks: {
            'task-a': { id: 'task-a', project: 'project-a', owner: appA, createdByUid: uidA, reviewer: appB, title: 'Assigned to A' },
            'task-b': { id: 'task-b', project: 'project-b', owner: appB, createdByUid: uidB, title: 'Assigned to B' }
          },
          activity: {
            'task-a': {
              'activity-existing-a': { id: 'activity-existing-a', task: 'task-a', user: appA, text: 'Original shared activity' }
            }
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
          activity: {
            'rw-a': {
              'activity-existing-rwa': { id: 'activity-existing-rwa', task: 'rw-a', user: appA, text: 'Original Regular Work activity', createdByUid: uidA }
            }
          },
          ownerActivity: {
            [uidA]: {
              'owner-activity-existing-a': { id: 'owner-activity-existing-a', ownerUid: uidA, text: 'Original owner activity', createdByUid: uidA }
            }
          },
          taskAccess: {
            [appA]: { 'rw-a': true },
            [appB]: { 'rw-assigned-b': true, 'rw-b': true, 'rw-a': true }
          },
          dailyTasks: {
            'rw-a': {
              'daily-a': { id: 'daily-a', parentTaskId: 'rw-a', title: 'A daily', assignedTo: appA, date: '2026-10-03', notes: '', priority: 'P2', createdBy: appA, createdByUid: uidA, createdAt: '2026-10-02T10:00:00.000Z', status: 'Not Started', archived: false, archivedAt: null, archivedByUid: null },
              'daily-assigned-b': { id: 'daily-assigned-b', parentTaskId: 'rw-a', title: 'B daily', assignedTo: appB, date: '2026-10-03', notes: '', priority: 'P2', createdBy: appA, createdByUid: uidA, createdAt: '2026-10-02T10:00:00.000Z', status: 'Not Started', archived: false, archivedAt: null, archivedByUid: null }
            },
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
  const unknown = env.authenticatedContext('unknown-auth-user', { email: 'unknown@example.test' }).database();
  const unverifiedAdminEmail = env.authenticatedContext('unverified-admin-email-auth', { email: systemAdminEmail, email_verified: false }).database();
  const wrongUidVerifiedAdminEmail = env.authenticatedContext('wrong-uid-verified-admin-auth', { email: systemAdminEmail, email_verified: true }).database();
  const unauthenticated = env.unauthenticatedContext().database();
  const migrationEmployee = env.authenticatedContext(migrationUid, { email: 'scoped-migration@example.test' }).database();
  const admin = env.authenticatedContext(trustedSystemAdminUid, { email: systemAdminEmail, email_verified: true }).database();

  const scopedPlan = buildScopedWorkspaceMigration({
    users: [
      { id: migrationAppId, appUserId: migrationAppId, authUid: migrationUid, email: 'scoped-migration@example.test', status: 'active', name: 'Migration Employee' },
      { id: appInactive, appUserId: appInactive, authUid: uidInactive, email: 'inactive@example.test', status: 'exited', name: 'Inactive' }
    ],
    departments: [],
    projects: [{ id: 'migration-project-a', name: 'Scoped migration test', projectLead: migrationAppId, team: [migrationAppId, appInactive] }],
    tasks: [{ id: 'migration-task-a', project: 'migration-project-a', owner: migrationAppId, createdByUid: migrationUid, title: 'Scoped task' }],
    approvals: [], comments: [], activity: [], calendarEvents: []
  });
  assert.equal(scopedPlan.ready, true, scopedPlan.blockers.join('; '));
  await expectAllowed('System Admin', 'executionHub scoped migration multi-path update', 'write validated current-scope plan', update(ref(admin), scopedPlan.updates));
  await expectAllowed('Migrated employee', 'executionHub/shared/projects/migration-project-a', 'read project after scoped migration', get(ref(migrationEmployee, 'executionHub/shared/projects/migration-project-a')));
  await expectAllowed('Migrated employee', 'executionHub/shared/tasks/migration-task-a', 'read assigned task after scoped migration', get(ref(migrationEmployee, 'executionHub/shared/tasks/migration-task-a')));
  await expectDenied('Inactive employee', 'executionHub/shared/projects/migration-project-a', 'remain excluded from migrated project', get(ref(inactive, 'executionHub/shared/projects/migration-project-a')));

  const transitionTask = { id: 'rw-status-model', status: 'Not Started' };
  const statusHistory = [];
  for (const [status, activityVerb] of [
    ['In Progress', 'changed status from Not Started to In Progress'],
    ['Ready for Review', 'changed status from In Progress to Ready for Review'],
    ['Completed', 'completed this task'],
    ['In Progress', 'reopened this task'],
    ['Completed', 'completed this task']
  ]) {
    const transition = createRegularWorkTaskStatusChange(transitionTask, status, uidA, `2026-10-03T10:00:0${statusHistory.length}.000Z`);
    assert.ok(transition);
    Object.assign(transitionTask, transition.updates);
    statusHistory.push(transition.activityVerb);
    assert.equal(transition.activityVerb, activityVerb);
  }
  assert.equal(transitionTask.status, 'Completed');
  assert.equal(transitionTask.completedByUid, uidA);
  assert.match(transitionTask.completedAt, /^2026-10-03T10:00:04/);
  assert.equal(createRegularWorkTaskStatusChange(transitionTask, 'Completed', uidA, '2026-10-03T11:00:05.000Z'), null, 'repeated completion must not create a second transition/activity');
  const reopenTransition = createRegularWorkTaskStatusChange(transitionTask, 'In Progress', uidA, '2026-10-03T10:00:05.000Z');
  assert.equal(reopenTransition.updates.completedAt, null);
  assert.equal(reopenTransition.updates.completedByUid, null);
  record('Regular Work task status', 'complete/reopen transition metadata and activity wording', statusHistory.length, 'PASS', 'PASS');

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
  await expectDenied('Employee A', 'executionHub/users', 'read all employee profiles', get(ref(a, 'executionHub/users')));

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
  await expectAllowed('System Admin', `executionHub/users/${trustedSystemAdminUid}`, 'read trusted Admin profile', get(ref(admin, `executionHub/users/${trustedSystemAdminUid}`)));
  await expectAllowed('System Admin', 'executionHub/users', 'read all employee profiles for workspace bootstrap', get(ref(admin, 'executionHub/users')));
  const adminProfileProbeUid = 'admin-profile-creation-probe';
  await expectAllowed('System Admin', `executionHub/users/${adminProfileProbeUid}`, 'create employee profile', set(ref(admin, `executionHub/users/${adminProfileProbeUid}`), profile(adminProfileProbeUid, 'admin-profile-probe', 'admin-profile-probe@example.test')));
  await env.withSecurityRulesDisabled(context => set(ref(context.database(), `executionHub/users/${adminProfileProbeUid}`), null));
  const adminDirectorySnapshot = await get(ref(admin, 'executionHub/employeeDirectory/safe'));
  await expectAllowed('System Admin', 'executionHub/employeeDirectory/safe', 'write employee directory', set(ref(admin, 'executionHub/employeeDirectory/safe'), adminDirectorySnapshot.val()));
  await expectAllowed('System Admin', 'executionHub/userViews/admin-view-probe', 'write userViews grant', set(ref(admin, 'executionHub/userViews/admin-view-probe'), { projectAccess: { 'project-a': true } }));
  await env.withSecurityRulesDisabled(context => set(ref(context.database(), 'executionHub/userViews/admin-view-probe'), null));
  await expectAllowed('System Admin', 'executionHub/regularWork/taskAccess/empB/rw-b', 'read taskAccess grants', get(ref(admin, 'executionHub/regularWork/taskAccess/empB/rw-b')));
  await expectAllowed('System Admin', 'executionHub/regularWork/taskAccess/empB/rw-b', 'write taskAccess grant', set(ref(admin, 'executionHub/regularWork/taskAccess/empB/rw-b'), true));
  await expectAllowed('System Admin', 'executionHub/migrationBackups', 'read backup index to resume workspace recovery', get(ref(admin, 'executionHub/migrationBackups')));
  await expectDenied('Employee A', 'executionHub/migrationBackups', 'read Admin-only recovery backups', get(ref(a, 'executionHub/migrationBackups')));
  await expectDenied('Unauthenticated', 'executionHub/shared/projects/project-a', 'read protected project', get(ref(unauthenticated, 'executionHub/shared/projects/project-a')));
  await expectDenied('Unauthenticated', 'executionHub/regularWork/dailyTasks/rw-a', 'read Daily Tasks', get(ref(unauthenticated, 'executionHub/regularWork/dailyTasks/rw-a')));
  await expectDenied('Unknown Auth user', 'executionHub/shared/projects/project-a', 'read project without employee profile', get(ref(unknown, 'executionHub/shared/projects/project-a')));
  await expectDenied('Unknown Auth user', 'executionHub/shared/tasks/task-a', 'read task without employee profile', get(ref(unknown, 'executionHub/shared/tasks/task-a')));
  await expectDenied('Unverified Auth account claiming Admin email', 'executionHub/shared/projects/project-a', 'must not gain Admin project access before verified identity', get(ref(unverifiedAdminEmail, 'executionHub/shared/projects/project-a')));
  await expectDenied('Unknown Auth user', 'executionHub/users/unknown-auth-user', 'self-provision an application profile', set(ref(unknown, 'executionHub/users/unknown-auth-user'), profile('unknown-auth-user', 'unknown-app-id', 'unknown@example.test')));
  await expectDenied('Unknown Auth user', 'executionHub/userViews/unknown-auth-user', 'create access grants without an employee profile', set(ref(unknown, 'executionHub/userViews/unknown-auth-user'), { projectAccess: { 'project-a': true } }));
  await expectDenied('Unknown Auth user', 'executionHub/regularWork/taskAccess/empA/rw-a', 'grant task access without an employee profile', set(ref(unknown, 'executionHub/regularWork/taskAccess/empA/rw-a'), true));
  await expectDenied('Unknown Auth user', 'executionHub/employeeDirectory/safe', 'read employee directory without an employee profile', get(ref(unknown, 'executionHub/employeeDirectory/safe')));
  await expectDenied('Unknown Auth user', 'executionHub/regularWork/tasks/rw-a', 'read Regular Work without an employee profile', get(ref(unknown, 'executionHub/regularWork/tasks/rw-a')));
  await expectDenied('Unknown Auth user', 'executionHub/regularWork/dailyTasks/rw-a', 'read Daily Tasks without an employee profile', get(ref(unknown, 'executionHub/regularWork/dailyTasks/rw-a')));
  const adminEmailAttackers = [
    { label: 'Unverified Admin-email attacker', uid: 'unverified-admin-email-auth', db: unverifiedAdminEmail },
    { label: 'Wrong-UID verified Admin-email attacker', uid: 'wrong-uid-verified-admin-auth', db: wrongUidVerifiedAdminEmail }
  ];
  const attackerCleanupPaths = [];
  for (const attacker of adminEmailAttackers) {
    const suffix = attacker.uid.replace(/[^a-z0-9-]/gi, '-');
    const paths = {
      profile: `executionHub/users/${attacker.uid}`,
      userViews: `executionHub/userViews/${attacker.uid}`,
      taskAccess: `executionHub/regularWork/taskAccess/${appA}/attacker-${suffix}`,
      directoryProbe: 'executionHub/employeeDirectory/safe/attackerProbe',
      project: `executionHub/shared/projects/attacker-${suffix}`,
      task: `executionHub/shared/tasks/attacker-${suffix}`,
      regularTask: `executionHub/regularWork/tasks/attacker-${suffix}`,
      dailyTask: `executionHub/regularWork/dailyTasks/rw-a/attacker-${suffix}`,
      backup: `executionHub/migrationBackups/attacker-${suffix}`,
      migration: 'executionHub/system/migrations/sparkMigrationV1',
      management: 'executionHub/admin/employeeManagement/attackerProbe',
      private: 'executionHub/admin/private/attackerProbe'
    };
    attackerCleanupPaths.push(...Object.values(paths));
    await expectDenied(attacker.label, paths.profile, 'create an employee profile using the Admin email', set(ref(attacker.db, paths.profile), profile(attacker.uid, `attacker-${suffix}`, systemAdminEmail)));
    await expectDenied(attacker.label, 'executionHub/employeeDirectory/safe', 'read employee directory', get(ref(attacker.db, 'executionHub/employeeDirectory/safe')));
    await expectDenied(attacker.label, paths.directoryProbe, 'write employee directory', set(ref(attacker.db, paths.directoryProbe), { attacker: true }));
    await expectDenied(attacker.label, `executionHub/userViews/${uidA}`, 'read another userViews record', get(ref(attacker.db, `executionHub/userViews/${uidA}`)));
    await expectDenied(attacker.label, paths.userViews, 'create userViews grants', set(ref(attacker.db, paths.userViews), { projectAccess: { 'project-a': true } }));
    await expectDenied(attacker.label, `executionHub/regularWork/taskAccess/${appB}/rw-b`, 'read taskAccess grants', get(ref(attacker.db, `executionHub/regularWork/taskAccess/${appB}/rw-b`)));
    await expectDenied(attacker.label, paths.taskAccess, 'create taskAccess grants', set(ref(attacker.db, paths.taskAccess), true));
    await expectDenied(attacker.label, 'executionHub/shared/projects/project-a', 'read shared project', get(ref(attacker.db, 'executionHub/shared/projects/project-a')));
    await expectDenied(attacker.label, paths.project, 'create shared project', set(ref(attacker.db, paths.project), { id: `attacker-${suffix}`, projectLead: 'systemAdmin' }));
    await expectDenied(attacker.label, 'executionHub/shared/tasks/task-a', 'read shared task', get(ref(attacker.db, 'executionHub/shared/tasks/task-a')));
    await expectDenied(attacker.label, paths.task, 'create shared task', set(ref(attacker.db, paths.task), { id: `attacker-${suffix}`, project: 'project-a', owner: 'systemAdmin' }));
    await expectDenied(attacker.label, 'executionHub/regularWork', 'read all Regular Work', get(ref(attacker.db, 'executionHub/regularWork')));
    await expectDenied(attacker.label, 'executionHub/regularWork/tasks/rw-a', 'read Regular Work task', get(ref(attacker.db, 'executionHub/regularWork/tasks/rw-a')));
    await expectDenied(attacker.label, paths.regularTask, 'create Regular Work task', set(ref(attacker.db, paths.regularTask), { id: `attacker-${suffix}`, owner: appA, createdByUid: attacker.uid, folderOwnerUid: attacker.uid }));
    await expectDenied(attacker.label, 'executionHub/regularWork/dailyTasks/rw-a', 'read Daily Tasks', get(ref(attacker.db, 'executionHub/regularWork/dailyTasks/rw-a')));
    await expectDenied(attacker.label, paths.dailyTask, 'create Daily Task', set(ref(attacker.db, paths.dailyTask), { id: `attacker-${suffix}`, parentTaskId: 'rw-a', title: 'attacker write' }));
    await expectDenied(attacker.label, 'executionHub/system/migrations/sparkMigrationV1', 'read migration marker', get(ref(attacker.db, paths.migration)));
    await expectDenied(attacker.label, paths.migration, 'write migration marker', set(ref(attacker.db, paths.migration), { status: 'attacker' }));
    await expectDenied(attacker.label, 'executionHub/migrationBackups', 'read migration/recovery index', get(ref(attacker.db, 'executionHub/migrationBackups')));
    await expectDenied(attacker.label, paths.backup, 'create migration/recovery backup', set(ref(attacker.db, paths.backup), { attacker: true }));
    await expectDenied(attacker.label, 'executionHub/admin/employeeManagement', 'read Admin employee management', get(ref(attacker.db, 'executionHub/admin/employeeManagement')));
    await expectDenied(attacker.label, paths.management, 'write Admin employee management', set(ref(attacker.db, paths.management), { attacker: true }));
    await expectDenied(attacker.label, 'executionHub/admin/private', 'read Admin private data', get(ref(attacker.db, 'executionHub/admin/private')));
    await expectDenied(attacker.label, paths.private, 'write Admin private data', set(ref(attacker.db, paths.private), { attacker: true }));
  }
  await env.withSecurityRulesDisabled(async context => {
    const db = context.database();
    await Promise.all([...new Set(attackerCleanupPaths)].map(path => set(ref(db, path), null)));
  });

  for (const path of [
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
  await expectAllowed('Inactive employee', `executionHub/users/${uidInactive}`, 'read own profile so app can deny inactive status explicitly', get(ref(inactive, `executionHub/users/${uidInactive}`)));
  await expectAllowed('Unknown Auth user', 'executionHub/users/unknown-auth-user', 'read own missing profile for application authorization check', get(ref(unknown, 'executionHub/users/unknown-auth-user')));

  await expectAllowed('Employee A', 'executionHub/shared/projects/project-a', 'read', get(ref(a, 'executionHub/shared/projects/project-a')));
  await expectDenied('Employee A', 'executionHub/shared/projects/project-b', 'read', get(ref(a, 'executionHub/shared/projects/project-b')));
  await expectAllowed('Employee A', 'executionHub/shared/tasks/task-a', 'read', get(ref(a, 'executionHub/shared/tasks/task-a')));
  await expectDenied('Employee A', 'executionHub/shared/tasks/task-b', 'read', get(ref(a, 'executionHub/shared/tasks/task-b')));

  const projectPath = 'executionHub/shared/projects/project-a';
  const originalProject = (await get(ref(a, projectPath))).val();
  await expectAllowed('Employee A (Project Lead)', `${projectPath}/name`, 'update project content', set(ref(a, `${projectPath}/name`), 'Project A updated'));
  await expectAllowed('Employee A (Project Lead)', `${projectPath}/team`, 'manage explicitly authorized team access', set(ref(a, `${projectPath}/team`), [appA, appB]));
  await expectDenied('Employee A (Project Lead)', `${projectPath}/projectLead`, 'change project lead authority', set(ref(a, `${projectPath}/projectLead`), appB));
  await expectDenied('Employee A (Project Lead)', `${projectPath}/id`, 'change immutable project ID', set(ref(a, `${projectPath}/id`), 'project-b'));
  await expectDenied('Employee A (Project Lead)', `${projectPath}/owner`, 'change project ownership', set(ref(a, `${projectPath}/owner`), appB));
  await expectDenied('Employee A (Project Lead)', `${projectPath}/createdBy`, 'change project creation attribution', set(ref(a, `${projectPath}/createdBy`), uidB));
  for (const [field, value] of Object.entries({
    ownerUid: uidB, createdByUid: uidB, permissions: { admin: true }, access: { appB: true },
    accessRole: 'admin', accessUserIds: [appB], teamAccess: { appB: true }, allowedUsers: [appB]
  })) await expectDenied('Employee A (Project Lead)', `${projectPath}/${field}`, `cannot add or change protected ${field}`, set(ref(a, `${projectPath}/${field}`), value));
  await expectAllowed('System Admin', `${projectPath}/projectLead`, 'admin change project lead', set(ref(admin, `${projectPath}/projectLead`), appB));
  await env.withSecurityRulesDisabled(context => set(ref(context.database(), projectPath), originalProject));

  await expectAllowed('Employee A (folder owner)', 'executionHub/regularWork/owners/' + uidA, 'read', get(ref(a, `executionHub/regularWork/owners/${uidA}`)));
  await expectDenied('Employee B (unrelated folder)', 'executionHub/regularWork/owners/' + uidA, 'read', get(ref(b, `executionHub/regularWork/owners/${uidA}`)));
  await expectAllowed('Employee A (task owner)', 'executionHub/regularWork/tasks/rw-a', 'read', get(ref(a, 'executionHub/regularWork/tasks/rw-a')));
  await expectAllowed('Employee B (assigned task)', 'executionHub/regularWork/tasks/rw-assigned-b', 'read', get(ref(b, 'executionHub/regularWork/tasks/rw-assigned-b')));
  await expectDenied('Employee A (unrelated task)', 'executionHub/regularWork/tasks/rw-b', 'read', get(ref(a, 'executionHub/regularWork/tasks/rw-b')));
  await expectAllowed('Employee A', 'executionHub/regularWork/dailyTasks/rw-a', 'read', get(ref(a, 'executionHub/regularWork/dailyTasks/rw-a')));
  await expectDenied('Employee A', 'executionHub/regularWork/dailyTasks/rw-b', 'read', get(ref(a, 'executionHub/regularWork/dailyTasks/rw-b')));
  const newDailyTask = {
    id: 'daily-created-a', parentTaskId: 'rw-a', title: 'Daily task created by owner', date: '2026-10-04',
    assignedTo: appA, status: 'Not Started', priority: 'P2', notes: '', createdBy: appA,
    createdByUid: uidA, createdAt: '2026-10-04T18:00:00.000Z', completedAt: null,
    archived: false, archivedAt: null, archivedByUid: null
  };
  await expectAllowed('Employee A (Regular Work owner)', 'executionHub/regularWork/dailyTasks/rw-a/daily-created-a', 'create full Daily Task record', set(ref(a, 'executionHub/regularWork/dailyTasks/rw-a/daily-created-a'), newDailyTask));
  await expectDenied('Employee B (unrelated Regular Work task)', 'executionHub/regularWork/dailyTasks/rw-a/daily-created-b', 'create Daily Task on unrelated parent', set(ref(b, 'executionHub/regularWork/dailyTasks/rw-a/daily-created-b'), { ...newDailyTask, id: 'daily-created-b', createdByUid: uidB }));

  const ownerTaskPath = 'executionHub/regularWork/tasks/rw-a';
  let ownerTaskRecord = { ...(await get(ref(a, ownerTaskPath))).val(), status: 'Not Started' };
  await expectAllowed('Employee A (Regular Work owner)', ownerTaskPath, 'initialize parent status for Daily Task independence test', set(ref(a, ownerTaskPath), ownerTaskRecord));
  const dailyRecord = (await get(ref(a, 'executionHub/regularWork/dailyTasks/rw-a/daily-a'))).val();
  await expectAllowed('Employee A (Regular Work owner)', 'executionHub/regularWork/dailyTasks/rw-a/daily-a', 'complete child Daily Task', set(ref(a, 'executionHub/regularWork/dailyTasks/rw-a/daily-a'), { ...dailyRecord, status: 'Completed', completedAt: '2026-10-03T10:59:00.000Z' }));
  assert.equal((await get(ref(a, ownerTaskPath))).val().status, 'Not Started', 'completing a child Daily Task must not complete its parent');
  const parentTransitions = ['In Progress', 'Ready for Review', 'Completed', 'In Progress', 'Completed'];
  for (const [index, status] of parentTransitions.entries()) {
    const transition = createRegularWorkTaskStatusChange(ownerTaskRecord, status, uidA, `2026-10-03T11:00:0${index}.000Z`);
    if (!transition) continue;
    ownerTaskRecord = { ...ownerTaskRecord, ...transition.updates };
    await expectAllowed('Employee A (Regular Work owner)', ownerTaskPath, `set parent status ${status}`, set(ref(a, ownerTaskPath), ownerTaskRecord));
    const eventId = `status-rwa-${index}`;
    await expectAllowed('Employee A (Regular Work owner)', `executionHub/regularWork/activity/rw-a/${eventId}`, `write ${transition.activityVerb} activity`, set(ref(a, `executionHub/regularWork/activity/rw-a/${eventId}`), {
      id: eventId, task: 'rw-a', user: appA, time: `2026-10-03T11:00:0${index}.000Z`, type: 'Status', text: `${appA} ${transition.activityVerb}`,
      authorUid: uidA, actorUid: uidA, createdByUid: uidA, contextType: 'regular_work'
    }));
  }
  const ownerTaskReadBack = (await get(ref(a, ownerTaskPath))).val();
  assert.equal(ownerTaskReadBack.status, 'Completed');
  assert.equal(ownerTaskReadBack.completedByUid, uidA);
  assert.equal(ownerTaskReadBack.completedAt, '2026-10-03T11:00:04.000Z');
  const reopenedActivityReadBack = (await get(ref(a, 'executionHub/regularWork/activity/rw-a/status-rwa-3'))).val();
  const completedActivityReadBack = (await get(ref(a, 'executionHub/regularWork/activity/rw-a/status-rwa-4'))).val();
  assert.equal(reopenedActivityReadBack.text, `${appA} reopened this task`);
  assert.equal(completedActivityReadBack.text, `${appA} completed this task`);
  record('Employee A (Regular Work owner)', ownerTaskPath, 'completion/reopen/final completion read-back', 'Completed + metadata', `${ownerTaskReadBack.status} + metadata`);

  const assignedTaskPath = 'executionHub/regularWork/tasks/rw-assigned-b';
  const assignedTaskRecord = (await get(ref(b, assignedTaskPath))).val();
  const assignedTransition = createRegularWorkTaskStatusChange(assignedTaskRecord, 'Completed', uidB, '2026-10-03T11:10:00.000Z');
  await expectAllowed('Employee B (assigned Regular Work task)', assignedTaskPath, 'complete assigned parent task', set(ref(b, assignedTaskPath), { ...assignedTaskRecord, ...assignedTransition.updates }));
  await expectAllowed('Employee B (assigned Regular Work task)', 'executionHub/regularWork/activity/rw-assigned-b/status-assigned-complete', 'write assigned completion activity', set(ref(b, 'executionHub/regularWork/activity/rw-assigned-b/status-assigned-complete'), {
    id: 'status-assigned-complete', task: 'rw-assigned-b', user: appB, time: '2026-10-03T11:10:00.000Z', type: 'Status', text: `${appB} completed this task`,
    authorUid: uidB, actorUid: uidB, createdByUid: uidB, contextType: 'regular_work'
  }));
  assert.equal((await get(ref(b, assignedTaskPath))).val().completedByUid, uidB);
  const unrelatedTaskRecord = (await env.withSecurityRulesDisabled(async context => (await get(ref(context.database(), 'executionHub/regularWork/tasks/rw-b'))).val()));
  await expectDenied('Employee A (unrelated Regular Work task)', 'executionHub/regularWork/tasks/rw-b', 'complete unrelated parent task', set(ref(a, 'executionHub/regularWork/tasks/rw-b'), { ...unrelatedTaskRecord, status: 'Completed', completedAt: '2026-10-03T11:20:00.000Z', completedByUid: uidA }));
  await expectDenied('Employee A (unrelated Regular Work task)', 'executionHub/regularWork/activity/rw-b/status-unrelated-complete', 'write unrelated completion activity', set(ref(a, 'executionHub/regularWork/activity/rw-b/status-unrelated-complete'), {
    id: 'status-unrelated-complete', task: 'rw-b', user: appA, time: '2026-10-03T11:20:00.000Z', type: 'Status', text: `${appA} completed this task`,
    authorUid: uidA, actorUid: uidA, createdByUid: uidA, contextType: 'regular_work'
  }));
  const adminTaskPath = 'executionHub/regularWork/tasks/rw-b';
  const adminTaskRecord = (await get(ref(admin, adminTaskPath))).val();
  await expectAllowed('System Admin (Regular Work)', adminTaskPath, 'complete Regular Work parent task', set(ref(admin, adminTaskPath), { ...adminTaskRecord, status: 'Completed', completedAt: '2026-10-03T11:30:00.000Z', completedByUid: trustedSystemAdminUid }));
  await expectAllowed('System Admin (Regular Work)', 'executionHub/regularWork/activity/rw-b/status-admin-complete', 'write parent completion activity', set(ref(admin, 'executionHub/regularWork/activity/rw-b/status-admin-complete'), {
    id: 'status-admin-complete', task: 'rw-b', user: 'systemAdmin', time: '2026-10-03T11:30:00.000Z', type: 'Status', text: 'System Admin completed this task',
    authorUid: trustedSystemAdminUid, actorUid: trustedSystemAdminUid, createdByUid: trustedSystemAdminUid, contextType: 'regular_work'
  }));
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
  const dailyPath = 'executionHub/regularWork/dailyTasks/rw-a/daily-assigned-b';
  await expectAllowed('Employee B (Daily Task assignee)', `${dailyPath}/status`, 'update own Daily Task status', set(ref(b, `${dailyPath}/status`), 'In Progress'));
  await expectAllowed('Employee B (Daily Task assignee)', `${dailyPath}/completedAt`, 'update permitted execution timestamp', set(ref(b, `${dailyPath}/completedAt`), '2026-10-03T10:00:00.000Z'));
  await expectAllowed('Employee B (Daily Task assignee)', `${dailyPath}/completedByUid`, 'set own completion attribution', set(ref(b, `${dailyPath}/completedByUid`), uidB));
  await expectAllowed('Employee B (Daily Task assignee)', `${dailyPath}/updatedAt`, 'set permitted update timestamp', set(ref(b, `${dailyPath}/updatedAt`), '2026-10-03T10:01:00.000Z'));
  for (const [field, value] of Object.entries({
    id: 'daily-forged-id', parentTaskId: 'rw-b', assignedTo: appA, title: '<img src=x onerror=alert(1)>',
    date: '2026-12-31', priority: 'P0', notes: 'changed',
    createdBy: appB, createdByUid: uidB, createdAt: '2099-01-01T00:00:00.000Z', archived: true,
    archivedAt: '2099-01-01T00:00:00.000Z', archivedByUid: uidA
  })) {
    const original = (await get(ref(b, dailyPath))).val();
    await expectDenied('Employee B (Daily Task assignee)', `${dailyPath}/${field}`, `cannot change protected ${field}`, set(ref(b, `${dailyPath}/${field}`), value));
    assert.deepEqual((await get(ref(b, dailyPath))).val(), original, `denied Daily Task mutation must not persist (${field})`);
  }
  await expectAllowed('System Admin (Daily Task)', `${dailyPath}/title`, 'admin manage Daily Task content', set(ref(admin, `${dailyPath}/title`), 'Admin updated title'));

  const sharedActivity = 'executionHub/shared/activity/task-a/activity-existing-a';
  const rwActivity = 'executionHub/regularWork/activity/rw-a/activity-existing-rwa';
  const ownerActivity = `executionHub/regularWork/ownerActivity/${uidA}/owner-activity-existing-a`;
  for (const [actor, db] of [['Employee A', a], ['System Admin', admin]]) {
    for (const path of [sharedActivity, rwActivity, ownerActivity]) {
      const oldRecord = (await get(ref(db, path))).val();
      await expectDenied(actor, path, 'modify existing immutable activity', set(ref(db, path), { ...oldRecord, text: 'rewritten history' }));
      await expectDenied(actor, path, 'delete existing immutable activity', set(ref(db, path), null));
    }
  }
  await expectAllowed('System Admin', 'executionHub/shared/activity/task-a/activity-admin-new', 'create shared activity', set(ref(admin, 'executionHub/shared/activity/task-a/activity-admin-new'), { id: 'activity-admin-new', task: 'task-a', user: 'systemAdmin', text: 'Admin event' }));
  await expectAllowed('Employee A', 'executionHub/shared/activity/task-a/activity-employee-new', 'create authorized shared activity', set(ref(a, 'executionHub/shared/activity/task-a/activity-employee-new'), { id: 'activity-employee-new', task: 'task-a', user: appA, text: 'Employee event' }));
  await expectAllowed('System Admin', 'executionHub/regularWork/activity/rw-a/activity-admin-new', 'create Regular Work activity', set(ref(admin, 'executionHub/regularWork/activity/rw-a/activity-admin-new'), { id: 'activity-admin-new', task: 'rw-a', user: 'systemAdmin', text: 'Admin event', createdByUid: trustedSystemAdminUid }));

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
  runDailyWorkModelChecks();
  runScopedMigrationPlannerChecks();
  runApplicationAuthorizationChecks();
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
