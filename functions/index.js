const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { initializeApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getDatabase } = require('firebase-admin/database');

const ADMIN_EMAIL = 'ashish@arpitatravels.com';
  const resubmitting = requester && before.status === 'Changes Requested' && after.version === (before.version || 1) + 1;
const STATE_PATH = 'executionHub/workspaces/default/state';
const USERS_PATH = 'executionHub/users';
const REGION = 'asia-southeast1';
initializeApp({ databaseURL: 'https://project-hub-emp-default-rtdb.asia-southeast1.firebasedatabase.app' });
const db = getDatabase();

function requireSignedIn(request) {
  if (!request.auth?.uid || !request.auth.token.email) throw new HttpsError('unauthenticated', 'Sign in is required.');
}
function isAdmin(request) {
  return request.auth?.token.email?.toLowerCase() === ADMIN_EMAIL;
}
function requireAdmin(request) {
  requireSignedIn(request);
  if (!isAdmin(request)) throw new HttpsError('permission-denied', 'Only the System Admin can perform this action.');
}
function clone(value) { return JSON.parse(JSON.stringify(value ?? null)); }
function stripCredentials(value) {
  if (Array.isArray(value)) { value.forEach(stripCredentials); return value; }
  if (!value || typeof value !== 'object') return value;
  ['passwordHash', 'password', 'temporaryPassword'].forEach(key => delete value[key]);
  Object.values(value).forEach(stripCredentials);
  return value;
}
function list(value) { return Array.isArray(value) ? value : []; }
function keyOf(record) { return String(record?.id || ''); }
function changed(a, b) { return JSON.stringify(a ?? null) !== JSON.stringify(b ?? null); }
function employeeAccess(profile, project) {
  return !!project && (project.team || []).includes(profile.appUserId);
}
function categoryOwner(profile, project, task) {
  return project?.projectLead === profile.appUserId || (project?.workstreams || []).some(ws => ws.name === task?.workstream && ws.owner === profile.appUserId);
}
function validateTaskChange(profile, oldTask, newTask, project) {
  if (!employeeAccess(profile, project)) throw new HttpsError('permission-denied', 'Project access is required.');
  if (!(project.workstreams || []).some(workstream => workstream.name === newTask.workstream)) throw new HttpsError('permission-denied', 'Tasks must belong to an existing project category.');
  const manager = categoryOwner(profile, project, oldTask || newTask);
  if (oldTask) {
    if (!manager && oldTask.owner !== profile.appUserId) throw new HttpsError('permission-denied', 'Only the task owner or project/category lead may update this task.');
    const allowed = manager
      ? new Set(['owner', 'status', 'progress', 'next', 'waitingOn', 'pendingDue', 'currentDue', 'reschedules', 'completedAt', 'approvalBlockId'])
      : new Set(['status', 'progress', 'next', 'waitingOn', 'pendingDue']);
    const keys = new Set([...Object.keys(oldTask), ...Object.keys(newTask)]);
    for (const key of keys) if (changed(oldTask[key], newTask[key]) && !allowed.has(key)) throw new HttpsError('permission-denied', `Task field ${key} cannot be changed by this user.`);
    if (manager && !['project', 'workstream', 'reviewer', 'originalDue'].every(key => !changed(oldTask[key], newTask[key]))) throw new HttpsError('permission-denied', 'Task project, category, reviewer, and original commitment cannot be rewritten.');
    if (manager && changed(oldTask.owner, newTask.owner) && !(project.team || []).includes(newTask.owner)) throw new HttpsError('permission-denied', 'Task owners must be project members.');
  } else if (!manager && newTask.owner !== profile.appUserId) {
    throw new HttpsError('permission-denied', 'Employees may create tasks only for themselves.');
  }
  if (newTask.project !== project.id || !(project.team || []).includes(newTask.owner)) throw new HttpsError('permission-denied', 'Task project and owner must be valid project members.');
}
function appendOnly(oldItems, newItems, validate) {
  const oldById = new Map(list(oldItems).map(item => [keyOf(item), item]));
  const output = list(oldItems).map(clone);
  for (const item of list(newItems)) {
    const id = keyOf(item);
    if (!id) continue;
    const before = oldById.get(id);
    if (!before) {
      validate(null, item);
      output.push(clone(item));
    } else if (changed(before, item)) {
      validate(before, item);
      const index = output.findIndex(entry => keyOf(entry) === id);
      output[index] = clone(item);
    }
  }
  return output;
}
function mergeEmployeeState(current, submitted, profile) {
  const next = { ...current };
  next.projects = appendOnly(current.projects, submitted.projects, (before, after) => {
    if (!before) throw new HttpsError('permission-denied', 'Only the System Admin can create projects.');
    if (before.projectLead !== profile.appUserId || !employeeAccess(profile, before)) throw new HttpsError('permission-denied', 'Only this project’s Project Lead may manage project settings.');
    const allowed = new Set(['team', 'workstreams', 'lifecycle', 'launchedAt', 'revivedAt', 'health', 'progress']);
    const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
    for (const key of keys) if (changed(before[key], after[key]) && !allowed.has(key)) throw new HttpsError('permission-denied', `Project field ${key} cannot be changed here.`);
    if (!(after.team || []).includes(profile.appUserId) || !(after.team || []).includes(before.projectLead)) throw new HttpsError('permission-denied', 'A Project Lead cannot remove their own project access.');
    if ((after.team || []).some(uid => !list(current.users).some(user => user.id === uid) && !(before.team || []).includes(uid))) throw new HttpsError('permission-denied', 'Project teams may contain only existing employees.');
    if ((after.workstreams || []).some(workstream => !(after.team || []).includes(workstream.owner))) throw new HttpsError('permission-denied', 'Category owners must be members of the project team.');
  });
  const projectById = new Map(next.projects.map(project => [project.id, project]));

  const approvableTasks = new Set(list(submitted.approvals).filter(approval => (approval.approvers || []).includes(profile.appUserId) && approval.autoComplete && approval.status !== 'Pending').map(approval => approval.task).filter(Boolean));
  next.tasks = appendOnly(current.tasks, submitted.tasks, (before, task) => {
    const project = projectById.get(task.project);
    const canDirectlyEdit = employeeAccess(profile, project) && (before?.owner === profile.appUserId || categoryOwner(profile, project, before));
    if (approvableTasks.has(task.id) && before?.approvalBlockId && !canDirectlyEdit) {
      const allowed = new Set(['status', 'progress', 'completedAt', 'next', 'waitingOn', 'approvalBlockId']);
      const keys = new Set([...Object.keys(before), ...Object.keys(task)]);
      for (const key of keys) if (changed(before[key], task[key]) && !allowed.has(key)) throw new HttpsError('permission-denied', `Scoped approvers cannot change task field ${key}.`);
    } else validateTaskChange(profile, before, task, project);
  });
  const taskById = new Map(next.tasks.map(task => [task.id, task]));
  next.comments = appendOnly(current.comments, submitted.comments, (_before, comment) => {
    const task = taskById.get(comment.task);
    const project = projectById.get(task?.project);
    if (_before || comment.user !== profile.appUserId || !employeeAccess(profile, project) || !task) throw new HttpsError('permission-denied', 'Comments must be new and authored by the signed-in employee on an accessible task.');
  });
  next.activity = appendOnly(current.activity, submitted.activity, (_before, event) => {
    if (_before || event.user !== profile.appUserId) throw new HttpsError('permission-denied', 'Activity records must be new and attributed to the signed-in employee.');
  });

  const currentApprovals = list(current.approvals);
  next.approvals = appendOnly(currentApprovals, submitted.approvals, (before, after) => {
    if (!before) {
      const task = taskById.get(after.task);
      const project = projectById.get(after.project || task?.project);
      const knownUsers = new Set([...list(current.users).map(user => user.id), 'u1']);
      if (after.requestedBy !== profile.appUserId || (after.task && (!task || !employeeAccess(profile, project))) || (after.project && !employeeAccess(profile, project)) || !(after.approvers || []).length || (after.approvers || []).some(uid => uid === profile.appUserId || !knownUsers.has(uid))) throw new HttpsError('permission-denied', 'Approval requests must be submitted by the signed-in employee to valid colleagues for accessible work.');
      return;
    }
    const immutable = ['id', 'task', 'project', 'title', 'type', 'requestedBy', 'approvers', 'approvalMode', 'reference', 'priority', 'detail', 'blocking', 'autoComplete'];
    if (immutable.some(key => changed(before[key], after[key]))) throw new HttpsError('permission-denied', 'Approval identity and routing cannot be changed by employees.');
    const approver = (before.approvers || []).includes(profile.appUserId);
    const requester = before.requestedBy === profile.appUserId;
    if (!approver && !requester) throw new HttpsError('permission-denied', 'Only the requester or a selected approver can update this approval.');
    const resubmitting = requester && before.status === 'Changes Requested' && after.version === (before.version || 1) + 1;
    const decisionKeys = new Set([...Object.keys(before.decisions || {}), ...Object.keys(after.decisions || {})]);
    for (const decisionUid of decisionKeys) {
      if (decisionUid !== profile.appUserId && changed(before.decisions?.[decisionUid], after.decisions?.[decisionUid])) throw new HttpsError('permission-denied', 'Employees cannot modify another approver’s decision.');
    }
    if (!requester && (changed(before.version, after.version) || changed(before.requestedAt, after.requestedAt) || changed(before.dueAt, after.dueAt))) throw new HttpsError('permission-denied', 'Approvers cannot alter approval deadlines or versions.');
    if (requester && !resubmitting && changed(before.decisions, after.decisions)) throw new HttpsError('permission-denied', 'Requesters cannot edit approval decisions.');
    if (requester && !resubmitting && (changed(before.dueAt, after.dueAt) || changed(before.requestedAt, after.requestedAt))) throw new HttpsError('permission-denied', 'Only a new approval version may change its deadline.');
    const oldComments = list(before.comments), newComments = list(after.comments);
    if (newComments.length < oldComments.length || oldComments.some((comment, index) => changed(comment, newComments[index])) || newComments.slice(oldComments.length).some(comment => comment.user !== profile.appUserId)) throw new HttpsError('permission-denied', 'Approval comments must be authored by the signed-in employee.');
    if (changed(before.version, after.version) && !resubmitting) throw new HttpsError('permission-denied', 'Only the requester may resubmit a returned approval as a new version.');
    if (resubmitting && (Object.keys(after.decisions || {}).length || after.status !== 'Pending')) throw new HttpsError('permission-denied', 'A resubmitted approval must reset decisions and return to Pending.');
    if (changed(before.decisions?.[profile.appUserId], after.decisions?.[profile.appUserId])) {
      if (!approver || !after.decisions?.[profile.appUserId] || !['Approved', 'Rejected', 'Changes Requested'].includes(after.decisions[profile.appUserId].status)) throw new HttpsError('permission-denied', 'Only a selected approver may record their own valid decision.');
      const statuses = (after.approvers || []).map(id => after.decisions?.[id]?.status);
      const expected = statuses.includes('Changes Requested') ? 'Changes Requested' : statuses.includes('Rejected') ? 'Rejected' : (after.approvalMode === 'any' ? statuses.includes('Approved') : statuses.length > 0 && statuses.every(status => status === 'Approved')) ? 'Approved' : 'Pending';
      if (after.status !== expected) throw new HttpsError('permission-denied', 'Approval status must match the recorded approver decisions.');
    } else if (!resubmitting && after.status !== before.status) {
      if (!(requester && after.status === 'Cancelled' && before.status === 'Pending' && after.cancelledBy === profile.appUserId)) throw new HttpsError('permission-denied', 'Requesters may only cancel pending approvals or resubmit returned versions.');
    }
    const allowedChanges = requester
      ? new Set(['status', 'comments', 'rounds', 'version', 'requestedAt', 'dueAt', 'decisions', 'cancelledAt', 'cancelledBy'])
      : new Set(['status', 'comments', 'decisions', 'completedAt']);
    const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
    for (const key of keys) if (changed(before[key], after[key]) && !allowedChanges.has(key)) throw new HttpsError('permission-denied', `Approval field ${key} cannot be changed by this user.`);
  });

  next.calendarEvents = appendOnly(current.calendarEvents, submitted.calendarEvents, (before, after) => {
    const project = projectById.get(after.project);
    if (!before) {
      if (after.createdBy !== profile.appUserId || (project && !employeeAccess(profile, project))) throw new HttpsError('permission-denied', 'Calendar events must be created by the signed-in employee within accessible projects.');
      if (after.type === 'meeting' && (!project || !(project.team || []).includes(profile.appUserId) || (project.projectLead !== profile.appUserId && !taskById.has(after.task)) || (after.participants || []).some(uid => !(project.team || []).includes(uid)))) throw new HttpsError('permission-denied', 'Only an authorized project participant may schedule a project meeting for project members.');
      if (after.type === 'workblock' && !(after.participants || []).includes(profile.appUserId)) throw new HttpsError('permission-denied', 'Personal work blocks must belong to their creator.');
      return;
    }
    if (before.createdBy !== profile.appUserId && !(before.participants || []).includes(profile.appUserId)) throw new HttpsError('permission-denied', 'Only the event creator or a participant may update it.');
    if (['id', 'project', 'task', 'type', 'title', 'date', 'start', 'end', 'createdBy', 'participants', 'agenda', 'reminderMinutes'].some(key => changed(before[key], after[key]))) throw new HttpsError('permission-denied', 'Employees cannot change calendar event identity or schedule.');
    const responseKeys = new Set([...Object.keys(before.responses || {}), ...Object.keys(after.responses || {})]);
    if (changed(before.responses?.[profile.appUserId], after.responses?.[profile.appUserId]) && !(before.participants || []).includes(profile.appUserId)) throw new HttpsError('permission-denied', 'Only meeting participants may change their RSVP.');
    for (const responseUid of responseKeys) if (responseUid !== profile.appUserId && changed(before.responses?.[responseUid], after.responses?.[responseUid])) throw new HttpsError('permission-denied', 'Meeting participants cannot change another person’s RSVP.');
  });

  next.performanceReviews = list(current.performanceReviews).map(clone);
  next.performanceSnapshots = list(current.performanceSnapshots).map(clone);
  next.departments = list(current.departments).map(clone);
  next.users = list(current.users).map(clone);
  next.approvalHistory = list(current.approvalHistory).map(clone);
  next.plannerRead = current.plannerRead || {};
  next.schemaVersion = current.schemaVersion;
  return stripCredentials(next);
}
function scopedWorkspace(state, profile) {
  const projects = list(state.projects).filter(project => employeeAccess(profile, project));
  const ids = new Set(projects.map(project => project.id));
  const approvals = list(state.approvals).filter(approval => approval.requestedBy === profile.appUserId || (approval.approvers || []).includes(profile.appUserId) || list(state.tasks).some(task => task.id === approval.task && ids.has(task.project)));
  const approvalTaskIds = new Set(approvals.map(approval => approval.task).filter(Boolean));
  const tasks = list(state.tasks).filter(task => ids.has(task.project) || approvalTaskIds.has(task.id));
  const taskIds = new Set(tasks.map(task => task.id));
  const teamIds = new Set([profile.appUserId, ...projects.flatMap(project => project.team || []), ...approvals.flatMap(approval => [approval.requestedBy, ...(approval.approvers || [])])]);
  return {
    schemaVersion: state.schemaVersion || '',
    users: list(state.users).filter(user => teamIds.has(user.id) && user.email?.toLowerCase() !== ADMIN_EMAIL),
    departments: list(state.departments).filter(department => list(state.users).some(user => teamIds.has(user.id) && user.departmentId === department.id)),
    projects,
    tasks,
    approvals,
    approvalHistory: list(state.approvalHistory).filter(item => approvals.some(approval => approval.id === item.approval)),
    comments: list(state.comments).filter(comment => taskIds.has(comment.task)),
    activity: list(state.activity).filter(item => !item.project ? item.user === profile.appUserId : ids.has(item.project)),
    calendarEvents: list(state.calendarEvents).filter(event => (event.project && ids.has(event.project)) || (event.participants || []).includes(profile.appUserId)),
    performanceReviews: [],
    performanceSnapshots: [],
    plannerRead: Object.fromEntries(Object.entries(state.plannerRead || {}).filter(([key]) => key.endsWith(`-${profile.appUserId}`)))
  };
}

exports.createEmployeeProfile = onCall({ region: REGION }, async request => {
  requireAdmin(request);
  const profile = request.data?.profile;
  const uid = String(request.data?.uid || '');
  if (!uid || !profile || profile.role !== 'employee' || profile.createdBy !== ADMIN_EMAIL || !['active', 'inactive', 'resigned', 'suspended'].includes(profile.status)) throw new HttpsError('invalid-argument', 'Invalid employee profile.');
  const record = { ...profile, uid, email: String(profile.email || '').trim().toLowerCase(), createdBy: ADMIN_EMAIL };
  if (!record.email || record.email === ADMIN_EMAIL) throw new HttpsError('invalid-argument', 'Invalid employee email.');
  await db.ref(`${USERS_PATH}/${uid}`).set(record);
  return { uid };
});

exports.saveEmployeeProfile = onCall({ region: REGION }, async request => {
  requireAdmin(request);
  const profile = request.data?.profile;
  const uid = String(request.data?.uid || '');
  if (!uid || uid === request.auth.uid || !profile || profile.role !== 'employee' || profile.createdBy !== ADMIN_EMAIL || profile.email?.toLowerCase() === ADMIN_EMAIL) throw new HttpsError('invalid-argument', 'Invalid or protected employee profile.');
  if (!['active', 'inactive', 'resigned', 'suspended'].includes(profile.status)) throw new HttpsError('invalid-argument', 'Invalid employee status.');
  const previous = await db.ref(`${USERS_PATH}/${uid}`).get();
  if (!previous.exists() || previous.val().uid !== uid) throw new HttpsError('not-found', 'The Firebase employee profile was not found.');
  const saved = { ...profile, uid, role: 'employee', createdBy: ADMIN_EMAIL };
  await db.ref(`${USERS_PATH}/${uid}`).set(saved);
  if (saved.status !== 'active') await getAuth().revokeRefreshTokens(uid);
  return { uid };
});

exports.loadWorkspace = onCall({ region: REGION }, async request => {
  requireSignedIn(request);
  if (isAdmin(request)) {
    const snapshot = await db.ref(STATE_PATH).get();
    return snapshot.exists() ? snapshot.val() : {};
  }
  const uid = request.auth.uid;
  const profileSnapshot = await db.ref(`${USERS_PATH}/${uid}`).get();
  const profile = profileSnapshot.val();
  if (!profile || profile.uid !== uid || profile.role !== 'employee') throw new HttpsError('permission-denied', 'Your account is not authorized for this application. Please contact the administrator.');
  if (profile.status !== 'active') {
    const messages = { inactive: 'Your account is inactive. Please contact the administrator.', resigned: 'Your account is marked as resigned. Please contact the administrator.', suspended: 'Your account is suspended. Please contact the administrator.' };
    throw new HttpsError('permission-denied', messages[profile.status] || 'Your account is disabled. Please contact the administrator.');
  }
  const stateSnapshot = await db.ref(STATE_PATH).get();
  return scopedWorkspace(stripCredentials(stateSnapshot.val() || {}), profile);
});

exports.saveWorkspace = onCall({ region: REGION }, async request => {
  requireSignedIn(request);
  if (isAdmin(request)) throw new HttpsError('invalid-argument', 'Admin clients write the workspace directly.');
  const uid = request.auth.uid;
  const [profileSnapshot, stateRef] = await Promise.all([db.ref(`${USERS_PATH}/${uid}`).get(), Promise.resolve(db.ref(STATE_PATH))]);
  const profile = profileSnapshot.val();
  if (!profile || profile.uid !== uid || profile.role !== 'employee' || profile.status !== 'active') throw new HttpsError('permission-denied', 'Your account is not active.');
  const submitted = request.data?.state;
  if (!submitted || typeof submitted !== 'object') throw new HttpsError('invalid-argument', 'Workspace state is required.');
  await stateRef.transaction(current => mergeEmployeeState(current || {}, submitted, profile));
  return { ok: true };
});
