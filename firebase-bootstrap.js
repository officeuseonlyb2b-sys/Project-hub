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
import { get, getDatabase, onValue, ref, set, update } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-database.js';

const SYSTEM_ADMIN_EMAIL = 'ashish@arpitatravels.com';
const AUTH_LOADING = 'AUTH_LOADING';
const AUTHENTICATED = 'AUTHENTICATED';
const SIGNED_OUT = 'SIGNED_OUT';
const firebaseConfig = {
  apiKey: 'AIzaSyC0gOy_JIaIpds2BdoHGv20EZiuHt8ozvM',
  authDomain: 'project-hub-emp.firebaseapp.com',
  databaseURL: 'https://project-hub-emp-default-rtdb.asia-southeast1.firebasedatabase.app',
        const incoming = await readEmployeeWorkspace(employeeProfile);
  storageBucket: 'project-hub-emp.firebasestorage.app',
  messagingSenderId: '360406593945',
  appId: '1:360406593945:web:3ca19e86849053b4f76308',
  measurementId: 'G-DQC30WE2XH'
};

const legacyWorkspacePath = 'executionHub/workspaces/default/state';
const workspacePath = 'executionHub/workspace/employeeVisibleData/state';
const employeeDirectoryPath = 'executionHub/workspace/employeeVisibleData/directory';
const adminManagementPath = 'executionHub/admin/employeeManagement';
const employeeProfilesPath = 'executionHub/users';
const privateDataPath = 'executionHub/admin/private';
const workspaceCollections = ['users', 'departments', 'projects', 'tasks', 'approvals', 'approvalHistory', 'comments', 'activity', 'calendarEvents'];
const privateCollections = ['performanceReviews', 'performanceSnapshots', 'payroll', 'salary', 'salaryRecords', 'overtime', 'overtimeRecords', 'compensation', 'management', 'managementPrivate'];
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
let legacyPrivateDataPending = false;
let saveQueue = Promise.resolve();
let workspaceRecordKeys = Object.fromEntries(workspaceCollections.map(key => [key, new Map()]));
let privateRecordKeys = Object.fromEntries(privateCollections.map(key => [key, new Map()]));
let authFlow = Promise.resolve();
let handlingUid = null;
let pendingAuthMessage = '';
let legacyState = null;
let adminManagement = { users: [], departments: [] };
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
    comments: [], activity: [], calendarEvents: [], plannerRead: {}, ...Object.fromEntries(privateCollections.map(collection => [collection, []]))
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
  });
  return result;
}

function cleanWorkspaceState(value) {
  const result = cleanState(value);
  delete result.users;
  delete result.departments;
  return result;
}

function safeDirectory(state) {
  const users = recordsFrom(state?.users)
    .filter(account => account.email?.toLowerCase() !== SYSTEM_ADMIN_EMAIL.toLowerCase())
    .map(account => {
      const safe = { ...account };
      ['mobile', 'phone', 'reportingTo', 'dateJoined', 'joiningDate', 'departmentHistory', 'createdBy', 'temporaryPassword', 'password', 'passwordHash', 'authUid', 'firebaseUid', 'uid'].forEach(key => delete safe[key]);
      return safe;
    });
  const departments = recordsFrom(state?.departments).map(({ id, name, code, headId, active }) => ({ id, name, code, headId, active }));
  return { users, departments };
}

function managementRecords(state) {
  return { users: recordsFrom(state?.users), departments: recordsFrom(state?.departments) };
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

function privateCollectionsSnapshot(value) {
  return Object.fromEntries(privateCollections.map(collection => [collection, recordsFrom(value?.[collection])]));
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
  const merged = new Map(recordsFrom(primary).map((record, index) => [recordIdentity(record, index), record]));
  recordsFrom(legacy).forEach((record, index) => {
    const id = recordIdentity(record, index);
    if (!merged.has(id)) merged.set(id, record);
  });
  return [...merged.values()];
}

function stripLegacyCredentials(value) {
  if (Array.isArray(value)) { value.forEach(stripLegacyCredentials); return; }
  if (!value || typeof value !== 'object') return;
  ['passwordHash', 'password', 'temporaryPassword'].forEach(key => delete value[key]);
  Object.values(value).forEach(stripLegacyCredentials);
}
function containsLegacyCredentials(value) {
  if (Array.isArray(value)) return value.some(containsLegacyCredentials);
  if (!value || typeof value !== 'object') return false;
  return Object.keys(value).some(key => ['passwordHash', 'password', 'temporaryPassword'].includes(key) || containsLegacyCredentials(value[key]));
}

async function readWorkspace() {
  const [workspaceSnapshot, directorySnapshot, managementSnapshot] = await Promise.all([
    get(ref(database, workspacePath)),
    get(ref(database, employeeDirectoryPath)),
    get(ref(database, adminManagementPath))
  ]);
  let value = workspaceSnapshot.exists() ? workspaceSnapshot.val() : null;
  if (!value) {
    const legacySnapshot = await get(ref(database, legacyWorkspacePath));
    if (legacySnapshot.exists()) {
      value = normalizeWorkspace(legacySnapshot.val());
      stripLegacyCredentials(value);
      const directory = safeDirectory(value);
      adminManagement = managementRecords(value);
      await Promise.all([
        set(ref(database, workspacePath), cleanWorkspaceState(value)),
        set(ref(database, employeeDirectoryPath), directory),
        set(ref(database, adminManagementPath), adminManagement)
      ]);
    }
  }
  const storedManagement = managementSnapshot.exists() ? managementSnapshot.val() : adminManagement;
  if (storedManagement && (storedManagement.users || storedManagement.departments)) adminManagement = storedManagement;
  const directory = directorySnapshot.exists() ? directorySnapshot.val() : safeDirectory(value || {});
  value = { ...(value || emptyState()), ...(directory || {}), users: adminManagement.users || [], departments: adminManagement.departments || [] };
  captureRecordKeys(value, workspaceCollections, workspaceRecordKeys);
  return normalizeWorkspace(value);
}

async function readEmployeeWorkspace(profile) {
  const [workspaceSnapshot, directorySnapshot] = await Promise.all([
    get(ref(database, workspacePath)),
    get(ref(database, employeeDirectoryPath))
  ]);
  const directory = directorySnapshot.exists() ? directorySnapshot.val() : { users: [], departments: [] };
  const state = { ...emptyState(), ...(workspaceSnapshot.exists() ? workspaceSnapshot.val() : {}), ...directory };
  state.users = recordsFrom(state.users);
  state.departments = recordsFrom(state.departments);
  const own = appUserFromEmployee(profile);
  const index = state.users.findIndex(account => account.id === own.id || account.authUid === profile.uid);
  if (index < 0) state.users.push(own);
  else state.users[index] = { ...state.users[index], ...own };
  return normalizeWorkspace(state);
}

async function loadPrivateAdminData(state) {
  const [snapshot, legacySnapshot] = await Promise.all([
    get(ref(database, privateDataPath)),
    get(ref(database, legacyWorkspacePath))
  ]);
  const stored = snapshot.exists() ? snapshot.val() : {};
  const legacyStateValue = legacySnapshot.exists() ? legacySnapshot.val() : {};
  const migration = {};
  const privateData = { ...stored };

  privateCollections.forEach(collection => {
    const legacy = mergeRecordsById(state[collection], legacyStateValue[collection]);
    const storedCollection = stored[collection] || {};
    const collectionData = Array.isArray(storedCollection)
      ? Object.fromEntries(storedCollection.map((record, index) => [String(index), record]))
      : { ...storedCollection };
    const storedIds = new Set(recordsFrom(storedCollection).map(recordIdentity));
    const merged = mergeRecordsById(storedCollection, legacy);

    if (recordsFrom(legacy).length) {
      recordsFrom(legacy).forEach((record, index) => {
        const id = recordIdentity(record, index);
        if (storedIds.has(id)) return;
        const key = databaseRecordKey(id);
        migration[`${privateDataPath}/${collection}/${key}`] = record;
        collectionData[key] = record;
        storedIds.add(id);
      });
      migration[`${workspacePath}/${collection}`] = null;
    }

    privateData[collection] = collectionData;
    state[collection] = merged;
  });

  if (Object.keys(migration).length) await update(ref(database), migration);
  captureRecordKeys(privateData, privateCollections, privateRecordKeys);
  lastPrivateData = clonePrivateCollections(privateData);
  lastPrivateJson = JSON.stringify(lastPrivateData);
  privateCollections.forEach(collection => { state[collection] = [...lastPrivateData[collection]]; });
  privateDataAvailable = true;
  legacyPrivateDataPending = false;
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

async function authorize(user) {
  if (!user?.email) throw new Error('Your Firebase account does not have an email address.');
  systemAdminUid = null;
  if (user.email.toLowerCase() === SYSTEM_ADMIN_EMAIL.toLowerCase()) {
    systemAdminUid = user.uid;
  }
  const admin = isSystemAdmin(user);
  let profile = null;
  if (!admin) {
    const snapshot = await get(ref(database, `${employeeProfilesPath}/${user.uid}`));
    profile = snapshot.exists() ? snapshot.val() : null;
    if (!profile || profile.uid !== user.uid || profile.email?.toLowerCase() !== user.email.toLowerCase() || profile.role !== 'employee') {
      throw Object.assign(new Error('Your account is not authorized for this application. Please contact the administrator.'), { code: 'app/not-authorized' });
    }
    if (profile.status !== 'active') {
      const messages = {
        inactive: 'Your account is inactive. Please contact the administrator.',
        resigned: 'Your account is marked as resigned. Please contact the administrator.',
        suspended: 'Your account is suspended. Please contact the administrator.'
      };
      throw Object.assign(new Error(messages[profile.status] || 'Your account is disabled. Please contact the administrator.'), { code: 'app/account-disabled' });
    }
    if (!profile.appUserId) throw Object.assign(new Error('Your employee profile is incomplete. Please contact the administrator.'), { code: 'app/not-authorized' });
  }

  let state;
  let scrubCloudCredentials = false;
  let restoredLocalState = false;
  if (admin) {
    state = await readWorkspace();
    scrubCloudCredentials = containsLegacyCredentials(state);
    if (state) stripLegacyCredentials(state);
    const hasCloudRecords = state && ['users', 'departments', 'projects', 'tasks', 'approvals', 'comments', 'activity', 'calendarEvents'].some(key => Array.isArray(state[key]) && state[key].length);
    if (!hasCloudRecords && legacyState) {
      state = legacyState;
      legacyState = null;
      restoredLocalState = true;
    }
  } else state = await readEmployeeWorkspace(profile);
  state = { ...emptyState(), ...(state || {}) };
  if (admin) {
    try {
      await loadPrivateAdminData(state);
    } catch (error) {
      if (!isDatabasePermissionDenied(error)) throw error;
      legacyPrivateDataPending = privateCollections.some(collection => recordsFrom(state[collection]).length > 0);
      privateDataAvailable = false;
      lastPrivateData = Object.fromEntries(privateCollections.map(collection => [collection, []]));
      lastPrivateJson = JSON.stringify(lastPrivateData);
      privateCollections.forEach(collection => { state[collection] = []; });
      console.warn('Private management data is unavailable until Realtime Database rules grant System Admin access.');
    }
  } else privateCollections.forEach(collection => { state[collection] = []; });
  if (admin) {
    state = ensureAdminProfile(state, user);
    if (scrubCloudCredentials && !legacyPrivateDataPending) {
      await set(ref(database, workspacePath), cleanWorkspaceState(state));
      await set(ref(database, employeeDirectoryPath), safeDirectory(state));
      adminManagement = managementRecords(state);
      await set(ref(database, adminManagementPath), adminManagement);
    }
  } else {
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
  lastStateJson = restoredLocalState ? null : JSON.stringify(cleanWorkspaceState(state));
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

function isDatabasePermissionDenied(error) {
  return error?.code === 'PERMISSION_DENIED'
    || error?.code === 'database/permission-denied'
    || /permission denied/i.test(error?.message || '');
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
  await loadClassicScript('phase13.js');
  await loadClassicScript('phase15.js');
  await loadClassicScript('phase16.js');
  await loadClassicScript('phase17.js');
  await loadClassicScript('phase18.js');
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
  if (!isSystemAdmin()) {
    if (stopProfileWatch) stopProfileWatch();
    stopProfileWatch = onValue(ref(database, `${employeeProfilesPath}/${authUser.uid}`), snapshot => {
      const profile = snapshot.val();
      if (!profile || profile.uid !== authUser.uid || profile.role !== 'employee' || profile.status !== 'active' || !profile.appUserId) {
        const disabled = profile?.status && profile.status !== 'active';
        pendingAuthMessage = disabled
          ? ({ inactive: 'Your account is inactive. Please contact the administrator.', resigned: 'Your account is marked as resigned. Please contact the administrator.', suspended: 'Your account is suspended. Please contact the administrator.' }[profile.status] || 'Your account is disabled. Please contact the administrator.')
          : 'Your account is not authorized for this application. Please contact the administrator.';
        firebaseAuthState = SIGNED_OUT;
        showLogin(pendingAuthMessage);
        return;
      }
      employeeProfile = profile;
      window.firebaseHub.employeeProfile = profile;
    }, error => console.error('Could not monitor employee authorization status:', error));
    let polling = false;
    const refreshScopedState = async () => {
      if (polling || !authUser) return;
      polling = true;
      try {
        const incoming = await readEmployeeWorkspace(employeeProfile);
        const workspace = incoming || emptyState();
        workspace.users = Array.isArray(workspace.users) ? workspace.users : [];
        const existing = workspace.users.find(account => account.authUid === authUser.uid || account.id === employeeProfile.appUserId);
        const appProfile = { ...(existing || {}), ...appUserFromEmployee(employeeProfile) };
        if (!existing) workspace.users.push(appProfile);
        else workspace.users[workspace.users.indexOf(existing)] = appProfile;
        const json = JSON.stringify(cleanWorkspaceState(workspace));
        if (json !== lastStateJson) {
          lastStateJson = json;
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
        }
      } finally { polling = false; }
    };
    const timer = setInterval(refreshScopedState, 15000);
    stopWatching = () => clearInterval(timer);
    return;
  }
  stopWatching = onValue(ref(database, workspacePath), snapshot => {
    if (!snapshot.exists()) return;
    const incoming = { ...emptyState(), ...snapshot.val(), ...safeDirectory(adminManagement) };
    if (isSystemAdmin()) {
      incoming.users = adminManagement.users || incoming.users;
      incoming.departments = adminManagement.departments || incoming.departments;
      ensureAdminProfile(incoming, authUser);
      Object.assign(incoming, clonePrivateCollections(lastPrivateData));
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
  }
}

function startAdminManagementSync() {
  if (!isSystemAdmin()) return;
  if (stopManagementWatching) stopManagementWatching();
  stopManagementWatching = onValue(ref(database, adminManagementPath), snapshot => {
    adminManagement = snapshot.exists() ? snapshot.val() : { users: [], departments: [] };
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
    const next = privateCollectionsSnapshot(stored);
    const json = JSON.stringify(next);
    if (json === lastPrivateJson) return;
    lastPrivateJson = json;
    lastPrivateData = clonePrivateCollections(next);
    privateDataAvailable = true;
    captureRecordKeys(stored, privateCollections, privateRecordKeys);
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
  get SYSTEM_ADMIN_EMAIL() { return SYSTEM_ADMIN_EMAIL; },
  get privateDataAvailable() { return privateDataAvailable; },
  isSystemAdmin,
  friendlyError: friendlyAuthError,
  async createEmployeeAccount(email, password, profile) {
    let credential;
    try {
      credential = await createUserWithEmailAndPassword(employeeCreationAuth, email, password);
      const uid = credential.user.uid;
      const savedProfile = { ...profile, uid, email: credential.user.email, role: 'employee' };
      await set(ref(database, `${employeeProfilesPath}/${uid}`), savedProfile);
      await signOut(employeeCreationAuth);
      return { ...credential.user, uid };
    } catch (error) {
      if (credential?.user) await deleteUser(credential.user).catch(() => {});
      await signOut(employeeCreationAuth).catch(() => {});
      throw error;
    }
  },
  async saveEmployeeProfile(uid, profile) {
    if (!isSystemAdmin()) throw new Error('Only the system administrator may update employee profiles.');
    if (!uid || uid === auth.currentUser?.uid || profile.email?.toLowerCase() === SYSTEM_ADMIN_EMAIL.toLowerCase()) throw new Error('The System Admin account cannot be edited as an employee.');
    await set(ref(database, `${employeeProfilesPath}/${uid}`), { ...profile, uid, role: 'employee' });
  },
  async updateEmployeeStatus(uid, status) {
    if (!isSystemAdmin()) throw new Error('Only the system administrator may update employee status.');
    if (!uid || uid === auth.currentUser?.uid) throw new Error('The System Admin account cannot be deactivated.');
    const snapshot = await get(ref(database, `${employeeProfilesPath}/${uid}`));
    if (!snapshot.exists()) throw new Error('The Firebase employee profile was not found.');
    await set(ref(database, `${employeeProfilesPath}/${uid}`), { ...snapshot.val(), status, uid, role: 'employee' });
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
    await signOut(auth);
  },
  async saveState(state) {
    if (!auth.currentUser) return;
    if (isSystemAdmin() && !privateDataAvailable && legacyPrivateDataPending) {
      console.warn('Workspace save skipped to preserve legacy private management data until Admin database rules are available.');
      return;
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
    if (json === lastStateJson && (!admin || (privateJson === lastPrivateJson && directoryJson === JSON.stringify(safeDirectory(adminManagement)) && managementJson === JSON.stringify(adminManagement)))) return;
    saveQueue = saveQueue.catch(() => {}).then(async () => {
      if (json !== lastStateJson) {
        await set(ref(database, workspacePath), cleaned);
        lastStateJson = json;
      }
      if (admin && (directoryJson !== JSON.stringify(safeDirectory(adminManagement)) || managementJson !== JSON.stringify(adminManagement))) {
        await Promise.all([
          set(ref(database, employeeDirectoryPath), directory),
          set(ref(database, adminManagementPath), management)
        ]);
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
    });
    try {
      await saveQueue;
    } catch (error) {
      console.error('Could not save Firebase workspace data:', error);
      window.dispatchEvent(new CustomEvent('firebase-save-error', { detail: error }));
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
  localStorage.removeItem('executionHubStateFinal');
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
