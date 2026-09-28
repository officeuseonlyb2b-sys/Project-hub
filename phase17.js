/* Execution Hub – Phase 1.7 Admin-only Performance & Growth intelligence */
(function(){
  const PHASE='1.7';
  const DIRECTOR='u1';
  let perfTab='company';
  let perfPeriod='quarter';
  let perfFocus=null;

  const esc=v=>String(v??'').replace(/[&<>'"]/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[ch]));
  const isAdmin=(id=state.currentUser)=>id===DIRECTOR||user(id).systemRole==='Director / Admin';
  const now=()=>new Date();
  const pct=(n,d)=>d?Math.round((n/d)*100):null;
  const pctText=v=>v==null?'—':`${v}%`;
  const hoursText=v=>v==null?'—':v<24?`${v.toFixed(v<10?1:0)} hrs`:`${(v/24).toFixed(1)} days`;
  const daysUntil=date=>date?Math.ceil((new Date(`${date}T23:59:59`)-now())/86400000):null;
  const priorityWeight=p=>p==='P0'?3:p==='P1'?2:1;
  const terminalApproval=a=>['Approved','Rejected','Cancelled'].includes(a.status);
  const approvalOverdue=a=>!terminalApproval(a)&&a.dueAt&&new Date(a.dueAt)<now();
  const taskDone=t=>t.status==='Completed';
  const taskSubmitted=t=>['Completed','Ready for Review'].includes(t.status);
  const taskOverdue=t=>!taskSubmitted(t)&&t.currentDue&&new Date(`${t.currentDue}T23:59:59`)<now();
  const hasRecordedDependency=t=>!!t.waitingOn||['Waiting','Blocked'].includes(t.status);

  function migratePerformance(){
    state.performanceReviews=Array.isArray(state.performanceReviews)?state.performanceReviews:[];
    state.performanceSnapshots=Array.isArray(state.performanceSnapshots)?state.performanceSnapshots:[];
    state.schemaVersion=PHASE;
    save();
  }

  function startOfPeriod(key=perfPeriod){
    const d=now();
    if(key==='month') return new Date(d.getFullYear(),d.getMonth(),1);
    if(key==='quarter') return new Date(d.getFullYear(),Math.floor(d.getMonth()/3)*3,1);
    if(key==='six'){const x=new Date(d);x.setMonth(x.getMonth()-6);return x}
    if(key==='fy') return new Date(d.getMonth()>=3?d.getFullYear():d.getFullYear()-1,3,1);
    return new Date(2000,0,1);
  }
  function periodLabel(key=perfPeriod){return ({month:'This Month',quarter:'Current Quarter',six:'Last 6 Months',fy:'Financial Year',all:'All Recorded'})[key]||'Current Quarter'}
  function dateInPeriod(value){if(!value)return true;const d=new Date(value.length===10?`${value}T23:59:59`:value);return d>=startOfPeriod()&&d<=now()}
  function taskInPeriod(t){return dateInPeriod(t.completedAt||t.currentDue||t.originalDue)}
  function approvalInPeriod(a){return dateInPeriod(a.completedAt||a.requestedAt)}

  function completionOnTime(t,dueField){
    if(!taskDone(t)||!t.completedAt||!t[dueField])return false;
    return new Date(t.completedAt)<=new Date(`${t[dueField]}T23:59:59`);
  }
  function decisionFor(a,uid){return a.decisions?.[uid]||null}
  function responseHours(a,uid){const d=decisionFor(a,uid);if(!d?.at||!a.requestedAt)return null;return Math.max(0,(new Date(d.at)-new Date(a.requestedAt))/3600000)}
  function average(nums){const v=nums.filter(x=>Number.isFinite(x));return v.length?v.reduce((a,b)=>a+b,0)/v.length:null}

  function employeeEvidence(uid){
    const tasks=state.tasks.filter(t=>t.owner===uid&&taskInPeriod(t));
    const completed=tasks.filter(taskDone);
    const submitted=tasks.filter(taskSubmitted);
    const overdue=tasks.filter(taskOverdue);
    const noDependencyOverdue=overdue.filter(t=>!hasRecordedDependency(t));
    const dependencies=tasks.filter(t=>!taskDone(t)&&hasRecordedDependency(t));
    const originalOnTime=completed.filter(t=>completionOnTime(t,'originalDue'));
    const adjustedOnTime=completed.filter(t=>completionOnTime(t,'currentDue'));
    const reschedules=tasks.reduce((s,t)=>s+(Number(t.reschedules)||0),0);
    const weightedDen=tasks.reduce((s,t)=>s+priorityWeight(t.priority),0);
    const weightedProgress=weightedDen?Math.round(tasks.reduce((s,t)=>s+priorityWeight(t.priority)*(Number(t.progress)||0),0)/weightedDen):0;
    const critical=tasks.filter(t=>['P0','P1'].includes(t.priority));
    const criticalDone=critical.filter(taskDone);
    const requested=state.approvals.filter(a=>a.requestedBy===uid&&approvalInPeriod(a));
    const approved=requested.filter(a=>a.status==='Approved');
    const firstPass=approved.filter(a=>(a.rounds||[]).length===0);
    const reviewIncoming=state.approvals.filter(a=>(a.approvers||[]).includes(uid)&&approvalInPeriod(a));
    const responseTimes=reviewIncoming.map(a=>responseHours(a,uid)).filter(x=>x!=null);
    const approvalBacklog=state.approvals.filter(a=>(a.approvers||[]).includes(uid)&&!terminalApproval(a));
    const approvalOverdueCount=approvalBacklog.filter(approvalOverdue).length;
    const changesRequired=tasks.filter(t=>t.status==='Changes Required').length+(requested.reduce((s,a)=>s+(a.rounds||[]).filter(r=>r.status==='Changes Requested').length,0));
    const comments=state.comments.filter(c=>c.user===uid&&dateInPeriod(c.time)).length;
    const ledProjects=state.projects.filter(p=>p.projectLead===uid&&p.lifecycle!=='Archived');
    const ledTasks=state.tasks.filter(t=>ledProjects.some(p=>p.id===t.project)&&taskInPeriod(t));
    const leadOverdue=ledTasks.filter(taskOverdue).length;
    const leadBlocked=ledTasks.filter(t=>!taskDone(t)&&hasRecordedDependency(t)).length;
    const leadReadiness=ledProjects.length?Math.round(ledProjects.reduce((s,p)=>s+projectReadiness(p),0)/ledProjects.length):null;
    const evidenceCount=tasks.length+reviewIncoming.filter(a=>decisionFor(a,uid)).length+requested.filter(terminalApproval).length;
    const confidence=evidenceCount>=15?'Established':evidenceCount>=7?'Building':'Limited';
    return {uid,tasks,completed,submitted,overdue,noDependencyOverdue,dependencies,originalOnTime,adjustedOnTime,reschedules,weightedProgress,critical,criticalDone,requested,approved,firstPass,reviewIncoming,responseTimes,approvalBacklog,approvalOverdueCount,changesRequired,comments,ledProjects,leadOverdue,leadBlocked,leadReadiness,confidence,evidenceCount};
  }

  function departmentEvidence(dept){
    const deptRecord=Array.isArray(state.departments)?state.departments.find(d=>d.id===dept||d.name===dept):null;
    const deptName=deptRecord?.name||dept;
    const members=state.users.filter(u=>u.active!==false&&(deptRecord?u.departmentId===deptRecord.id:u.dept===deptName));
    const ids=new Set(members.map(u=>u.id));
    const tasks=state.tasks.filter(t=>ids.has(t.owner)&&taskInPeriod(t));
    const completed=tasks.filter(taskDone);
    const overdue=tasks.filter(taskOverdue);
    const noDependencyOverdue=overdue.filter(t=>!hasRecordedDependency(t));
    const dependencies=tasks.filter(t=>!taskDone(t)&&hasRecordedDependency(t));
    const originalOnTime=completed.filter(t=>completionOnTime(t,'originalDue'));
    const adjustedOnTime=completed.filter(t=>completionOnTime(t,'currentDue'));
    const reschedules=tasks.reduce((s,t)=>s+(Number(t.reschedules)||0),0);
    const weightedDen=tasks.reduce((s,t)=>s+priorityWeight(t.priority),0);
    const weightedProgress=weightedDen?Math.round(tasks.reduce((s,t)=>s+priorityWeight(t.priority)*(Number(t.progress)||0),0)/weightedDen):0;
    const incomingApprovals=state.approvals.filter(a=>(a.approvers||[]).some(id=>ids.has(id))&&approvalInPeriod(a));
    const responseTimes=[];incomingApprovals.forEach(a=>(a.approvers||[]).filter(id=>ids.has(id)).forEach(id=>{const h=responseHours(a,id);if(h!=null)responseTimes.push(h)}));
    const approvalBacklog=state.approvals.filter(a=>(a.approvers||[]).some(id=>ids.has(id))&&!terminalApproval(a));
    const incomingDeps=state.tasks.filter(t=>t.waitingOn&&typeof t.waitingOn==='string'&&ids.has(t.waitingOn)&&!ids.has(t.owner)&&!taskDone(t));
    const outgoingDeps=tasks.filter(t=>!taskDone(t)&&t.waitingOn&&(!String(t.waitingOn).startsWith('u')||!ids.has(t.waitingOn)));
    const byProject=state.projects.map(p=>{const pt=tasks.filter(t=>t.project===p.id);return pt.length?{project:p,tasks:pt,progress:Math.round(pt.reduce((s,t)=>s+(Number(t.progress)||0),0)/pt.length)}:null}).filter(Boolean);
    return {dept:deptName,departmentId:deptRecord?.id||null,members,tasks,completed,overdue,noDependencyOverdue,dependencies,originalOnTime,adjustedOnTime,reschedules,weightedProgress,incomingApprovals,responseTimes,approvalBacklog,incomingDeps,outgoingDeps,byProject};
  }

  function projectReadiness(p){
    const ts=state.tasks.filter(t=>t.project===p.id);
    return ts.length?Math.round(ts.reduce((s,t)=>s+(Number(t.progress)||0),0)/ts.length):(Number(p.progress)||0);
  }
  function projectEvidence(p){
    const tasks=state.tasks.filter(t=>t.project===p.id&&taskInPeriod(t));
    const open=tasks.filter(t=>!taskDone(t));
    const overdue=open.filter(taskOverdue);
    const waiting=open.filter(hasRecordedDependency);
    const approvals=state.approvals.filter(a=>a.project===p.id&&approvalInPeriod(a));
    const pendingApprovals=approvals.filter(a=>!terminalApproval(a));
    return {p,tasks,open,overdue,waiting,approvals,pendingApprovals,readiness:projectReadiness(p),days:daysUntil(p.launch)};
  }

  function metricCard(label,value,note='',tone='',action=''){
    const tag=action?'button':'div';
    return `<${tag} class="perf-metric ${tone} ${action?'clickable':''}" ${action?`data-perf-evidence="${esc(action)}"`:''}><span>${esc(label)}</span><strong>${esc(value)}</strong>${note?`<small>${esc(note)}</small>`:''}</${tag}>`;
  }
  function miniBar(label,value,detail=''){
    const v=Math.max(0,Math.min(100,Number(value)||0));
    return `<div class="perf-bar-row"><div><span>${esc(label)}</span>${detail?`<small>${esc(detail)}</small>`:''}</div><div class="perf-bar"><i style="width:${v}%"></i></div><strong>${v}%</strong></div>`;
  }
  function evidenceBadge(e){return `<span class="perf-confidence ${e.confidence.toLowerCase()}">Evidence: ${e.confidence}</span>`}
  function approvalStatus(a){return a.status||'Pending'}

  function renderPerformance(){
    if(!isAdmin()){activeView='dashboard';toast('Performance & Growth is restricted to Director / Admin.');return}
    setTitle('Performance & Growth','ADMIN ONLY • EXECUTION EVIDENCE');
    const tabs=[['company','Company'],['individuals','Individuals'],['departments','Departments'],['leads','Project Leads'],['projects','Projects']];
    el('content').innerHTML=`<div class="perf-lock-banner"><div><span>ADMIN ONLY</span><strong>Performance evidence, not an automatic employment decision.</strong><p>Use delivery, quality, dependency and collaboration records as one input to management reviews. Salary and position decisions remain human decisions.</p></div><div class="perf-lock-icon">◇</div></div>
      <div class="perf-toolbar"><div class="perf-tabs">${tabs.map(([k,l])=>`<button class="${perfTab===k?'active':''}" data-perf-tab="${k}">${l}</button>`).join('')}</div><label class="perf-period"><span>Review period</span><select id="performancePeriod" class="select"><option value="month" ${perfPeriod==='month'?'selected':''}>This Month</option><option value="quarter" ${perfPeriod==='quarter'?'selected':''}>Current Quarter</option><option value="six" ${perfPeriod==='six'?'selected':''}>Last 6 Months</option><option value="fy" ${perfPeriod==='fy'?'selected':''}>Financial Year</option><option value="all" ${perfPeriod==='all'?'selected':''}>All Recorded</option></select></label></div>
      <div id="performanceBody">${renderPerfBody()}</div>`;
  }

  function renderPerfBody(){
    if(perfFocus?.type==='employee')return renderEmployeeProfile(perfFocus.id);
    if(perfFocus?.type==='department')return renderDepartmentProfile(perfFocus.id);
    if(perfFocus?.type==='lead')return renderLeadProfile(perfFocus.id);
    if(perfTab==='individuals')return renderIndividuals();
    if(perfTab==='departments')return renderDepartments();
    if(perfTab==='leads')return renderProjectLeads();
    if(perfTab==='projects')return renderProjectPerformance();
    return renderCompanyPerformance();
  }

  function renderCompanyPerformance(){
    const tasks=state.tasks.filter(taskInPeriod),open=tasks.filter(t=>!taskDone(t)),overdue=open.filter(taskOverdue),waiting=open.filter(hasRecordedDependency);
    const pendingApprovals=state.approvals.filter(a=>approvalInPeriod(a)&&!terminalApproval(a));
    const projects=state.projects.filter(p=>p.lifecycle!=='Archived'),avgReady=projects.length?Math.round(projects.reduce((s,p)=>s+projectReadiness(p),0)/projects.length):0;
    const depts=Array.isArray(state.departments)&&state.departments.length?state.departments.filter(d=>d.active!==false&&d.name!=='Management').map(d=>d.name).sort():[...new Set(state.users.filter(u=>u.active!==false&&u.dept!=='Management').map(u=>u.dept))].sort();
    const launched=state.projects.filter(p=>p.lifecycle==='Launched'&&dateInPeriod(p.launchedAt||p.launch));
    return `<div class="perf-section-head"><div><h2>Company Execution Overview</h2><p>${periodLabel()} • operational evidence across projects, people, departments and approvals.</p></div></div>
      <div class="perf-metrics-grid">${metricCard('Active / Recorded Projects',projects.length,'Portfolio under execution','indigo')}${metricCard('Portfolio Readiness',`${avgReady}%`,'Task-progress weighted view','sage')}${metricCard('Open Work',open.length,`${tasks.length} tasks in period`,'')}${metricCard('Overdue Work',overdue.length,`${overdue.filter(t=>!hasRecordedDependency(t)).length} without a recorded dependency`,'risk','company-overdue')}${metricCard('Dependency Holds',waiting.length,'Waiting / blocked work','amber','company-waiting')}${metricCard('Approval Backlog',pendingApprovals.length,`${pendingApprovals.filter(approvalOverdue).length} overdue`,'violet','company-approvals')}${metricCard('Projects Launched',launched.length,periodLabel(),'') }</div>
      <div class="perf-grid-2"><div class="panel"><div class="panel-head"><div><h3>Department operating view</h3><span>No ranking — inspect each department in its own operating context.</span></div></div><div class="panel-body perf-dept-list">${depts.map(d=>departmentSummaryCard(departmentEvidence(d))).join('')}</div></div>
      <div class="panel"><div class="panel-head"><div><h3>Execution signals requiring attention</h3><span>Facts to investigate, not verdicts.</span></div></div><div class="panel-body"><div class="perf-signal-list">${signalRow('Overdue without recorded dependency',overdue.filter(t=>!hasRecordedDependency(t)).length,'Review whether the owner had an unrecorded blocker.','company-overdue')}${signalRow('Approval decisions overdue',pendingApprovals.filter(approvalOverdue).length,'Cross-team decisions can become hidden bottlenecks.','company-approvals')}${signalRow('Tasks currently waiting / blocked',waiting.length,'Inspect which team or external party is holding work.','company-waiting')}${signalRow('Projects inside 30 days of launch',projects.filter(p=>{const d=daysUntil(p.launch);return d!=null&&d>=0&&d<=30&&p.lifecycle!=='Launched'}).length,'Compare readiness against launch-critical work.','launch-soon')}</div></div></div></div>
      <div class="panel perf-principles"><div><strong>Management use</strong><p>The module intentionally avoids a single employee score or automatic “raise / promotion” recommendation. The evidence should be combined with role scope, judgement, achievements outside tracked tasks, development goals and business context.</p></div><button class="btn btn-soft" id="openIndividualsFromCompany">Review Individuals</button></div>`;
  }

  function departmentSummaryCard(e){
    const ontime=pct(e.adjustedOnTime.length,e.completed.length),avgResponse=average(e.responseTimes);
    return `<button class="perf-dept-card" data-perf-dept="${esc(e.dept)}"><div class="perf-dept-top"><div><strong>${esc(e.dept)}</strong><span>${e.members.length} active member${e.members.length===1?'':'s'}</span></div><span>Open →</span></div><div class="perf-dept-stats"><div><b>${e.tasks.length}</b><span>Tasks</span></div><div><b>${e.overdue.length}</b><span>Overdue</span></div><div><b>${pctText(ontime)}</b><span>Adjusted on-time</span></div><div><b>${hoursText(avgResponse)}</b><span>Approval response</span></div></div></button>`;
  }
  function signalRow(title,value,note,action){return `<button class="perf-signal" data-perf-evidence="${action}"><span class="perf-signal-num">${value}</span><div><strong>${esc(title)}</strong><small>${esc(note)}</small></div><b>→</b></button>`}

  function renderIndividuals(){
    const rows=state.users.filter(u=>u.active!==false&&u.id!==DIRECTOR).map(u=>({u,e:employeeEvidence(u.id)}));
    return `<div class="perf-section-head"><div><h2>Individual Performance Evidence</h2><p>${periodLabel()} • click any person to inspect the work behind their metrics.</p></div></div><div class="panel"><div class="table-wrap"><table class="table perf-table"><thead><tr><th>Employee</th><th>Committed Work</th><th>Submitted / Done</th><th>Current Overdue</th><th>Dependency Holds</th><th>Reschedules</th><th>Weighted Progress</th><th>Approval Backlog</th><th></th></tr></thead><tbody>${rows.map(({u,e})=>`<tr><td>${person(u.id)}${evidenceBadge(e)}</td><td>${e.tasks.length}</td><td>${e.submitted.length}</td><td><strong class="${e.noDependencyOverdue.length?'perf-risk-text':''}">${e.overdue.length}</strong><div class="subtle">${e.noDependencyOverdue.length} without recorded dependency</div></td><td>${e.dependencies.length}</td><td>${e.reschedules}</td><td>${e.weightedProgress}%</td><td>${e.approvalBacklog.length}</td><td><button class="link-btn" data-perf-user="${u.id}">Open evidence →</button></td></tr>`).join('')}</tbody></table></div></div>`;
  }

  function renderEmployeeProfile(uid){
    const u=user(uid),e=employeeEvidence(uid),onOrig=pct(e.originalOnTime.length,e.completed.length),onAdj=pct(e.adjustedOnTime.length,e.completed.length),firstPass=pct(e.firstPass.length,e.approved.length),avgResponse=average(e.responseTimes);
    const reviews=state.performanceReviews.filter(r=>r.user===uid).sort((a,b)=>b.time.localeCompare(a.time));
    const positive=[];if(e.adjustedOnTime.length)positive.push(`${e.adjustedOnTime.length} completed task${e.adjustedOnTime.length===1?'':'s'} met the current committed date.`);if(e.firstPass.length)positive.push(`${e.firstPass.length} approval${e.firstPass.length===1?'':'s'} cleared on first pass.`);if(e.criticalDone.length)positive.push(`${e.criticalDone.length} P0/P1 task${e.criticalDone.length===1?'':'s'} completed.`);
    const discuss=[];if(e.noDependencyOverdue.length)discuss.push(`${e.noDependencyOverdue.length} overdue task${e.noDependencyOverdue.length===1?'':'s'} currently have no recorded dependency.`);if(e.reschedules)discuss.push(`${e.reschedules} accepted deadline revision${e.reschedules===1?'':'s'} recorded.`);if(e.changesRequired)discuss.push(`${e.changesRequired} rework / changes-requested signal${e.changesRequired===1?'':'s'} recorded.`);if(e.approvalOverdueCount)discuss.push(`${e.approvalOverdueCount} approval${e.approvalOverdueCount===1?'':'s'} waiting on this employee are overdue.`);
    return `<button class="link-btn perf-back" data-perf-back="individuals">← Back to Individuals</button><div class="perf-profile-head"><div>${avatar(uid)}<div><span>${esc(u.dept)} • ${esc(u.role)}</span><h2>${esc(u.name)}</h2><div>${evidenceBadge(e)} <span class="perf-period-chip">${periodLabel()}</span></div></div></div><button class="btn btn-soft" data-perf-review="${uid}">Add Management Review</button></div>
      <div class="perf-metrics-grid">${metricCard('Work Commitments',e.tasks.length,'Tasks owned in review period')}${metricCard('Submitted / Completed',e.submitted.length,`${e.completed.length} formally completed`,'sage',`user-submitted:${uid}`)}${metricCard('Original On-time',pctText(onOrig),e.completed.length?`${e.originalOnTime.length}/${e.completed.length} completed`:'Completion evidence not mature','indigo')}${metricCard('Adjusted On-time',pctText(onAdj),'Uses current approved due date','sage')}${metricCard('Overdue Now',e.overdue.length,`${e.noDependencyOverdue.length} without recorded dependency`,'risk',`user-overdue:${uid}`)}${metricCard('Dependency Holds',e.dependencies.length,'Waiting / blocked work','amber',`user-waiting:${uid}`)}${metricCard('Deadline Revisions',e.reschedules,'Accepted revisions on owned tasks','')}${metricCard('First-pass Approval',pctText(firstPass),e.approved.length?`${e.firstPass.length}/${e.approved.length} approvals`:'Not enough closed approvals','violet')}${metricCard('Avg Approval Response',hoursText(avgResponse),`${e.approvalBacklog.length} currently waiting on employee`,'')}${metricCard('Weighted Work Progress',`${e.weightedProgress}%`,'P0 work carries more weight','')}${metricCard('P0/P1 Completed',`${e.criticalDone.length}/${e.critical.length}`,'Critical & high-priority work','')}${metricCard('Projects Led',e.ledProjects.length,e.ledProjects.length?`${e.leadReadiness??0}% avg readiness`:'No Project Lead assignment','')}</div>
      <div class="perf-grid-2"><div class="panel"><div class="panel-head"><div><h3>Evidence for management discussion</h3><span>These are traceable operating signals, not a promotion or salary verdict.</span></div></div><div class="panel-body"><div class="perf-evidence-columns"><div><h4>Positive evidence</h4>${positive.length?positive.map(x=>`<div class="perf-evidence-line positive">✓ ${esc(x)}</div>`).join(''):'<div class="subtle">More completed work is needed before a meaningful pattern emerges.</div>'}</div><div><h4>Discuss / investigate</h4>${discuss.length?discuss.map(x=>`<div class="perf-evidence-line discuss">• ${esc(x)}</div>`).join(''):'<div class="subtle">No material exception signals in the recorded period.</div>'}</div></div></div></div>
      <div class="panel"><div class="panel-head"><div><h3>Role & leadership context</h3><span>Individual execution is kept separate from Project Lead responsibility.</span></div></div><div class="panel-body">${e.ledProjects.length?`<div class="perf-lead-mini">${e.ledProjects.map(p=>{const pe=projectEvidence(p);return `<button data-perf-project="${p.id}"><strong>${esc(p.name)}</strong><span>${pe.readiness}% ready • ${pe.overdue.length} overdue • ${pe.waiting.length} waiting</span></button>`}).join('')}</div><div class="perf-lead-summary"><div><span>Lead-project overdue</span><strong>${e.leadOverdue}</strong></div><div><span>Lead-project blockers</span><strong>${e.leadBlocked}</strong></div><div><span>Avg readiness</span><strong>${e.leadReadiness??0}%</strong></div></div>`:'<div class="empty"><strong>No Project Lead assignment</strong>Leadership metrics will appear when this employee is assigned as Project Lead.</div>'}</div></div></div>
      <div class="panel"><div class="panel-head"><div><h3>Management Review History</h3><span>Private Director/Admin notes stored separately from task activity.</span></div></div><div class="panel-body">${reviews.length?reviews.map(r=>`<div class="perf-review-card"><div><strong>${esc(r.period)}</strong><span>${fmtTime(r.time)} • ${esc(user(r.author).name)}</span></div>${r.strengths?`<p><b>Strengths:</b> ${esc(r.strengths)}</p>`:''}${r.concerns?`<p><b>Concerns:</b> ${esc(r.concerns)}</p>`:''}${r.achievements?`<p><b>Achievements outside tracked tasks:</b> ${esc(r.achievements)}</p>`:''}${r.goals?`<p><b>Development goals:</b> ${esc(r.goals)}</p>`:''}${r.notes?`<p><b>Role / compensation discussion notes:</b> ${esc(r.notes)}</p>`:''}</div>`).join(''):'<div class="empty"><strong>No management review recorded yet</strong>Add a review when you want to preserve qualitative context beside the platform evidence.</div>'}</div></div>`;
  }

  const lens={'Technology / Development':'Delivery reliability • quality/rework • deployment blockers','Graphics & Creative':'Turnaround • approval quality • revision cycles • launch asset readiness','Digital Marketing':'Calendar adherence • approval flow • campaign readiness',Product:'Product completion • content accuracy • programme readiness • dependency handling','Vendor Management':'Supplier closure • follow-up responsiveness • dependency resolution','Sales & Queries':'Follow-up discipline • validation turnaround • launch-enablement work','Tour Operations':'Readiness • handover quality • issue closure • escalation response',Technology:'Delivery reliability • quality/rework • deployment blockers',Creative:'Turnaround • approval quality • revision cycles • launch asset readiness',Marketing:'Calendar adherence • approval flow • campaign readiness',Vendor:'Supplier closure • follow-up responsiveness • dependency resolution',Sales:'Follow-up discipline • validation turnaround • launch-enablement work',Operations:'Readiness • handover quality • issue closure • escalation response',Management:'Portfolio execution • decision turnaround • leadership capacity'};

  function renderDepartments(){
    const depts=Array.isArray(state.departments)&&state.departments.length?state.departments.filter(d=>d.active!==false&&d.name!=='Management').map(d=>d.name).sort():[...new Set(state.users.filter(u=>u.active!==false&&u.dept!=='Management').map(u=>u.dept))].sort();
    return `<div class="perf-section-head"><div><h2>Department Performance Evidence</h2><p>${periodLabel()} • based on employees' formal department membership from People & Departments, not project categories/workstreams.</p></div></div><div class="perf-department-grid">${depts.map(d=>departmentSummaryCard(departmentEvidence(d))).join('')}</div>`;
  }

  function renderDepartmentProfile(dept){
    const e=departmentEvidence(dept),orig=pct(e.originalOnTime.length,e.completed.length),adj=pct(e.adjustedOnTime.length,e.completed.length),avgResponse=average(e.responseTimes);
    const workloads=e.members.map(u=>({u,count:e.tasks.filter(t=>t.owner===u.id&&!taskDone(t)).length,over:e.tasks.filter(t=>t.owner===u.id&&taskOverdue(t)).length}));
    return `<button class="link-btn perf-back" data-perf-back="departments">← Back to Departments</button><div class="perf-section-head"><div><span class="eyebrow">DEPARTMENT</span><h2>${esc(dept)}</h2><p>${esc(lens[dept]||'Delivery • quality • collaboration • dependency handling')}</p></div></div>
      <div class="perf-metrics-grid">${metricCard('Active Members',e.members.length,'Team members in department')}${metricCard('Work Commitments',e.tasks.length,`${e.completed.length} completed`)}${metricCard('Original On-time',pctText(orig),'Completed work vs original date','indigo')}${metricCard('Adjusted On-time',pctText(adj),'Completed work vs approved current date','sage')}${metricCard('Current Overdue',e.overdue.length,`${e.noDependencyOverdue.length} without recorded dependency`,'risk',`dept-overdue:${dept}`)}${metricCard('Dependency Holds',e.dependencies.length,`${e.outgoingDeps.length} waiting outside department`,'amber',`dept-waiting:${dept}`)}${metricCard('Approval Backlog',e.approvalBacklog.length,`${e.approvalBacklog.filter(approvalOverdue).length} overdue`,'violet')}${metricCard('Avg Approval Response',hoursText(avgResponse),'For recorded decisions')}${metricCard('Deadline Revisions',e.reschedules,'Across department-owned tasks')}${metricCard('Weighted Work Progress',`${e.weightedProgress}%`,'Priority-weighted active work')}${metricCard('Waiting on Department',e.incomingDeps.length,'Cross-team dependency inflow','')}${metricCard('Department Waiting Out',e.outgoingDeps.length,'External / cross-team dependency outflow','')}</div>
      <div class="perf-grid-2"><div class="panel"><div class="panel-head"><div><h3>Workload distribution</h3><span>Workload is context for performance — not a judgement by itself.</span></div></div><div class="panel-body">${workloads.map(w=>{const max=Math.max(1,...workloads.map(x=>x.count));return `<button class="perf-workload-row" data-perf-user="${w.u.id}"><div>${avatar(w.u.id)}<div><strong>${esc(w.u.name)}</strong><span>${w.count} open • ${w.over} overdue</span></div></div><div class="perf-workload-bar"><i style="width:${Math.round(w.count/max*100)}%"></i></div><span>Open profile →</span></button>`}).join('')}</div></div>
      <div class="panel"><div class="panel-head"><div><h3>Project contribution</h3><span>Where work owned by this department's employees is currently concentrated.</span></div></div><div class="panel-body">${e.byProject.length?e.byProject.map(x=>miniBar(x.project.name,x.progress,`${x.tasks.length} task${x.tasks.length===1?'':'s'}`)).join(''):'<div class="empty"><strong>No work in this period</strong>No department-owned project tasks fall inside the selected period.</div>'}</div></div></div>`;
  }

  function leadRows(){return state.users.filter(u=>state.projects.some(p=>p.projectLead===u.id&&p.lifecycle!=='Archived')).map(u=>{const e=employeeEvidence(u.id);return {u,e}})}
  function renderProjectLeads(){
    const rows=leadRows();
    return `<div class="perf-section-head"><div><h2>Project Lead Performance</h2><p>Leadership evidence is separated from the employee's own task delivery.</p></div></div><div class="panel"><div class="table-wrap"><table class="table perf-table"><thead><tr><th>Project Lead</th><th>Projects Led</th><th>Avg Readiness</th><th>Overdue Across Led Projects</th><th>Waiting / Blocked</th><th>Launch Risk</th><th></th></tr></thead><tbody>${rows.map(({u,e})=>{const past=e.ledProjects.filter(p=>{const d=daysUntil(p.launch);return d!=null&&d<0&&p.lifecycle!=='Launched'}).length;return `<tr><td>${person(u.id)}</td><td>${e.ledProjects.length}<div class="subtle">${e.ledProjects.map(p=>p.code).join(' • ')}</div></td><td>${e.leadReadiness??0}%</td><td>${e.leadOverdue}</td><td>${e.leadBlocked}</td><td>${past?`<span class="status-pill overdue">${past} past target</span>`:'<span class="status-pill on-track">No past target</span>'}</td><td><button class="link-btn" data-perf-lead="${u.id}">Open leadership evidence →</button></td></tr>`}).join('')}</tbody></table></div></div>`;
  }
  function renderLeadProfile(uid){
    const u=user(uid),e=employeeEvidence(uid);
    return `<button class="link-btn perf-back" data-perf-back="leads">← Back to Project Leads</button><div class="perf-profile-head"><div>${avatar(uid)}<div><span>PROJECT LEAD EVIDENCE</span><h2>${esc(u.name)}</h2><div><span class="perf-period-chip">${periodLabel()}</span></div></div></div><button class="btn btn-ghost" data-perf-user="${uid}">Open Individual Evidence</button></div>
      <div class="perf-metrics-grid">${metricCard('Projects Led',e.ledProjects.length,'Current recorded portfolio')}${metricCard('Average Readiness',`${e.leadReadiness??0}%`,'Across projects led','sage')}${metricCard('Overdue Work',e.leadOverdue,'Across project-team tasks','risk')}${metricCard('Waiting / Blocked',e.leadBlocked,'Dependencies requiring coordination','amber')}</div>
      <div class="perf-project-cards">${e.ledProjects.map(p=>projectPerfCard(projectEvidence(p))).join('')||'<div class="empty"><strong>No projects led</strong>No Project Lead responsibility is recorded.</div>'}</div>`;
  }

  function renderProjectPerformance(){
    const rows=state.projects.filter(p=>p.lifecycle!=='Archived').map(projectEvidence);
    return `<div class="perf-section-head"><div><h2>Project Performance</h2><p>Launch readiness, delivery pressure and dependency evidence across the portfolio.</p></div></div><div class="perf-project-cards">${rows.map(projectPerfCard).join('')}</div>`;
  }
  function projectPerfCard(e){
    const p=e.p,d=e.days;
    return `<button class="perf-project-card" data-perf-project="${p.id}"><div class="perf-project-top"><div><span>${esc(p.category)} • ${esc(p.code)}</span><strong>${esc(p.name)}</strong><small>Project Lead: ${esc(user(p.projectLead).name)}</small></div><div class="perf-project-ready"><b>${e.readiness}%</b><span>ready</span></div></div><div class="perf-project-stats"><div><b>${e.open.length}</b><span>Open</span></div><div><b>${e.overdue.length}</b><span>Overdue</span></div><div><b>${e.waiting.length}</b><span>Waiting</span></div><div><b>${e.pendingApprovals.length}</b><span>Approvals</span></div></div><div class="perf-project-foot"><span>${d==null?'No launch date':d<0?`${Math.abs(d)} days past target`:d===0?'Launch today':`${d} days to launch`}</span><b>Open project →</b></div></button>`;
  }

  function evidenceLists(key){
    const [type,arg]=String(key).split(':');
    if(type==='company-overdue')return {title:'Company • Overdue Work',note:'Open tasks whose current due date has passed.',tasks:state.tasks.filter(t=>taskInPeriod(t)&&taskOverdue(t))};
    if(type==='company-waiting')return {title:'Company • Dependency Holds',note:'Open work with a recorded waiting-on person, external dependency or blocked status.',tasks:state.tasks.filter(t=>taskInPeriod(t)&&!taskDone(t)&&hasRecordedDependency(t))};
    if(type==='company-approvals')return {title:'Company • Approval Backlog',note:'Formal decisions still open in the selected period.',approvals:state.approvals.filter(a=>approvalInPeriod(a)&&!terminalApproval(a))};
    if(type==='launch-soon')return {title:'Projects Near Launch',note:'Projects inside 30 days of their launch target.',projects:state.projects.filter(p=>{const d=daysUntil(p.launch);return d!=null&&d>=0&&d<=30&&p.lifecycle!=='Launched'})};
    if(type==='user-submitted')return {title:`${user(arg).name} • Submitted / Completed`,note:'Work formally submitted for review or completed.',tasks:employeeEvidence(arg).submitted};
    if(type==='user-overdue')return {title:`${user(arg).name} • Current Overdue`,note:'Overdue work. Dependency status is shown so the context remains visible.',tasks:employeeEvidence(arg).overdue};
    if(type==='user-waiting')return {title:`${user(arg).name} • Dependency Holds`,note:'Owned tasks waiting on another person, approval or external input.',tasks:employeeEvidence(arg).dependencies};
    if(type==='dept-overdue')return {title:`${arg} • Current Overdue`,note:'Department-owned overdue work.',tasks:departmentEvidence(arg).overdue};
    if(type==='dept-waiting')return {title:`${arg} • Dependency Holds`,note:'Department-owned tasks currently waiting or blocked.',tasks:departmentEvidence(arg).dependencies};
    return {title:'Performance Evidence',note:'No evidence list is available for this signal.'};
  }

  function openEvidence(key){
    const e=evidenceLists(key),tasks=e.tasks||[],approvals=e.approvals||[],projects=e.projects||[];
    el('modalTitle').textContent=e.title;el('modalBody').innerHTML=`<div class="perf-modal-intro">${esc(e.note||'')}</div>${tasks.length?`<div class="perf-evidence-list">${tasks.map(t=>`<button data-perf-task="${t.id}"><div><strong>${esc(t.title)}</strong><span>${esc(project(t.project)?.name||'')} • ${esc(t.workstream)} • ${esc(user(t.owner).name)}</span></div><div>${statusPill(taskOverdue(t)?'Overdue':t.status)}<small>Due ${fmtDate(t.currentDue)}</small></div></button>`).join('')}</div>`:''}${approvals.length?`<div class="perf-evidence-list">${approvals.map(a=>`<div class="perf-evidence-static"><div><strong>${esc(a.title)}</strong><span>${esc(user(a.requestedBy).name)} → ${(a.approvers||[]).map(id=>esc(user(id).name)).join(', ')}</span></div><div><span class="status-pill ${approvalOverdue(a)?'overdue':'review'}">${approvalOverdue(a)?'Overdue':esc(approvalStatus(a))}</span><small>${a.dueAt?new Date(a.dueAt).toLocaleString('en-IN',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}):''}</small></div></div>`).join('')}</div>`:''}${projects.length?`<div class="perf-evidence-list">${projects.map(p=>`<button data-perf-project="${p.id}"><div><strong>${esc(p.name)}</strong><span>${esc(user(p.projectLead).name)} • ${projectReadiness(p)}% ready</span></div><div><small>${p.launch?fmtDateFull(p.launch):'No launch date'}</small></div></button>`).join('')}</div>`:''}${!tasks.length&&!approvals.length&&!projects.length?'<div class="empty"><strong>No records</strong>No matching evidence is recorded for this period.</div>':''}<div class="modal-actions"><button class="btn btn-soft" id="closePerfEvidence">Close</button></div>`;el('modalBackdrop').classList.add('open');el('closePerfEvidence').onclick=()=>el('modalBackdrop').classList.remove('open');document.querySelectorAll('[data-perf-task]').forEach(b=>b.onclick=()=>{el('modalBackdrop').classList.remove('open');openTask(b.dataset.perfTask)});document.querySelectorAll('#modalBody [data-perf-project]').forEach(b=>b.onclick=()=>{el('modalBackdrop').classList.remove('open');openPerfProject(b.dataset.perfProject)});
  }

  function openReview(uid){
    if(!isAdmin())return;
    const u=user(uid);
    el('modalTitle').textContent=`Management Review • ${u.name}`;
    el('modalBody').innerHTML=`<form id="performanceReviewForm" class="form-stack"><div class="perf-review-note">Private Director/Admin context. This complements platform evidence and should capture important work that task metrics may miss.</div><label class="form-field"><span>Review period</span><input class="input" name="period" value="${esc(periodLabel())}" required></label><label class="form-field"><span>Strengths / positive contribution</span><textarea class="textarea" name="strengths" placeholder="What has the employee done particularly well?"></textarea></label><label class="form-field"><span>Concerns / discussion points</span><textarea class="textarea" name="concerns" placeholder="What needs discussion or closer context?"></textarea></label><label class="form-field"><span>Achievements outside tracked tasks</span><textarea class="textarea" name="achievements" placeholder="Client rescue, mentoring, problem solving, initiative, etc."></textarea></label><label class="form-field"><span>Development goals</span><textarea class="textarea" name="goals" placeholder="Skills, ownership or leadership goals for the next period."></textarea></label><label class="form-field"><span>Role / compensation discussion notes</span><textarea class="textarea" name="notes" placeholder="Private management notes. The system does not make the decision."></textarea></label><div class="modal-actions"><button type="button" class="btn btn-ghost" id="cancelPerformanceReview">Cancel</button><button class="btn btn-soft" type="submit">Save Review</button></div></form>`;
    el('modalBackdrop').classList.add('open');el('cancelPerformanceReview').onclick=()=>el('modalBackdrop').classList.remove('open');el('performanceReviewForm').onsubmit=ev=>{ev.preventDefault();const fd=new FormData(ev.target);state.performanceReviews.push({id:'pr'+Date.now(),user:uid,author:state.currentUser,time:new Date().toISOString(),period:String(fd.get('period')||periodLabel()),strengths:String(fd.get('strengths')||''),concerns:String(fd.get('concerns')||''),achievements:String(fd.get('achievements')||''),goals:String(fd.get('goals')||''),notes:String(fd.get('notes')||'')});log(state.currentUser,null,null,'Performance',`added a private management review for ${u.name}`,String(fd.get('period')||periodLabel()));save();el('modalBackdrop').classList.remove('open');toast('Management review saved.');render()};
  }

  function openPerfProject(pid){activeProject=pid;activeProjectTab='overview';activeView='projects';document.querySelectorAll('.nav-item').forEach(n=>n.classList.toggle('active',n.dataset.view==='projects'));render()}

  function syncPerformanceNav(){
    const nav=el('nav');if(!nav)return;
    let btn=nav.querySelector('[data-view="performance"]');
    if(isAdmin()){
      if(!btn){btn=document.createElement('button');btn.className='nav-item perf-nav-item';btn.dataset.view='performance';btn.innerHTML='<span>◇</span> Performance & Growth';const activity=nav.querySelector('[data-view="activity"]');if(activity)nav.insertBefore(btn,activity);else nav.appendChild(btn)}
      btn.classList.toggle('active',activeView==='performance');
      btn.onclick=()=>{perfFocus=null;activeView='performance';activeProject=null;document.querySelectorAll('.nav-item').forEach(n=>n.classList.toggle('active',n===btn));render()};
    }else if(btn){btn.remove();if(activeView==='performance'){activeView='dashboard';activeProject=null}}
  }

  const baseRender17=render;
  render=function(search=''){
    syncPerformanceNav();
    if(!activeProject&&activeView==='performance'){
      if(!isAdmin()){activeView='dashboard';baseRender17(search);syncPerformanceNav();return}
      renderPerformance();wireDynamic();syncPerformanceNav();return;
    }
    baseRender17(search);syncPerformanceNav();
  };

  const baseWire17=wireDynamic;
  wireDynamic=function(){
    baseWire17();syncPerformanceNav();
    document.querySelectorAll('[data-perf-tab]').forEach(b=>b.onclick=()=>{perfTab=b.dataset.perfTab;perfFocus=null;render()});
    const pp=el('performancePeriod');if(pp)pp.onchange=()=>{perfPeriod=pp.value;perfFocus=null;render()};
    document.querySelectorAll('[data-perf-user]').forEach(b=>b.onclick=e=>{e.stopPropagation();perfFocus={type:'employee',id:b.dataset.perfUser};perfTab='individuals';activeView='performance';render()});
    document.querySelectorAll('[data-perf-dept]').forEach(b=>b.onclick=()=>{perfFocus={type:'department',id:b.dataset.perfDept};perfTab='departments';render()});
    document.querySelectorAll('[data-perf-lead]').forEach(b=>b.onclick=()=>{perfFocus={type:'lead',id:b.dataset.perfLead};perfTab='leads';render()});
    document.querySelectorAll('[data-perf-back]').forEach(b=>b.onclick=()=>{perfTab=b.dataset.perfBack;perfFocus=null;render()});
    document.querySelectorAll('[data-perf-evidence]').forEach(b=>b.onclick=()=>openEvidence(b.dataset.perfEvidence));
    document.querySelectorAll('[data-perf-project]').forEach(b=>b.onclick=e=>{e.stopPropagation();openPerfProject(b.dataset.perfProject)});
    document.querySelectorAll('[data-perf-review]').forEach(b=>b.onclick=()=>openReview(b.dataset.perfReview));
    const oi=el('openIndividualsFromCompany');if(oi)oi.onclick=()=>{perfTab='individuals';perfFocus=null;render()};
    // Admin-only quick entry from Team cards.
    if(isAdmin())document.querySelectorAll('.edit-member').forEach(edit=>{const holder=edit.parentElement;if(holder&&!holder.querySelector('.performance-member')){const b=document.createElement('button');b.className='btn btn-ghost performance-member';b.type='button';b.textContent='Performance';b.dataset.perfUser=edit.dataset.user;b.onclick=()=>{perfTab='individuals';perfFocus={type:'employee',id:edit.dataset.user};activeView='performance';activeProject=null;render()};holder.insertBefore(b,edit)}});
  };

  migratePerformance();syncPerformanceNav();render();
})();
