import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const rules = JSON.parse(fs.readFileSync(new URL('./database.rules.json', import.meta.url), 'utf8')).rules;
const hosting = JSON.parse(fs.readFileSync(new URL('./firebase.json', import.meta.url), 'utf8')).hosting;
const authSource = fs.readFileSync(new URL('./firebase-bootstrap.js', import.meta.url), 'utf8');
const phase13Source = fs.readFileSync(new URL('./phase13.js', import.meta.url), 'utf8');
const phase19Source = fs.readFileSync(new URL('./phase19.js', import.meta.url), 'utf8');
const employeeFormSource = fs.readFileSync(new URL('./phase18.js', import.meta.url), 'utf8');
const appSource = fs.readFileSync(new URL('./app.js', import.meta.url), 'utf8');
const { escapeHtml } = require('./xss-safety.js');

function ruleAt(...segments) {
  return segments.reduce((current, segment) => current?.[segment], rules.executionHub);
}

test('Firebase Hosting sets required restrictive security headers', () => {
  const headers = hosting.headers.flatMap(entry => entry.headers);
  const values = Object.fromEntries(headers.map(header => [header.key.toLowerCase(), header.value]));
  const csp = values['content-security-policy'];
  assert.ok(csp.includes("script-src 'self' https://www.gstatic.com"));
  assert.ok(csp.includes("frame-ancestors 'none'"));
  assert.ok(csp.includes('https://identitytoolkit.googleapis.com'));
  assert.ok(csp.includes('wss://project-hub-emp-default-rtdb.asia-southeast1.firebasedatabase.app'));
  assert.doesNotMatch(csp, /(?:script-src|connect-src)\s+[^;]*\*/i);
  assert.doesNotMatch(csp, /unsafe-eval/i);
  assert.equal(values['x-content-type-options'], 'nosniff');
  assert.equal(values['referrer-policy'], 'strict-origin-when-cross-origin');
  assert.ok(values['permissions-policy']);
  assert.equal(values['x-frame-options'], 'DENY');
  assert.ok(values['strict-transport-security']);
});

test('project validation protects ID, lead, owner, and creation attribution', () => {
  const validation = ruleAt('shared', 'projects', '$projectId', '.validate');
  for (const field of ['id', 'projectLead', 'owner', 'ownerUid', 'createdBy', 'createdByUid', 'createdAt', 'permissions', 'access', 'accessRole', 'accessUserIds', 'teamAccess', 'allowedUsers']) assert.ok(validation.includes(`child('${field}')`));
  assert.ok(validation.includes("auth.uid === 'lGhNVO4kclh133CqgCiyPo3V5DA3'"));
  assert.ok(validation.includes('auth.token.email_verified === true'));
});

test('every Admin email rule branch requires the trusted UID and a verified email', () => {
  const adminEmailRule = "auth.token.email === 'ashish@enchantingmp.in'";
  const adminUidRule = "auth.uid === 'lGhNVO4kclh133CqgCiyPo3V5DA3'";
  const branches = [];
  function visit(value, path = 'rules') {
    if (typeof value === 'string' && value.includes(adminEmailRule)) branches.push({ path, value });
    else if (value && typeof value === 'object') Object.entries(value).forEach(([key, child]) => visit(child, `${path}.${key}`));
  }
  visit(rules);
  assert.ok(branches.length > 0, 'expected Admin branches in the rules');
  for (const branch of branches) {
    assert.ok(branch.value.includes(adminUidRule), `${branch.path} lacks the trusted Admin UID`);
    assert.ok(branch.value.includes('auth.token.email_verified === true'), `${branch.path} lacks verified-email enforcement`);
  }
  assert.equal(branches.length, (JSON.stringify(rules).match(/auth\.token\.email === 'ashish@enchantingmp\.in'/g) || []).length, 'every Admin email occurrence must be part of a fully bound branch');
});

test('client Admin recognition uses the exact trusted UID, verified email, and email consistency', () => {
  assert.ok(authSource.includes("const TRUSTED_SYSTEM_ADMIN_UID = 'lGhNVO4kclh133CqgCiyPo3V5DA3'"));
  assert.ok(authSource.includes('user.uid === TRUSTED_SYSTEM_ADMIN_UID'));
  assert.ok(authSource.includes('user.emailVerified === true'));
  assert.ok(authSource.includes('user.email?.toLowerCase() === SYSTEM_ADMIN_EMAIL.toLowerCase()'));
  assert.doesNotMatch(authSource, /systemAdminUid/);
  const authorizeStart = authSource.indexOf('async function authorize(user)');
  const authorizeEnd = authSource.indexOf('\nfunction setApplicationVisible', authorizeStart);
  const authorizeSource = authSource.slice(authorizeStart, authorizeEnd);
  const adminGate = authorizeSource.indexOf('const admin = isSystemAdmin(user);');
  const employeeProfileGate = authorizeSource.indexOf('validateEmployeeProfile(user, profile)');
  assert.ok(adminGate >= 0, 'authorize must use the canonical Admin gate');
  assert.ok(employeeProfileGate > adminGate, 'non-Admins must proceed to employee profile validation');
});

test('employee authorization relies on its profile and scoped reads, not the global recovery marker', () => {
  const authorizeStart = authSource.indexOf('async function authorize(user)');
  const authorizeEnd = authSource.indexOf('\nfunction setApplicationVisible', authorizeStart);
  const authorizeSource = authSource.slice(authorizeStart, authorizeEnd);
  const employeeStart = authorizeSource.indexOf('if (!admin) {');
  const employeeEnd = authorizeSource.indexOf('\n  }\n\n  let state;', employeeStart);
  const employeeGate = authorizeSource.slice(employeeStart, employeeEnd);
  assert.ok(employeeStart >= 0);
  assert.ok(employeeGate.includes('validateEmployeeProfile(user, profile)'));
  assert.equal(employeeGate.includes('migrationMetadataPath'), false);
  assert.equal(employeeGate.includes('isWorkspaceReady'), false);
  assert.equal(employeeGate.includes('app/migration-pending'), false);
  assert.ok(authorizeSource.includes('else state = await readEmployeeWorkspace(profile);'));
  assert.ok(authSource.includes('async function readEmployeeWorkspace(profile)'));
  assert.equal(authSource.includes("code === 'app/migration-pending'"), false);
});

test('unverified trusted Admin gets a resend flow and refreshed token before authorization', () => {
  const verificationStart = authSource.indexOf('function showAdminEmailVerification(user)');
  const verificationEnd = authSource.indexOf('\nfunction showLogin', verificationStart);
  const verificationSource = authSource.slice(verificationStart, verificationEnd);
  assert.ok(authSource.includes("code: 'app/admin-verification-required'"));
  assert.ok(verificationSource.includes('await sendEmailVerification(currentUser)'));
  assert.ok(verificationSource.includes('Verification email sent. Open the email, verify your account, then sign in again.'));
  assert.ok(verificationSource.includes("const code = error?.code || 'auth/unknown'"));
  assert.ok(verificationSource.includes('Firebase verification email request failed:'));
  assert.ok(verificationSource.includes('await currentUser.reload()'));
  assert.ok(verificationSource.includes('await refreshedUser.getIdTokenResult(true)'));
  assert.ok(verificationSource.includes('tokenResult.claims.email_verified === true'));
  assert.ok(verificationSource.includes('await signOut(auth)'));
  const authFlowStart = authSource.indexOf('async function handleAuthState(user)');
  const authFlowEnd = authSource.indexOf('\nfunction startRealtimeSync', authFlowStart);
  const authFlowSource = authSource.slice(authFlowStart, authFlowEnd);
  assert.ok(authFlowSource.indexOf('await user.reload()') < authFlowSource.indexOf('await authorize(user)'));
  assert.ok(authFlowSource.indexOf('await user.getIdTokenResult(true)') < authFlowSource.indexOf('await authorize(user)'));
});

test('scoped recovery replaces the derived safe directory instead of retaining stale Admin rows', () => {
  assert.ok(authSource.includes('path === safeEmployeeDirectoryPath'));
  assert.ok(authSource.includes('? planned'));
  assert.ok(authSource.includes(': existing ? mergeData(existing, planned) : planned;'));
});

test('recovery reports precise operation context and uses recovery-specific UI messages', () => {
  for (const field of ['functionName: \'runSparkMigration\'', 'migrationStep', 'path: migrationPath', 'operation:', 'code:', 'message:']) assert.ok(authSource.includes(field));
  assert.ok(authSource.includes("new CustomEvent('firebase-recovery-error'"));
  assert.ok(authSource.includes("new CustomEvent('firebase-recovery-progress'"));
  assert.ok(phase13Source.includes("toast('Workspace recovery is in progress.')"));
  assert.ok(phase13Source.includes("toast('Workspace recovery could not continue. Check the recovery error.')"));
});

test('My Work heading has a semantic fallback for a null user name', () => {
  assert.equal((phase13Source.match(/userName=String\(user\((?:u|currentUser)\)\?\.name\|\|''\)\.trim\(\)\|\|'Team Member'/g) || []).length, 2);
  assert.equal(phase13Source.includes('user(currentUser).name.toUpperCase()'), false);
  assert.equal(phase13Source.includes('user(u).name.toUpperCase()'), false);
  assert.ok(phase19Source.includes("String(user(state.currentUser)?.name||'').trim()||'Team Member'"));
  assert.equal(phase19Source.includes('user(state.currentUser).name.toUpperCase()'), false);
});

test('all three activity paths require an absent old record, even for Admin', () => {
  const writes = [
    ruleAt('shared', 'activity', '$taskId', '$activityId', '.write'),
    ruleAt('regularWork', 'activity', '$taskId', '$activityId', '.write'),
    ruleAt('regularWork', 'ownerActivity', '$ownerUid', '$activityId', '.write')
  ];
  for (const write of writes) {
    assert.ok(write.includes('!data.exists()'));
    assert.ok(write.includes('newData.exists()'));
  }
});

test('Daily Task assignee rules freeze all non-execution fields', () => {
  const daily = ruleAt('regularWork', 'dailyTasks', '$parentTaskId', '$dailyTaskId');
  assert.ok(daily.$other['.validate'].includes('newData.val() === data.val()'));
  for (const field of ['status', 'completedAt', 'completedByUid', 'updatedAt']) assert.ok(daily[field]?.['.validate']);
  for (const field of ['id', 'parentTaskId', 'assignedTo', 'title', 'date', 'priority', 'notes', 'createdBy', 'createdByUid', 'createdAt', 'archived', 'archivedAt', 'archivedByUid']) {
    assert.equal(Object.hasOwn(daily, field), false, `protected field ${field} must remain under the immutable wildcard`);
  }
});

test('login errors use text nodes and generic credential feedback', () => {
  assert.ok(authSource.includes("textContent = friendlyLoginError(error)"));
  assert.ok(authSource.includes("return 'Email or password is incorrect.'"));
  assert.equal(authSource.includes("code === 'app/migration-pending'"), false);
  assert.equal(authSource.includes('Sign in as the verified System Admin to resume it'), false);
  assert.equal(authSource.includes('class="login-error">${message}'), false);
  assert.ok(authSource.includes("'auth/invalid-login-credentials'"));
});

test('employee temporary passwords require fourteen characters', () => {
  assert.ok(employeeFormSource.includes('temporaryPasswordInput.minLength=14'));
  assert.ok(employeeFormSource.includes("length<14"));
  assert.equal(escapeHtml('<img src=x onerror="x">'), '&lt;img src=x onerror=&quot;x&quot;&gt;');
});

test('passwords are stripped before RTDB saves and never written to browser storage or audit logs', () => {
  for (const key of ['password', 'temporaryPassword', 'initialPassword']) assert.ok(authSource.includes(`delete savedProfile.${key}`));
  assert.ok(authSource.includes('delete account.password'));
  assert.ok(authSource.includes('delete account.temporaryPassword'));
  assert.ok(appSource.includes('delete account.password'));
  const source = `${authSource}\n${employeeFormSource}\n${appSource}`;
  assert.doesNotMatch(source, /(?:localStorage|sessionStorage)\.(?:setItem|set)\s*\([^\r\n]*(?:password|passwd|pwd)/i);
  assert.doesNotMatch(source, /\blog(?:Org|Account)?\s*\([^\r\n]*(?:password|temporaryPassword)/i);
});

test('Regular Work structural edits use only targeted record saves', () => {
  const folderHandler = phase19Source.slice(phase19Source.indexOf('openFolderForm=function'), phase19Source.indexOf('openCategoryForm=function'));
  const categoryHandler = phase19Source.slice(phase19Source.indexOf('openCategoryForm=function'), phase19Source.indexOf('function openParentTaskForm'));
  const taskHandler = phase19Source.slice(phase19Source.indexOf('function openParentTaskForm'), phase19Source.indexOf('function archiveParentTask'));
  assert.ok(folderHandler.includes('saveRegularWorkFolder'));
  assert.ok(categoryHandler.includes('saveRegularWorkCategory'));
  assert.ok(taskHandler.includes('saveRegularWorkTask'));
  for (const handler of [folderHandler, categoryHandler, taskHandler]) {
    assert.doesNotMatch(handler, /saveRegularWorkState|\/approvals\/|\/comments\/|\/dailyTasks\//);
  }
  assert.ok(authSource.includes("console.info('[RW SAVE] folder:'"));
  assert.ok(authSource.includes('Folder read-back failed'));
  assert.ok(authSource.includes('Category read-back failed'));
  assert.ok(authSource.includes('Task read-back failed'));
});
