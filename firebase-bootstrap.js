import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js';
import {
  browserLocalPersistence,
  createUserWithEmailAndPassword,
  deleteUser,
  getAuth,
  inMemoryPersistence,
  onAuthStateChanged,
  sendPasswordResetEmail,
  setPersistence,
  signInWithEmailAndPassword,
  signOut
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';
import { get, getDatabase, onValue, ref, runTransaction, set, update } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-database.js';

const SYSTEM_ADMIN_EMAIL = 'ashish@arpitatravels.com';
const AUTH_LOADING = 'AUTH_LOADING';
const AUTHENTICATED = 'AUTHENTICATED';
const SIGNED_OUT = 'SIGNED_OUT';
const firebaseConfig = {
  apiKey: 'AIzaSyC0gOy_JIaIpds2BdoHGv20EZiuHt8ozvM',
  authDomain: 'project-hub-emp.firebaseapp.com',
  databaseURL: 'https://project-hub-emp-default-rtdb.asia-southeast1.firebasedatabase.app',
  storageBucket: 'project-hub-emp.firebasestorage.app',
  messagingSenderId: '360406593945',
  appId: '1:360406593945:web:3ca19e86849053b4f76308',
  measurementId: 'G-DQC30WE2XH'
};

const legacyWorkspacePath = 'executionHub/workspaces/default/state';
const workspacePath = 'executionHub/workspace/employeeVisibleData/state';
const employeeDirectoryPath = 'executionHub/workspace/employeeVisibleData/directory';
const safeEmployeeDirectoryPath = 'executionHub/employeeDirectory/safe';
const sharedProjectsPath = 'executionHub/shared/projects';
const sharedTasksPath = 'executionHub/shared/tasks';
const sharedApprovalsPath = 'executionHub/shared/approvals';
const sharedCommentsPath = 'executionHub/shared/comments';
const sharedActivityPath = 'executionHub/shared/activity';
const sharedCalendarPath = 'executionHub/shared/calendar';
const userWorkPath = 'executionHub/userWork';
const userViewsPath = 'executionHub/userViews';
const teamViewsPath = 'executionHub/teamViews';
const departmentViewsPath = 'executionHub/departmentViews';
const privatePath = 'executionHub/private';
const adminManagementPath = 'executionHub/admin/employeeManagement';
const employeeProfilesPath = 'executionHub/users';
const privateDataPath = 'executionHub/admin/private';
const migrationBackupsPath = 'executionHub/migrationBackups';
const migrationMetadataPath = 'executionHub/system/migrations/sparkMigrationV1';
const migrationId = 'sparkMigrationV1';
const regularWorkPath = 'executionHub/regularWork';
const regularWorkOwnersPath = `${regularWorkPath}/owners`;
const regularWorkTasksPath = `${regularWorkPath}/tasks`;
const regularWorkTaskAccessPath = `${regularWorkPath}/taskAccess`;
const regularWorkCommentsPath = `${regularWorkPath}/comments`;
const regularWorkApprovalsPath = `${regularWorkPath}/approvals`;
const regularWorkActivityPath = `${regularWorkPath}/activity`;
const regularWorkOwnerActivityPath = `${regularWorkPath}/ownerActivity`;
const regularWorkCalendarPath = `${regularWorkPath}/calendarEvents`;
const regularWorkDailyTasksPath = `${regularWorkPath}/dailyTasks`;
const workspaceCollections = ['users', 'departments', 'projects', 'tasks', 'approvals', 'approvalHistory', 'comments', 'activity', 'calendarEvents'];
const privateCollections = ['performanceReviews', 'performanceSnapshots', 'attendance', 'attendanceRecords', 'leaves', 'leaveRecords', 'payroll', 'salary', 'salaryRecords', 'overtime', 'overtimeRecords', 'compensation', 'management', 'managementPrivate'];
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const database = getDatabase(app);
const employeeCreationApp = initializeApp(firebaseConfig, 'employeeCreation');
const employeeCreationAuth = getAuth(employeeCreationApp);
let authUser = null;
let employeeProfile = null;
let systemAdminUid = null;
let stopWatching = null;
let stopProfileWatch = null;
let stopPrivateWatching = null;
let stopManagementWatching = null;
let appLoaded = false;
let lastStateJson = null;
let lastPrivateJson = null;
let lastPrivateData = Object.fromEntries(privateCollections.map(collection => [collection, []]));
let privateDataAvailable = false;
let saveQueue = Promise.resolve();
let workspaceRecordKeys = Object.fromEntries(workspaceCollections.map(key => [key, new Map()]));
let privateRecordKeys = Object.fromEntries(privateCollections.map(key => [key, new Map()]));
let authFlow = Promise.resolve();
let handlingUid = null;
let pendingAuthMessage = '';
let legacyState = null;
let adminManagement = { users: [], departments: [] };
let adminPrivateData = {};
let recoveryContext = null;
let recoveryPending = false;
let migrationInProgress = false;
let appDataWritesEnabled = false;
let deferredSaveState = null;
let lastApplicationState = null;
let safeEmployeeDirectoryNeedsSync = false;
let safeEmployeeDirectoryReadable = false;
let employeeUserWorkReadable = true;
let lastRegularWorkSnapshot = { folders: [], categories: [], tasks: [], comments: [], approvals: [], activity: [], calendarEvents: [] };
let stopRegularWorkWatching = null;
let firebaseAuthState = AUTH_LOADING;

function setFirebaseAuthState(nextState) {
  firebaseAuthState = nextState;
  const appShell = document.querySelector('.app-shell');
  const overlay = document.getElementById('firebaseAuthOverlay');
  if (nextState === AUTH_LOADING) {
    appShell?.classList.add('firebase-app-hidden');
    if (!overlay) {
      const loadingOverlay = document.createElement('div');
      loadingOverlay.id = 'firebaseAuthOverlay';
      loadingOverlay.className = 'login-overlay open';
      loadingOverlay.innerHTML = '<div class="login-card"><div class="login-brand"><div class="brand-mark">EH</div><div><strong>Execution Hub</strong><span>Projects • Launches • Accountability</span></div></div><div class="eyebrow">PRIVATE TEAM ACCESS</div><h1>Loading your workspace...</h1><p>Please wait while your secure session is restored.</p></div>';
      document.body.appendChild(loadingOverlay);
    } else {
      overlay.innerHTML = '<div class="login-card"><div class="login-brand"><div class="brand-mark">EH</div><div><strong>Execution Hub</strong><span>Projects • Launches • Accountability</span></div></div><div class="eyebrow">PRIVATE TEAM ACCESS</div><h1>Loading your workspace...</h1><p>Please wait while your secure session is restored.</p></div>';
      overlay.classList.add('open');

    }
    return;
  }
  if (nextState === AUTHENTICATED) {
    appShell?.classList.remove('firebase-app-hidden');
    overlay?.classList.remove('open');
    return;
  }
  appShell?.classList.add('firebase-app-hidden');
  overlay?.classList.remove('open');
}

function isSystemAdmin(user = auth.currentUser) {
  return !!user?.uid && user.uid === systemAdminUid;
}

function emptyState() {
  return {
    currentUser: null, users: [], departments: [], projects: [], tasks: [], approvals: [], approvalHistory: [],
    comments: [], activity: [], calendarEvents: [], plannerRead: {}, regularWorkFolders: [], regularWorkCategories: [], ...Object.fromEntries(privateCollections.map(collection => [collection, []]))
  };
}

function cleanState(value) {
  const result = JSON.parse(JSON.stringify(value || emptyState()));
  delete result.currentUser;
  privateCollections.forEach(collection => delete result[collection]);
  result.users = (result.users || []).filter(account => account.email?.toLowerCase() !== SYSTEM_ADMIN_EMAIL.toLowerCase());
  result.users.forEach(account => {
    delete account.passwordHash;
    delete account.password;
    delete account.temporaryPassword;
    delete account.initialPassword;
  });
  return result;
}

function cleanWorkspaceState(value) {
  const result = cleanState(value);
  const regularTaskIds = new Set(recordsFrom(result.tasks).filter(task => task.contextType === 'regular_work').map(task => task.id));
  result.tasks = recordsFrom(result.tasks).filter(task => task.contextType !== 'regular_work');
  result.comments = recordsFrom(result.comments).filter(comment => !regularTaskIds.has(comment.task));
  result.approvals = recordsFrom(result.approvals).filter(approval => !regularTaskIds.has(approval.task));
  result.approvalHistory = recordsFrom(result.approvalHistory).filter(entry => !regularTaskIds.has(entry.task));
  result.activity = recordsFrom(result.activity).filter(event => event.contextType !== 'regular_work' && !regularTaskIds.has(event.task));
  result.calendarEvents = recordsFrom(result.calendarEvents).filter(event => event.contextType !== 'regular_work' && !regularTaskIds.has(event.task));
  delete result.users;
  delete result.departments;
  delete result.regularWorkFolders;
  delete result.regularWorkCategories;
  return result;
}

function safeDirectory(state) {
  const users = recordsFrom(state?.users)
    .filter(account => account.email?.toLowerCase() !== SYSTEM_ADMIN_EMAIL.toLowerCase())
    .map(account => {
      const safe = { ...account };
      ['mobile', 'phone', 'reportingTo', 'dateJoined', 'joiningDate', 'departmentHistory', 'createdBy', 'temporaryPassword', 'initialPassword', 'password', 'passwordHash', 'authUid', 'firebaseUid', 'uid'].forEach(key => delete safe[key]);
      return safe;
    });
  const departments = recordsFrom(state?.departments).map(({ id, name, code, headId, active }) => ({ id, name, code, headId, active }));
  return JSON.parse(JSON.stringify({ users, departments }));
}

function safeEmployeeDirectory(state) {
  const users = recordsFrom(state?.users).map(account => {
    const id = String(account.appUserId || account.id || '');
    const designation = account.designation || account.role || 'Team Member';
    const department = account.department || account.dept || 'Unassigned';
    const status = account.status || (account.active === false ? 'inactive' : 'active');
    const name = account.displayName || account.name || 'Employee';
    return {
      appUserId: id,
      displayName: name,
      designation,
      departmentName: department,
      departmentId: account.departmentId || '',
      initials: account.initials || String(name).trim().split(/\s+/).slice(0, 2).map(part => part[0]?.toUpperCase() || '').join(''),
      active: status === 'active'
    };
  }).filter(account => account.appUserId);
  const departments = recordsFrom(state?.departments).map(department => ({
    id: String(department.id || ''),
    name: String(department.name || 'Unassigned')
  })).filter(department => department.id);
  return JSON.parse(JSON.stringify({ users, departments }));
}

function managementRecords(state) {
  const result = JSON.parse(JSON.stringify({ users: recordsFrom(state?.users), departments: recordsFrom(state?.departments) }));
  stripLegacyCredentials(result);
  return result;
}

function employeeManagementRecord(profile, uid) {
  return {
    id: profile.appUserId,
    authUid: uid,
    appUserId: profile.appUserId,
    employeeId: profile.employeeId || '',
    name: profile.name || profile.email,
    email: profile.email,
    mobile: profile.mobile || '',
    department: profile.department || 'Unassigned',
    departmentId: profile.departmentId || '',
    designation: profile.designation || 'Team Member',
    jobRole: profile.jobRole || 'Team Member',
    role: profile.designation || 'Team Member',
    reportingTo: profile.reportingTo || null,
    dateJoined: profile.joiningDate || '',
    active: profile.status === 'active',
    status: profile.status,
    createdAt: profile.createdAt || new Date().toISOString(),
    createdBy: profile.createdBy || auth.currentUser?.uid || ''
  };
}

async function upsertArrayRecord(path, record, { rejectUidConflict = false, rejectExistingId = false } = {}) {
  const result = await runTransaction(ref(database, path), current => {
    const records = recordsFrom(current);
    const index = records.findIndex(item => item.id === record.id || item.appUserId === record.appUserId);
    if (index >= 0 && rejectExistingId) return;
    if (index >= 0 && rejectUidConflict && records[index].authUid && records[index].authUid !== record.authUid) return;
    if (index >= 0) records[index] = { ...records[index], ...record };
    else records.push(record);
    return records;
  }, { applyLocally: false });
  if (!result.committed) throw new Error(`Could not safely save the employee record at ${path}.`);
}

async function removeNewEmployeeRecord(path, uid, profile) {
  await runTransaction(ref(database, path), current => recordsFrom(current).filter(record => {
    const uidMatches = record.authUid === uid;
    const newRowMatches = record.id === profile.appUserId && record.email === profile.email && record.createdAt === profile.createdAt;
    return !uidMatches && !newRowMatches;
  }), { applyLocally: false });
}

function recordsFrom(value) {
  if (Array.isArray(value)) return value.filter(record => record && typeof record === 'object');
  if (value && typeof value === 'object') return Object.values(value).filter(record => record && typeof record === 'object');
  return [];
}

function recordIdentity(record, index) {
  return String(record?.id ?? `legacy-${index}`);
}

function databaseRecordKey(id) {
  return encodeURIComponent(String(id)).replace(/\./g, '%2E');
}

function maskedDiagnosticEmail(email) {
  const value = String(email || '');
  const at = value.indexOf('@');
  return at > 0 ? `${value[0]}***${value.slice(at)}` : value ? '***' : '(none)';
}

function privateCollectionsSnapshot(value) {
  return Object.fromEntries(privateCollections.map(collection => [collection, recordsFrom(value?.[collection])]));
}

function presentPrivateCollections(value) {
  return Object.fromEntries(privateCollections
    .filter(collection => value?.[collection] !== undefined && value?.[collection] !== null)
    .map(collection => [collection, value[collection]]));
}

function clonePrivateCollections(value) {
  return Object.fromEntries(privateCollections.map(collection => [
    collection,
    recordsFrom(value?.[collection]).map(record => JSON.parse(JSON.stringify(record)))
  ]));
}

function captureRecordKeys(source, collections, target) {
  for (const collection of collections) {
    const value = source?.[collection];
    const entries = Array.isArray(value)
      ? value.map((record, index) => [String(index), record])
      : Object.entries(value || {});
    target[collection] = new Map(entries
      .filter(([, record]) => record && typeof record === 'object')
      .map(([key, record], index) => [recordIdentity(record, index), key]));
  }
}

function normalizeWorkspace(value) {
  const workspace = { ...emptyState(), ...(value || {}) };
  [...workspaceCollections, ...privateCollections].forEach(key => {
    workspace[key] = recordsFrom(workspace[key]);
  });
  return workspace;
}

function mergeRecordsById(primary, legacy) {
  const identity = record => record?.id != null ? `id:${record.id}` : `record:${JSON.stringify(record)}`;
  const merged = new Map(recordsFrom(primary).map(record => [identity(record), record]));
  recordsFrom(legacy).forEach(record => {
    const id = identity(record);
    if (!merged.has(id)) merged.set(id, record);
  });
  return [...merged.values()];
}

function mergeData(target, source) {
  if (Array.isArray(target) && Array.isArray(source)) return mergeRecordsById(target, source);
  if (target && source && typeof target === 'object' && typeof source === 'object' && !Array.isArray(target) && !Array.isArray(source)) {
    const merged = { ...source, ...target };
    Object.keys(source).forEach(key => {
      if (Object.hasOwn(target, key)) merged[key] = mergeData(target[key], source[key]);
    });
    return merged;
  }
  return target === undefined || target === null ? source : target;
}

function hasData(value) {
  if (Array.isArray(value)) return value.length > 0;
  if (!value || typeof value !== 'object') return false;
  return Object.values(value).some(hasData);
}

function stripLegacyCredentials(value) {
  if (Array.isArray(value)) { value.forEach(stripLegacyCredentials); return; }
  if (!value || typeof value !== 'object') return;
  ['passwordHash', 'password', 'temporaryPassword', 'initialPassword'].forEach(key => delete value[key]);
  Object.values(value).forEach(stripLegacyCredentials);
}
async function readWorkspace() {
  const [legacySnapshot, workspaceSnapshot, directorySnapshot, safeDirectoryResult, managementSnapshot, privateSnapshot, profilesSnapshot, migrationSnapshot] = await Promise.all([
    get(ref(database, legacyWorkspacePath)),
    get(ref(database, workspacePath)),
    get(ref(database, employeeDirectoryPath)),
    get(ref(database, safeEmployeeDirectoryPath))
      .then(snapshot => ({ snapshot, readable: true }))
      .catch(error => {
        const permissionDenied = error?.code === 'PERMISSION_DENIED' || String(error?.message || '').toLowerCase().includes('permission denied');
        if (!permissionDenied) throw error;
        console.warn('The sanitized employee directory is not readable under the currently deployed rules; Admin workspace loading will continue without syncing that optional path.');
        return { snapshot: null, readable: false };
      }),
    get(ref(database, adminManagementPath)),
    get(ref(database, privateDataPath)),
    get(ref(database, employeeProfilesPath)),
    get(ref(database, migrationMetadataPath))
  ]);
  const legacy = cloneWithoutCredentials(legacySnapshot.exists() ? legacySnapshot.val() : {});
  const target = cloneWithoutCredentials(workspaceSnapshot.exists() ? workspaceSnapshot.val() : {});
  const storedManagement = cloneWithoutCredentials(managementSnapshot.exists() ? managementSnapshot.val() : { users: [], departments: [] });
  const rawProfiles = cloneWithoutCredentials(profilesSnapshot.exists() ? profilesSnapshot.val() : {});
  const profiles = Object.entries(rawProfiles || {}).map(([uid, profile]) => ({ ...profile, uid }));
  const users = mergeRecordsById(storedManagement.users, legacy.users).map(account => {
    const profile = profiles.find(item => item.appUserId === account.id || item.appUserId === account.appUserId || item.uid === account.authUid);
    return profile
      ? { ...account, ...appUserFromEmployee(profile), authUid: profile.uid, status: profile.status, active: profile.status === 'active' }
      : account;
  });
  profiles.forEach(profile => {
    if (!users.some(account => account.authUid === profile.uid || account.id === profile.appUserId)) users.push(appUserFromEmployee(profile));
  });
  const departments = mergeRecordsById(storedManagement.departments, legacy.departments);
  adminManagement = { ...storedManagement, users, departments };

  const storedDirectory = cloneWithoutCredentials(directorySnapshot.exists() ? directorySnapshot.val() : { users: [], departments: [] });
  const directory = safeDirectory(mergeData({ users, departments }, storedDirectory));
  const employeeDirectory = safeEmployeeDirectory(directory);
  const safeDirectorySnapshot = safeDirectoryResult.snapshot;
  safeEmployeeDirectoryReadable = safeDirectoryResult.readable;
  safeEmployeeDirectoryNeedsSync = safeEmployeeDirectoryReadable
    && JSON.stringify(employeeDirectory) !== JSON.stringify(safeDirectorySnapshot?.exists() ? safeDirectorySnapshot.val() : null);
  const operationalLegacy = cleanWorkspaceState(legacy);
  const operational = cleanWorkspaceState(mergeData(target, operationalLegacy));

  const storedPrivate = cloneWithoutCredentials(privateSnapshot.exists() ? privateSnapshot.val() : {});
  const legacyPrivate = presentPrivateCollections(legacy);
  adminPrivateData = mergeData(storedPrivate, legacyPrivate);
  lastPrivateData = clonePrivateCollections(adminPrivateData);
  lastPrivateJson = JSON.stringify(lastPrivateData);
  captureRecordKeys(adminPrivateData, privateCollections, privateRecordKeys);
  privateDataAvailable = true;

  const marker = migrationSnapshot.exists() ? migrationSnapshot.val() : null;
  const missingLegacyData = JSON.stringify(operational) !== JSON.stringify(cleanWorkspaceState(target))
    || JSON.stringify(adminManagement) !== JSON.stringify(storedManagement)
    || JSON.stringify(directory) !== JSON.stringify(storedDirectory)
    || JSON.stringify(adminPrivateData) !== JSON.stringify(storedPrivate);
  recoveryPending = hasData(legacy) && (missingLegacyData || marker?.status !== 'completed');
  recoveryContext = { legacy, target, storedDirectory, storedManagement, storedPrivate, profiles: rawProfiles, marker };

  const state = normalizeWorkspace({
    ...operational,
    ...directory,
    users,
    departments,
    ...privateCollectionsSnapshot(adminPrivateData)
  });
  captureRecordKeys(state, workspaceCollections, workspaceRecordKeys);
  return state;
}

function recordsWithKeys(value) {
  if (Array.isArray(value)) return value.filter(record => record && typeof record === 'object');
  if (!value || typeof value !== 'object') return [];
  return Object.entries(value).filter(([, record]) => record && typeof record === 'object').map(([key, record]) => ({ ...record, id: record.id || key }));
}

function recordsGroupedByTask(value) {
  if (!value || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([taskId, records]) => recordsWithKeys(records).map(record => ({ ...record, task: record.task || taskId })));
}

function cloneRegularWorkSnapshot(data) {
  return JSON.parse(JSON.stringify({
    folders: recordsFrom(data?.folders),
    categories: recordsFrom(data?.categories),
    tasks: recordsFrom(data?.tasks).map(task=>{const copy={...task};delete copy.accessUserIds;delete copy.approverIds;return copy}),
    comments: recordsFrom(data?.comments),
    approvals: recordsFrom(data?.approvals),
    activity: recordsFrom(data?.activity),
    ownerActivity: recordsFrom(data?.ownerActivity),
    calendarEvents: recordsFrom(data?.calendarEvents),
    access: data?.access || {}
  }));
}

async function readRegularWorkData(firebaseUid, admin, employeeProfile = null) {
  let owners = {};
  let stored = {};
  let ownerActivity = {};
  let allowedTaskIds = [];
  if (admin) {
    const snapshot = await get(ref(database, regularWorkPath));
    stored = snapshot.exists() ? snapshot.val() : {};
    owners = stored.owners || {};
    ownerActivity = stored.ownerActivity || {};
    allowedTaskIds = Object.keys(stored.tasks || {});
  } else {
    const [ownerSnapshot, accessSnapshot, ownerActivitySnapshot] = await Promise.all([
      get(ref(database, `${regularWorkOwnersPath}/${firebaseUid}`)),
      get(ref(database, `${regularWorkTaskAccessPath}/${employeeProfile?.appUserId || ''}`)),
      get(ref(database, `${regularWorkOwnerActivityPath}/${firebaseUid}`))
    ]);
    owners = ownerSnapshot.exists() ? { [firebaseUid]: ownerSnapshot.val() } : {};
    ownerActivity = ownerActivitySnapshot.exists() ? { [firebaseUid]: ownerActivitySnapshot.val() } : {};
    const access = accessSnapshot.exists() ? accessSnapshot.val() : {};
    allowedTaskIds = Object.entries(access).filter(([, allowed]) => allowed === true).map(([taskId]) => taskId);
    const taskSnapshots = await Promise.all(allowedTaskIds.map(taskId => get(ref(database, `${regularWorkTasksPath}/${taskId}`))));
    stored.tasks = Object.fromEntries(taskSnapshots.map((snapshot, index) => [allowedTaskIds[index], snapshot.exists() ? snapshot.val() : null]).filter(([, task]) => task));
    const grouped = await Promise.all(allowedTaskIds.map(async taskId => {
      const [comments, approvals, activity, calendarEvents] = await Promise.all([
        get(ref(database, `${regularWorkCommentsPath}/${taskId}`)),
        get(ref(database, `${regularWorkApprovalsPath}/${taskId}`)),
        get(ref(database, `${regularWorkActivityPath}/${taskId}`)),
        get(ref(database, `${regularWorkCalendarPath}/${taskId}`))
      ]);
      return [taskId, {
        comments: comments.exists() ? comments.val() : {},
        approvals: approvals.exists() ? approvals.val() : {},
        activity: activity.exists() ? activity.val() : {},
        calendarEvents: calendarEvents.exists() ? calendarEvents.val() : {}
      }];
    }));
    stored.comments = Object.fromEntries(grouped.map(([taskId, data]) => [taskId, data.comments]));
    stored.approvals = Object.fromEntries(grouped.map(([taskId, data]) => [taskId, data.approvals]));
    stored.activity = Object.fromEntries(grouped.map(([taskId, data]) => [taskId, data.activity]));
    stored.calendarEvents = Object.fromEntries(grouped.map(([taskId, data]) => [taskId, data.calendarEvents]));
  }

  const folders = [];
  const categories = [];
  Object.entries(owners).forEach(([ownerUid, data]) => {
    folders.push(...recordsWithKeys(data?.folders).map(folder => ({ ...folder, ownerUid: folder.ownerUid || ownerUid })));
    categories.push(...recordsWithKeys(data?.categories).map(category => ({ ...category, ownerUid: category.ownerUid || ownerUid })));
  });
  const tasks = recordsWithKeys(stored.tasks).filter(task => allowedTaskIds.includes(task.id)).map(task => ({
    ...task,
    contextType: 'regular_work',
    project: null,
    workstream: task.regularCategoryName || task.workstream || 'Regular Work',
    deliverable: task.deliverable || task.regularFolderName || 'Regular Work'
  }));
  const data = {
    folders,
    categories,
    tasks,
    comments: recordsGroupedByTask(stored.comments),
    approvals: recordsGroupedByTask(stored.approvals),
    activity: [...recordsGroupedByTask(stored.activity), ...Object.entries(ownerActivity).flatMap(([ownerUid, records]) => recordsWithKeys(records).map(event => ({ ...event, ownerUid, contextType: 'regular_work' })))],
    ownerActivity: Object.entries(ownerActivity).flatMap(([ownerUid, records]) => recordsWithKeys(records).map(event => ({ ...event, ownerUid, contextType: 'regular_work' }))),
    calendarEvents: recordsGroupedByTask(stored.calendarEvents)
  };
  const approvalsByTask=recordsFrom(data.approvals).reduce((map,approval)=>{(map[approval.task]||(map[approval.task]=[])).push(approval);return map},{});
  const eventsByTask=recordsFrom(data.calendarEvents).reduce((map,event)=>{const taskId=event.regularWorkTaskId||event.task;if(taskId)(map[taskId]||(map[taskId]=[])).push(event);return map},{});
  data.access=Object.fromEntries(tasks.map(task=>[task.id,[...new Set([task.folderOwnerUserId,task.createdBy,task.owner,...(approvalsByTask[task.id]||[]).flatMap(approval=>[approval.requestedBy,...(approval.approvers||[])]),...(eventsByTask[task.id]||[]).flatMap(event=>[event.createdBy,...(event.participants||[])])].filter(Boolean))]]));
  data.tasks.forEach(task=>{task.accessUserIds=data.access[task.id]||[]});
  lastRegularWorkSnapshot = cloneRegularWorkSnapshot(data);
  return data;
}

function mergeRegularWorkIntoState(state, regularWork) {
  const taskIds = new Set(recordsFrom(regularWork?.tasks).map(task => task.id));
  state.regularWorkFolders = recordsFrom(regularWork?.folders);
  state.regularWorkCategories = recordsFrom(regularWork?.categories);
  state.tasks = [...recordsFrom(state.tasks).filter(task => task.contextType !== 'regular_work'), ...recordsFrom(regularWork?.tasks)];
  state.comments = [...recordsFrom(state.comments).filter(record => !taskIds.has(record.task)), ...recordsFrom(regularWork?.comments)];
  state.approvals = [...recordsFrom(state.approvals).filter(record => !taskIds.has(record.task)), ...recordsFrom(regularWork?.approvals)];
  state.activity = [...recordsFrom(state.activity).filter(record => !taskIds.has(record.task)), ...recordsFrom(regularWork?.activity)];
  state.calendarEvents = [...recordsFrom(state.calendarEvents).filter(record => !taskIds.has(record.task)), ...recordsFrom(regularWork?.calendarEvents)];
  return state;
}

async function readEmployeeWorkspace(profile) {
  const uid = profile?.uid;
  if (!uid) return normalizeWorkspace(emptyState());

  const [userViewSnapshot, userWorkResult, privateSnapshot, directorySnapshot] = await Promise.all([
    get(ref(database, `${userViewsPath}/${uid}`)),
    get(ref(database, `${userWorkPath}/${uid}`))
      .then(snapshot => ({ snapshot, readable: true }))
      .catch(error => {
        const permissionDenied = error?.code === 'PERMISSION_DENIED' || String(error?.message || '').toLowerCase().includes('permission denied');
        if (!permissionDenied) throw error;
        console.warn('The employee-scoped userWork path is not readable under the currently deployed rules; continuing with independently authorized data.');
        return { snapshot: null, readable: false };
      }),
    get(ref(database, `${privatePath}/${uid}`)),
    get(ref(database, safeEmployeeDirectoryPath))
  ]);

  const userView = userViewSnapshot.exists() ? userViewSnapshot.val() : {};
  employeeUserWorkReadable = userWorkResult.readable;
  const userWorkSnapshot = userWorkResult.snapshot;
  const userWork = userWorkSnapshot?.exists() ? userWorkSnapshot.val() : {};
  const privateData = privateSnapshot.exists() ? privateSnapshot.val() : {};
  const directory = directorySnapshot.exists() ? directorySnapshot.val() : { users: [], departments: [] };

  const projectIds = Object.keys(userView.projectAccess || {}).filter(id => userView.projectAccess[id] === true);
  const taskIds = [...new Set([
    ...Object.keys(userView.taskAccess || {}).filter(id => userView.taskAccess[id] === true),
    ...Object.keys(userView.projectTaskAccess || {}).filter(id => userView.projectTaskAccess[id] === true)
  ])];
  const approvalIds = Object.keys(userView.approvalAccess || {}).filter(id => userView.approvalAccess[id] === true);
  const calendarIds = Object.keys(userView.calendarAccess || {}).filter(id => userView.calendarAccess[id] === true);
  const [projects, tasks, approvals, calendarEvents, commentsByTask, activityByTask] = await Promise.all([
    readScopedRecords(sharedProjectsPath, projectIds),
    readScopedRecords(sharedTasksPath, taskIds),
    readScopedRecords(sharedApprovalsPath, approvalIds),
    readScopedRecords(sharedCalendarPath, calendarIds),
    readScopedGroupedRecords(sharedCommentsPath, taskIds),
    readScopedGroupedRecords(sharedActivityPath, taskIds)
  ]);
  const safeUsers = recordsFrom(directory.users).map(account => ({
    ...account,
    id: account.appUserId,
    name: account.displayName,
    role: account.designation,
    dept: account.departmentName,
    department: account.departmentName,
    status: account.active ? 'active' : 'inactive'
  }));
  const state = { ...emptyState(), ...userWork, ...directory, users: safeUsers, ...privateCollectionsSnapshot(privateData) };
  state.projects = mergeRecordsById(userWork.projects, projects);
  state.tasks = mergeRecordsById(userWork.tasks, tasks);
  state.approvals = mergeRecordsById(userWork.approvals, approvals);
  state.calendarEvents = mergeRecordsById(userWork.calendarEvents, calendarEvents);
  state.comments = mergeRecordsById(userWork.comments, commentsByTask);
  state.activity = mergeRecordsById(userWork.activity, activityByTask);
  state.users = recordsFrom(state.users);
  state.departments = recordsFrom(state.departments);

  const own = appUserFromEmployee(profile);
  const index = state.users.findIndex(account => account.id === own.id || account.authUid === uid);
  if (index < 0) state.users.push(own);
  else state.users[index] = { ...state.users[index], ...own };

  return normalizeWorkspace(state);
}

async function readScopedRecords(path, ids) {
  const snapshots = await Promise.all(ids.map(id => get(ref(database, `${path}/${databaseRecordKey(id)}`))));
  return snapshots.flatMap((snapshot, index) => snapshot.exists()
    ? recordsWithKeys(snapshot.val()).map(record => ({ ...record, id: record.id || ids[index] }))
    : []);
}

async function readScopedGroupedRecords(path, ids) {
  const snapshots = await Promise.all(ids.map(id => get(ref(database, `${path}/${databaseRecordKey(id)}`))));
  return snapshots.flatMap((snapshot, index) => snapshot.exists()
    ? recordsWithKeys(snapshot.val()).map(record => ({ ...record, task: record.task || ids[index] }))
    : []);
}

async function saveEmployeeScopedChanges(state) {
  const previous = lastApplicationState || emptyState();
  const saveChanged = async (path, beforeRecords, afterRecords, keyForRecord = record => record?.id, prepareRecord = record => record) => {
    const before = new Map(recordsFrom(beforeRecords).map(record => [String(keyForRecord(record) || ''), record]));
    for (const record of recordsFrom(afterRecords)) {
      const id = String(keyForRecord(record) || '');
      if (!id || JSON.stringify(before.get(id)) === JSON.stringify(record)) continue;
      await set(ref(database, `${path}/${databaseRecordKey(id)}`), prepareRecord(record));
    }
  };
  const projectTaskIds = new Set(recordsFrom(state.tasks).filter(task => task.contextType !== 'regular_work').map(task => String(task.id)));
  await saveChanged(sharedProjectsPath, previous.projects, state.projects);
  await saveChanged(sharedTasksPath,
    recordsFrom(previous.tasks).filter(task => task.contextType !== 'regular_work'),
    recordsFrom(state.tasks).filter(task => task.contextType !== 'regular_work'));
  await saveChanged(sharedApprovalsPath,
    recordsFrom(previous.approvals).filter(approval => !approval.contextType || approval.contextType !== 'regular_work'),
    recordsFrom(state.approvals).filter(approval => !approval.contextType || approval.contextType !== 'regular_work'),
    record => record?.id,
    approval => ({ ...approval, approverIds: Object.fromEntries((approval.approvers || []).map(id => [id, true])) }));
  const saveTaskGrouped = async (path, beforeRecords, afterRecords) => {
    const before = new Map(recordsFrom(beforeRecords).map(record => [`${record.task || ''}/${record.id || ''}`, record]));
    for (const record of recordsFrom(afterRecords)) {
      const taskId = String(record.task || '');
      const id = String(record.id || '');
      if (!taskId || !id || !projectTaskIds.has(taskId) || JSON.stringify(before.get(`${taskId}/${id}`)) === JSON.stringify(record)) continue;
      await set(ref(database, `${path}/${databaseRecordKey(taskId)}/${databaseRecordKey(id)}`), record);
    }
  };
  await saveTaskGrouped(sharedCommentsPath,
    recordsFrom(previous.comments).filter(record => !recordsFrom(previous.tasks).some(task => task.id === record.task && task.contextType === 'regular_work')),
    recordsFrom(state.comments).filter(record => !recordsFrom(state.tasks).some(task => task.id === record.task && task.contextType === 'regular_work')));
  await saveTaskGrouped(sharedActivityPath,
    recordsFrom(previous.activity).filter(record => record.task && record.contextType !== 'regular_work'),
    recordsFrom(state.activity).filter(record => record.task && record.contextType !== 'regular_work'));
  await saveChanged(sharedCalendarPath,
    recordsFrom(previous.calendarEvents).filter(event => event.contextType !== 'regular_work' && !event.regularWorkTaskId),
    recordsFrom(state.calendarEvents).filter(event => event.contextType !== 'regular_work' && !event.regularWorkTaskId),
    record => record?.id,
    event => ({ ...event, participantUserIds: Object.fromEntries((event.participants || []).map(id => [id, true])) }));
  const uid = auth.currentUser?.uid;
  if (uid && employeeUserWorkReadable && JSON.stringify(previous.plannerRead || {}) !== JSON.stringify(state.plannerRead || {})) {
    await set(ref(database, `${userWorkPath}/${uid}/plannerRead`), state.plannerRead || {});
  }
}

function appUserFromEmployee(profile) {
  return {
    id: profile.appUserId,
    authUid: profile.uid,
    employeeId: profile.employeeId || '',
    name: profile.name || profile.email,
    email: profile.email,
    phone: profile.mobile || '',
    mobile: profile.mobile || '',
    designation: profile.designation || 'Team Member',
    jobRole: profile.jobRole || 'Team Member',
    role: profile.designation || 'Team Member',
    departmentId: profile.departmentId || '',
    dept: profile.department || 'Unassigned',
    reportingTo: profile.reportingTo || null,
    dateJoined: profile.joiningDate || '',
    initials: String(profile.name || profile.email).trim().split(/\s+/).slice(0, 2).map(part => part[0].toUpperCase()).join(''),
    active: profile.status === 'active',
    status: profile.status,
    systemRole: 'Team Member',
    accessRole: 'Team Member',
    createdAt: profile.createdAt || ''
  };
}

function ensureAdminProfile(state, user) {
  const users = Array.isArray(state.users) ? state.users : (state.users = []);
  const existing = users.find(account => account.id === 'u1' || account.email?.toLowerCase() === SYSTEM_ADMIN_EMAIL.toLowerCase());
  const admin = {
    ...(existing || {}),
    id: 'u1', authUid: user.uid, name: existing?.name || 'System Admin', email: SYSTEM_ADMIN_EMAIL,
    designation: 'Director / Admin', role: 'Director / Admin', dept: 'Management', departmentId: existing?.departmentId || '',
    initials: existing?.initials || 'SA', active: true, status: 'active',
    systemRole: 'Director / Admin', accessRole: 'Director / Admin', isSystemAdmin: true
  };
  state.users = users.filter(account => account !== existing && account.email?.toLowerCase() !== SYSTEM_ADMIN_EMAIL.toLowerCase());
  state.users.unshift(admin);
  return state;
}

function cloneWithoutCredentials(value) {
  const copy = value == null ? value : JSON.parse(JSON.stringify(value));
  stripLegacyCredentials(copy);
  return copy;
}

async function backupLegacyEmployeeVisibleData() {
  if (!isSystemAdmin()) return null;
  const backupKey = `legacy-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const backupPath = `${migrationBackupsPath}/${backupKey}`;
  const existing = await get(ref(database, backupPath));
  if (existing.exists()) return backupPath;

  const [legacySnapshot, directorySnapshot, workspaceSnapshot, managementSnapshot, privateSnapshot] = await Promise.all([
    get(ref(database, legacyWorkspacePath)),
    get(ref(database, employeeDirectoryPath)),
    get(ref(database, workspacePath)),
    get(ref(database, adminManagementPath)),
    get(ref(database, privateDataPath))
  ]);

  const backup = {
    migrationId,
    createdAt: new Date().toISOString(),
    backupPath,
    sourcePaths: {
      legacyWorkspacePath,
      workspacePath,
      employeeDirectoryPath,
      adminManagementPath,
      privateDataPath
    },
    legacyWorkspace: cloneWithoutCredentials(legacySnapshot.exists() ? legacySnapshot.val() : {}),
    employeeVisibleState: cloneWithoutCredentials(workspaceSnapshot.exists() ? workspaceSnapshot.val() : {}),
    directory: cloneWithoutCredentials(directorySnapshot.exists() ? directorySnapshot.val() : { users: [], departments: [] }),
    management: cloneWithoutCredentials(managementSnapshot.exists() ? managementSnapshot.val() : { users: [], departments: [] }),
    privateData: cloneWithoutCredentials(privateSnapshot.exists() ? privateSnapshot.val() : {})
  };

  await set(ref(database, backupPath), backup);
  return backupPath;
}

async function runSparkMigration() {
  if (!isSystemAdmin() || !recoveryPending || !recoveryContext || migrationInProgress) return;
  migrationInProgress = true;
  let backupPath = '';
  try {
    const context = recoveryContext;
    const backupsSnapshot = await get(ref(database, migrationBackupsPath));
    const backups = backupsSnapshot.exists() ? backupsSnapshot.val() : {};
    let backupEntry = Object.entries(backups).find(([, value]) => value?.migrationId === migrationId);
    if (!backupEntry) {
      const backupKey = String(Date.now());
      backupPath = `${migrationBackupsPath}/${backupKey}`;
      const backup = {
        migrationId,
        createdAt: new Date().toISOString(),
        sourcePath: legacyWorkspacePath,
        targetPath: workspacePath,
        source: cloneWithoutCredentials(context.legacy),
        ...(context.localState ? { localState: cloneWithoutCredentials(context.localState) } : {}),
        target: cloneWithoutCredentials(context.target),
        directory: cloneWithoutCredentials(context.storedDirectory),
        employeeManagement: cloneWithoutCredentials(context.storedManagement),
        privateData: cloneWithoutCredentials(context.storedPrivate),
        employeeProfiles: cloneWithoutCredentials(context.profiles)
      };
      await set(ref(database, backupPath), backup);
      backupEntry = [backupKey, backup];
    }
    if (!backupPath) backupPath = `${migrationBackupsPath}/${backupEntry[0]}`;

    await set(ref(database, migrationMetadataPath), {
      migrationId,
      status: 'running',
      startedAt: new Date().toISOString(),
      sourcePath: legacyWorkspacePath,
      targetPath: workspacePath,
      backupPath
    });

    const source = mergeData(context.legacy, context.localState || {});
    const operational = cleanWorkspaceState(mergeData(context.target, cleanWorkspaceState(source)));
    const management = mergeData(context.storedManagement, mergeData(adminManagement, managementRecords(source)));
    const directory = safeDirectory(mergeData(management, context.storedDirectory));
    const privateSource = presentPrivateCollections(source);
    const privateData = mergeData(context.storedPrivate, mergeData(adminPrivateData, privateSource));
    const updates = {
      [workspacePath]: operational,
      [employeeDirectoryPath]: directory,
      [adminManagementPath]: management
    };
    if (Object.keys(privateData).length) updates[privateDataPath] = privateData;
    await update(ref(database), updates);
    await set(ref(database, migrationMetadataPath), {
      migrationId,
      status: 'completed',
      completedAt: new Date().toISOString(),
      sourcePath: legacyWorkspacePath,
      targetPath: workspacePath,
      backupPath
    });

    recoveryPending = false;
    lastStateJson = JSON.stringify(operational);
    adminManagement = management;
    adminPrivateData = privateData;
    lastPrivateData = clonePrivateCollections(privateData);
    lastPrivateJson = JSON.stringify(lastPrivateData);
    captureRecordKeys(privateData, privateCollections, privateRecordKeys);
    localStorage.removeItem('executionHubStateFinal');
    if (typeof window.getFirebaseApplicationState === 'function') {
      deferredSaveState = null;
      await window.firebaseHub.saveState(window.getFirebaseApplicationState());
    }
  } catch (error) {
    console.error('Legacy data recovery did not complete; the original legacy data and backup were left untouched:', error);
    window.dispatchEvent(new CustomEvent('firebase-save-error', { detail: error }));
  } finally {
    migrationInProgress = false;
  }
}

async function authorize(user) {
  if (!user?.email) throw new Error('Your Firebase account does not have an email address.');
  systemAdminUid = null;
  if (user.email.toLowerCase() === SYSTEM_ADMIN_EMAIL.toLowerCase()) {
    systemAdminUid = user.uid;
  }
  const admin = isSystemAdmin(user);
  if (admin) {
    await backupLegacyEmployeeVisibleData();
  }
  let profile = null;
  if (!admin) {
    const snapshot = await get(ref(database, `${employeeProfilesPath}/${user.uid}`));
    profile = snapshot.exists() ? snapshot.val() : null;
    if (!profile || profile.uid !== user.uid || profile.email?.toLowerCase() !== user.email.toLowerCase() || profile.role !== 'employee') {
      throw Object.assign(new Error('Your account exists but is not authorized for this application. Please contact the administrator.'), { code: 'app/not-authorized' });
    }
    if (profile.status !== 'active') {
      const messages = {
        inactive: 'Your account is inactive. Please contact the administrator.',
        resigned: 'Your account is marked as resigned. Please contact the administrator.',
        suspended: 'Your account is suspended. Please contact the administrator.',
        exited: 'Your account is marked as exited. Please contact the administrator.'
      };
      throw Object.assign(new Error(messages[profile.status] || 'Your account is disabled. Please contact the administrator.'), { code: 'app/account-disabled' });
    }
    if (typeof profile.appUserId !== 'string' || !profile.appUserId.trim()) throw Object.assign(new Error('Your employee profile is incomplete. Please contact the administrator.'), { code: 'app/not-authorized' });
    const migrationSnapshot = await get(ref(database, migrationMetadataPath));
    if (migrationSnapshot.val()?.status !== 'completed') {
      throw Object.assign(new Error('The administrator must complete workspace data recovery before employee access is enabled.'), { code: 'app/migration-pending' });
    }
  }

  let state;
  if (admin) {
    state = await readWorkspace();
    if (hasData(legacyState)) {
      const localState = cloneWithoutCredentials(legacyState);
      const mergedState = normalizeWorkspace(mergeData(state, localState));
      const mergedManagement = mergeData(adminManagement, managementRecords(localState));
      const mergedPrivate = mergeData(adminPrivateData, presentPrivateCollections(localState));
      const localDataMissing = JSON.stringify(cleanWorkspaceState(mergedState)) !== JSON.stringify(cleanWorkspaceState(state))
        || JSON.stringify(mergedManagement) !== JSON.stringify(adminManagement)
        || JSON.stringify(mergedPrivate) !== JSON.stringify(adminPrivateData);
      if (localDataMissing) {
        state = mergedState;
        recoveryContext = { ...(recoveryContext || {}), localState };
        recoveryPending = true;
        adminManagement = mergedManagement;
        adminPrivateData = mergedPrivate;
      } else {
        localStorage.removeItem('executionHubStateFinal');
        legacyState = null;
      }
    }
  } else state = await readEmployeeWorkspace(profile);
  const regularWork = await readRegularWorkData(user.uid, admin, profile);
  state = mergeRegularWorkIntoState(state || emptyState(), regularWork);
  state = { ...emptyState(), ...(state || {}) };
  if (admin) state = ensureAdminProfile(state, user);
  else {
    state.users = Array.isArray(state.users) ? state.users : [];
    const existing = state.users.find(account => account.authUid === user.uid || account.id === profile.appUserId);
    const appProfile = { ...(existing || {}), ...appUserFromEmployee(profile) };
    if (!existing) state.users.push(appProfile);
    else state.users[state.users.indexOf(existing)] = appProfile;
  }

  authUser = user;
  employeeProfile = profile;
  window.firebaseHub.initialState = state;
  window.firebaseHub.employeeProfile = profile;
  lastStateJson = JSON.stringify(cleanWorkspaceState(state));
  lastApplicationState = JSON.parse(JSON.stringify(state));
  return { state, admin, profile };
}

function setApplicationVisible(visible) {
  document.querySelector('.app-shell')?.classList.toggle('firebase-app-hidden', !visible);
  document.querySelectorAll('.drawer, .drawer-backdrop, .modal-backdrop, .toast').forEach(node => {
    if (!visible) node.classList.remove('open', 'show');
  });
  let overlay = document.getElementById('firebaseAuthOverlay');
  if (visible) overlay?.remove();
  else if (overlay) overlay.classList.add('open');
}

function friendlyAuthError(error) {
  const code = error?.code || '';
  if (code === 'auth/user-not-found' || code === 'auth/wrong-password' || code === 'auth/invalid-credential') return 'Email or password is incorrect.';
  if (code === 'auth/too-many-requests') return 'Too many sign-in attempts. Wait a while and try again.';
  if (code === 'auth/network-request-failed') return 'Network error. Check your connection and try again.';
  if (code === 'auth/user-disabled') return 'This Firebase account is disabled. Please contact the administrator.';
  if (code === 'auth/email-already-in-use') return 'An account already exists for this email.';
  if (code === 'auth/weak-password') return 'The temporary password must contain at least 6 characters.';
  if (code === 'auth/operation-not-allowed') return 'Email and password sign-in is not enabled in Firebase Console.';
  if (code === 'PERMISSION_DENIED' || error?.message?.includes('PERMISSION_DENIED')) return 'Firebase denied access. Check the deployed Realtime Database rules.';
  return error?.message || 'Unable to complete the Firebase request. Please try again.';
}

function showLogin(message = '') {
  setApplicationVisible(false);
  let overlay = document.getElementById('firebaseAuthOverlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'firebaseAuthOverlay';
    overlay.className = 'login-overlay open';
    document.body.appendChild(overlay);
  }
  overlay.innerHTML = `<div class="login-card"><div class="login-brand"><div class="brand-mark">EH</div><div><strong>Execution Hub</strong><span>Projects • Launches • Accountability</span></div></div><div class="eyebrow">PRIVATE TEAM ACCESS</div><h1>Welcome back.</h1><p>Sign in with your authorized company account.</p><form id="firebaseLoginForm" class="form-stack"><label class="form-field"><span>Email</span><input class="input" name="email" type="email" autocomplete="username" required placeholder="name@company.com"></label><label class="form-field"><span>Password</span><input class="input" name="password" type="password" autocomplete="current-password" required placeholder="••••••••"></label><div id="firebaseAuthMessage" class="login-error">${message}</div><button class="btn btn-primary login-btn" type="submit">Login</button><button class="link-btn" id="firebaseForgotPassword" type="button">Forgot Password</button></form></div>`;
  overlay.classList.add('open');
  const form = document.getElementById('firebaseLoginForm');
  form.onsubmit = async event => {
    event.preventDefault();
    const button = form.querySelector('button[type="submit"]');
    const values = new FormData(form);
    button.disabled = true;
    document.getElementById('firebaseAuthMessage').textContent = '';
    try {
      await signInWithEmailAndPassword(auth, String(values.get('email')).trim(), String(values.get('password')));
    } catch (error) {
      document.getElementById('firebaseAuthMessage').textContent = friendlyAuthError(error);
      button.disabled = false;
    }
  };
  document.getElementById('firebaseForgotPassword').onclick = async () => {
    const email = String(form.elements.email.value || '').trim();
    const messageEl = document.getElementById('firebaseAuthMessage');
    if (!email) { messageEl.textContent = 'Enter your email address first.'; return; }
    try {
      await sendPasswordResetEmail(auth, email);
      messageEl.textContent = 'If an account exists for this email, a password reset link has been sent.';
    } catch (error) {
      messageEl.textContent = friendlyAuthError(error);
    }
  };
}

async function loadClassicScript(src) {
  await new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.async = false;
    script.onload = resolve;
    script.onerror = () => reject(new Error(`Could not load ${src}`));
    document.body.appendChild(script);
  });
}

async function loadApplication() {
  if (appLoaded) return;
  await loadClassicScript('app.js');
  await loadClassicScript('regular-work-comment-guard.js');
  await loadClassicScript('phase13.js');
  await loadClassicScript('phase15.js');
  await loadClassicScript('phase19.js');
  await loadClassicScript('phase17.js');
  await loadClassicScript('phase18.js');
  await loadClassicScript('phase20.js');
  appLoaded = true;
}

async function handleAuthState(user) {
  if (!user) {
    authUser = null;
    employeeProfile = null;
    systemAdminUid = null;
    handlingUid = null;
    if (stopWatching) stopWatching();
    stopWatching = null;
    if (stopProfileWatch) stopProfileWatch();
    stopProfileWatch = null;
    if (stopPrivateWatching) stopPrivateWatching();
    stopPrivateWatching = null;
    if (stopManagementWatching) stopManagementWatching();
    stopManagementWatching = null;
    if (stopRegularWorkWatching) stopRegularWorkWatching();
    stopRegularWorkWatching = null;
    appDataWritesEnabled = false;
    deferredSaveState = null;
    firebaseAuthState = SIGNED_OUT;
    showLogin(pendingAuthMessage);
    pendingAuthMessage = '';
    return;
  }
  if (handlingUid === user.uid) return authFlow;
  if (authUser?.uid === user.uid && appLoaded) return;
  handlingUid = user.uid;
  authFlow = (async () => {
    try {
      setFirebaseAuthState(AUTH_LOADING);
      const restored = await authorize(user);
      authUser = user;
      employeeProfile = restored?.profile || employeeProfile;
      await loadApplication();
      if (appLoaded) {
        window.applyFirebaseState(window.firebaseHub.initialState);
        window.refreshFirebaseView();
      }
      setFirebaseAuthState(AUTHENTICATED);
      setApplicationVisible(true);
      startRealtimeSync();
      firebaseAuthState = AUTHENTICATED;
    } catch (error) {
      console.error('Firebase authorization failed:', error);
      const message = error?.message || friendlyAuthError(error);
      authUser = null;
      employeeProfile = null;
      systemAdminUid = null;
      handlingUid = null;
      pendingAuthMessage = message;
      await signOut(auth).catch(() => {});
      firebaseAuthState = SIGNED_OUT;
      showLogin(message);
      return { error: message };
    }
  })();
  return authFlow;
}

function startRealtimeSync() {
  if (stopWatching || !authUser) return;
  appDataWritesEnabled = true;
  if (!isSystemAdmin()) {
    if (stopProfileWatch) stopProfileWatch();
    stopProfileWatch = onValue(ref(database, `${employeeProfilesPath}/${authUser.uid}`), snapshot => {
      const profile = snapshot.val();
      if (!profile || profile.uid !== authUser.uid || profile.role !== 'employee' || profile.status !== 'active' || !profile.appUserId) {
        const disabled = profile?.status && profile.status !== 'active';
        pendingAuthMessage = disabled
          ? ({ inactive: 'Your account is inactive. Please contact the administrator.', resigned: 'Your account is marked as resigned. Please contact the administrator.', suspended: 'Your account is suspended. Please contact the administrator.', exited: 'Your account is marked as exited. Please contact the administrator.' }[profile.status] || 'Your account is disabled. Please contact the administrator.')
          : 'Your account is not authorized for this application. Please contact the administrator.';
        firebaseAuthState = SIGNED_OUT;
        showLogin(pendingAuthMessage);
        signOut(auth).catch(() => {});
        return;
      }
      employeeProfile = profile;
      window.firebaseHub.employeeProfile = profile;
    }, error => {
      console.error('Could not monitor employee authorization status:', error);
      if (String(error?.code || error?.message || '').toLowerCase().includes('permission')) {
        pendingAuthMessage = 'Your account is no longer active. Please contact the administrator.';
        firebaseAuthState = SIGNED_OUT;
        showLogin(pendingAuthMessage);
        signOut(auth).catch(() => {});
      }
    });
    let polling = false;
    const refreshScopedState = async () => {
      if (polling || !authUser) return;
      polling = true;
      try {
        const incoming = await readEmployeeWorkspace(employeeProfile);
        const workspace = mergeRegularWorkIntoState(incoming || emptyState(), await readRegularWorkData(authUser.uid, false, employeeProfile));
        workspace.users = Array.isArray(workspace.users) ? workspace.users : [];
        const existing = workspace.users.find(account => account.authUid === authUser.uid || account.id === employeeProfile.appUserId);
        const appProfile = { ...(existing || {}), ...appUserFromEmployee(employeeProfile) };
        if (!existing) workspace.users.push(appProfile);
        else workspace.users[workspace.users.indexOf(existing)] = appProfile;
        const json = JSON.stringify(cleanWorkspaceState(workspace));
        if (json !== lastStateJson) {
          lastStateJson = json;
          lastApplicationState = JSON.parse(JSON.stringify(workspace));
          window.firebaseHub.initialState = workspace;
          window.applyFirebaseState(workspace);
          window.refreshFirebaseView();
        }
      } catch (error) {
        console.error('Could not refresh employee workspace:', error);
        const code = error?.code || error?.message || '';
        if (code.includes('permission-denied') || code.includes('unauthenticated')) {
          pendingAuthMessage = error.message || 'Your account is not authorized for this application. Please contact the administrator.';
          firebaseAuthState = SIGNED_OUT;
          showLogin(pendingAuthMessage);
          signOut(auth).catch(() => {});
        }
      } finally { polling = false; }
    };
    const timer = setInterval(refreshScopedState, 15000);
    const stopUserViewWatch = onValue(ref(database, `${userViewsPath}/${authUser.uid}`), refreshScopedState, error => console.error('Could not monitor user-scoped view updates:', error));
    const stopUserWorkWatch = employeeUserWorkReadable
      ? onValue(ref(database, `${userWorkPath}/${authUser.uid}`), refreshScopedState, error => console.error('Could not monitor user-scoped work updates:', error))
      : () => {};
    const stopTaskAccessWatch = onValue(ref(database, `${regularWorkTaskAccessPath}/${employeeProfile.appUserId}`), refreshScopedState, error => console.error('Could not monitor assigned Regular Work tasks:', error));
    const stopOwnerWorkWatch = onValue(ref(database, `${regularWorkOwnersPath}/${authUser.uid}`), refreshScopedState, error => console.error('Could not monitor owned Regular Work structure:', error));
    if (stopRegularWorkWatching) stopRegularWorkWatching();
    stopRegularWorkWatching = () => { stopUserViewWatch(); stopUserWorkWatch(); stopTaskAccessWatch(); stopOwnerWorkWatch(); };
    stopWatching = () => clearInterval(timer);
    const pending = deferredSaveState;
    deferredSaveState = null;
    if (pending) window.firebaseHub.saveState(pending);
    return;
  }
  stopWatching = onValue(ref(database, workspacePath), async snapshot => {
    if (!snapshot.exists()) return;
    const mergedOperational = recoveryPending && recoveryContext
      ? mergeData(snapshot.val(), cleanWorkspaceState(recoveryContext.legacy))
      : snapshot.val();
    let incoming = { ...emptyState(), ...mergedOperational, ...safeDirectory(adminManagement) };
    if (isSystemAdmin()) {
      incoming.users = adminManagement.users || incoming.users;
      incoming.departments = adminManagement.departments || incoming.departments;
      ensureAdminProfile(incoming, authUser);
      Object.assign(incoming, clonePrivateCollections(lastPrivateData));
      incoming = mergeRegularWorkIntoState(incoming, await readRegularWorkData(authUser.uid, true));
    }
    else return;
    const json = JSON.stringify(cleanWorkspaceState(incoming));
    if (json === lastStateJson) return;
    lastStateJson = json;
    window.firebaseHub.initialState = incoming;
    if (typeof window.applyFirebaseState === 'function') {
      window.applyFirebaseState(incoming);
      window.refreshFirebaseView();
    }
  }, error => {
    console.error('Firebase live sync failed:', error);
    window.dispatchEvent(new CustomEvent('firebase-save-error', { detail: error }));
  });
  if (isSystemAdmin()) {
    startPrivateAdminSync();
    startAdminManagementSync();
    startRegularWorkAdminSync();
    if (recoveryPending) runSparkMigration();
    else if (recoveryContext?.marker?.status !== 'completed') {
      set(ref(database, migrationMetadataPath), {
        migrationId,
        status: 'completed',
        completedAt: new Date().toISOString(),
        sourcePath: legacyWorkspacePath,
        targetPath: workspacePath,
        backupPath: null
      }).catch(error => console.error('Could not record that no legacy recovery was required:', error));
    }
  }
  if (!isSystemAdmin() || !recoveryPending) {
    const pending = deferredSaveState;
    deferredSaveState = null;
    if (pending) window.firebaseHub.saveState(pending);
  }
}

function startRegularWorkAdminSync() {
  if (!isSystemAdmin()) return;
  if (stopRegularWorkWatching) stopRegularWorkWatching();
  stopRegularWorkWatching = onValue(ref(database, regularWorkPath), async () => {
    try {
      const incoming = mergeRegularWorkIntoState(window.firebaseHub.initialState || emptyState(), await readRegularWorkData(authUser.uid, true));
      window.firebaseHub.initialState = incoming;
      if (typeof window.applyFirebaseState === 'function') {
        window.applyFirebaseState(incoming);
        window.refreshFirebaseView();
      }
    } catch (error) {
      console.error('Could not refresh Admin Regular Work data:', error);
      window.dispatchEvent(new CustomEvent('firebase-save-error', { detail: error }));
    }
  }, error => console.error('Could not monitor Regular Work data:', error));
}

function regularRecordMap(records, includeTask = false) {
  return new Map(recordsFrom(records).map(record => [includeTask ? `${record.task || ''}/${record.id}` : record.id, record]));
}

async function saveRegularRecordCollection(pathForRecord, records, oldRecords, actorUid, { immutable = false } = {}) {
  const before = regularRecordMap(oldRecords, true);
  const after = regularRecordMap(records, true);
  for (const [key, record] of after) {
    if (JSON.stringify(before.get(key)) === JSON.stringify(record)) continue;
    if (immutable && before.has(key)) continue;
    const path = pathForRecord(record);
    if (!path) continue;
    const saved = { ...record, ...(record.authorUid ? {} : { authorUid: actorUid }), ...(record.actorUid ? {} : { actorUid: actorUid }), ...(record.createdByUid ? {} : { createdByUid: actorUid }) };
    await set(ref(database, path), saved);
  }
}

function regularWorkDataFromState(state, actorUid, admin) {
  const tasks = recordsFrom(state.tasks).filter(task => task.contextType === 'regular_work');
  const taskIds = new Set(tasks.map(task => task.id));
  const approvals=recordsFrom(state.approvals).filter(approval=>taskIds.has(approval.task)).map(approval=>({...approval,approverIds:Object.fromEntries((approval.approvers||[]).map(id=>[id,true]))}));
  const events=recordsFrom(state.calendarEvents).filter(event=>event.regularWorkTaskId||taskIds.has(event.task)).map(event=>({...event,participantUserIds:Object.fromEntries((event.participants||[]).map(id=>[id,true]))}));
  const approvalsByTask=approvals.reduce((map,approval)=>{(map[approval.task]||(map[approval.task]=[])).push(approval);return map},{});
  const eventsByTask=events.reduce((map,event)=>{const taskId=event.regularWorkTaskId||event.task;if(taskId)(map[taskId]||(map[taskId]=[])).push(event);return map},{});
  const access=Object.fromEntries(tasks.map(task=>[task.id,[...new Set([task.folderOwnerUserId,task.createdBy,task.owner,...(approvalsByTask[task.id]||[]).flatMap(approval=>[approval.requestedBy,...(approval.approvers||[])]),...(eventsByTask[task.id]||[]).flatMap(event=>[event.createdBy,...(event.participants||[])])].filter(Boolean))]]));
  tasks.forEach(task=>{task.accessUserIds=access[task.id]||[]});
  return cloneRegularWorkSnapshot({
    folders: recordsFrom(state.regularWorkFolders).filter(folder => admin || folder.ownerUid === actorUid),
    categories: recordsFrom(state.regularWorkCategories).filter(category => admin || category.ownerUid === actorUid),
    tasks,
    comments: recordsFrom(state.comments).filter(comment => taskIds.has(comment.task)),
    approvals,
    activity: recordsFrom(state.activity).filter(event => event.contextType === 'regular_work' || taskIds.has(event.task)),
    ownerActivity: recordsFrom(state.activity).filter(event => event.contextType === 'regular_work' && !event.task),
    calendarEvents: events,
    access
  });
}

async function saveRegularWorkData(state) {
  const actorUid = auth.currentUser?.uid;
  if (!actorUid) return;
  const admin = isSystemAdmin();
  const next = regularWorkDataFromState(state, actorUid, admin);
  const previous = lastRegularWorkSnapshot;

  const upsertOwned = async (collection, oldRecords) => {
    const oldById = new Map(recordsFrom(oldRecords).map(record => [record.id, record]));
    for (const record of recordsFrom(next[collection])) {
      const ownerUid = record.ownerUid;
      if (!ownerUid || (!admin && ownerUid !== actorUid)) continue;
      if (JSON.stringify(oldById.get(record.id)) === JSON.stringify(record)) continue;
      await set(ref(database, `${regularWorkOwnersPath}/${ownerUid}/${collection}/${record.id}`), record);
    }
  };
  await upsertOwned('folders', previous.folders);
  await upsertOwned('categories', previous.categories);

  const oldTasks = regularRecordMap(previous.tasks);
  const newTasks = regularRecordMap(next.tasks);
  for (const [taskId, task] of newTasks) {
    const old = oldTasks.get(taskId);
    if (JSON.stringify(old) === JSON.stringify(task)) continue;
    const savedTask = { ...task, createdByUid: task.createdByUid || actorUid };
    await set(ref(database, `${regularWorkTasksPath}/${taskId}`), savedTask);
  }

  for (const [taskId, accessUids] of Object.entries(next.access)) {
    const oldAccessUids=new Set(previous.access?.[taskId]||[]);
    const task=next.tasks.find(record=>record.id===taskId);
    const employeeHasDirectTaskRole = task && (
      task.owner === employeeProfile?.appUserId
      || task.createdByUid === actorUid
      || task.folderOwnerUid === actorUid
      || task.folderOwnerUserId === employeeProfile?.appUserId
    );
    const canGrantAssignedEmployee = task && task.owner && (task.createdByUid === actorUid || task.folderOwnerUid === actorUid);
    for(const appUserId of accessUids)if((admin||(appUserId===employeeProfile?.appUserId&&employeeHasDirectTaskRole)||(appUserId===task?.owner&&canGrantAssignedEmployee))&&!oldAccessUids.has(appUserId))await set(ref(database,`${regularWorkTaskAccessPath}/${appUserId}/${taskId}`),true);
    if(admin||task?.createdByUid===actorUid||task?.folderOwnerUid===actorUid){
      const nextAccess=new Set(accessUids);
      for(const appUserId of oldAccessUids)if(!nextAccess.has(appUserId))await set(ref(database,`${regularWorkTaskAccessPath}/${appUserId}/${taskId}`),null);
    }
  }

  await saveRegularRecordCollection(record => `${regularWorkCommentsPath}/${record.task}/${record.id}`, next.comments, previous.comments, actorUid);
  await saveRegularRecordCollection(record => `${regularWorkApprovalsPath}/${record.task}/${record.id}`, next.approvals, previous.approvals, actorUid);
  const taskActivity=next.activity.filter(event=>event.task),ownerActivity=next.activity.filter(event=>!event.task&&event.ownerUid);
  await saveRegularRecordCollection(record => `${regularWorkActivityPath}/${record.task}/${record.id}`, taskActivity, previous.activity.filter(event=>event.task), actorUid, { immutable: true });
  await saveRegularRecordCollection(record => `${regularWorkOwnerActivityPath}/${record.ownerUid}/${record.id}`, ownerActivity, previous.activity.filter(event=>!event.task&&event.ownerUid), actorUid, { immutable: true });
  await saveRegularRecordCollection(record => {
    const taskId = record.regularWorkTaskId || record.task;
    return taskId && newTasks.has(taskId) ? `${regularWorkCalendarPath}/${taskId}/${record.id}` : null;
  }, next.calendarEvents, previous.calendarEvents, actorUid);
  lastRegularWorkSnapshot = next;
}

function startAdminManagementSync() {
  if (!isSystemAdmin()) return;
  if (stopManagementWatching) stopManagementWatching();
  stopManagementWatching = onValue(ref(database, adminManagementPath), snapshot => {
    const stored = snapshot.exists() ? snapshot.val() : { users: [], departments: [] };
    adminManagement = recoveryPending ? mergeData(adminManagement, stored) : stored;
    const incoming = { ...(window.firebaseHub.initialState || emptyState()), users: adminManagement.users || [], departments: adminManagement.departments || [] };
    window.firebaseHub.initialState = incoming;
    if (typeof window.applyFirebaseState === 'function') {
      window.applyFirebaseState(incoming);
      window.refreshFirebaseView();
    }
  }, error => console.error('Could not monitor private employee-management data:', error));
}

function startPrivateAdminSync() {
  if (stopPrivateWatching || !isSystemAdmin() || !privateDataAvailable) return;
  stopPrivateWatching = onValue(ref(database, privateDataPath), snapshot => {
    const stored = snapshot.exists() ? snapshot.val() : {};
    adminPrivateData = recoveryPending ? mergeData(adminPrivateData, stored) : stored;
    const next = privateCollectionsSnapshot(adminPrivateData);
    const json = JSON.stringify(next);
    if (json === lastPrivateJson) return;
    lastPrivateJson = json;
    lastPrivateData = clonePrivateCollections(next);
    privateDataAvailable = true;
    captureRecordKeys(adminPrivateData, privateCollections, privateRecordKeys);
    const combined = { ...(window.firebaseHub.initialState || emptyState()), ...lastPrivateData };
    window.firebaseHub.initialState = combined;
    if (typeof window.applyFirebaseState === 'function') {
      window.applyFirebaseState(combined);
      window.refreshFirebaseView();
    }
  }, error => {
    console.error('Could not monitor private administrator data:', error);
    window.dispatchEvent(new CustomEvent('firebase-save-error', { detail: error }));
  });
}

window.firebaseHub = {
  app,
  database,
  initialState: emptyState(),
  employeeProfile: null,
  get authUser() { return authUser; },
  get firebaseUid() { return auth.currentUser?.uid || ''; },
  get SYSTEM_ADMIN_EMAIL() { return SYSTEM_ADMIN_EMAIL; },
  get adminUid() { return isSystemAdmin() ? auth.currentUser?.uid || '' : ''; },
  get privateDataAvailable() { return privateDataAvailable; },
  isSystemAdmin,
  canAccessRegularWorkTask(taskId) {
    if (isSystemAdmin() || lastRegularWorkSnapshot.tasks.some(task => task.id === taskId)) return true;
    const task = window.getFirebaseApplicationState?.().tasks.find(item => item.id === taskId && item.contextType === 'regular_work');
    return !!task && !!auth.currentUser?.uid && (task.createdByUid === auth.currentUser.uid || task.folderOwnerUid === auth.currentUser.uid || task.owner === employeeProfile?.appUserId || (task.accessUserIds || []).includes(employeeProfile?.appUserId));
  },
  async getRegularWorkDailyTasks(parentTaskId) {
    if (!isSystemAdmin() && !window.firebaseHub.canAccessRegularWorkTask(parentTaskId)) throw new Error('You do not have access to this Regular Work task.');
    const snapshot = await get(ref(database, `${regularWorkDailyTasksPath}/${parentTaskId}`));
    return snapshot.exists() ? recordsWithKeys(snapshot.val()) : [];
  },
  async saveRegularWorkDailyTask(parentTaskId, dailyTask) {
    if (!dailyTask?.id || (!isSystemAdmin() && !window.firebaseHub.canAccessRegularWorkTask(parentTaskId))) throw new Error('You do not have access to save a Daily Task here.');
    await set(ref(database, `${regularWorkDailyTasksPath}/${parentTaskId}/${dailyTask.id}`), dailyTask);
  },
  async saveRegularWorkComment(comment, activity, onProgress = () => {}) {
    const actorUid = auth.currentUser?.uid;
    const actorEmail = auth.currentUser?.email || '';
    const taskId = String(comment?.task || '');
    const commentId = String(comment?.id || '');
    const activityId = String(activity?.id || '');
    if (!actorUid || !appDataWritesEnabled || !taskId || !commentId || !activityId || activity?.task !== taskId) {
      throw new Error('Regular Work comment data is incomplete or the session is not ready.');
    }

    const savedComment = {
      ...comment,
      authorUid: comment.authorUid || actorUid,
      actorUid: comment.actorUid || actorUid,
      createdByUid: comment.createdByUid || actorUid
    };
    const savedActivity = {
      ...activity,
      authorUid: activity.authorUid || actorUid,
      actorUid: activity.actorUid || actorUid,
      createdByUid: activity.createdByUid || actorUid
    };
    const commentPath = `${regularWorkCommentsPath}/${databaseRecordKey(taskId)}/${databaseRecordKey(commentId)}`;
    const activityPath = `${regularWorkActivityPath}/${databaseRecordKey(taskId)}/${databaseRecordKey(activityId)}`;
    let taskAccess = isSystemAdmin() ? 'admin rule bypass (task index not required)' : 'not checked';
    onProgress({ commentPath, activityPath, taskAccess: isSystemAdmin() ? taskAccess : 'checking', writeStarted: false, writeSuccess: false, commentReadBackExists: false, activityReadBackExists: false });
    if (!isSystemAdmin() && employeeProfile?.appUserId) {
      try {
        const accessSnapshot = await get(ref(database, `${regularWorkTaskAccessPath}/${databaseRecordKey(employeeProfile.appUserId)}/${databaseRecordKey(taskId)}`));
        taskAccess = accessSnapshot.val() === true;
      } catch (error) {
        console.error('[RW COMMENT] task-access diagnostic read failed', {
          code: error?.code || '(no Firebase code)', message: error?.message || String(error || 'Unknown error'),
          taskId, authUid: actorUid || '(none)', maskedEmail: maskedDiagnosticEmail(actorEmail), commentPath, activityPath
        });
        throw error;
      }
    }
    onProgress({ commentPath, activityPath, taskAccess, writeStarted: false, writeSuccess: false, commentReadBackExists: false, activityReadBackExists: false });
    const relativeUpdates = {
      [`comments/${databaseRecordKey(taskId)}/${databaseRecordKey(commentId)}`]: savedComment,
      [`activity/${databaseRecordKey(taskId)}/${databaseRecordKey(activityId)}`]: savedActivity
    };
    const matchesSavedRecord = (snapshot, expected) => {
      const actual = snapshot.val();
      return snapshot.exists()
        && Object.entries(expected).every(([key, value]) => actual?.[key] === value)
        && actual?.createdByUid === actorUid;
    };
    try {
      onProgress({ writeStarted: true });
      await update(ref(database, regularWorkPath), relativeUpdates);
      onProgress({ writeSuccess: true });
      const [commentSnapshot, activitySnapshot] = await Promise.all([
        get(ref(database, commentPath)),
        get(ref(database, activityPath))
      ]);
      const commentReadBackExists = matchesSavedRecord(commentSnapshot, savedComment);
      const activityReadBackExists = matchesSavedRecord(activitySnapshot, savedActivity);
      onProgress({ commentReadBackExists, activityReadBackExists });
      if (!commentReadBackExists || !activityReadBackExists) throw new Error('Firebase write completed but read-back did not confirm both Regular Work comment records.');
      const savedCommentReadBack = commentSnapshot.val();
      const savedActivityReadBack = activitySnapshot.val();

      const upsertSnapshotRecord = (records, record) => [
        ...records.filter(item => !(item.task === record.task && item.id === record.id)),
        record
      ];
      lastRegularWorkSnapshot.comments = upsertSnapshotRecord(lastRegularWorkSnapshot.comments, savedCommentReadBack);
      lastRegularWorkSnapshot.activity = upsertSnapshotRecord(lastRegularWorkSnapshot.activity, savedActivityReadBack);
      onProgress({ writeSuccess: true, commentReadBackExists: true, activityReadBackExists: true });
      return { comment: savedCommentReadBack, activity: savedActivityReadBack, commentReadBackExists: true, activityReadBackExists: true };
    } catch (error) {
      console.error('[RW COMMENT] Firebase atomic save failed', {
        code: error?.code || '(no Firebase code)',
        message: error?.message || String(error || 'Unknown error'),
        taskId,
        authUid: actorUid || '(none)',
        maskedEmail: maskedDiagnosticEmail(actorEmail),
        commentPath,
        activityPath,
        taskAccess
      });
      throw error;
    }
  },
  watchRegularWorkDailyTasks(parentTaskIds, callback) {
    if (typeof callback !== 'function') return () => {};
    const ids = [...new Set(parentTaskIds || [])];
    if (isSystemAdmin()) {
      return onValue(ref(database, regularWorkDailyTasksPath), snapshot => {
        const all = snapshot.exists() ? snapshot.val() : {};
        ids.forEach(parentTaskId => callback(parentTaskId, recordsWithKeys(all?.[parentTaskId] || {})));
      }, error => console.error('Could not monitor Daily Tasks:', error));
    }
    const stops = ids
      .filter(parentTaskId => isSystemAdmin() || window.firebaseHub.canAccessRegularWorkTask(parentTaskId))
      .map(parentTaskId => onValue(ref(database, `${regularWorkDailyTasksPath}/${parentTaskId}`), snapshot => {
        callback(parentTaskId, snapshot.exists() ? recordsWithKeys(snapshot.val()) : []);
      }, error => console.error(`Could not monitor Daily Tasks for ${parentTaskId}:`, error)));
    return () => stops.forEach(stop => stop());
  },
  friendlyError: friendlyAuthError,
  async createEmployeeAccount(email, password, profile) {
    if (!isSystemAdmin()) throw new Error('Only the System Admin can create employee accounts.');
    if (recoveryPending) throw new Error('Workspace recovery is still running. Please retry employee creation in a moment.');
    let credential;
    let rollbackError = null;
    try {
      credential = await createUserWithEmailAndPassword(employeeCreationAuth, email, password);
      const uid = credential.user.uid;
      const savedProfile = {
        ...profile,
        uid,
        email: credential.user.email,
        role: 'employee',
        createdBy: profile.createdBy || auth.currentUser.uid
      };
      delete savedProfile.password;
      delete savedProfile.temporaryPassword;
      delete savedProfile.initialPassword;
      await set(ref(database, `${employeeProfilesPath}/${uid}`), savedProfile);
      const record = employeeManagementRecord(savedProfile, uid);
      await upsertArrayRecord(`${adminManagementPath}/users`, record, { rejectUidConflict: true, rejectExistingId: true });
      await upsertArrayRecord(`${employeeDirectoryPath}/users`, safeDirectory({ users: [record] }).users[0], { rejectExistingId: true });
      return { uid, email: credential.user.email };
    } catch (error) {
      if (credential?.user) {
        await removeNewEmployeeRecord(`${employeeDirectoryPath}/users`, credential.user.uid, profile).catch(caught => { rollbackError ||= caught; });
        await removeNewEmployeeRecord(`${adminManagementPath}/users`, credential.user.uid, profile).catch(caught => { rollbackError ||= caught; });
        await set(ref(database, `${employeeProfilesPath}/${credential.user.uid}`), null).catch(caught => { rollbackError ||= caught; });
        await deleteUser(credential.user).catch(caught => { rollbackError ||= caught; });
      }
      const explanation = rollbackError
        ? ` Employee account creation failed and automatic cleanup was incomplete (${rollbackError.message}). Please inspect Firebase Authentication and executionHub/users before retrying.`
        : ' The new Firebase account was rolled back; no existing employee account was changed.';
      throw new Error(`${error?.message || 'Employee account creation failed.'}${credential?.user ? explanation : ''}`);
    } finally {
      await signOut(employeeCreationAuth).catch(() => {});
    }
  },
  async saveEmployeeProfile(uid, profile) {
    if (!isSystemAdmin()) throw new Error('Only the system administrator may update employee profiles.');
    if (recoveryPending) throw new Error('Workspace recovery is still running. Please retry in a moment.');
    if (!uid || uid === auth.currentUser?.uid || profile.email?.toLowerCase() === SYSTEM_ADMIN_EMAIL.toLowerCase()) throw new Error('The System Admin account cannot be edited as an employee.');
    const savedProfile = { ...profile, uid, role: 'employee', createdBy: profile.createdBy || auth.currentUser.uid };
    delete savedProfile.password;
    delete savedProfile.temporaryPassword;
    delete savedProfile.initialPassword;
    await set(ref(database, `${employeeProfilesPath}/${uid}`), savedProfile);
    const record = employeeManagementRecord(savedProfile, uid);
    await upsertArrayRecord(`${adminManagementPath}/users`, record);
    await upsertArrayRecord(`${employeeDirectoryPath}/users`, safeDirectory({ users: [record] }).users[0]);
  },
  async updateEmployeeStatus(uid, status) {
    if (!isSystemAdmin()) throw new Error('Only the system administrator may update employee status.');
    if (recoveryPending) throw new Error('Workspace recovery is still running. Please retry in a moment.');
    if (!uid || uid === auth.currentUser?.uid) throw new Error('The System Admin account cannot be deactivated.');
    const snapshot = await get(ref(database, `${employeeProfilesPath}/${uid}`));
    if (!snapshot.exists()) throw new Error('The Firebase employee profile was not found.');
    const profile = { ...snapshot.val(), status, uid, role: 'employee' };
    await set(ref(database, `${employeeProfilesPath}/${uid}`), profile);
    const record = employeeManagementRecord(profile, uid);
    await upsertArrayRecord(`${adminManagementPath}/users`, record);
    await upsertArrayRecord(`${employeeDirectoryPath}/users`, safeDirectory({ users: [record] }).users[0]);
  },
  async resetPassword(email) { return sendPasswordResetEmail(auth, email); },
  async signOut() {
    if (stopWatching) stopWatching();
    stopWatching = null;
    if (stopProfileWatch) stopProfileWatch();
    stopProfileWatch = null;
    if (stopPrivateWatching) stopPrivateWatching();
    stopPrivateWatching = null;
    if (stopManagementWatching) stopManagementWatching();
    stopManagementWatching = null;
    if (stopRegularWorkWatching) stopRegularWorkWatching();
    stopRegularWorkWatching = null;
    await signOut(auth);
  },
  async saveState(state) {
    if (!auth.currentUser) return false;
    if (!appDataWritesEnabled || (isSystemAdmin() && recoveryPending)) {
      deferredSaveState = state;
      console.warn('Workspace save deferred until the legacy-data backup and recovery completes.');
      return false;
    }
    const cleaned = cleanWorkspaceState(state);
    const json = JSON.stringify(cleaned);
    const directory = safeDirectory(state);
    const directoryJson = JSON.stringify(directory);
    const management = managementRecords(state);
    const managementJson = JSON.stringify(management);
    const privateSnapshot = clonePrivateCollections(state);
    const privateJson = JSON.stringify(privateSnapshot);
    const admin = isSystemAdmin();
    const regularSnapshot = regularWorkDataFromState(state, auth.currentUser.uid, admin);
    const regularJson = JSON.stringify(regularSnapshot);
    const regularChanged = regularJson !== JSON.stringify(lastRegularWorkSnapshot);
    if (json === lastStateJson && !regularChanged && (!admin || (!safeEmployeeDirectoryNeedsSync && privateJson === lastPrivateJson && directoryJson === JSON.stringify(safeDirectory(adminManagement)) && managementJson === JSON.stringify(adminManagement)))) return true;
    saveQueue = saveQueue.catch(() => {}).then(async () => {
      if (json !== lastStateJson) {
        if (admin) await set(ref(database, workspacePath), cleaned);
        else await saveEmployeeScopedChanges(state);
        lastStateJson = json;
      }
      if (regularChanged) await saveRegularWorkData(state);
      const directoryChanged = directoryJson !== JSON.stringify(safeDirectory(adminManagement));
      const managementChanged = managementJson !== JSON.stringify(adminManagement);
      const safeDirectoryChanged = safeEmployeeDirectoryReadable && (safeEmployeeDirectoryNeedsSync || directoryChanged || managementChanged);
      if (admin && (directoryChanged || managementChanged || safeDirectoryChanged)) {
        const adminDirectoryWrites = [
          set(ref(database, employeeDirectoryPath), directory),
          set(ref(database, adminManagementPath), management)
        ];
        if (safeDirectoryChanged) adminDirectoryWrites.push(set(ref(database, safeEmployeeDirectoryPath), safeEmployeeDirectory(state)));
        await Promise.all(adminDirectoryWrites);
        if (safeDirectoryChanged) safeEmployeeDirectoryNeedsSync = false;
        adminManagement = management;
      }
      if (admin && privateDataAvailable && privateJson !== lastPrivateJson) {
        const updates = {};
        privateCollections.forEach(collection => {
          const previous = new Map(lastPrivateData[collection].map((record, index) => [recordIdentity(record, index), record]));
          const next = new Map(privateSnapshot[collection].map((record, index) => [recordIdentity(record, index), record]));
          previous.forEach((record, id) => {
            if (!next.has(id)) {
              const key = privateRecordKeys[collection].get(id) || databaseRecordKey(id);
              updates[`${privateDataPath}/${collection}/${key}`] = null;
            }
          });
          next.forEach((record, id) => {
            if (JSON.stringify(previous.get(id)) === JSON.stringify(record)) return;
            const key = privateRecordKeys[collection].get(id) || databaseRecordKey(id);
            updates[`${privateDataPath}/${collection}/${key}`] = record;
          });
        });
        if (Object.keys(updates).length) await update(ref(database), updates);
        lastPrivateData = clonePrivateCollections(privateSnapshot);
        lastPrivateJson = privateJson;
        privateCollections.forEach(collection => {
          const nextKeys = new Map();
          privateSnapshot[collection].forEach((record, index) => {
            const id = recordIdentity(record, index);
            nextKeys.set(id, privateRecordKeys[collection].get(id) || databaseRecordKey(id));
          });
          privateRecordKeys[collection] = nextKeys;
        });
      }
      lastApplicationState = JSON.parse(JSON.stringify(state));
    });
    try {
      await saveQueue;
      return true;
    } catch (error) {
      console.error('Could not save Firebase workspace data:', error);
      window.dispatchEvent(new CustomEvent('firebase-save-error', { detail: error }));
      return false;
    }
  },
  startRealtimeSync,
  get authState() {
    return firebaseAuthState;
  },
  AUTH_LOADING,
  AUTHENTICATED,
  SIGNED_OUT
};

function startupError(error) {
  console.error('Firebase startup failed:', error);
  showLogin(friendlyAuthError(error));
}

try {
  let legacy = null;
  try { legacy = JSON.parse(localStorage.getItem('executionHubStateFinal') || 'null'); } catch { /* Discard a malformed obsolete cache. */ }
  if (legacy) {
    const { currentUser, ...savedState } = legacy;
    stripLegacyCredentials(savedState);
    legacyState = savedState;
  }
  sessionStorage.removeItem('executionHubSessionFinal');
  setFirebaseAuthState(AUTH_LOADING);
  await setPersistence(auth, browserLocalPersistence);
  await setPersistence(employeeCreationAuth, inMemoryPersistence);
  let firstAuthState = true;
  onAuthStateChanged(auth, user => {
    if (firstAuthState) firstAuthState = false;
    handleAuthState(user).catch(startupError);
  }, startupError);
} catch (error) {
  startupError(error);
}
