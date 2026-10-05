import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const project = 'project-hub-emp';
const adminEmail = 'ashish@enchantingmp.in';
const paths = [
  'executionHub/workspace/employeeVisibleData/state',
  'executionHub/workspace/employeeVisibleData/directory',
  'executionHub/workspaces/default/state',
  'executionHub/admin/employeeManagement',
  'executionHub/admin/private',
  'executionHub/users',
  'executionHub/shared/projects',
  'executionHub/shared/tasks',
  'executionHub/shared/approvals',
  'executionHub/shared/comments',
  'executionHub/shared/activity',
  'executionHub/shared/calendar',
  'executionHub/employeeDirectory/safe',
  'executionHub/userViews',
  'executionHub/userWork',
  'executionHub/private',
  'executionHub/teamViews',
  'executionHub/departmentViews',
  'executionHub/regularWork',
  'executionHub/regularWork/dailyTasks',
  'executionHub/regularWork/calendarEvents',
  'executionHub/migrationBackups'
];

function readPath(path) {
  const command = `firebase database:get /${path} --project ${project}`;
  const raw = execFileSync('cmd.exe', ['/d', '/s', '/c', command], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    windowsHide: true
  }).trim();
  return raw ? JSON.parse(raw) : null;
}
function entries(value) {
  if (Array.isArray(value)) return value.map((record, index) => [String(record?.id ?? index), record]);
  if (!value || typeof value !== 'object') return [];
  return Object.entries(value).map(([key, record]) => [String(record?.id ?? key), record]);
}
function count(value) { return entries(value).length; }
function groupedCount(value) { return entries(value).reduce((sum, [, group]) => sum + count(group), 0); }
function strings(value) {
  if (Array.isArray(value)) return value.filter(item => typeof item === 'string' && item.length > 0);
  if (value && typeof value === 'object') return Object.keys(value).filter(key => value[key] === true);
  return [];
}
function add(map, key, value) {
  if (!map.has(key)) map.set(key, new Set());
  map.get(key).add(String(value));
}
function safeName(record, profile) {
  return String(record?.displayName || record?.name || profile?.name || record?.id || record?.appUserId || 'Unmapped employee');
}

const db = Object.fromEntries(paths.map(path => [path, readPath(path)]));
const state = db['executionHub/workspace/employeeVisibleData/state'] || {};
const management = db['executionHub/admin/employeeManagement'] || {};
const adminPrivate = db['executionHub/admin/private'] || {};
const legacyDirectory = db['executionHub/workspace/employeeVisibleData/directory'] || {};
const pluralLegacy = db['executionHub/workspaces/default/state'] || {};
const profiles = entries(db['executionHub/users']).map(([uid, profile]) => ({ uid, ...profile }));
const profilesByUid = new Map(profiles.map(profile => [profile.uid, profile]));
const profilesByAppId = new Map();
for (const profile of profiles) {
  if (!profile.appUserId) continue;
  if (!profilesByAppId.has(profile.appUserId)) profilesByAppId.set(profile.appUserId, []);
  profilesByAppId.get(profile.appUserId).push(profile);
}

const employeeRecords = new Map();
for (const [key, record] of [...entries(management.users), ...entries(legacyDirectory.users)]) {
  const appUserId = String(record?.appUserId || record?.id || key || '');
  if (!appUserId || appUserId === 'u1' || String(record?.email || '').toLowerCase() === adminEmail) continue;
  if (!employeeRecords.has(appUserId)) employeeRecords.set(appUserId, record);
}
const employeeMappings = [];
const appIdToUid = new Map();
const uidToAppId = new Map();
const missingUidMappings = [];
const ambiguousUidMappings = [];
for (const [appUserId, record] of employeeRecords) {
  const profileRefs = new Set([record?.authUid, record?.firebaseUid, record?.uid].filter(Boolean).map(String));
  let matched = [...profileRefs].map(uid => profilesByUid.get(uid)).filter(Boolean);
  if (matched.length === 0) matched = profilesByAppId.get(appUserId) || [];
  const unique = [...new Map(matched.map(profile => [profile.uid, profile])).values()];
  if (unique.length !== 1) {
    (unique.length ? ambiguousUidMappings : missingUidMappings).push({ appUserId, name: safeName(record) });
    continue;
  }
  const profile = unique[0];
  if (appIdToUid.has(appUserId) && appIdToUid.get(appUserId) !== profile.uid) {
    ambiguousUidMappings.push({ appUserId, name: safeName(record) });
    continue;
  }
  if (uidToAppId.has(profile.uid) && uidToAppId.get(profile.uid) !== appUserId) {
    ambiguousUidMappings.push({ appUserId, name: safeName(record) });
    continue;
  }
  appIdToUid.set(appUserId, profile.uid);
  uidToAppId.set(profile.uid, appUserId);
  employeeMappings.push({ appUserId, uid: profile.uid, record, profile, status: profile.status || record.status || 'unknown' });
}

const safeDirectoryFields = ['appUserId', 'displayName', 'designation', 'departmentId', 'departmentName', 'initials', 'active'];
const safeDirectoryPlanned = employeeMappings.map(({ appUserId, record, profile, status }) => ({
  appUserId,
  displayName: String(profile?.name || record?.displayName || record?.name || 'Employee'),
  designation: String(profile?.designation || record?.designation || record?.role || 'Team Member'),
  departmentId: String(profile?.departmentId || record?.departmentId || ''),
  departmentName: String(profile?.department || record?.department || record?.dept || 'Unassigned'),
  initials: String(record?.initials || String(profile?.name || record?.name || 'Employee').trim().split(/\s+/).slice(0, 2).map(part => part[0]?.toUpperCase() || '').join('')),
  active: status === 'active'
}));
const safeDepartmentPlanned = entries(management.departments).map(([id, department]) => ({
  id: String(department?.id || id),
  name: String(department?.name || 'Unassigned')
}));
const forbiddenSafeFields = new Set(['email', 'uid', 'authuid', 'firebaseuid', 'salary', 'attendance', 'leave', 'password', 'management', 'mobile', 'phone']);
const safeDirectoryViolations = safeDirectoryPlanned.flatMap(record => Object.keys(record).filter(key => forbiddenSafeFields.has(key.toLowerCase()) || !safeDirectoryFields.includes(key)));

const grants = new Map(employeeMappings.map(({ uid }) => [uid, {
  projectAccess: new Set(), taskAccess: new Set(), projectTaskAccess: new Set(),
  approvalAccess: new Set(), calendarAccess: new Set(), teamAccess: new Set(), departmentAccess: new Set()
}]));
const missingProjectMembers = new Set();
const missingTaskAssignees = new Set();
const missingApprovalUsers = new Set();
const missingPlannerUsers = new Set();
const duplicateIds = [];
const targetConflicts = [];
function uidForAppId(value, missingSet) {
  if (!value) return null;
  if (String(value) === 'u1') return null;
  const uid = appIdToUid.get(String(value));
  if (!uid) missingSet.add(String(value));
  if (!uid) return null;
  const mapping = employeeMappings.find(item => item.uid === uid);
  return mapping?.status === 'active' ? uid : null;
}
function directUid(value, missingSet) {
  if (!value) return null;
  const uid = String(value);
  if (uid === 'u1') return null;
  if (profilesByUid.has(uid) && grants.has(uid)) return uid;
  return uidForAppId(value, missingSet);
}
function recordsWithIds(value, sourceLabel) {
  const rows = entries(value);
  const seen = new Set();
  return rows.map(([key, record]) => {
    const id = String(record?.id ?? key);
    if (seen.has(id)) duplicateIds.push(`${sourceLabel}:${id}`);
    seen.add(id);
    return { id, record: record || {} };
  });
}

const projects = recordsWithIds(state.projects, 'projects');
const tasksAll = recordsWithIds(state.tasks, 'tasks');
const projectTasks = tasksAll.filter(({ record }) => record.contextType !== 'regular_work');
const approvals = recordsWithIds(state.approvals, 'approvals');
const comments = recordsWithIds(state.comments, 'comments');
const activity = recordsWithIds(state.activity, 'activity');
const events = recordsWithIds(state.calendarEvents, 'calendarEvents');
const rw = db['executionHub/regularWork'] || {};
const rwFolders = entries(rw.owners).flatMap(([, owner]) => entries(owner?.folders));
const rwCategories = entries(rw.owners).flatMap(([, owner]) => entries(owner?.categories));
const rwTasks = recordsWithIds(rw.tasks, 'regularWork.tasks');
const dailyTasks = groupedCount(db['executionHub/regularWork/dailyTasks']);
const projectById = new Map(projects.map(project => [project.id, project.record]));
const taskById = new Map(projectTasks.map(task => [task.id, task.record]));
const projectUids = new Map();

for (const { id, record } of projects) {
  const memberIds = new Set([
    ...strings(record.team),
    ...[record.projectLead, record.owner].filter(Boolean).map(String)
  ]);
  const uids = new Set();
  for (const memberId of memberIds) {
    const uid = uidForAppId(memberId, missingProjectMembers);
    if (uid) {
      uids.add(uid);
      grants.get(uid).projectAccess.add(id);
      grants.get(uid).teamAccess.add(id);
    }
  }
  projectUids.set(id, uids);
}

for (const { id, record } of projectTasks) {
  const taskUids = new Set(projectUids.get(String(record.project)) || []);
  for (const [field, missingSet] of [['owner', missingTaskAssignees], ['assignee', missingTaskAssignees], ['reviewer', missingTaskAssignees], ['createdBy', missingTaskAssignees]]) {
    const uid = uidForAppId(record[field], missingSet);
    if (uid) taskUids.add(uid);
  }
  const creatorUid = directUid(record.createdByUid, missingTaskAssignees);
  if (creatorUid) taskUids.add(creatorUid);
  for (const uid of taskUids) {
    grants.get(uid).projectTaskAccess.add(id);
    if ([record.owner, record.assignee, record.reviewer, record.createdBy].filter(Boolean).some(appId => appIdToUid.get(String(appId)) === uid) || creatorUid === uid) grants.get(uid).taskAccess.add(id);
  }
}

for (const { id, record } of approvals) {
  const users = new Set();
  for (const appId of [record.requestedBy, ...strings(record.approvers), ...strings(record.approverIds)]) {
    const uid = uidForAppId(appId, missingApprovalUsers);
    if (uid) users.add(uid);
  }
  const linkedTask = taskById.get(String(record.task));
  if (linkedTask) {
    for (const field of ['owner', 'reviewer', 'createdBy']) {
      const uid = uidForAppId(linkedTask[field], missingApprovalUsers);
      if (uid) users.add(uid);
    }
    const creator = directUid(linkedTask.createdByUid, missingApprovalUsers);
    if (creator) users.add(creator);
  }
  for (const uid of users) grants.get(uid).approvalAccess.add(id);
}

for (const { id, record } of events) {
  const users = new Set();
  for (const appId of [...strings(record.participants), ...strings(record.participantUserIds)]) {
    const uid = uidForAppId(appId, missingPlannerUsers);
    if (uid) users.add(uid);
  }
  const creator = directUid(record.createdByUid, missingPlannerUsers) || uidForAppId(record.createdBy, missingPlannerUsers);
  if (creator) users.add(creator);
  const relatedTask = taskById.get(String(record.task || record.regularWorkTaskId || ''));
  if (relatedTask) {
    for (const appId of [relatedTask.owner, relatedTask.reviewer, relatedTask.createdBy]) {
      const uid = uidForAppId(appId, missingPlannerUsers);
      if (uid) users.add(uid);
    }
    const taskCreator = directUid(relatedTask.createdByUid, missingPlannerUsers);
    if (taskCreator) users.add(taskCreator);
  }
  for (const uid of users) grants.get(uid).calendarAccess.add(id);
}

const departmentHeads = [];
for (const [departmentId, department] of entries(management.departments)) {
  const headUid = uidForAppId(department?.headId, missingProjectMembers);
  if (!headUid) continue;
  grants.get(headUid).departmentAccess.add(String(department.id || departmentId));
  departmentHeads.push({ uid: headUid, departmentId: String(department.id || departmentId) });
}

const backupEntries = entries(db['executionHub/migrationBackups']);
const existingBackup = backupEntries
  .map(([key, value]) => ({ key, value }))
  .sort((a, b) => String(b.value?.createdAt || b.key).localeCompare(String(a.value?.createdAt || a.key)))[0] || null;
const allTargetCounts = {
  projects: count(db['executionHub/shared/projects']),
  tasks: count(db['executionHub/shared/tasks']),
  approvals: count(db['executionHub/shared/approvals']),
  comments: groupedCount(db['executionHub/shared/comments']),
  activity: groupedCount(db['executionHub/shared/activity']),
  calendar: count(db['executionHub/shared/calendar']),
  userViews: count(db['executionHub/userViews']),
  userWork: count(db['executionHub/userWork']),
  private: count(db['executionHub/private']),
  teamViews: count(db['executionHub/teamViews']),
  departmentViews: count(db['executionHub/departmentViews']),
  regularWorkOwners: count(rw.owners),
  regularWorkTasks: count(rw.tasks),
  regularWorkTaskAccessEmployees: count(rw.taskAccess),
  regularWorkDailyTasks: dailyTasks,
  safeDirectory: count(db['executionHub/employeeDirectory/safe']?.users)
};
const sourceCounts = {
  users: count(management.users),
  authProfiles: profiles.length,
  departments: count(management.departments),
  projects: projects.length,
  projectTasks: projectTasks.length,
  regularWorkContextTasksInLegacy: tasksAll.length - projectTasks.length,
  approvals: approvals.length,
  comments: comments.length,
  activity: activity.length,
  'task-keyed project activity': activity.filter(({ record }) => record?.task && taskById.has(String(record.task)) && record.contextType !== 'regular_work').length,
  'activity without project-task target': activity.filter(({ record }) => !record?.task || !taskById.has(String(record.task)) || record.contextType === 'regular_work').length,
  calendarEvents: events.length,
  regularWorkFolders: rwFolders.length,
  regularWorkCategories: rwCategories.length,
  regularWorkTasks: rwTasks.length,
  regularWorkCalendarEvents: count(rw.calendarEvents),
  'Admin private records (not copied to employee private paths)': groupedCount(adminPrivate),
  dailyTasks,
  legacyEmployeeVisibleStateKeys: Object.keys(state).length,
  legacyPluralWorkspaceStateKeys: Object.keys(pluralLegacy).length,
  legacyDirectoryUsers: count(legacyDirectory.users),
  legacyDirectoryDepartments: count(legacyDirectory.departments),
  migrationBackups: backupEntries.length
};

const grantTotals = { project: 0, task: 0, projectTask: 0, approval: 0, calendar: 0, team: 0, department: 0 };
for (const row of grants.values()) {
  grantTotals.project += row.projectAccess.size;
  grantTotals.task += row.taskAccess.size;
  grantTotals.projectTask += row.projectTaskAccess.size;
  grantTotals.approval += row.approvalAccess.size;
  grantTotals.calendar += row.calendarAccess.size;
  grantTotals.team += row.teamAccess.size;
  grantTotals.department += row.departmentAccess.size;
}

const plans = [
  ['Projects', 'executionHub/workspace/employeeVisibleData/state/projects', 'executionHub/shared/projects/{projectId}', projects.length, allTargetCounts.projects],
  ['Project tasks', 'executionHub/workspace/employeeVisibleData/state/tasks (excluding contextType=regular_work)', 'executionHub/shared/tasks/{taskId}', projectTasks.length, allTargetCounts.tasks],
  ['Approvals', 'executionHub/workspace/employeeVisibleData/state/approvals', 'executionHub/shared/approvals/{approvalId}', approvals.length, allTargetCounts.approvals],
  ['Comments', 'executionHub/workspace/employeeVisibleData/state/comments', 'executionHub/shared/comments/{taskId}/{commentId}', comments.length, allTargetCounts.comments],
  ['Task-keyed project activity', 'executionHub/workspace/employeeVisibleData/state/activity where activity.task refers to a project task', 'executionHub/shared/activity/{taskId}/{activityId}', sourceCounts['task-keyed project activity'], allTargetCounts.activity],
  ['Planner/calendar', 'executionHub/workspace/employeeVisibleData/state/calendarEvents', 'executionHub/shared/calendar/{eventId}', events.length, allTargetCounts.calendar],
  ['Safe directory', 'executionHub/admin/employeeManagement/users + executionHub/users/{uid}', 'executionHub/employeeDirectory/safe', safeDirectoryPlanned.length, allTargetCounts.safeDirectory],
  ['User views', 'projects/tasks/approvals/calendar relationship-derived grants', 'executionHub/userViews/{uid}', employeeMappings.length, allTargetCounts.userViews],
  ['Team grants', 'legacy project team membership', 'executionHub/userViews/{uid}/teamAccess/{projectId}', grantTotals.team, allTargetCounts.userViews],
  ['Department grants', 'Admin department head relationship only', 'executionHub/userViews/{uid}/departmentAccess/{departmentId}', grantTotals.department, allTargetCounts.userViews],
  ['User work', 'employee-owned plannerRead only; no imported shared records', 'executionHub/userWork/{uid}', 0, allTargetCounts.userWork],
  ['Regular Work folders/categories/tasks', 'executionHub/regularWork/owners and /tasks', 'same existing secure Regular Work paths (no migration)', 0, rwFolders.length + rwCategories.length + rwTasks.length],
  ['Daily Tasks', 'executionHub/regularWork/dailyTasks (currently absent)', 'same existing secure Daily Task path (no migration)', 0, dailyTasks]
];
const plannedBackupKey = String(Date.now());
const plannedBackupPath = `executionHub/migrationBackups/${plannedBackupKey}`;
const mapFailures = missingUidMappings.length + ambiguousUidMappings.length;
const mappingPass = mapFailures === 0 && employeeMappings.length === employeeRecords.size;
const skipped = missingProjectMembers.size + missingTaskAssignees.size + missingApprovalUsers.size + missingPlannerUsers.size;
const unsupportedActivityCount = sourceCounts['activity without project-task target'];
const skippedRecordCount = skipped + unsupportedActivityCount;
const conflictCount = duplicateIds.length + targetConflicts.length + unsupportedActivityCount;

console.log('READ-ONLY PRODUCTION INVENTORY');
for (const [key, value] of Object.entries(sourceCounts)) console.log(`SOURCE\t${key}\t${value}`);
for (const [key, value] of Object.entries(allTargetCounts)) console.log(`TARGET\t${key}\t${value}`);
console.log(`UID-MAPPING\tprofiles=${profiles.length}\temployees=${employeeRecords.size}\tmapped=${employeeMappings.length}\tmissing=${missingUidMappings.length}\tambiguous=${ambiguousUidMappings.length}`);
console.log(`MISSING-RELATIONSHIPS\tprojectMembers=${missingProjectMembers.size}\ttaskUsers=${missingTaskAssignees.size}\tapprovalUsers=${missingApprovalUsers.size}\tplannerUsers=${missingPlannerUsers.size}`);
for (const [kind, values] of [['project-member', missingProjectMembers], ['task-user', missingTaskAssignees], ['approval-user', missingApprovalUsers], ['planner-user', missingPlannerUsers]]) for (const value of values) console.log(`MISSING-RELATIONSHIP\t${kind}\t${value}`);
console.log(`GRANTS\tprojectAccess=${grantTotals.project}\ttaskAccess=${grantTotals.task}\tprojectTaskAccess=${grantTotals.projectTask}\tapprovalAccess=${grantTotals.approval}\tcalendarAccess=${grantTotals.calendar}\tteamAccess=${grantTotals.team}\tdepartmentAccess=${grantTotals.department}`);
console.log(`SAFE-DIRECTORY\tusersPlanned=${safeDirectoryPlanned.length}\tdepartmentsPlanned=${safeDepartmentPlanned.length}\tusersCurrent=${allTargetCounts.safeDirectory}\tfields=${safeDirectoryFields.join(',')}\tviolations=${safeDirectoryViolations.length}`);
console.log(`CONFLICTS\tduplicates=${duplicateIds.length}\ttargetConflicts=${targetConflicts.length}\tactivityPathUnsupported=${unsupportedActivityCount}\tskippedReferences=${skipped}`);
console.log(`SKIPPED\tactivityWithoutProjectTaskTarget=${unsupportedActivityCount}\tunknownRelationshipReferences=${skipped}`);
console.log(`BACKUP\texistingCount=${backupEntries.length}\texistingLatestPath=${existingBackup ? `executionHub/migrationBackups/${existingBackup.key}` : 'none'}\texistingLatestCreatedAt=${existingBackup?.value?.createdAt || 'unknown'}\tplannedNewPath=${plannedBackupPath}\tcreated=false`);
console.log(`BACKUP-SOURCE-PATHS\tlegacyState,legacyDirectory,pluralLegacyState,employeeManagement,employeeProfiles,adminPrivate,sharedTargets,userViews,userWork,employeePrivate,regularWork`);
console.log('DATA PLAN');
for (const [type, source, target, planned, current] of plans) console.log(`PLAN\t${type}\t${source}\t${planned}\t${target}\tcurrentTarget=${current}`);
console.log('EMPLOYEES');
for (const mapping of employeeMappings.sort((a, b) => safeName(a.record, a.profile).localeCompare(safeName(b.record, b.profile)))) {
  const g = grants.get(mapping.uid);
  console.log(`EMPLOYEE|${safeName(mapping.record, mapping.profile)}|${mapping.uid}|${g.projectAccess.size}|${new Set([...g.taskAccess, ...g.projectTaskAccess]).size}|${g.approvalAccess.size}|${g.calendarAccess.size}|${g.teamAccess.size}|${g.departmentAccess.size}|${mapping.status}`);
}
for (const item of missingProjectMembers) console.log(`MISSING-PROJECT-MEMBER\t${item}`);
for (const item of missingUidMappings) console.log(`MISSING-UID\t${item.name}\tappUserId=${item.appUserId}`);
for (const item of ambiguousUidMappings) console.log(`AMBIGUOUS-UID\t${item.name}\tappUserId=${item.appUserId}`);
console.log(`STATUS\tuidMapping=${mappingPass ? 'PASS' : 'FAIL'}\tdryRun=${mappingPass && safeDirectoryViolations.length === 0 && skippedRecordCount === 0 && conflictCount === 0 ? 'PASS' : 'FAIL'}\tbackupReady=false\tskippedRecords=${skippedRecordCount}\tdepartmentHeads=${departmentHeads.length}`);
