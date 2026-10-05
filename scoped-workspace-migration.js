(function (root, factory) {
  const migration = factory();
  if (typeof module === 'object' && module.exports) module.exports = migration;
  if (root) root.ScopedWorkspaceMigration = migration;
})(typeof globalThis === 'undefined' ? this : globalThis, function () {
  const ADMIN_EMAIL = 'ashish@enchantingmp.in';
  const accessFields = ['projectAccess', 'taskAccess', 'projectTaskAccess', 'approvalAccess', 'calendarAccess', 'teamAccess', 'departmentAccess'];

  function isSystemAdminEmail(email) { return String(email || '').toLowerCase() === ADMIN_EMAIL.toLowerCase(); }

  function validateEmployeeProfile(user, profile) {
    if (!profile || profile.uid !== user?.uid || profile.email?.toLowerCase() !== user?.email?.toLowerCase() || profile.role !== 'employee') {
      return { allowed: false, code: 'app/not-authorized', message: 'Your account exists but is not authorized for this application. Please contact the administrator.' };
    }
    if (profile.status !== 'active') {
      const message = {
        inactive: 'Your account is inactive. Please contact the administrator.',
        resigned: 'Your account is marked as resigned. Please contact the administrator.',
        suspended: 'Your account is suspended. Please contact the administrator.',
        exited: 'Your account is marked as exited. Please contact the administrator.'
      }[profile.status] || 'Your account is disabled. Please contact the administrator.';
      return { allowed: false, code: 'app/account-disabled', message };
    }
    if (typeof profile.appUserId !== 'string' || !profile.appUserId.trim()) {
      return { allowed: false, code: 'app/not-authorized', message: 'Your employee profile is incomplete. Please contact the administrator.' };
    }
    return { allowed: true, code: '', message: '' };
  }

  function entries(value) {
    if (Array.isArray(value)) return value.map((record, index) => [String(record?.id ?? index), record]).filter(([, record]) => record && typeof record === 'object');
    if (!value || typeof value !== 'object') return [];
    return Object.entries(value).filter(([, record]) => record && typeof record === 'object');
  }

  function strings(value) {
    if (Array.isArray(value)) return value.filter(item => typeof item === 'string' && item).map(String);
    if (value && typeof value === 'object') return Object.keys(value).filter(key => value[key] === true);
    return [];
  }

  function dbKey(value) { return encodeURIComponent(String(value)).replace(/\./g, '%2E'); }
  function isWorkspaceReady(marker) { return marker?.status === 'completed' && marker?.scopedDataVersion === 1; }

  function buildScopedWorkspaceMigration(state = {}) {
    const blockers = new Set();
    const updates = {};
    const employees = entries(state.users).map(([key, record]) => ({ ...record, id: String(record.id ?? key) }))
      .filter(employee => String(employee.email || '').toLowerCase() !== ADMIN_EMAIL.toLowerCase());
    const uidByAppId = new Map();
    const activeUids = new Set();
    const statusByUid = new Map();
    for (const employee of employees) {
      const appUserId = String(employee.appUserId || employee.id || '');
      const authUid = String(employee.authUid || employee.firebaseUid || employee.uid || '');
      if (!appUserId || !authUid) {
        blockers.add(`unmapped employee record ${employee.id || 'unknown'}`);
        continue;
      }
      if (uidByAppId.has(appUserId) && uidByAppId.get(appUserId) !== authUid) blockers.add(`ambiguous appUserId ${appUserId}`);
      uidByAppId.set(appUserId, authUid);
      const status = employee.status || (employee.active === false ? 'inactive' : 'active');
      statusByUid.set(authUid, status);
      if (status === 'active' && employee.active !== false) activeUids.add(authUid);
    }

    const grants = new Map([...activeUids].map(uid => [uid, Object.fromEntries(accessFields.map(field => [field, new Set()]))]));
    const addGrant = (uid, field, id) => { if (uid && grants.has(uid) && id) grants.get(uid)[field].add(String(id)); };
    const uidForAppId = (value, context) => {
      if (!value || String(value) === 'u1') return null;
      const uid = uidByAppId.get(String(value));
      if (!uid) {
        blockers.add(`unmapped ${context} reference ${String(value)}`);
        return null;
      }
      if (!activeUids.has(uid)) return null;
      return uid;
    };
    const uidForDirect = (value, context) => {
      if (!value || String(value) === 'u1') return null;
      const direct = String(value);
      if (activeUids.has(direct)) return direct;
      if (statusByUid.has(direct)) return null;
      return uidForAppId(direct, context);
    };
    const write = (path, value) => { updates[`executionHub/${path}`] = value; };
    const recordRows = collection => entries(state[collection]).map(([key, record]) => ({ id: String(record.id ?? key), record }));

    const projects = recordRows('projects');
    const projectIds = new Set(projects.map(project => project.id));
    const projectMembers = new Map();
    for (const { id, record } of projects) {
      const members = new Set();
      for (const appId of [...strings(record.team), record.projectLead, record.owner].filter(Boolean)) {
        const uid = uidForAppId(appId, `project ${id}`);
        if (!uid) continue;
        members.add(uid);
        addGrant(uid, 'projectAccess', id);
        addGrant(uid, 'teamAccess', id);
      }
      projectMembers.set(id, members);
      write(`shared/projects/${dbKey(id)}`, { ...record, id: record.id || id });
    }

    const projectTasks = recordRows('tasks').filter(({ record }) => record.contextType !== 'regular_work');
    const projectTaskIds = new Set(projectTasks.map(task => task.id));
    for (const { id, record } of projectTasks) {
      const projectId = String(record.project || '');
      if (!projectId || !projectIds.has(projectId)) blockers.add(`project task ${id} has no matching project`);
      const members = new Set(projectMembers.get(projectId) || []);
      for (const field of ['owner', 'assignee', 'reviewer', 'createdBy']) {
        const uid = uidForAppId(record[field], `project task ${id} ${field}`);
        if (!uid) continue;
        members.add(uid);
        addGrant(uid, 'taskAccess', id);
      }
      const creatorUid = uidForDirect(record.createdByUid, `project task ${id} creatorUid`);
      if (creatorUid) { members.add(creatorUid); addGrant(creatorUid, 'taskAccess', id); }
      for (const uid of members) addGrant(uid, 'projectTaskAccess', id);
      write(`shared/tasks/${dbKey(id)}`, { ...record, id: record.id || id });
    }

    const approvals = recordRows('approvals');
    for (const { id, record } of approvals) {
      const approvers = strings(record.approvers);
      for (const appId of [record.requestedBy, ...approvers, ...strings(record.approverIds)].filter(Boolean)) {
        const uid = uidForAppId(appId, `approval ${id}`);
        if (uid) addGrant(uid, 'approvalAccess', id);
      }
      const linkedTask = projectTasks.find(task => task.id === String(record.task || ''))?.record;
      if (linkedTask) {
        for (const field of ['owner', 'reviewer', 'createdBy']) {
          const uid = uidForAppId(linkedTask[field], `approval ${id} linked task`);
          if (uid) addGrant(uid, 'approvalAccess', id);
        }
        const creatorUid = uidForDirect(linkedTask.createdByUid, `approval ${id} task creator`);
        if (creatorUid) addGrant(creatorUid, 'approvalAccess', id);
      }
      write(`shared/approvals/${dbKey(id)}`, { ...record, id: record.id || id, approverIds: Object.fromEntries(approvers.map(appId => [appId, true])) });
    }

    let migratedComments = 0;
    for (const { id, record } of recordRows('comments')) {
      const taskId = String(record.task || '');
      if (!projectTaskIds.has(taskId)) continue;
      write(`shared/comments/${dbKey(taskId)}/${dbKey(id)}`, { ...record, id: record.id || id });
      migratedComments++;
    }

    let migratedActivity = 0;
    const activityRows = recordRows('activity');
    for (const { id, record } of activityRows) {
      const taskId = String(record.task || '');
      if (!taskId || !projectTaskIds.has(taskId) || record.contextType === 'regular_work') continue;
      write(`shared/activity/${dbKey(taskId)}/${dbKey(id)}`, { ...record, id: record.id || id });
      migratedActivity++;
    }

    const calendarEvents = recordRows('calendarEvents');
    for (const { id, record } of calendarEvents) {
      if (record.contextType === 'regular_work' || record.regularWorkTaskId) continue;
      for (const appId of [...strings(record.participants), record.createdBy].filter(Boolean)) {
        const uid = uidForAppId(appId, `calendar event ${id}`);
        if (uid) addGrant(uid, 'calendarAccess', id);
      }
      const creatorUid = uidForDirect(record.createdByUid, `calendar event ${id} creatorUid`);
      if (creatorUid) addGrant(creatorUid, 'calendarAccess', id);
      write(`shared/calendar/${dbKey(id)}`, { ...record, id: record.id || id, participantUserIds: Object.fromEntries(strings(record.participants).map(appId => [appId, true])) });
    }

    for (const [departmentKey, department] of entries(state.departments)) {
      const departmentId = String(department.id || departmentKey);
      const headUid = uidForAppId(department.headId, `department ${departmentId} head`);
      if (headUid) addGrant(headUid, 'departmentAccess', departmentId);
    }

    const userViews = {};
    for (const [uid, access] of grants) {
      userViews[uid] = { scopedSeedVersion: 1 };
      for (const field of accessFields) userViews[uid][field] = Object.fromEntries([...access[field]].map(id => [id, true]));
      write(`userViews/${dbKey(uid)}`, userViews[uid]);
    }

    const safeUsers = employees.map(employee => {
      const appUserId = String(employee.appUserId || employee.id || '');
      const name = String(employee.displayName || employee.name || 'Employee');
      return {
        appUserId,
        displayName: name,
        designation: String(employee.designation || employee.role || 'Team Member'),
        departmentId: String(employee.departmentId || ''),
        departmentName: String(employee.department || employee.dept || 'Unassigned'),
        initials: String(employee.initials || name.trim().split(/\s+/).slice(0, 2).map(part => part[0]?.toUpperCase() || '').join('')),
        active: employee.status ? employee.status === 'active' : employee.active !== false
      };
    }).filter(employee => employee.appUserId);
    const safeDepartments = recordRows('departments').map(({ id, record }) => ({ id: String(record.id || id), name: String(record.name || 'Unassigned') })).filter(department => department.id);
    write('employeeDirectory/safe', { users: safeUsers, departments: safeDepartments });

    const retainedLegacyActivity = activityRows.filter(({ id, record }) => {
      const taskId = String(record.task || '');
      return !taskId || !projectTaskIds.has(taskId) || record.contextType === 'regular_work';
    }).length;
    const activeEmployeeCount = activeUids.size;
    if (!activeEmployeeCount && employees.length) blockers.add('no active employee profiles mapped');
    const counts = {
      projects: projects.length,
      projectTasks: projectTasks.length,
      approvals: approvals.length,
      comments: migratedComments,
      activity: migratedActivity,
      calendar: Object.keys(calendarEvents).length,
      employeesMapped: employees.filter(employee => employee.authUid || employee.uid || employee.firebaseUid).length,
      activeEmployees: activeEmployeeCount,
      userViews: Object.keys(userViews).length,
      safeDirectoryUsers: safeUsers.length,
      safeDirectoryDepartments: safeDepartments.length,
      retainedLegacyActivity
    };
    return { updates, counts, blockers: [...blockers], ready: blockers.size === 0 };
  }

  return { buildScopedWorkspaceMigration, isWorkspaceReady, isSystemAdminEmail, validateEmployeeProfile };
});