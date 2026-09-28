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
import { get, getDatabase, onValue, ref, set } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-database.js';
import { getFunctions, httpsCallable } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-functions.js';

const SYSTEM_ADMIN_EMAIL = 'ashish@arpitatravels.com';
const AUTH_LOADING = 'AUTH_LOADING';
const AUTHENTICATED = 'AUTHENTICATED';
const SIGNED_OUT = 'SIGNED_OUT';
const firebaseConfig = {
  apiKey: 'AIzaSyC0gOy_JIaIpds2BdoHGv20EZiuHt8ozvM',
  authDomain: 'project-hub-emp.firebaseapp.com',
  databaseURL: 'https://project-hub-emp-default-rtdb.asia-southeast1.firebasedatabase.app',
  projectId: 'project-hub-emp',
  storageBucket: 'project-hub-emp.firebasestorage.app',
  messagingSenderId: '360406593945',
  appId: '1:360406593945:web:3ca19e86849053b4f76308',
  measurementId: 'G-DQC30WE2XH'
};

const workspacePath = 'executionHub/workspaces/default/state';
const employeeProfilesPath = 'executionHub/users';
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const database = getDatabase(app);
const functions = getFunctions(app, 'asia-southeast1');
const employeeCreationApp = initializeApp(firebaseConfig, 'employeeCreation');
const employeeCreationAuth = getAuth(employeeCreationApp);
let authUser = null;
let employeeProfile = null;
let stopWatching = null;
let stopProfileWatch = null;
let appLoaded = false;
let lastStateJson = null;
let saveQueue = Promise.resolve();
let authFlow = Promise.resolve();
let handlingUid = null;
let pendingAuthMessage = '';
let legacyState = null;
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
  return user?.email?.toLowerCase() === SYSTEM_ADMIN_EMAIL.toLowerCase();
}

function emptyState() {
  return {
    currentUser: null, users: [], departments: [], projects: [], tasks: [], approvals: [], approvalHistory: [],
    comments: [], activity: [], calendarEvents: [], plannerRead: {}, performanceReviews: [], performanceSnapshots: []
  };
}

function cleanState(value) {
  const result = JSON.parse(JSON.stringify(value || emptyState()));
  delete result.currentUser;
  result.users = (result.users || []).filter(account => account.email?.toLowerCase() !== SYSTEM_ADMIN_EMAIL.toLowerCase());
  result.users.forEach(account => {
    delete account.passwordHash;
    delete account.password;
    delete account.temporaryPassword;
  });
  return result;
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
  const snapshot = await get(ref(database, workspacePath));
  return snapshot.exists() ? snapshot.val() : null;
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
  const admin = isSystemAdmin(user);
  let profile = null;
  if (!admin) {
    const snapshot = await get(ref(database, `${employeeProfilesPath}/${user.uid}`));
    profile = snapshot.exists() ? snapshot.val() : null;
    if (!profile || profile.uid !== user.uid || profile.role !== 'employee') {
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
  if (admin) {
    state = await readWorkspace();
    scrubCloudCredentials = containsLegacyCredentials(state);
    if (state) stripLegacyCredentials(state);
    const hasCloudRecords = state && ['users', 'departments', 'projects', 'tasks', 'approvals', 'comments', 'activity', 'calendarEvents'].some(key => Array.isArray(state[key]) && state[key].length);
    if (!hasCloudRecords && legacyState) {
      state = legacyState;
      legacyState = null;
    }
  }
  else state = (await httpsCallable(functions, 'loadWorkspace')()).data;
  state = { ...emptyState(), ...(state || {}) };
  if (admin) {
    state = ensureAdminProfile(state, user);
    if (scrubCloudCredentials) await set(ref(database, workspacePath), cleanState(state));
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
  lastStateJson = JSON.stringify(cleanState(state));
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
  if (code === 'functions/unauthenticated' || code === 'functions/permission-denied') return 'Your account is not authorized for this application. Please contact the administrator.';
  if (code === 'functions/unavailable' || code === 'functions/internal') return 'The secure application service is unavailable. Please contact the administrator.';
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
      const credential = await signInWithEmailAndPassword(auth, String(values.get('email')).trim(), String(values.get('password')));
      await handleAuthState(credential.user);
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
    handlingUid = null;
    if (stopWatching) stopWatching();
    stopWatching = null;
    if (stopProfileWatch) stopProfileWatch();
    stopProfileWatch = null;
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
      handlingUid = null;
      pendingAuthMessage = message;
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
      if (!profile || profile.uid !== authUser.uid || profile.role !== 'employee' || profile.status !== 'active') {
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
        const incoming = (await httpsCallable(functions, 'loadWorkspace')()).data;
        incoming.users = Array.isArray(incoming.users) ? incoming.users : [];
        const existing = incoming.users.find(account => account.authUid === authUser.uid || account.id === employeeProfile.appUserId);
        const appProfile = { ...(existing || {}), ...appUserFromEmployee(employeeProfile) };
        if (!existing) incoming.users.push(appProfile);
        else incoming.users[incoming.users.indexOf(existing)] = appProfile;
        const json = JSON.stringify(cleanState(incoming));
        if (json !== lastStateJson) {
          lastStateJson = json;
          window.firebaseHub.initialState = incoming;
          window.applyFirebaseState(incoming);
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
    const incoming = snapshot.val();
    if (isSystemAdmin()) ensureAdminProfile(incoming, authUser);
    else if (employeeProfile) {
      incoming.users = Array.isArray(incoming.users) ? incoming.users : [];
      const existing = incoming.users.find(account => account.authUid === authUser.uid || account.id === employeeProfile.appUserId);
      const appProfile = { ...(existing || {}), ...appUserFromEmployee(employeeProfile) };
      if (!existing) incoming.users.push(appProfile);
      else incoming.users[incoming.users.indexOf(existing)] = appProfile;
    }
    const json = JSON.stringify(cleanState(incoming));
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
}

window.firebaseHub = {
  app,
  database,
  initialState: emptyState(),
  employeeProfile: null,
  get authUser() { return authUser; },
  get SYSTEM_ADMIN_EMAIL() { return SYSTEM_ADMIN_EMAIL; },
  isSystemAdmin,
  friendlyError: friendlyAuthError,
  async createEmployeeAccount(email, password, profile) {
    let credential;
    try {
      credential = await createUserWithEmailAndPassword(employeeCreationAuth, email, password);
      const uid = credential.user.uid;
      const savedProfile = { ...profile, uid, email: credential.user.email, role: 'employee' };
      await httpsCallable(functions, 'createEmployeeProfile')({ uid, profile: savedProfile });
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
    await httpsCallable(functions, 'saveEmployeeProfile')({ uid, profile: { ...profile, uid, role: 'employee' } });
  },
  async updateEmployeeStatus(uid, status) {
    if (!isSystemAdmin()) throw new Error('Only the system administrator may update employee status.');
    if (!uid || uid === auth.currentUser?.uid) throw new Error('The System Admin account cannot be deactivated.');
    const snapshot = await get(ref(database, `${employeeProfilesPath}/${uid}`));
    if (!snapshot.exists()) throw new Error('The Firebase employee profile was not found.');
    await httpsCallable(functions, 'saveEmployeeProfile')({ uid, profile: { ...snapshot.val(), status, uid, role: 'employee' } });
  },
  async resetPassword(email) { return sendPasswordResetEmail(auth, email); },
  async signOut() {
    if (stopWatching) stopWatching();
    stopWatching = null;
    if (stopProfileWatch) stopProfileWatch();
    stopProfileWatch = null;
    await signOut(auth);
  },
  async saveState(state) {
    if (!auth.currentUser) return;
    const cleaned = cleanState(state);
    const json = JSON.stringify(cleaned);
    if (json === lastStateJson) return;
    saveQueue = saveQueue.catch(() => {}).then(async () => {
      if (isSystemAdmin()) {
        await set(ref(database, workspacePath), cleaned);
        lastStateJson = json;
      } else {
        await httpsCallable(functions, 'saveWorkspace')({ state: cleaned });
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
