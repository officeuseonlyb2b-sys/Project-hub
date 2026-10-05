const seed = {
  currentUser: null,
  users: [],
  departments: [],
  projects: [],
  tasks: [],
  approvals: [],
  approvalHistory: [],
  comments: [],
  activity: [],
  calendarEvents: [],
  plannerRead: {},
  regularWorkFolders: [],
  regularWorkCategories: [],
  performanceReviews: [],
  performanceSnapshots: []
};

const projectWorkstreams = project => Array.isArray(project?.workstreams) ? project.workstreams : [];
function withSafeProjectWorkstreams(project){
  if(!project || typeof project !== 'object') return project;
  return new Proxy(project,{
    get(target,property,receiver){
      if(property==='workstreams') return projectWorkstreams(target);
      return Reflect.get(target,property,receiver);
    }
  });
}

function normalizeState(data){
  const normalized = { ...structuredClone(seed), ...(data || {}) };
  Object.keys(seed).forEach(key => {
    if (Array.isArray(seed[key]) && !Array.isArray(normalized[key])) normalized[key] = [];
    if (seed[key] && typeof seed[key] === 'object' && !Array.isArray(seed[key]) && (!normalized[key] || typeof normalized[key] !== 'object')) normalized[key] = {};
  });
  normalized.projects = normalized.projects.map(withSafeProjectWorkstreams);
  return normalized;
}
let state = normalizeState(window.firebaseHub?.initialState);
window.getFirebaseApplicationState = () => state;
const viewRouter = window.executionHubViewRouting?.createViewRouter({
  location: window.location,
  history: window.history,
  isSystemAdmin: () => !!window.firebaseHub?.isSystemAdmin?.()
});
let activeView = viewRouter?.current || 'dashboard';
let activeProject = null;
let activeProjectTab = 'overview';
const today = new Date();

const el = id => document.getElementById(id);
const escapeHtml = window.ExecutionHubSecurity?.escapeHtml || (value => String(value ?? '').replace(/[&<>\"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[char])));
window.executionHubEscapeHtml = escapeHtml;
const user = id => state.users.find(u=>u.id===id) || {name:id,initials:'?',role:''};
const project = id => state.projects.find(p=>p.id===id);
const task = id => state.tasks.find(t=>t.id===id);
const save = () => {
  state.users.forEach(account => {
    delete account.passwordHash;
    delete account.password;
  });
  return window.firebaseHub?.saveState(state);
};
window.applyFirebaseState = data => {
  const currentUser = state.currentUser;
  state = normalizeState({ ...(data || {}), currentUser });
  state.users.forEach(account => { delete account.passwordHash; delete account.password; });
};
window.refreshFirebaseView = () => {
  const authUser = window.firebaseHub?.authUser;
  const profile = state.users.find(account => account.authUid === authUser?.uid || account.email?.toLowerCase() === authUser?.email?.toLowerCase());
  if (!profile || profile.active === false) {
    state.currentUser = null;
    if (typeof showLogin === 'function') showLogin();
    return;
  }
  state.currentUser = profile.id;
  populateUserSelect();
  updateUserBadge();
  render();
};
const fmtDate = d => new Date(d+'T00:00:00').toLocaleDateString('en-IN',{day:'2-digit',month:'short'});
const fmtDateFull = d => new Date(d+'T00:00:00').toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'});
const fmtTime = d => new Date(d).toLocaleString('en-IN',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'});
const daysDiff = d => Math.ceil((new Date(d+'T23:59:59')-today)/86400000);
const isOverdue = t => !['Completed','Ready for Review'].includes(t.status) && daysDiff(t.currentDue) < 0;
const healthLabel = h => ({'on-track':'On Track','at-risk':'At Risk','delayed':'Delayed'})[h] || h;
const avatar = uid => `<div class="avatar">${escapeHtml(user(uid).initials)}</div>`;
const person = uid => `<div class="person">${avatar(uid)}<div><strong>${escapeHtml(user(uid).name)}</strong><div class="subtle">${escapeHtml(user(uid).role)}</div></div></div>`;
const statusClass = s => {
  if(s==='Ready for Review'||s==='Changes Required') return 'review';
  if(s==='Waiting'||s==='Blocked') return 'waiting';
  if(s==='Completed') return 'completed';
  if(s==='Overdue') return 'overdue';
  return 'on-track';
};
const statusPill = s => `<span class="status-pill ${statusClass(s)}">${escapeHtml(s)}</span>`;
const priorityPill = p => {const value=String(p??'');return `<span class="priority-pill ${escapeHtml(value.toLowerCase())}">${escapeHtml(value)}</span>`};

function init(){
  populateUserSelect();
  bindShell();
  render();
}

function populateUserSelect(){
  el('userSelect').innerHTML = state.users.map(u=>`<option value="${escapeHtml(u.id)}" ${u.id===state.currentUser?'selected':''}>${escapeHtml(u.name)}</option>`).join('');
  updateUserBadge();
}
function updateUserBadge(){
  const u=user(state.currentUser); el('currentAvatar').textContent=u.initials; el('currentUserName').textContent=u.name; el('currentUserRole').textContent=u.role;
}
function bindShell(){
  document.querySelectorAll('.nav-item').forEach(btn=>btn.addEventListener('click',()=>{activeView=btn.dataset.view;activeProject=null;document.querySelectorAll('.nav-item').forEach(b=>b.classList.toggle('active',b===btn));render();}));
  el('userSelect').addEventListener('change',e=>{state.currentUser=e.target.value;save();updateUserBadge();render();toast(`Switched to ${user(state.currentUser).name}`)});
  el('closeDrawer').addEventListener('click',closeDrawer); el('drawerBackdrop').addEventListener('click',closeDrawer);
  el('globalSearch').addEventListener('input',e=>{ if(e.target.value.trim().length>1){activeView='projects';activeProject=null;render(e.target.value.trim().toLowerCase());}});
}

function setTitle(title,eyebrow='MANAGEMENT'){el('pageTitle').textContent=title;el('pageEyebrow').textContent=eyebrow;syncViewRoute()}
function syncViewRoute(){
  if(viewRouter)activeView=viewRouter.sync(activeView);
  document.querySelectorAll('.nav-item').forEach(button=>button.classList.toggle('active',button.dataset.view===activeView));
}
function restoreViewRoute(){
  if(!viewRouter)return;
  const restored=viewRouter.restore();if(!restored)return;
  activeView=restored;activeProject=null;activeProjectTab='overview';
  document.querySelectorAll('.nav-item').forEach(button=>button.classList.toggle('active',button.dataset.view===activeView));
  render();
}
window.addEventListener('popstate',restoreViewRoute);
window.addEventListener('hashchange',restoreViewRoute);
function render(search=''){
  if(!window.executionHubModulesReady)return;
  if(activeProject){renderProject(activeProject);wireDynamic();return;}
  ({dashboard:renderDashboard,projects:()=>renderProjects(search),mywork:renderMyWork,approvals:renderApprovals,team:renderTeam,activity:renderActivity}[activeView]||renderDashboard)();
  wireDynamic();
}

function renderDashboard(){
  setTitle('Command Centre','EXECUTION HUB');
  const open=state.tasks.filter(t=>t.status!=='Completed');
  const overdue=open.filter(isOverdue);
  const dueWeek=open.filter(t=>{const d=daysDiff(t.currentDue);return d>=0&&d<=7});
  const waiting=open.filter(t=>['Waiting','Blocked'].includes(t.status));
  const mineWaiting=state.tasks.filter(t=>t.waitingOn===state.currentUser || (typeof t.waitingOn==='string'&&t.waitingOn.toLowerCase().includes(user(state.currentUser).name.split(' ')[0].toLowerCase())));
  const avg=state.projects.length?Math.round(state.projects.reduce((a,p)=>a+(Number(p.progress)||0),0)/state.projects.length):0;
  el('content').innerHTML = `
    <div class="hero">
      <div class="hero-card">
        <div class="eyebrow" style="color:#b7c0c5">EXECUTION • OWNERSHIP • LAUNCH</div>
        <h2>Everything moving toward launch, in one place.</h2>
        <p>See what is on track, what is slipping, what is waiting on you, and exactly who changed what—without chasing updates across chats.</p>
        <div class="hero-actions"><button class="btn btn-primary" data-nav="mywork">Open My Work</button><button class="btn btn-secondary" data-nav="projects">View All Projects</button></div>
      </div>
      <div class="focus-card">
        <div class="focus-title">Portfolio readiness</div><div class="focus-count">${avg}%</div><div class="focus-note">Across ${state.projects.length} active initiatives</div>
        <div class="mini-bar"><span style="width:${avg}%"></span></div>
        <div style="display:flex;gap:10px;margin-top:17px"><span class="status-pill on-track">${state.projects.filter(p=>p.health==='on-track').length} On Track</span><span class="status-pill at-risk">${state.projects.filter(p=>p.health==='at-risk').length} At Risk</span></div>
      </div>
    </div>
    <div class="metrics">
      <div class="metric indigo"><div class="metric-label">ACTIVE PROJECTS</div><div class="metric-value">${state.projects.length}</div><div class="metric-foot">Units, brands & verticals</div></div>
      <div class="metric"><div class="metric-label">OPEN TASKS</div><div class="metric-value">${open.length}</div><div class="metric-foot">Across all initiatives</div></div>
      <div class="metric red"><div class="metric-label">OVERDUE</div><div class="metric-value">${overdue.length}</div><div class="metric-foot">Needs intervention</div></div>
      <div class="metric amber"><div class="metric-label">DUE THIS WEEK</div><div class="metric-value">${dueWeek.length}</div><div class="metric-foot">Next 7 days</div></div>
      <div class="metric sage"><div class="metric-label">WAITING / BLOCKED</div><div class="metric-value">${waiting.length}</div><div class="metric-foot">Dependencies visible</div></div>
      <div class="metric indigo"><div class="metric-label">WAITING ON YOU</div><div class="metric-value">${mineWaiting.length}</div><div class="metric-foot">Clear these first</div></div>
    </div>
    <div class="grid-2">
      <div class="panel">
        <div class="panel-head"><div><h3>Launch portfolio</h3><span>Live readiness across active initiatives</span></div><button class="link-btn" data-nav="projects">View all</button></div>
        <div class="panel-body"><div class="project-list">${state.projects.slice(0,5).map(projectRow).join('')}</div></div>
      </div>
      <div class="panel">
        <div class="panel-head"><div><h3>Needs your attention</h3><span>Approvals, blockers and overdue work</span></div></div>
        <div class="panel-body"><div class="attention-list">${attentionItems()}</div></div>
      </div>
    </div>
    <div class="section-row"><div><h2>Recent accountability trail</h2><p>Latest changes captured automatically.</p></div><button class="btn btn-ghost" data-nav="activity">Full activity</button></div>
    <div class="panel"><div class="panel-body"><div class="activity">${state.activity.slice(0,5).map(activityItem).join('')}</div></div></div>`;
}
function projectRow(p){
  const over=state.tasks.filter(t=>t.project===p.id&&isOverdue(t)).length;
  const due=daysDiff(p.launch);
  const progress=Math.max(0,Math.min(100,Number(p.progress)||0));
  return `<div class="project-card" data-project="${escapeHtml(p.id)}">
    <div><div class="project-title">${escapeHtml(p.name)}</div><div class="project-meta">${escapeHtml(p.category)} • ${escapeHtml(p.code)} • ${over} overdue task${over===1?'':'s'}</div></div>
    <div class="progress-wrap"><div class="progress"><span style="width:${progress}%"></span></div><div class="percent">${progress}%</div></div>
    <div><span class="status-pill ${escapeHtml(p.health)}">${escapeHtml(healthLabel(p.health))}</span></div>
    <div class="due ${due<0?'overdue':''}"><span>Launch</span><strong>${fmtDate(p.launch)}</strong></div>
  </div>`;
}
function attentionItems(){
  const items=[];
  state.approvals.slice(0,2).forEach(a=>{const t=task(a.task);if(!t)return;const p=t.project?project(t.project):null,context=p?.name||(t.contextType==='regular_work'?'Regular Work':'Project');items.push(`<div class="attention-item"><strong>${escapeHtml(a.type)}: ${escapeHtml(t.title)}</strong><span>${escapeHtml(user(a.requestedBy).name)} • ${escapeHtml(context)}</span><div class="row">${priorityPill(t.priority)}<button class="link-btn" data-task="${escapeHtml(t.id)}">Review →</button></div></div>`)});
  state.tasks.filter(isOverdue).slice(0,2).forEach(t=>{const p=t.project?project(t.project):null,context=p?.name||(t.contextType==='regular_work'?'Regular Work':'Project');items.push(`<div class="attention-item"><strong>${escapeHtml(t.title)}</strong><span>Overdue • ${escapeHtml(user(t.owner).name)} • ${escapeHtml(context)}</span><div class="row">${priorityPill(t.priority)}<button class="link-btn" data-task="${escapeHtml(t.id)}">Open →</button></div></div>`)});
  return items.join('')||`<div class="empty"><strong>Nothing urgent</strong>Your desk is clear.</div>`;
}

function renderProjects(search=''){
  setTitle('Projects','PORTFOLIO');
  const list=state.projects.filter(p=>!search||`${p.name} ${p.category} ${p.code}`.toLowerCase().includes(search));
  el('content').innerHTML=`
    <div class="section-row" style="margin-top:0"><div><h2>Units, Brands & New Verticals</h2><p>One portfolio, shared execution.</p></div><div class="filters"><select class="select"><option>All Categories</option><option>Unit</option><option>Brand</option><option>Vertical</option><option>System</option></select><button class="btn btn-soft" id="newProjectBtn">+ New Project</button></div></div>
    <div class="card-grid">${list.map(p=>{const progress=Math.max(0,Math.min(100,Number(p.progress)||0));return `<div class="big-card" data-project="${escapeHtml(p.id)}">
      <div class="topline"><div><div class="eyebrow">${escapeHtml(p.category).toUpperCase()} • ${escapeHtml(p.code)}</div><h3 style="margin-top:6px">${escapeHtml(p.name)}</h3></div><span class="status-pill ${escapeHtml(p.health)}">${escapeHtml(healthLabel(p.health))}</span></div>
      <p>${escapeHtml(p.description)}</p>
      <div class="progress-wrap"><div class="progress"><span style="width:${progress}%"></span></div><div class="percent">${progress}%</div></div>
      <div class="workstreams">${projectWorkstreams(p).slice(0,4).map(w=>{const value=Math.max(0,Math.min(100,Number(w.progress)||0));return `<div class="workstream-row"><span>${escapeHtml(w.name)}</span><div class="tiny-progress"><i style="width:${value}%"></i></div><span>${value}%</span></div>`}).join('')}</div>
      <div style="display:flex;justify-content:space-between;margin-top:15px"><span class="subtle">Launch ${fmtDateFull(p.launch)}</span><button class="link-btn">Open project →</button></div>
    </div>`}).join('')}</div>`;
}

function renderProject(pid){
  const p=project(pid); if(!p){activeProject=null;activeProjectTab='overview';renderProjects();return}
  setTitle(p.name,`${p.category.toUpperCase()} • ${p.code}`);
  const tasks=state.tasks.filter(t=>t.project===pid);
  const overdue=tasks.filter(isOverdue).length;
  const ready=tasks.filter(t=>t.status==='Ready for Review').length;
  const tabs=['overview','workstreams','tasks','timeline','team','activity'];
  if(!tabs.includes(activeProjectTab)) activeProjectTab='overview';
  const labels={overview:'Overview',workstreams:'Workstreams',tasks:'Tasks',timeline:'Timeline',team:'Team',activity:'Activity'};

  el('content').innerHTML=`
    <button class="link-btn" id="backProjects" style="margin-bottom:12px">← Back to Projects</button>
    <div class="project-hero">
      <div class="project-hero-top"><div><div class="eyebrow">${escapeHtml(p.category).toUpperCase()} • ${escapeHtml(p.code)}</div><h2>${escapeHtml(p.name)}</h2><p>${escapeHtml(p.description)}</p></div><span class="status-pill ${escapeHtml(p.health)}">${escapeHtml(healthLabel(p.health))}</span></div>
      <div class="project-stats"><div class="project-stat"><span>Readiness</span><strong>${p.progress}%</strong></div><div class="project-stat"><span>Launch target</span><strong>${fmtDate(p.launch)}</strong></div><div class="project-stat"><span>Open tasks</span><strong>${tasks.filter(t=>t.status!=='Completed').length}</strong></div><div class="project-stat"><span>Overdue</span><strong style="color:var(--red)">${overdue}</strong></div><div class="project-stat"><span>Awaiting review</span><strong>${ready}</strong></div></div>
    </div>
    <div class="tabs" role="tablist">${tabs.map(tab=>`<button class="tab ${activeProjectTab===tab?'active':''}" data-project-tab="${tab}" role="tab" aria-selected="${activeProjectTab===tab}">${labels[tab]}</button>`).join('')}</div>
    <div id="projectTabContent">${renderProjectTab(p,tasks,activeProjectTab)}</div>`;
}

function renderProjectTab(p,tasks,tab){
  if(tab==='workstreams') return renderProjectWorkstreams(p,tasks);
  if(tab==='tasks') return renderProjectTasks(p,tasks);
  if(tab==='timeline') return renderProjectTimeline(p,tasks);
  if(tab==='team') return renderProjectTeam(p,tasks);
  if(tab==='activity') return renderProjectActivity(p,tasks);
  return renderProjectOverview(p,tasks);
}

function renderProjectOverview(p,tasks){
  const overdue=tasks.filter(isOverdue).length;
  const ready=tasks.filter(t=>t.status==='Ready for Review').length;
  const critical=tasks.filter(t=>t.priority==='P0'&&t.status!=='Completed').sort((a,b)=>a.currentDue.localeCompare(b.currentDue));
  return `
    <div class="grid-2">
      <div class="panel"><div class="panel-head"><div><h3>Workstreams</h3><span>Launch readiness by area</span></div><button class="link-btn" data-project-tab="workstreams">View details →</button></div><div class="panel-body"><div class="workstreams">${projectWorkstreams(p).map(w=>{const progress=Math.max(0,Math.min(100,Number(w.progress)||0));return `<div class="workstream-row" style="grid-template-columns:1fr 180px 40px"><span>${escapeHtml(w.name)}</span><div class="tiny-progress"><i style="width:${progress}%"></i></div><span>${progress}%</span></div>`}).join('')}</div></div></div>
      <div class="panel"><div class="panel-head"><div><h3>Project pulse</h3><span>Current risk indicators</span></div></div><div class="panel-body"><div class="attention-list"><div class="attention-item"><strong>${overdue} overdue task${overdue===1?'':'s'}</strong><span>Original commitments remain visible.</span></div><div class="attention-item"><strong>${ready} item${ready===1?'':'s'} awaiting review</strong><span>Ready for manager approval.</span></div><div class="attention-item"><strong>${tasks.filter(t=>t.waitingOn).length} dependencies</strong><span>Waiting-on ownership is recorded.</span></div></div></div></div>
    </div>
    <div class="section-row"><div><h2>Critical & launch-sensitive work</h2><p>P0 tasks that can directly affect delivery.</p></div><button class="link-btn" data-project-tab="tasks">See all tasks →</button></div>
    <div class="panel"><div class="table-wrap"><table class="table"><thead><tr><th>Task</th><th>Owner</th><th>Status</th><th>Due</th><th>Next Action</th></tr></thead><tbody>${critical.map(t=>`<tr><td><button class="task-link" data-task="${escapeHtml(t.id)}">${escapeHtml(t.title)}</button><div class="subtle">${escapeHtml(t.workstream)} • ${escapeHtml(t.deliverable)}</div></td><td>${person(t.owner)}</td><td>${statusPill(isOverdue(t)?'Overdue':t.status)}</td><td>${fmtDate(t.currentDue)}</td><td>${escapeHtml(t.next)}</td></tr>`).join('')||`<tr><td colspan="5"><div class="empty"><strong>No critical tasks</strong>No open P0 work in this project.</div></td></tr>`}</tbody></table></div></div>
    <div class="section-row"><div><h2>Project task board</h2><p>Click any card to open full history and controls.</p></div></div>
    <div class="kanban">${['Not Started','In Progress','Waiting','Ready for Review'].map(s=>kanbanColumn(s,tasks.filter(t=>t.status===s || (s==='Waiting'&&t.status==='Blocked') || (s==='Ready for Review'&&t.status==='Changes Required')))).join('')}</div>`;
}

function renderProjectWorkstreams(p,tasks){
  return `<div class="section-row" style="margin-top:0"><div><h2>Workstream readiness</h2><p>See progress, workload and risk area by area.</p></div></div>
    <div class="workstream-grid">${projectWorkstreams(p).map(w=>{
      const wt=tasks.filter(t=>t.workstream===w.name);
      const open=wt.filter(t=>t.status!=='Completed').length;
      const over=wt.filter(isOverdue).length;
      const owners=[...new Set(wt.map(t=>t.owner))];
      const progress=Math.max(0,Math.min(100,Number(w.progress)||0));
      return `<div class="workstream-card"><div class="workstream-card-head"><div><div class="eyebrow">WORKSTREAM</div><h3>${escapeHtml(w.name)}</h3></div><strong>${progress}%</strong></div><div class="progress"><span style="width:${progress}%"></span></div><div class="workstream-metrics"><span><b>${wt.length}</b> Tasks</span><span><b>${open}</b> Open</span><span class="${over?'risk-text':''}"><b>${over}</b> Overdue</span></div><div class="avatar-stack">${owners.length?owners.map(uid=>`<span title="${escapeHtml(user(uid).name)}">${escapeHtml(user(uid).initials)}</span>`).join(''):'<em>No assigned tasks yet</em>'}</div>${wt.length?`<div class="workstream-task-list">${wt.slice(0,3).map(t=>`<button class="mini-task" data-task="${escapeHtml(t.id)}"><span>${escapeHtml(t.title)}</span>${priorityPill(t.priority)}</button>`).join('')}${wt.length>3?`<div class="subtle">+${wt.length-3} more task${wt.length-3===1?'':'s'}</div>`:''}</div>`:`<div class="empty compact"><strong>No tasks yet</strong>This workstream is ready for task planning.</div>`}</div>`;
    }).join('')}</div>`;
}

function renderProjectTasks(p,tasks){
  const workstreams=[...new Set(tasks.map(t=>t.workstream))].sort();
  return `<div class="section-row" style="margin-top:0"><div><h2>All project tasks</h2><p>${tasks.length} tasks across ${workstreams.length} workstreams.</p></div><div class="filters"><select class="select" id="projectWorkstreamFilter"><option value="">All Workstreams</option>${workstreams.map(w=>`<option value="${escapeHtml(w)}">${escapeHtml(w)}</option>`).join('')}</select><select class="select" id="projectStatusFilter"><option value="">All Statuses</option>${[...new Set(tasks.map(t=>t.status))].map(st=>`<option value="${escapeHtml(st)}">${escapeHtml(st)}</option>`).join('')}</select></div></div>
    <div class="panel"><div class="table-wrap"><table class="table"><thead><tr><th>Task</th><th>Owner</th><th>Priority</th><th>Status</th><th>Progress</th><th>Due</th><th>Next Action</th></tr></thead><tbody id="projectTaskRows">${tasks.map(projectTaskRow).join('')}</tbody></table></div></div>`;
}
function projectTaskRow(t){const progress=Math.max(0,Math.min(100,Number(t.progress)||0));return `<tr data-task-row="${escapeHtml(t.id)}" data-workstream="${escapeHtml(t.workstream)}" data-status="${escapeHtml(t.status)}"><td><button class="task-link" data-task="${escapeHtml(t.id)}">${escapeHtml(t.title)}</button><div class="subtle">${escapeHtml(t.workstream)} • ${escapeHtml(t.deliverable)}</div></td><td>${person(t.owner)}</td><td>${priorityPill(t.priority)}</td><td>${statusPill(isOverdue(t)?'Overdue':t.status)}</td><td><div class="progress-wrap"><div class="progress"><span style="width:${progress}%"></span></div><div class="percent">${progress}%</div></div></td><td>${fmtDate(t.currentDue)}${t.originalDue!==t.currentDue?`<div class="subtle">Original ${fmtDate(t.originalDue)}</div>`:''}</td><td>${escapeHtml(t.next)}</td></tr>`}

function renderProjectTimeline(p,tasks){
  const sorted=[...tasks].sort((a,b)=>a.currentDue.localeCompare(b.currentDue));
  return `<div class="section-row" style="margin-top:0"><div><h2>Delivery timeline</h2><p>Original commitments, current deadlines and launch target in sequence.</p></div></div>
    <div class="panel"><div class="panel-body"><div class="timeline-list">${sorted.map(t=>{
      const overdue=isOverdue(t); const done=t.status==='Completed';
      return `<div class="timeline-item ${overdue?'is-overdue':''} ${done?'is-done':''}"><div class="timeline-marker"></div><div class="timeline-date"><strong>${fmtDate(t.currentDue)}</strong>${t.originalDue!==t.currentDue?`<span>Original ${fmtDate(t.originalDue)}</span>`:''}</div><div class="timeline-copy"><button class="task-link" data-task="${escapeHtml(t.id)}">${escapeHtml(t.title)}</button><span>${escapeHtml(t.workstream)} • ${escapeHtml(user(t.owner).name)}</span></div><div>${priorityPill(t.priority)} ${statusPill(overdue?'Overdue':t.status)}</div></div>`;
    }).join('')}<div class="timeline-item launch-milestone"><div class="timeline-marker"></div><div class="timeline-date"><strong>${fmtDate(p.launch)}</strong></div><div class="timeline-copy"><strong>Launch target</strong><span>${escapeHtml(p.name)}</span></div><span class="status-pill ${escapeHtml(p.health)}">${escapeHtml(healthLabel(p.health))}</span></div></div></div></div>`;
}

function renderProjectTeam(p,tasks){
  const ids=[...new Set([p.owner,...tasks.map(t=>t.owner),...tasks.map(t=>t.reviewer)].filter(Boolean))];
  return `<div class="section-row" style="margin-top:0"><div><h2>Project team</h2><p>People currently responsible for this initiative.</p></div></div><div class="team-grid">${ids.map(uid=>{
    const u=user(uid); const assigned=tasks.filter(t=>t.owner===uid); const open=assigned.filter(t=>t.status!=='Completed').length; const over=assigned.filter(isOverdue).length; const wait=assigned.filter(t=>t.waitingOn).length;
    return `<div class="team-card">${avatar(uid)}<strong>${escapeHtml(u.name)}</strong><div class="role">${escapeHtml(u.role)} • ${escapeHtml(u.dept||'')}</div><div class="team-numbers"><div class="team-num"><b>${open}</b><span>OPEN</span></div><div class="team-num"><b>${over}</b><span>OVERDUE</span></div><div class="team-num"><b>${wait}</b><span>WAITING</span></div></div>${assigned.length?`<div class="team-task-preview">${assigned.slice(0,3).map(t=>`<button class="mini-task" data-task="${escapeHtml(t.id)}"><span>${escapeHtml(t.title)}</span></button>`).join('')}</div>`:'<div class="subtle" style="margin-top:12px">Reviewer / project owner</div>'}</div>`;
  }).join('')}</div>`;
}

function renderProjectActivity(p,tasks){
  const history=state.activity.filter(a=>a.project===p.id);
  return `<div class="section-row" style="margin-top:0"><div><h2>Project activity</h2><p>Immutable history of meaningful changes in ${escapeHtml(p.name)}.</p></div><span class="tag">${history.length} recorded events</span></div><div class="panel"><div class="panel-body"><div class="activity">${history.map(activityItem).join('')||`<div class="empty"><strong>No activity yet</strong>Changes made inside this project will appear here.</div>`}</div></div></div>`;
}

function kanbanColumn(status,tasks){return `<div class="kanban-col"><div class="kanban-head">${escapeHtml(status)}<span>${tasks.length}</span></div>${tasks.map(t=>`<div class="kanban-card" data-task="${escapeHtml(t.id)}"><strong>${escapeHtml(t.title)}</strong><div class="meta">${escapeHtml(t.workstream)} • ${escapeHtml(t.deliverable)}</div><div class="foot">${priorityPill(t.priority)}<div class="mini-avatar">${escapeHtml(user(t.owner).initials)}</div></div></div>`).join('')||`<div class="subtle" style="padding:12px">No items</div>`}</div>`}

function renderMyWork(){
  const u=state.currentUser; setTitle('My Work',user(u).name.toUpperCase());
  const mine=state.tasks.filter(t=>t.owner===u);
  const groups=[['Overdue',mine.filter(isOverdue)],['Due Today',mine.filter(t=>daysDiff(t.currentDue)===0&&!isOverdue(t))],['Due This Week',mine.filter(t=>{const d=daysDiff(t.currentDue);return d>0&&d<=7})],['Waiting / Blocked',mine.filter(t=>['Waiting','Blocked'].includes(t.status))],['Later',mine.filter(t=>daysDiff(t.currentDue)>7)]];
  el('content').innerHTML=`
    <div class="metrics">
      <div class="metric"><div class="metric-label">ASSIGNED TO ME</div><div class="metric-value">${mine.length}</div></div>
      <div class="metric red"><div class="metric-label">OVERDUE</div><div class="metric-value">${mine.filter(isOverdue).length}</div></div>
      <div class="metric amber"><div class="metric-label">DUE THIS WEEK</div><div class="metric-value">${mine.filter(t=>{let d=daysDiff(t.currentDue);return d>=0&&d<=7}).length}</div></div>
      <div class="metric sage"><div class="metric-label">IN REVIEW</div><div class="metric-value">${mine.filter(t=>t.status==='Ready for Review').length}</div></div>
      <div class="metric indigo"><div class="metric-label">WAITING</div><div class="metric-value">${mine.filter(t=>t.waitingOn).length}</div></div>
      <div class="metric"><div class="metric-label">COMPLETED</div><div class="metric-value">${mine.filter(t=>t.status==='Completed').length}</div></div>
    </div>
    ${groups.map(([name,list])=>`<div class="section-row"><div><h2>${name}</h2><p>${list.length} item${list.length===1?'':'s'}</p></div></div><div class="panel"><div class="table-wrap"><table class="table"><thead><tr><th>Task</th><th>Project</th><th>Priority</th><th>Status</th><th>Due</th><th>Next Action</th></tr></thead><tbody>${list.map(taskRow).join('')||`<tr><td colspan="6"><div class="empty"><strong>Nothing here</strong>No tasks in this section.</div></td></tr>`}</tbody></table></div></div>`).join('')}`;
}
function taskRow(t){return `<tr><td><button class="task-link" data-task="${escapeHtml(t.id)}">${escapeHtml(t.title)}</button><div class="subtle">${escapeHtml(t.workstream)} • ${escapeHtml(t.deliverable)}</div></td><td>${escapeHtml(project(t.project)?.name||t.regularFolderName||'Regular Work')}</td><td>${priorityPill(t.priority)}</td><td>${statusPill(isOverdue(t)?'Overdue':t.status)}</td><td>${fmtDate(t.currentDue)}${t.originalDue!==t.currentDue?`<div class="subtle">Original ${fmtDate(t.originalDue)}</div>`:''}</td><td>${escapeHtml(t.next)}</td></tr>`}

function renderApprovals(){
  setTitle('Approvals','CONTROL DESK');
  const pending=state.currentUser==='u1'?state.approvals:state.approvals.filter(a=>a.requestedBy===state.currentUser);
  el('content').innerHTML=`
    <div class="section-row" style="margin-top:0"><div><h2>${state.currentUser==='u1'?'Pending decisions':'My requests'}</h2><p>Sensitive changes and final deliverables are never silently altered.</p></div></div>
    <div class="panel"><div class="table-wrap"><table class="table"><thead><tr><th>Type</th><th>Task</th><th>Requested By</th><th>Requested</th><th>Detail</th><th>Action</th></tr></thead><tbody>${pending.map(a=>{const t=task(a.task);return `<tr><td>${escapeHtml(a.type)}</td><td><button class="task-link" data-task="${escapeHtml(t?.id)}">${escapeHtml(t?.title)}</button><div class="subtle">${escapeHtml(project(t?.project)?.name||t?.regularFolderName||'Regular Work')}</div></td><td>${person(a.requestedBy)}</td><td>${fmtTime(a.requestedAt)}</td><td>${escapeHtml(a.detail)}</td><td>${state.currentUser==='u1'?`<button class="btn btn-soft approve-btn" data-approval="${escapeHtml(a.id)}">Approve</button> <button class="btn btn-ghost reject-btn" data-approval="${escapeHtml(a.id)}">Reject</button>`:'Pending'}</td></tr>`}).join('')||`<tr><td colspan="6"><div class="empty"><strong>All clear</strong>No pending approvals.</div></td></tr>`}</tbody></table></div></div>`;
}

function renderTeam(){
  setTitle('People','WORKLOAD & ACCOUNTABILITY');
  el('content').innerHTML=`<div class="section-row" style="margin-top:0"><div><h2>${state.users.length} individual account${state.users.length===1?'':'s'}</h2><p>Every change is attributable to a real person.</p></div></div><div class="team-grid">${state.users.map(u=>{const ts=state.tasks.filter(t=>t.owner===u.id);return `<div class="team-card">${avatar(u.id)}<strong>${escapeHtml(u.name)}</strong><div class="role">${escapeHtml(u.role)} • ${escapeHtml(u.dept)}</div><div class="team-numbers"><div class="team-num"><b>${ts.filter(t=>t.status!=='Completed').length}</b><span>OPEN</span></div><div class="team-num"><b>${ts.filter(isOverdue).length}</b><span>OVERDUE</span></div><div class="team-num"><b>${ts.filter(t=>t.waitingOn).length}</b><span>WAITING</span></div></div></div>`}).join('')}</div>`;
}

function renderActivity(){
  setTitle('Activity','IMMUTABLE HISTORY');
  el('content').innerHTML=`
    <div class="section-row" style="margin-top:0"><div><h2>Global audit trail</h2><p>Who changed what, when, and where.</p></div><div class="filters"><select class="select"><option>All People</option>${state.users.map(u=>`<option value="${escapeHtml(u.id)}">${escapeHtml(u.name)}</option>`).join('')}</select><select class="select"><option>All Change Types</option><option>Deadline</option><option>Status</option><option>Progress</option><option>Review</option></select></div></div>
    <div class="panel"><div class="panel-body"><div class="activity">${state.activity.map(activityItem).join('')}</div></div></div>`;
}
function activityItem(a){const t=task(a.task),source=t?.contextType==='regular_work'?` • Regular Work · ${t.regularFolderName||'Folder'} · ${t.regularCategoryName||t.workstream||''}`:a.project?` • ${project(a.project)?.name||''}`:'';return `<div class="activity-item">${avatar(a.user)}<div class="activity-copy"><strong>${escapeHtml(user(a.user).name)}</strong><p>${escapeHtml(a.text)}${t?` on <button class="task-link" data-task="${escapeHtml(t.id)}">${escapeHtml(t.title)}</button>`:''}${escapeHtml(source)}</p>${a.change?`<div class="change">${escapeHtml(a.change)}</div>`:''}</div><div class="activity-time">${fmtTime(a.time)}</div></div>`}

function openTask(id){
  const t=task(id); if(!t)return; const p=project(t.project); const comments=state.comments.filter(c=>c.task===id); const history=state.activity.filter(a=>a.task===id);
  el('drawerEyebrow').textContent=`${(p?.name||t.regularFolderName||'Regular Work').toUpperCase()} • ${String(t.workstream||'').toUpperCase()}`; el('drawerTitle').textContent=t.title;
  el('drawerBody').innerHTML=`
    <div class="drawer-section"><div class="drawer-actions">${priorityPill(t.priority)}${statusPill(isOverdue(t)?'Overdue':t.status)}${t.waitingOn?`<span class="status-pill waiting">Waiting on ${escapeHtml(t.waitingOn.startsWith?.('u')?user(t.waitingOn).name:t.waitingOn)}</span>`:''}</div></div>
    <div class="drawer-section"><h4>Task details</h4><div class="detail-grid"><div class="detail-box"><span>Owner</span><strong>${escapeHtml(user(t.owner).name)}</strong></div><div class="detail-box"><span>Reviewer</span><strong>${escapeHtml(user(t.reviewer).name)}</strong></div><div class="detail-box"><span>Original Due</span><strong>${fmtDateFull(t.originalDue)}</strong></div><div class="detail-box"><span>Current Due</span><strong>${fmtDateFull(t.currentDue)}</strong></div><div class="detail-box"><span>Progress</span><strong>${Math.max(0,Math.min(100,Number(t.progress)||0))}%</strong></div><div class="detail-box"><span>Next Action</span><strong>${escapeHtml(t.next)}</strong></div></div></div>
    <div class="drawer-section"><h4>Update work</h4><div class="drawer-actions"><button class="btn btn-soft status-update" data-task="${escapeHtml(id)}" data-status="In Progress">Start / Resume</button><button class="btn btn-soft status-update" data-task="${escapeHtml(id)}" data-status="Ready for Review">Ready for Review</button><button class="btn btn-ghost deadline-request" data-task="${escapeHtml(id)}">Request Deadline Change</button></div></div>
    <div class="drawer-section"><h4>Comments</h4><div class="comment-box"><textarea id="newComment" placeholder="Add an update, blocker, decision or @mention…"></textarea><button class="btn btn-soft" id="addComment" data-task="${escapeHtml(id)}">Post</button></div>${comments.map(c=>`<div class="comment">${avatar(c.user)}<div><strong>${escapeHtml(user(c.user).name)}</strong> <span>• ${fmtTime(c.time)}</span><p>${escapeHtml(c.text)}</p></div></div>`).join('')||`<div class="subtle" style="margin-top:12px">No comments yet.</div>`}</div>
    <div class="drawer-section"><h4>Activity history</h4><div class="activity">${history.map(activityItem).join('')||`<div class="subtle">No recorded activity yet.</div>`}</div></div>`;
  el('taskDrawer').classList.add('open'); el('drawerBackdrop').classList.add('open'); wireDrawer(id);
}
function closeDrawer(){el('taskDrawer').classList.remove('open');el('drawerBackdrop').classList.remove('open')}

function wireDynamic(){
  document.querySelectorAll('[data-nav]').forEach(b=>b.onclick=()=>{activeView=b.dataset.nav;activeProject=null;activeProjectTab='overview';document.querySelectorAll('.nav-item').forEach(n=>n.classList.toggle('active',n.dataset.view===activeView));render()});
  document.querySelectorAll('[data-project]').forEach(b=>b.onclick=()=>{activeProject=b.dataset.project;activeProjectTab='overview';render()});
  document.querySelectorAll('[data-project-tab]').forEach(b=>b.onclick=e=>{e.stopPropagation();activeProjectTab=b.dataset.projectTab;render()});
  document.querySelectorAll('[data-task]:not(#addComment)').forEach(b=>b.onclick=e=>{e.stopPropagation();openTask(b.dataset.task)});
  document.querySelectorAll('.approve-btn').forEach(b=>b.onclick=()=>approve(b.dataset.approval,true));
  document.querySelectorAll('.reject-btn').forEach(b=>b.onclick=()=>approve(b.dataset.approval,false));
  const back=el('backProjects'); if(back)back.onclick=()=>{activeProject=null;activeProjectTab='overview';activeView='projects';render()};
  const wf=el('projectWorkstreamFilter'), sf=el('projectStatusFilter');
  if(wf||sf){
    const apply=()=>document.querySelectorAll('[data-task-row]').forEach(row=>{const okW=!wf||!wf.value||row.dataset.workstream===wf.value;const okS=!sf||!sf.value||row.dataset.status===sf.value;row.style.display=okW&&okS?'':'none'});
    if(wf)wf.onchange=apply;if(sf)sf.onchange=apply;
  }
  const np=el('newProjectBtn'); if(np)np.onclick=()=>toast('Project creation flow is reserved for the production build.');
}
function wireDrawer(id){
  document.querySelectorAll('.status-update').forEach(b=>b.onclick=()=>updateStatus(id,b.dataset.status));
  el('addComment').onclick=()=>addComment(id);
  document.querySelectorAll('.deadline-request').forEach(b=>b.onclick=()=>requestDeadline(id));
  document.querySelectorAll('#drawerBody [data-task]:not(#addComment)').forEach(b=>b.onclick=e=>{e.stopPropagation();openTask(b.dataset.task)});
}

function updateStatus(id,newStatus){
  const t=task(id); const old=t.status; if(old===newStatus){toast('Task is already in that status.');return}
  t.status=newStatus; if(newStatus==='Ready for Review')t.progress=100;
  log(t.owner,t.project,t.id,'Status',`changed status from ${old} to ${newStatus}`,`${old} → ${newStatus}`);
  if(newStatus==='Ready for Review'&&!state.approvals.some(a=>a.task===id&&a.type==='Deliverable Review')) state.approvals.unshift({id:'a'+Date.now(),type:'Deliverable Review',task:id,requestedBy:state.currentUser,requestedAt:new Date().toISOString(),detail:'Task submitted for review.'});
  save();toast(`Status updated to ${newStatus}`);openTask(id);render();
}
function addComment(id){
  const box=el('newComment'); const text=box.value.trim(); if(!text)return;
  state.comments.push({id:'c'+Date.now(),task:id,user:state.currentUser,time:new Date().toISOString(),text}); const t=task(id);
  log(state.currentUser,t.project,id,'Comment','added a comment');save();toast('Comment added and timestamped.');openTask(id);
}
function requestDeadline(id){
  const t=task(id); const input=prompt(`Current due date is ${t.currentDue}. Enter requested new due date (YYYY-MM-DD):`,t.currentDue); if(!input||input===t.currentDue)return;
  const reason=prompt('Reason for deadline change:',''); if(!reason)return;
  state.approvals.unshift({id:'a'+Date.now(),type:'Deadline Change',task:id,requestedBy:state.currentUser,requestedAt:new Date().toISOString(),detail:`Requested ${fmtDateFull(input)}. Reason: ${reason}`});
  log(state.currentUser,t.project,id,'Deadline','requested deadline revision',`Current: ${fmtDateFull(t.currentDue)} → Requested: ${fmtDateFull(input)}`); t.pendingDue=input;save();toast('Deadline change sent for approval.');openTask(id);
}
function approve(aid,ok){
  const a=state.approvals.find(x=>x.id===aid); if(!a)return; const t=task(a.task);
  if(ok && a.type==='Deadline Change' && t.pendingDue){const old=t.currentDue;t.currentDue=t.pendingDue;delete t.pendingDue;t.reschedules=(t.reschedules||0)+1;log(state.currentUser,t.project,t.id,'Approval','approved deadline revision',`${fmtDateFull(old)} → ${fmtDateFull(t.currentDue)} • Original remains ${fmtDateFull(t.originalDue)}`)}
  else if(ok && a.type==='Deliverable Review'){t.status='Completed';t.progress=100;t.completedAt=new Date().toISOString();log(state.currentUser,t.project,t.id,'Approval','approved deliverable and marked task Completed')}
  else log(state.currentUser,t.project,t.id,'Approval',`rejected ${a.type.toLowerCase()}`);
  state.approvals=state.approvals.filter(x=>x.id!==aid);save();toast(ok?'Approved and recorded.':'Rejected and recorded.');render();
}
function log(uid,pid,tid,type,text,change=''){
  state.activity.unshift({id:'h'+Date.now(),time:new Date().toISOString(),user:uid,project:pid,task:tid,type,text,change});
}
function toast(msg){const t=el('toast');t.textContent=msg;t.classList.add('show');setTimeout(()=>t.classList.remove('show'),2200)}

init();
